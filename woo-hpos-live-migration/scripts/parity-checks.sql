-- Read-only: every statement below is a SELECT. Nothing here changes data, settings or tables.
--
-- Parity checks between WordPress posts order storage and High-Performance Order Storage (HPOS).
-- Placeholders, filled in by hpos-readonly-report.sh (or by hand):
--   {prefix}       the table prefix of the site, from `wp db prefix` (per site on multisite: wp db prefix --url=...)
--   {order_types}  quoted, comma-separated order types, for example 'shop_order','shop_order_refund'.
--                  List them with: wp eval 'echo implode( ",", wc_get_order_types( "cot-migration" ) );'
-- Each block starts with a "-- name:" line and holds one statement; the report script runs them one at a time, so a
-- failing block (for example before the HPOS tables exist) does not stop the others.
-- Several blocks join large tables. On a big store run them against a staging copy or a read replica, or at a quiet
-- hour.
-- Table and column names: WooCommerce 11.1.2 OrdersTableDataStore::get_database_schema(), DataSynchronizer constants,
-- and the Action Scheduler schema. See references/verification.md for what each result should be.

-- name: Orders by type and status in the posts table
SELECT post_type, post_status, COUNT(*) AS orders
FROM {prefix}posts
WHERE post_type IN ({order_types}, 'shop_order_placehold')
GROUP BY post_type, post_status
ORDER BY post_type, post_status;

-- name: Orders by type and status in the HPOS orders table
SELECT type, status, COUNT(*) AS orders
FROM {prefix}wc_orders
GROUP BY type, status
ORDER BY type, status;

-- name: Order posts with no HPOS row (0 once the backfill into HPOS is complete)
SELECT COUNT(*) AS missing_in_hpos
FROM {prefix}posts p
LEFT JOIN {prefix}wc_orders o ON o.id = p.ID
WHERE p.post_type IN ({order_types})
  AND p.post_status <> 'auto-draft'
  AND o.id IS NULL;

-- name: HPOS orders whose post is missing or only a placeholder (0 while compatibility mode is on)
SELECT COUNT(*) AS hpos_only
FROM {prefix}wc_orders o
LEFT JOIN {prefix}posts p ON p.ID = o.id
WHERE o.type IN ({order_types})
  AND o.status <> 'auto-draft'
  AND (p.ID IS NULL OR p.post_type = 'shop_order_placehold');

-- name: Orders whose modified dates differ between the two copies, by direction
SELECT
  COALESCE(SUM(o.date_updated_gmt > p.post_modified_gmt), 0) AS hpos_newer,
  COALESCE(SUM(o.date_updated_gmt < p.post_modified_gmt), 0) AS posts_newer
FROM {prefix}wc_orders o
JOIN {prefix}posts p ON p.ID = o.id
WHERE p.post_type IN ({order_types});

-- name: Status mismatches between the two copies
SELECT COUNT(*) AS status_mismatch
FROM {prefix}wc_orders o
JOIN {prefix}posts p ON p.ID = o.id
WHERE p.post_type IN ({order_types})
  AND NOT (o.status <=> p.post_status);

-- name: Order total mismatches, shop_order only (posts _order_total meta vs HPOS total_amount; empty after cleanup)
SELECT COUNT(*) AS total_mismatch
FROM {prefix}wc_orders o
JOIN {prefix}postmeta pm ON pm.post_id = o.id AND pm.meta_key = '_order_total'
WHERE o.type = 'shop_order'
  AND NOT (CAST(pm.meta_value AS DECIMAL(26,8)) <=> o.total_amount);

-- name: Order count and total per storage, shop_order only, excluding auto-draft and trash
SELECT 'hpos' AS storage, COUNT(*) AS orders, SUM(o.total_amount) AS total
FROM {prefix}wc_orders o
WHERE o.type = 'shop_order'
  AND o.status NOT IN ('auto-draft', 'trash')
UNION ALL
SELECT 'posts' AS storage, COUNT(DISTINCT p.ID) AS orders, SUM(CAST(pm.meta_value AS DECIMAL(26,8))) AS total
FROM {prefix}posts p
LEFT JOIN {prefix}postmeta pm ON pm.post_id = p.ID AND pm.meta_key = '_order_total'
WHERE p.post_type = 'shop_order'
  AND p.post_status NOT IN ('auto-draft', 'trash');

-- name: Deletion records waiting for the next sync (_deleted_from, by side)
SELECT meta_value AS deleted_from, COUNT(*) AS records
FROM {prefix}wc_orders_meta
WHERE meta_key = '_deleted_from'
GROUP BY meta_value;

-- name: Placeholder posts and post meta rows still attached to orders (sizes a cleanup)
SELECT
  (SELECT COUNT(*) FROM {prefix}posts WHERE post_type = 'shop_order_placehold') AS placeholder_posts,
  (SELECT COUNT(*)
     FROM {prefix}postmeta pm
     JOIN {prefix}posts p ON p.ID = pm.post_id
     WHERE p.post_type IN ({order_types}, 'shop_order_placehold')) AS order_postmeta_rows;

-- name: Sync and batch actions in Action Scheduler, by hook and status (is_order_sync = 1 for the order synchronizer)
SELECT a.hook,
       (a.args LIKE '%DataSynchronizer%') AS is_order_sync,
       a.status,
       COUNT(*) AS actions,
       MAX(a.last_attempt_gmt) AS last_attempt_gmt
FROM {prefix}actionscheduler_actions a
WHERE a.hook IN ('wc_schedule_pending_batch_processes', 'wc_run_batch_process',
                 'woocommerce_custom_orders_table_background_sync')
GROUP BY a.hook, is_order_sync, a.status
ORDER BY a.hook, is_order_sync, a.status;

-- name: Latest log messages of failed batch actions
SELECT a.action_id, a.status, a.last_attempt_gmt, l.message
FROM {prefix}actionscheduler_actions a
JOIN {prefix}actionscheduler_logs l ON l.action_id = a.action_id
WHERE a.hook = 'wc_run_batch_process'
  AND a.status = 'failed'
ORDER BY l.log_id DESC
LIMIT 10;

-- name: Newest 20 HPOS orders (feed these IDs to wp wc hpos diff)
SELECT id, type, status, date_updated_gmt
FROM {prefix}wc_orders
ORDER BY id DESC
LIMIT 20;

-- name: Rows in the Analytics lookup table wc_order_stats (information only)
SELECT COUNT(*) AS wc_order_stats_rows
FROM {prefix}wc_order_stats;
