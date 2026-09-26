-- Read-only: every statement below is a SELECT. Nothing here changes data, settings or tables.
--
-- Checkout performance checks for one WooCommerce site: sessions, saved carts, transients, autoloaded options, Action
-- Scheduler, orders and drafts on the checkout path, place-order debug markers, reserved stock, webhooks, table sizes,
-- engines and indexes.
-- Placeholders, filled in by checkout-readonly-report.sh (or by hand):
--   {prefix}       the site's table prefix, from `wp db prefix` (per site on multisite: wp db prefix --url=...)
--   {base_prefix}  the network's base prefix for users and usermeta (the same as {prefix} on a single site)
-- Each block starts with a "-- name:" line and holds one statement; the report script runs them one at a time, so a
-- block that fails (for example HPOS tables on a store without them) does not stop the others.
-- Blocks marked "(scan)" read whole tables. On a big store run them on a replica or staging copy, or at a quiet hour.
-- Output contains counts, sizes, dates, hook names and option names only: no customer data.
-- Table and column names: WooCommerce 11.1.2 (class-wc-install.php, OrdersTableDataStore::get_database_schema()),
-- Action Scheduler 4.0.0 schema, WordPress 7.1.2 schema. references/*.md explain what each result means.

-- name: Sessions: rows, expired, guests and customers, stored size (scan)
SELECT COUNT(*) AS sessions,
       COALESCE(SUM(session_expiry < UNIX_TIMESTAMP()), 0) AS expired,
       COALESCE(SUM(LEFT(session_key, 2) = 't_'), 0) AS guest_sessions,
       COALESCE(SUM(LEFT(session_key, 2) <> 't_'), 0) AS customer_sessions,
       ROUND(COALESCE(SUM(LENGTH(session_value)), 0) / 1048576, 1) AS value_mb,
       ROUND(COALESCE(AVG(LENGTH(session_value)), 0)) AS avg_value_bytes,
       COALESCE(MAX(LENGTH(session_value)), 0) AS max_value_bytes
FROM {prefix}woocommerce_sessions;

-- name: Sessions by expiry day (guests expire 2 days after their last activity by default) (scan)
SELECT DATE(FROM_UNIXTIME(session_expiry)) AS expiry_day,
       SUM(LEFT(session_key, 2) = 't_') AS guest_sessions,
       SUM(LEFT(session_key, 2) <> 't_') AS customer_sessions
FROM {prefix}woocommerce_sessions
GROUP BY expiry_day
ORDER BY expiry_day DESC
LIMIT 40;

-- name: Session cleanup runs in Action Scheduler (hook woocommerce_cleanup_sessions, WooCommerce 10.1.0 and later)
SELECT status,
       COUNT(*) AS actions,
       MAX(last_attempt_gmt) AS last_attempt_gmt,
       MIN(scheduled_date_gmt) AS earliest_scheduled_gmt
FROM {prefix}actionscheduler_actions
WHERE hook = 'woocommerce_cleanup_sessions'
GROUP BY status;

-- name: Saved carts of signed-in customers in user meta (_woocommerce_persistent_cart_*)
SELECT COUNT(*) AS saved_carts,
       ROUND(COALESCE(SUM(LENGTH(meta_value)), 0) / 1048576, 1) AS mb
FROM {base_prefix}usermeta
WHERE meta_key LIKE '\_woocommerce\_persistent\_cart\_%';

-- name: Transients in the options table: rows, size, autoloaded rows
SELECT COALESCE(SUM(option_name NOT LIKE '\_transient\_timeout\_%' AND option_name NOT LIKE '\_site\_transient\_timeout\_%'), 0) AS transients,
       COALESCE(SUM(option_name LIKE '\_transient\_timeout\_%' OR option_name LIKE '\_site\_transient\_timeout\_%'), 0) AS timeout_rows,
       ROUND(COALESCE(SUM(LENGTH(option_value)), 0) / 1024) AS kb,
       COALESCE(SUM(autoload IN ('yes', 'on', 'auto-on', 'auto')), 0) AS autoloaded_rows,
       ROUND(COALESCE(SUM(CASE WHEN autoload IN ('yes', 'on', 'auto-on', 'auto') THEN LENGTH(option_value) ELSE 0 END), 0) / 1024) AS autoloaded_kb
FROM {prefix}options
WHERE option_name LIKE '\_transient\_%' OR option_name LIKE '\_site\_transient\_%';

-- name: Expired transients (value rows whose timeout has passed) in the options table (network transients of a multisite are in sitemeta, not counted)
SELECT 'transient' AS kind, COUNT(*) AS expired
FROM {prefix}options t
JOIN {prefix}options o ON o.option_name = CONCAT('_transient_timeout_', SUBSTRING(t.option_name, 12))
WHERE t.option_name LIKE '\_transient\_%'
  AND t.option_name NOT LIKE '\_transient\_timeout\_%'
  AND o.option_value < UNIX_TIMESTAMP()
UNION ALL
SELECT 'site_transient' AS kind, COUNT(*) AS expired
FROM {prefix}options t
JOIN {prefix}options o ON o.option_name = CONCAT('_site_transient_timeout_', SUBSTRING(t.option_name, 17))
WHERE t.option_name LIKE '\_site\_transient\_%'
  AND t.option_name NOT LIKE '\_site\_transient\_timeout\_%'
  AND o.option_value < UNIX_TIMESTAMP();

-- name: Largest autoloaded transients, digits masked in case a name holds an IP or ID (top 10; MySQL 8.0+, MariaDB 10.0.5+)
SELECT REGEXP_REPLACE(option_name, '[0-9]', '#') AS option_name_masked, LENGTH(option_value) AS bytes, autoload
FROM {prefix}options
WHERE (option_name LIKE '\_transient\_%' OR option_name LIKE '\_site\_transient\_%')
  AND autoload IN ('yes', 'on', 'auto-on', 'auto')
ORDER BY bytes DESC
LIMIT 10;

-- name: Autoloaded options overall (Site Health suggests an object cache above 500 rows or about 100 KB)
SELECT COUNT(*) AS autoloaded_rows,
       ROUND(COALESCE(SUM(LENGTH(option_value)), 0) / 1024) AS autoloaded_kb
FROM {prefix}options
WHERE autoload IN ('yes', 'on', 'auto-on', 'auto');

-- name: Action Scheduler actions by status
SELECT status,
       COUNT(*) AS actions,
       MIN(scheduled_date_gmt) AS oldest_scheduled_gmt,
       MAX(scheduled_date_gmt) AS newest_scheduled_gmt
FROM {prefix}actionscheduler_actions
GROUP BY status
ORDER BY status;

-- name: Past-due pending actions (more than 1 hour and more than 1 day late)
SELECT COALESCE(SUM(scheduled_date_gmt < UTC_TIMESTAMP() - INTERVAL 1 HOUR), 0) AS past_due_over_1h,
       COALESCE(SUM(scheduled_date_gmt < UTC_TIMESTAMP() - INTERVAL 1 DAY), 0) AS past_due_over_1d
FROM {prefix}actionscheduler_actions
WHERE status = 'pending';

-- name: Pending actions by hook and group (top 15)
SELECT a.hook,
       g.slug AS action_group,
       COUNT(*) AS pending,
       COALESCE(SUM(a.scheduled_date_gmt < UTC_TIMESTAMP()), 0) AS due_now,
       MIN(a.scheduled_date_gmt) AS oldest_gmt
FROM {prefix}actionscheduler_actions a
LEFT JOIN {prefix}actionscheduler_groups g ON g.group_id = a.group_id
WHERE a.status = 'pending'
GROUP BY a.hook, g.slug
ORDER BY pending DESC
LIMIT 15;

-- name: Failed actions in the last 7 days by hook
SELECT hook,
       COUNT(*) AS failed,
       MAX(last_attempt_gmt) AS last_failure_gmt
FROM {prefix}actionscheduler_actions
WHERE status = 'failed'
  AND last_attempt_gmt > UTC_TIMESTAMP() - INTERVAL 7 DAY
GROUP BY hook
ORDER BY failed DESC
LIMIT 15;

-- name: Checkout-related actions scheduled in the last 7 days, by hook and status
SELECT hook, status, COUNT(*) AS actions
FROM {prefix}actionscheduler_actions
WHERE hook IN ('woocommerce_deliver_webhook_async',
               'woocommerce_send_queued_transactional_email',
               'wc-admin_import_orders',
               'wc-admin_process_pending_orders_batch',
               'woocommerce_cleanup_draft_orders',
               'woocommerce_cancel_unpaid_orders',
               'woocommerce_cleanup_sessions',
               'wc_run_batch_process',
               'action_scheduler_run_actions_cleanup_hook')
  AND scheduled_date_gmt > UTC_TIMESTAMP() - INTERVAL 7 DAY
GROUP BY hook, status
ORDER BY hook, status;

-- name: Actions completed per hour, last 24 hours (queue throughput)
SELECT DATE_FORMAT(last_attempt_gmt, '%Y-%m-%d %H:00') AS hour_gmt,
       COUNT(*) AS completed
FROM {prefix}actionscheduler_actions
WHERE status = 'complete'
  AND last_attempt_gmt > UTC_TIMESTAMP() - INTERVAL 1 DAY
GROUP BY hour_gmt
ORDER BY hour_gmt;

-- name: Open claims (batches being processed) and the oldest
SELECT COUNT(*) AS open_claims, MIN(date_created_gmt) AS oldest_claim_gmt
FROM {prefix}actionscheduler_claims;

-- name: Action Scheduler log rows (scan)
SELECT COUNT(*) AS log_rows, MIN(log_date_gmt) AS oldest_log_gmt
FROM {prefix}actionscheduler_logs;

-- name: Orders created per hour, last 48 hours (HPOS tables)
SELECT DATE_FORMAT(date_created_gmt, '%Y-%m-%d %H:00') AS hour_gmt, COUNT(*) AS orders
FROM {prefix}wc_orders
WHERE type = 'shop_order'
  AND date_created_gmt > UTC_TIMESTAMP() - INTERVAL 2 DAY
GROUP BY hour_gmt
ORDER BY hour_gmt;

-- name: Orders created per hour, last 48 hours (posts tables)
SELECT DATE_FORMAT(post_date_gmt, '%Y-%m-%d %H:00') AS hour_gmt, COUNT(*) AS orders
FROM {prefix}posts
WHERE post_type = 'shop_order'
  AND post_date_gmt > UTC_TIMESTAMP() - INTERVAL 2 DAY
GROUP BY hour_gmt
ORDER BY hour_gmt;

-- name: Draft, pending and failed orders created in the last 7 days (HPOS tables)
SELECT status, COUNT(*) AS orders, MIN(date_created_gmt) AS oldest_gmt
FROM {prefix}wc_orders
WHERE type = 'shop_order'
  AND status IN ('wc-checkout-draft', 'wc-pending', 'wc-failed')
  AND date_created_gmt > UTC_TIMESTAMP() - INTERVAL 7 DAY
GROUP BY status;

-- name: Draft, pending and failed orders created in the last 7 days (posts tables)
SELECT post_status AS status, COUNT(*) AS orders, MIN(post_date_gmt) AS oldest_gmt
FROM {prefix}posts
WHERE post_type = 'shop_order'
  AND post_status IN ('wc-checkout-draft', 'wc-pending', 'wc-failed')
  AND post_date_gmt > UTC_TIMESTAMP() - INTERVAL 7 DAY
GROUP BY post_status;

-- name: All checkout-draft orders and the oldest (HPOS tables)
SELECT COUNT(*) AS draft_orders, MIN(date_updated_gmt) AS oldest_update_gmt
FROM {prefix}wc_orders
WHERE status = 'wc-checkout-draft';

-- name: All checkout-draft orders and the oldest (posts tables)
SELECT COUNT(*) AS draft_orders, MIN(post_modified_gmt) AS oldest_update_gmt
FROM {prefix}posts
WHERE post_type = 'shop_order' AND post_status = 'wc-checkout-draft';

-- name: Place-order debug markers on orders (WooCommerce 9.9.0 and later) (HPOS tables)
SELECT meta_key, COUNT(*) AS orders
FROM {prefix}wc_orders_meta
WHERE meta_key IN ('_debug_log_source', '_debug_log_source_pending_deletion')
GROUP BY meta_key;

-- name: Place-order debug markers on orders (WooCommerce 9.9.0 and later) (posts tables)
SELECT meta_key, COUNT(*) AS orders
FROM {prefix}postmeta
WHERE meta_key IN ('_debug_log_source', '_debug_log_source_pending_deletion')
GROUP BY meta_key;

-- name: Place-order debug entries in the database log (only when the log handler is the database)
SELECT COUNT(*) AS log_entries, MIN(`timestamp`) AS oldest
FROM {prefix}woocommerce_log
WHERE source LIKE 'place-order-debug-%';

-- name: Reserved stock rows, and rows past their expiry
SELECT COUNT(*) AS reserved_rows,
       COALESCE(SUM(expires < NOW()), 0) AS expired_rows
FROM {prefix}wc_reserved_stock;

-- name: Webhooks by status and topic (no delivery URLs)
SELECT status, topic, COUNT(*) AS webhooks, SUM(failure_count) AS failures, SUM(pending_delivery) AS pending
FROM {prefix}wc_webhooks
GROUP BY status, topic
ORDER BY status, topic;

-- name: Sizes and engines of checkout tables (TABLE_ROWS is an estimate for InnoDB)
SELECT TABLE_NAME AS table_name,
       ENGINE AS engine,
       TABLE_ROWS AS approx_rows,
       ROUND(DATA_LENGTH / 1048576, 1) AS data_mb,
       ROUND(INDEX_LENGTH / 1048576, 1) AS index_mb
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('{prefix}woocommerce_sessions', '{prefix}wc_orders', '{prefix}wc_orders_meta',
                     '{prefix}wc_order_addresses', '{prefix}wc_order_operational_data', '{prefix}posts',
                     '{prefix}postmeta', '{prefix}options', '{prefix}woocommerce_order_items',
                     '{prefix}woocommerce_order_itemmeta', '{prefix}wc_reserved_stock', '{prefix}woocommerce_log',
                     '{prefix}actionscheduler_actions', '{prefix}actionscheduler_logs',
                     '{prefix}actionscheduler_claims', '{prefix}actionscheduler_groups', '{base_prefix}usermeta')
ORDER BY DATA_LENGTH + INDEX_LENGTH DESC;

-- name: Indexes on checkout tables (compare with references/database-indexes.md)
SELECT TABLE_NAME AS table_name,
       INDEX_NAME AS index_name,
       NON_UNIQUE AS non_unique,
       GROUP_CONCAT(CONCAT(COLUMN_NAME, IF(SUB_PART IS NULL, '', CONCAT('(', SUB_PART, ')')))
                    ORDER BY SEQ_IN_INDEX SEPARATOR ', ') AS index_columns
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('{prefix}woocommerce_sessions', '{prefix}wc_orders', '{prefix}wc_orders_meta',
                     '{prefix}wc_order_addresses', '{prefix}wc_order_operational_data', '{prefix}wc_reserved_stock',
                     '{prefix}woocommerce_order_items', '{prefix}woocommerce_order_itemmeta', '{prefix}postmeta',
                     '{prefix}actionscheduler_actions', '{prefix}actionscheduler_logs')
GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
ORDER BY TABLE_NAME, INDEX_NAME;
