-- Read-only: every statement below is a SELECT. Nothing here changes data, settings or tables.
--
-- Stock reservation checks for one WooCommerce site: the database clock, stock settings, reservation rows by order
-- status, live holds per product against _stock, unpaid orders past the hold time, on-hold orders, and orders whose
-- line items disagree with their status about deducted stock (_reduced_stock).
--
-- Placeholder, filled in by reservation-readonly-report.sh (or by hand):
--   {prefix}  the site's table prefix, from `wp db prefix` (per site on multisite: wp db prefix --url=...)
-- Each block starts with a "-- name:" line and holds one statement. Blocks whose name ends in "(HPOS)" read the
-- wc_orders tables; blocks ending in "(posts)" read posts and postmeta. Run the set that matches the store's
-- authoritative order storage (option woocommerce_custom_orders_table_enabled); the report script does this.
-- Blocks marked "(scan)" read many rows. On a big store run them on a replica or staging copy, or at a quiet hour.
-- Output: counts, product IDs, SKUs, order IDs, statuses and dates. No names, emails, addresses or payment data.
--
-- Table and column names: WooCommerce 11.1.2 (class-wc-install.php, OrdersTableDataStore::get_database_schema()),
-- WordPress 7.1.2 schema. Status values: OrderInternalStatus ('wc-pending', ...) and DraftOrders ('wc-checkout-draft').
-- A hold counts when its order is 'wc-checkout-draft' or 'wc-pending' and expires > NOW(), the same test WooCommerce
-- uses (ReserveStock::get_query_for_reserved_stock()). expires is compared with NOW() because WooCommerce writes it
-- with NOW(). references/*.md explain each result.

-- name: Database clock (expires is written and compared with NOW())
SELECT NOW() AS db_now,
       UTC_TIMESTAMP() AS db_utc_now,
       @@session.time_zone AS session_time_zone,
       @@system_time_zone AS system_time_zone;

-- name: Stock settings (options)
SELECT option_name, option_value
FROM {prefix}options
WHERE option_name IN ('woocommerce_version', 'woocommerce_schema_version', 'woocommerce_manage_stock',
                      'woocommerce_hold_stock_minutes', 'woocommerce_custom_orders_table_enabled',
                      'woocommerce_custom_orders_table_data_sync_enabled', 'woocommerce_stock_format',
                      'woocommerce_notify_no_stock_amount')
ORDER BY option_name;

-- name: Hold minutes in effect (60 when the option is missing, 0 when blank: no holds and no cancel event)
SELECT CASE WHEN COUNT(*) = 0 THEN 60
            WHEN MAX(option_value) = '' THEN 0
            ELSE MAX(CAST(option_value AS UNSIGNED)) END AS hold_minutes_in_effect
FROM {prefix}options
WHERE option_name = 'woocommerce_hold_stock_minutes';

-- name: Reservation rows: total, not expired, expired
SELECT COUNT(*) AS reservation_rows,
       COALESCE(SUM(expires > NOW()), 0) AS not_expired_rows,
       COALESCE(SUM(expires <= NOW()), 0) AS expired_rows,
       MIN(`timestamp`) AS oldest_written,
       MAX(expires) AS latest_expiry
FROM {prefix}wc_reserved_stock;

-- name: Reservation rows by order status (HPOS)
SELECT COALESCE(o.status, '(order missing)') AS order_status,
       COUNT(*) AS reservation_rows,
       COALESCE(SUM(rs.expires > NOW()), 0) AS not_expired_rows,
       COALESCE(SUM(rs.stock_quantity), 0) AS units_in_rows,
       COALESCE(SUM(CASE WHEN rs.expires > NOW() AND o.status IN ('wc-checkout-draft', 'wc-pending')
                         THEN rs.stock_quantity ELSE 0 END), 0) AS units_counting
FROM {prefix}wc_reserved_stock rs
LEFT JOIN {prefix}wc_orders o ON o.id = rs.order_id
GROUP BY COALESCE(o.status, '(order missing)')
ORDER BY reservation_rows DESC;

-- name: Reservation rows by order status (posts)
SELECT COALESCE(p.post_status, '(order missing)') AS order_status,
       COUNT(*) AS reservation_rows,
       COALESCE(SUM(rs.expires > NOW()), 0) AS not_expired_rows,
       COALESCE(SUM(rs.stock_quantity), 0) AS units_in_rows,
       COALESCE(SUM(CASE WHEN rs.expires > NOW() AND p.post_status IN ('wc-checkout-draft', 'wc-pending')
                         THEN rs.stock_quantity ELSE 0 END), 0) AS units_counting
FROM {prefix}wc_reserved_stock rs
LEFT JOIN {prefix}posts p ON p.ID = rs.order_id
GROUP BY COALESCE(p.post_status, '(order missing)')
ORDER BY reservation_rows DESC;

-- name: Reservation rows that do not count: expired, order missing, or order not draft or pending (HPOS)
SELECT COUNT(*) AS rows_not_counting,
       COALESCE(SUM(rs.expires <= NOW()), 0) AS expired,
       COALESCE(SUM(o.id IS NULL), 0) AS order_missing,
       COALESCE(SUM(o.id IS NOT NULL AND o.status NOT IN ('wc-checkout-draft', 'wc-pending')), 0) AS other_status
FROM {prefix}wc_reserved_stock rs
LEFT JOIN {prefix}wc_orders o ON o.id = rs.order_id
WHERE rs.expires <= NOW()
   OR o.id IS NULL
   OR o.status NOT IN ('wc-checkout-draft', 'wc-pending');

-- name: Reservation rows that do not count: expired, order missing, or order not draft or pending (posts)
SELECT COUNT(*) AS rows_not_counting,
       COALESCE(SUM(rs.expires <= NOW()), 0) AS expired,
       COALESCE(SUM(p.ID IS NULL), 0) AS order_missing,
       COALESCE(SUM(p.ID IS NOT NULL AND p.post_status NOT IN ('wc-checkout-draft', 'wc-pending')), 0) AS other_status
FROM {prefix}wc_reserved_stock rs
LEFT JOIN {prefix}posts p ON p.ID = rs.order_id
WHERE rs.expires <= NOW()
   OR p.ID IS NULL
   OR p.post_status NOT IN ('wc-checkout-draft', 'wc-pending');

-- name: Live holds per product against _stock, top 100 by units held (HPOS)
SELECT h.product_id,
       h.holding_orders,
       h.live_held,
       (SELECT MAX(CAST(pm.meta_value AS DECIMAL(20,4))) FROM {prefix}postmeta pm
         WHERE pm.post_id = h.product_id AND pm.meta_key = '_stock') AS stock,
       (SELECT MAX(CAST(pm.meta_value AS DECIMAL(20,4))) FROM {prefix}postmeta pm
         WHERE pm.post_id = h.product_id AND pm.meta_key = '_stock') - h.live_held AS available_to_shoppers,
       (SELECT MAX(pm.meta_value) FROM {prefix}postmeta pm
         WHERE pm.post_id = h.product_id AND pm.meta_key = '_stock_status') AS stock_status
FROM (SELECT rs.product_id,
             COUNT(DISTINCT rs.order_id) AS holding_orders,
             SUM(rs.stock_quantity) AS live_held
      FROM {prefix}wc_reserved_stock rs
      JOIN {prefix}wc_orders o ON o.id = rs.order_id
      WHERE o.status IN ('wc-checkout-draft', 'wc-pending')
        AND rs.expires > NOW()
      GROUP BY rs.product_id) h
ORDER BY h.live_held DESC, h.product_id
LIMIT 100;

-- name: Live holds per product against _stock, top 100 by units held (posts)
SELECT h.product_id,
       h.holding_orders,
       h.live_held,
       (SELECT MAX(CAST(pm.meta_value AS DECIMAL(20,4))) FROM {prefix}postmeta pm
         WHERE pm.post_id = h.product_id AND pm.meta_key = '_stock') AS stock,
       (SELECT MAX(CAST(pm.meta_value AS DECIMAL(20,4))) FROM {prefix}postmeta pm
         WHERE pm.post_id = h.product_id AND pm.meta_key = '_stock') - h.live_held AS available_to_shoppers,
       (SELECT MAX(pm.meta_value) FROM {prefix}postmeta pm
         WHERE pm.post_id = h.product_id AND pm.meta_key = '_stock_status') AS stock_status
FROM (SELECT rs.product_id,
             COUNT(DISTINCT rs.order_id) AS holding_orders,
             SUM(rs.stock_quantity) AS live_held
      FROM {prefix}wc_reserved_stock rs
      JOIN {prefix}posts p ON p.ID = rs.order_id
      WHERE p.post_status IN ('wc-checkout-draft', 'wc-pending')
        AND rs.expires > NOW()
      GROUP BY rs.product_id) h
ORDER BY h.live_held DESC, h.product_id
LIMIT 100;

-- name: Products held by two or more unpaid orders with the same billing email, emails not shown (HPOS)
SELECT rs.product_id,
       COUNT(DISTINCT rs.order_id) AS unpaid_orders_same_email,
       SUM(CASE WHEN rs.expires > NOW() THEN rs.stock_quantity ELSE 0 END) AS live_units,
       GROUP_CONCAT(DISTINCT rs.order_id ORDER BY rs.order_id SEPARATOR ',') AS order_ids
FROM {prefix}wc_reserved_stock rs
JOIN {prefix}wc_orders o ON o.id = rs.order_id
WHERE o.status IN ('wc-checkout-draft', 'wc-pending')
  AND o.billing_email IS NOT NULL AND o.billing_email <> ''
GROUP BY rs.product_id, o.billing_email
HAVING COUNT(DISTINCT rs.order_id) > 1
ORDER BY live_units DESC
LIMIT 50;

-- name: Products held by two or more unpaid orders with the same billing email, emails not shown (posts)
SELECT rs.product_id,
       COUNT(DISTINCT rs.order_id) AS unpaid_orders_same_email,
       SUM(CASE WHEN rs.expires > NOW() THEN rs.stock_quantity ELSE 0 END) AS live_units,
       GROUP_CONCAT(DISTINCT rs.order_id ORDER BY rs.order_id SEPARATOR ',') AS order_ids
FROM {prefix}wc_reserved_stock rs
JOIN {prefix}posts p ON p.ID = rs.order_id
JOIN {prefix}postmeta em ON em.post_id = p.ID AND em.meta_key = '_billing_email'
WHERE p.post_status IN ('wc-checkout-draft', 'wc-pending')
  AND em.meta_value <> ''
GROUP BY rs.product_id, em.meta_value
HAVING COUNT(DISTINCT rs.order_id) > 1
ORDER BY live_units DESC
LIMIT 50;

-- name: Unpaid orders past the hold time, by status and created_via (HPOS)
SELECT o.status,
       COALESCE(od.created_via, '') AS created_via,
       CASE WHEN o.status = 'wc-pending' AND od.created_via IN ('checkout', 'store-api')
            THEN 'yes' ELSE 'no' END AS cancel_event_would_cancel,
       COUNT(*) AS orders,
       MIN(o.date_updated_gmt) AS oldest_last_change_gmt
FROM {prefix}wc_orders o
LEFT JOIN {prefix}wc_order_operational_data od ON od.order_id = o.id
CROSS JOIN (SELECT CASE WHEN COUNT(*) = 0 THEN 60
                        WHEN MAX(option_value) = '' THEN 0
                        ELSE MAX(CAST(option_value AS UNSIGNED)) END AS minutes
            FROM {prefix}options
            WHERE option_name = 'woocommerce_hold_stock_minutes') h
WHERE o.type = 'shop_order'
  AND o.status IN ('wc-pending', 'wc-checkout-draft')
  AND h.minutes > 0
  AND o.date_updated_gmt < UTC_TIMESTAMP() - INTERVAL h.minutes MINUTE
GROUP BY o.status, COALESCE(od.created_via, ''), cancel_event_would_cancel
ORDER BY orders DESC;

-- name: Unpaid orders past the hold time, by status and created_via (posts)
-- The cancel event compares post_modified in site time; post_modified_gmt holds the same moment in UTC.
SELECT p.post_status AS status,
       COALESCE(cv.meta_value, '') AS created_via,
       CASE WHEN p.post_status = 'wc-pending' AND cv.meta_value IN ('checkout', 'store-api')
            THEN 'yes' ELSE 'no' END AS cancel_event_would_cancel,
       COUNT(*) AS orders,
       MIN(p.post_modified_gmt) AS oldest_last_change_gmt
FROM {prefix}posts p
LEFT JOIN {prefix}postmeta cv ON cv.post_id = p.ID AND cv.meta_key = '_created_via'
CROSS JOIN (SELECT CASE WHEN COUNT(*) = 0 THEN 60
                        WHEN MAX(option_value) = '' THEN 0
                        ELSE MAX(CAST(option_value AS UNSIGNED)) END AS minutes
            FROM {prefix}options
            WHERE option_name = 'woocommerce_hold_stock_minutes') h
WHERE p.post_type = 'shop_order'
  AND p.post_status IN ('wc-pending', 'wc-checkout-draft')
  AND h.minutes > 0
  AND p.post_modified_gmt < UTC_TIMESTAMP() - INTERVAL h.minutes MINUTE
GROUP BY p.post_status, COALESCE(cv.meta_value, ''), cancel_event_would_cancel
ORDER BY orders DESC;

-- name: Unpaid orders holding units now, oldest first, top 50 (HPOS)
SELECT o.id AS order_id,
       o.status,
       COALESCE(od.created_via, '') AS created_via,
       o.date_created_gmt,
       o.date_updated_gmt,
       SUM(rs.stock_quantity) AS units_held,
       MAX(rs.expires) AS hold_expires
FROM {prefix}wc_reserved_stock rs
JOIN {prefix}wc_orders o ON o.id = rs.order_id
LEFT JOIN {prefix}wc_order_operational_data od ON od.order_id = o.id
WHERE o.status IN ('wc-checkout-draft', 'wc-pending')
  AND rs.expires > NOW()
GROUP BY o.id, o.status, od.created_via, o.date_created_gmt, o.date_updated_gmt
ORDER BY o.date_created_gmt
LIMIT 50;

-- name: Unpaid orders holding units now, oldest first, top 50 (posts)
SELECT p.ID AS order_id,
       p.post_status AS status,
       COALESCE(cv.meta_value, '') AS created_via,
       p.post_date_gmt AS date_created_gmt,
       p.post_modified_gmt AS date_updated_gmt,
       SUM(rs.stock_quantity) AS units_held,
       MAX(rs.expires) AS hold_expires
FROM {prefix}wc_reserved_stock rs
JOIN {prefix}posts p ON p.ID = rs.order_id
LEFT JOIN {prefix}postmeta cv ON cv.post_id = p.ID AND cv.meta_key = '_created_via'
WHERE p.post_status IN ('wc-checkout-draft', 'wc-pending')
  AND rs.expires > NOW()
GROUP BY p.ID, p.post_status, cv.meta_value, p.post_date_gmt, p.post_modified_gmt
ORDER BY p.post_date_gmt
LIMIT 50;

-- name: On-hold orders by age, with units they deducted (never auto-cancelled) (HPOS)
SELECT CASE WHEN o.date_created_gmt >= UTC_TIMESTAMP() - INTERVAL 1 DAY THEN '1: under 1 day'
            WHEN o.date_created_gmt >= UTC_TIMESTAMP() - INTERVAL 7 DAY THEN '2: 1 to 7 days'
            WHEN o.date_created_gmt >= UTC_TIMESTAMP() - INTERVAL 30 DAY THEN '3: 7 to 30 days'
            ELSE '4: over 30 days' END AS age,
       COUNT(DISTINCT o.id) AS orders,
       COALESCE(SUM(CAST(im.meta_value AS DECIMAL(20,4))), 0) AS units_deducted
FROM {prefix}wc_orders o
LEFT JOIN {prefix}woocommerce_order_items oi ON oi.order_id = o.id AND oi.order_item_type = 'line_item'
LEFT JOIN {prefix}woocommerce_order_itemmeta im ON im.order_item_id = oi.order_item_id AND im.meta_key = '_reduced_stock'
WHERE o.type = 'shop_order'
  AND o.status = 'wc-on-hold'
GROUP BY age
ORDER BY age;

-- name: On-hold orders by age, with units they deducted (never auto-cancelled) (posts)
SELECT CASE WHEN p.post_date_gmt >= UTC_TIMESTAMP() - INTERVAL 1 DAY THEN '1: under 1 day'
            WHEN p.post_date_gmt >= UTC_TIMESTAMP() - INTERVAL 7 DAY THEN '2: 1 to 7 days'
            WHEN p.post_date_gmt >= UTC_TIMESTAMP() - INTERVAL 30 DAY THEN '3: 7 to 30 days'
            ELSE '4: over 30 days' END AS age,
       COUNT(DISTINCT p.ID) AS orders,
       COALESCE(SUM(CAST(im.meta_value AS DECIMAL(20,4))), 0) AS units_deducted
FROM {prefix}posts p
LEFT JOIN {prefix}woocommerce_order_items oi ON oi.order_id = p.ID AND oi.order_item_type = 'line_item'
LEFT JOIN {prefix}woocommerce_order_itemmeta im ON im.order_item_id = oi.order_item_id AND im.meta_key = '_reduced_stock'
WHERE p.post_type = 'shop_order'
  AND p.post_status = 'wc-on-hold'
GROUP BY age
ORDER BY age;

-- name: Units still deducted by draft, pending, cancelled or failed orders, top 100 (HPOS)
SELECT o.id AS order_id,
       o.status,
       o.date_updated_gmt,
       COUNT(*) AS items_with_reduced_stock,
       SUM(CAST(im.meta_value AS DECIMAL(20,4))) AS units_still_deducted
FROM {prefix}wc_orders o
JOIN {prefix}woocommerce_order_items oi ON oi.order_id = o.id AND oi.order_item_type = 'line_item'
JOIN {prefix}woocommerce_order_itemmeta im ON im.order_item_id = oi.order_item_id AND im.meta_key = '_reduced_stock'
WHERE o.type = 'shop_order'
  AND o.status IN ('wc-checkout-draft', 'wc-pending', 'wc-cancelled', 'wc-failed')
  AND CAST(im.meta_value AS DECIMAL(20,4)) <> 0
GROUP BY o.id, o.status, o.date_updated_gmt
ORDER BY o.date_updated_gmt DESC
LIMIT 100;

-- name: Units still deducted by draft, pending, cancelled or failed orders, top 100 (posts)
SELECT p.ID AS order_id,
       p.post_status AS status,
       p.post_modified_gmt AS date_updated_gmt,
       COUNT(*) AS items_with_reduced_stock,
       SUM(CAST(im.meta_value AS DECIMAL(20,4))) AS units_still_deducted
FROM {prefix}posts p
JOIN {prefix}woocommerce_order_items oi ON oi.order_id = p.ID AND oi.order_item_type = 'line_item'
JOIN {prefix}woocommerce_order_itemmeta im ON im.order_item_id = oi.order_item_id AND im.meta_key = '_reduced_stock'
WHERE p.post_type = 'shop_order'
  AND p.post_status IN ('wc-checkout-draft', 'wc-pending', 'wc-cancelled', 'wc-failed')
  AND CAST(im.meta_value AS DECIMAL(20,4)) <> 0
GROUP BY p.ID, p.post_status, p.post_modified_gmt
ORDER BY p.post_modified_gmt DESC
LIMIT 100;

-- name: Paid orders of the last 90 days with stock-managed items never deducted, top 100 (scan) (HPOS)
-- The stock owner is the variation when its _manage_stock is 'yes', else the parent product when the parent's is
-- 'yes' (WC_Product_Variation::get_manage_stock()). This reads today's settings, not those at the time of the order.
SELECT o.id AS order_id,
       o.status,
       o.date_created_gmt,
       COUNT(*) AS items_not_deducted,
       SUM(CAST(q.meta_value AS DECIMAL(20,4))) AS units_not_deducted
FROM {prefix}wc_orders o
JOIN {prefix}woocommerce_order_items oi ON oi.order_id = o.id AND oi.order_item_type = 'line_item'
LEFT JOIN {prefix}woocommerce_order_itemmeta rsd ON rsd.order_item_id = oi.order_item_id AND rsd.meta_key = '_reduced_stock'
LEFT JOIN {prefix}woocommerce_order_itemmeta q ON q.order_item_id = oi.order_item_id AND q.meta_key = '_qty'
LEFT JOIN {prefix}woocommerce_order_itemmeta pid ON pid.order_item_id = oi.order_item_id AND pid.meta_key = '_product_id'
LEFT JOIN {prefix}woocommerce_order_itemmeta vid ON vid.order_item_id = oi.order_item_id AND vid.meta_key = '_variation_id'
LEFT JOIN {prefix}postmeta pms ON pms.post_id = CAST(pid.meta_value AS UNSIGNED) AND pms.meta_key = '_manage_stock'
LEFT JOIN {prefix}postmeta vms ON vms.post_id = CAST(vid.meta_value AS UNSIGNED) AND vms.meta_key = '_manage_stock'
WHERE o.type = 'shop_order'
  AND o.status IN ('wc-processing', 'wc-completed', 'wc-on-hold')
  AND o.date_created_gmt >= UTC_TIMESTAMP() - INTERVAL 90 DAY
  AND rsd.meta_id IS NULL
  AND (vms.meta_value = 'yes' OR pms.meta_value = 'yes')
GROUP BY o.id, o.status, o.date_created_gmt
ORDER BY o.date_created_gmt DESC
LIMIT 100;

-- name: Paid orders of the last 90 days with stock-managed items never deducted, top 100 (scan) (posts)
SELECT p.ID AS order_id,
       p.post_status AS status,
       p.post_date_gmt AS date_created_gmt,
       COUNT(*) AS items_not_deducted,
       SUM(CAST(q.meta_value AS DECIMAL(20,4))) AS units_not_deducted
FROM {prefix}posts p
JOIN {prefix}woocommerce_order_items oi ON oi.order_id = p.ID AND oi.order_item_type = 'line_item'
LEFT JOIN {prefix}woocommerce_order_itemmeta rsd ON rsd.order_item_id = oi.order_item_id AND rsd.meta_key = '_reduced_stock'
LEFT JOIN {prefix}woocommerce_order_itemmeta q ON q.order_item_id = oi.order_item_id AND q.meta_key = '_qty'
LEFT JOIN {prefix}woocommerce_order_itemmeta pid ON pid.order_item_id = oi.order_item_id AND pid.meta_key = '_product_id'
LEFT JOIN {prefix}woocommerce_order_itemmeta vid ON vid.order_item_id = oi.order_item_id AND vid.meta_key = '_variation_id'
LEFT JOIN {prefix}postmeta pms ON pms.post_id = CAST(pid.meta_value AS UNSIGNED) AND pms.meta_key = '_manage_stock'
LEFT JOIN {prefix}postmeta vms ON vms.post_id = CAST(vid.meta_value AS UNSIGNED) AND vms.meta_key = '_manage_stock'
WHERE p.post_type = 'shop_order'
  AND p.post_status IN ('wc-processing', 'wc-completed', 'wc-on-hold')
  AND p.post_date_gmt >= UTC_TIMESTAMP() - INTERVAL 90 DAY
  AND rsd.meta_id IS NULL
  AND (vms.meta_value = 'yes' OR pms.meta_value = 'yes')
GROUP BY p.ID, p.post_status, p.post_date_gmt
ORDER BY p.post_date_gmt DESC
LIMIT 100;

-- name: Order flag "stock reduced" against item records, orders of the last 90 days, by status (a hint only) (scan) (HPOS)
SELECT t.status, t.flag_stock_reduced, t.items_have_reduced_stock, COUNT(*) AS orders
FROM (SELECT o.status,
             COALESCE(od.order_stock_reduced, 0) AS flag_stock_reduced,
             CASE WHEN EXISTS (SELECT 1 FROM {prefix}woocommerce_order_items oi
                               JOIN {prefix}woocommerce_order_itemmeta im ON im.order_item_id = oi.order_item_id
                               WHERE oi.order_id = o.id AND im.meta_key = '_reduced_stock')
                  THEN 'yes' ELSE 'no' END AS items_have_reduced_stock
      FROM {prefix}wc_orders o
      LEFT JOIN {prefix}wc_order_operational_data od ON od.order_id = o.id
      WHERE o.type = 'shop_order'
        AND o.date_created_gmt >= UTC_TIMESTAMP() - INTERVAL 90 DAY) t
GROUP BY t.status, t.flag_stock_reduced, t.items_have_reduced_stock
ORDER BY t.status, t.flag_stock_reduced, t.items_have_reduced_stock;

-- name: Order flag "stock reduced" against item records, orders of the last 90 days, by status (a hint only) (scan) (posts)
SELECT t.status, t.flag_stock_reduced, t.items_have_reduced_stock, COUNT(*) AS orders
FROM (SELECT p.post_status AS status,
             COALESCE(fl.meta_value, '(none)') AS flag_stock_reduced,
             CASE WHEN EXISTS (SELECT 1 FROM {prefix}woocommerce_order_items oi
                               JOIN {prefix}woocommerce_order_itemmeta im ON im.order_item_id = oi.order_item_id
                               WHERE oi.order_id = p.ID AND im.meta_key = '_reduced_stock')
                  THEN 'yes' ELSE 'no' END AS items_have_reduced_stock
      FROM {prefix}posts p
      LEFT JOIN {prefix}postmeta fl ON fl.post_id = p.ID AND fl.meta_key = '_order_stock_reduced'
      WHERE p.post_type = 'shop_order'
        AND p.post_date_gmt >= UTC_TIMESTAMP() - INTERVAL 90 DAY) t
GROUP BY t.status, t.flag_stock_reduced, t.items_have_reduced_stock
ORDER BY t.status, t.flag_stock_reduced, t.items_have_reduced_stock;

-- name: Storage engine of the tables the reservation locks (InnoDB expected)
SELECT TABLE_NAME AS table_name, ENGINE AS engine
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('{prefix}wc_reserved_stock', '{prefix}postmeta', '{prefix}posts', '{prefix}wc_orders')
ORDER BY TABLE_NAME;
