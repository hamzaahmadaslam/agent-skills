-- Read-only: one SELECT. Nothing here changes data, settings or tables.
--
-- Stock ledger for a store whose orders are in posts storage (woocommerce_custom_orders_table_enabled is not yes).
-- One row per product or variation that manages its own stock (_manage_stock = 'yes'):
--   stock                  _stock, the number the product page shows
--   live_held              units held by draft or pending orders whose hold has not expired
--   available_to_shoppers  stock - live_held, what a new shopper can buy now
--   reduced_processing     units already taken off _stock by processing orders (item meta _reduced_stock)
--   reduced_on_hold        the same for on-hold orders
-- A variation whose stock is managed by its parent has no row of its own: its holds and reductions are on the
-- parent's row, as WooCommerce keeps them (get_stock_managed_by_id()).
--
-- Usage (fill in the prefix; the output is tab-separated with a header row):
--   sed 's/{prefix}/wp_/g' stock-ledger-posts.sql | wp db query > ledger.tsv
--   node reconcile-counts.mjs --ledger=ledger.tsv --counts=counts.csv
-- The query reads every stock-managed product and every processing and on-hold order (scan). Run it at a quiet hour,
-- right after the shelf count, so that orders placed in between do not shift the numbers.
-- Output: product IDs, SKUs and numbers only. Sources: references/stock-reduction-and-restore.md.

SELECT p.ID AS product_id,
       p.post_parent AS parent_id,
       p.post_type AS product_type,
       (SELECT MAX(pm.meta_value) FROM {prefix}postmeta pm
         WHERE pm.post_id = p.ID AND pm.meta_key = '_sku') AS sku,
       (SELECT MAX(CAST(pm.meta_value AS DECIMAL(20,4))) FROM {prefix}postmeta pm
         WHERE pm.post_id = p.ID AND pm.meta_key = '_stock') AS stock,
       (SELECT MAX(pm.meta_value) FROM {prefix}postmeta pm
         WHERE pm.post_id = p.ID AND pm.meta_key = '_stock_status') AS stock_status,
       COALESCE(h.live_held, 0) AS live_held,
       (SELECT MAX(CAST(pm.meta_value AS DECIMAL(20,4))) FROM {prefix}postmeta pm
         WHERE pm.post_id = p.ID AND pm.meta_key = '_stock') - COALESCE(h.live_held, 0) AS available_to_shoppers,
       COALESCE(r.reduced_processing, 0) AS reduced_processing,
       COALESCE(r.reduced_on_hold, 0) AS reduced_on_hold
FROM {prefix}posts p
JOIN {prefix}postmeta ms ON ms.post_id = p.ID AND ms.meta_key = '_manage_stock' AND ms.meta_value = 'yes'
LEFT JOIN (SELECT rs.product_id, SUM(rs.stock_quantity) AS live_held
           FROM {prefix}wc_reserved_stock rs
           JOIN {prefix}posts o ON o.ID = rs.order_id
           WHERE o.post_status IN ('wc-checkout-draft', 'wc-pending')
             AND rs.expires > NOW()
           GROUP BY rs.product_id) h ON h.product_id = p.ID
LEFT JOIN (SELECT CASE WHEN vms.meta_value = 'yes' THEN CAST(vid.meta_value AS UNSIGNED)
                       WHEN pms.meta_value = 'yes' THEN CAST(pid.meta_value AS UNSIGNED)
                  END AS stock_owner_id,
                  SUM(CASE WHEN o.post_status = 'wc-processing' THEN CAST(rsd.meta_value AS DECIMAL(20,4)) ELSE 0 END)
                    AS reduced_processing,
                  SUM(CASE WHEN o.post_status = 'wc-on-hold' THEN CAST(rsd.meta_value AS DECIMAL(20,4)) ELSE 0 END)
                    AS reduced_on_hold
           FROM {prefix}posts o
           JOIN {prefix}woocommerce_order_items oi ON oi.order_id = o.ID AND oi.order_item_type = 'line_item'
           JOIN {prefix}woocommerce_order_itemmeta rsd ON rsd.order_item_id = oi.order_item_id
                                                      AND rsd.meta_key = '_reduced_stock'
           LEFT JOIN {prefix}woocommerce_order_itemmeta pid ON pid.order_item_id = oi.order_item_id
                                                           AND pid.meta_key = '_product_id'
           LEFT JOIN {prefix}woocommerce_order_itemmeta vid ON vid.order_item_id = oi.order_item_id
                                                           AND vid.meta_key = '_variation_id'
           LEFT JOIN {prefix}postmeta pms ON pms.post_id = CAST(pid.meta_value AS UNSIGNED)
                                         AND pms.meta_key = '_manage_stock'
           LEFT JOIN {prefix}postmeta vms ON vms.post_id = CAST(vid.meta_value AS UNSIGNED)
                                         AND vms.meta_key = '_manage_stock'
           WHERE o.post_type = 'shop_order'
             AND o.post_status IN ('wc-processing', 'wc-on-hold')
           GROUP BY stock_owner_id) r ON r.stock_owner_id = p.ID
WHERE p.post_type IN ('product', 'product_variation')
  AND p.post_status <> 'trash'
ORDER BY p.ID;
