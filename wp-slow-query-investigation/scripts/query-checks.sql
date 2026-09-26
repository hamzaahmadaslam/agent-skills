-- Read-only: every statement below is a SELECT or a SHOW. Nothing here changes data, settings or tables.
--
-- Slow query checks for one WordPress site on MySQL 8.x or MariaDB 10.6 and later: server settings and counters,
-- table sizes, engines and collations, indexes on the core tables, the heaviest post meta keys, autoloaded options,
-- transients, Performance Schema digests, sys schema index views, statements running now, WooCommerce lookup tables,
-- and the slow log table when the log is written to a table.
-- Placeholders, filled in by slow-query-readonly-report.sh (or by hand):
--   {prefix}       the site's table prefix, from `wp db prefix` (per site on multisite: wp db prefix --url=...)
--   {base_prefix}  the network's base prefix for users and usermeta (the same as {prefix} on a single site)
-- Each block starts with a "-- name:" line and holds one statement; the report script runs them one at a time, so a
-- block that fails (a MySQL-only view on MariaDB, a WooCommerce table on a site without it, a missing privilege) does
-- not stop the others.
-- Blocks marked "(scan)" read a whole table. On a big site run them on a replica or staging copy, or at a quiet hour.
-- Output holds counts, sizes, settings, and names of tables, indexes, options and meta keys (digits masked), and
-- statement texts only in normalized or masked form: no row contents, user names, hosts or literal values.
-- Sources for what each result means: references/*.md (WordPress 7.1.2, MySQL 8.4 manual, MariaDB docs 2026-09-26).

-- name: Server version
SELECT VERSION() AS version, @@version_comment AS version_comment;

-- name: Slow log, statistics and timeout settings (names differ between MySQL and MariaDB; missing ones are not listed)
SHOW GLOBAL VARIABLES WHERE Variable_name IN ('slow_query_log', 'log_slow_query', 'slow_query_log_file',
  'log_slow_query_file', 'long_query_time', 'log_slow_query_time', 'log_output', 'log_slow_extra',
  'log_slow_verbosity', 'log_slow_filter', 'log_slow_rate_limit', 'log_queries_not_using_indexes',
  'min_examined_row_limit', 'log_slow_min_examined_row_limit', 'performance_schema', 'innodb_buffer_pool_size',
  'query_cache_type', 'query_cache_size', 'lock_wait_timeout', 'max_execution_time', 'max_statement_time',
  'innodb_stats_persistent', 'innodb_stats_auto_recalc', 'use_stat_tables', 'explain_format');

-- name: Status counters since startup (run the report twice some minutes apart and compare)
SHOW GLOBAL STATUS WHERE Variable_name IN ('Uptime', 'Questions', 'Slow_queries', 'Select_full_join', 'Select_scan',
  'Handler_read_rnd_next', 'Created_tmp_tables', 'Created_tmp_disk_tables', 'Sort_merge_passes',
  'Innodb_buffer_pool_reads', 'Innodb_buffer_pool_read_requests', 'Threads_running', 'Threads_connected');

-- name: Table sizes, engines and collations of this site's tables, largest first (TABLE_ROWS is an estimate for InnoDB)
SELECT TABLE_NAME AS table_name,
       ENGINE AS engine,
       TABLE_COLLATION AS collation,
       TABLE_ROWS AS approx_rows,
       ROUND(DATA_LENGTH / 1048576, 1) AS data_mb,
       ROUND(INDEX_LENGTH / 1048576, 1) AS index_mb
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_TYPE = 'BASE TABLE'
  AND LEFT(TABLE_NAME, CHAR_LENGTH('{prefix}')) = '{prefix}'
ORDER BY DATA_LENGTH + INDEX_LENGTH DESC
LIMIT 40;

-- name: Whole database size against the InnoDB buffer pool
SELECT ROUND(SUM(DATA_LENGTH + INDEX_LENGTH) / 1048576) AS database_mb,
       ROUND(@@innodb_buffer_pool_size / 1048576) AS buffer_pool_mb
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE();

-- name: Tables that are not InnoDB (MyISAM locks whole tables for writes)
SELECT TABLE_NAME AS table_name, ENGINE AS engine, TABLE_ROWS AS approx_rows
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_TYPE = 'BASE TABLE'
  AND ENGINE <> 'InnoDB'
ORDER BY TABLE_NAME;

-- name: Table collations in use (joins across collations can stop index use)
SELECT TABLE_COLLATION AS collation, COUNT(*) AS tables
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_TYPE = 'BASE TABLE'
GROUP BY TABLE_COLLATION
ORDER BY tables DESC;

-- name: Text columns whose collation differs from their table's (this site's tables)
SELECT c.TABLE_NAME AS table_name,
       c.COLUMN_NAME AS column_name,
       c.COLLATION_NAME AS column_collation,
       t.TABLE_COLLATION AS table_collation
FROM information_schema.COLUMNS c
JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
WHERE c.TABLE_SCHEMA = DATABASE()
  AND LEFT(c.TABLE_NAME, CHAR_LENGTH('{prefix}')) = '{prefix}'
  AND c.COLLATION_NAME IS NOT NULL
  AND c.COLLATION_NAME <> t.TABLE_COLLATION
ORDER BY c.TABLE_NAME, c.COLUMN_NAME
LIMIT 40;

-- name: Indexes on the WordPress core tables (compare with references/wordpress-schema.md)
SELECT TABLE_NAME AS table_name,
       INDEX_NAME AS index_name,
       NON_UNIQUE AS non_unique,
       GROUP_CONCAT(CONCAT(COLUMN_NAME, IF(SUB_PART IS NULL, '', CONCAT('(', SUB_PART, ')')))
                    ORDER BY SEQ_IN_INDEX SEPARATOR ', ') AS index_columns
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('{prefix}posts', '{prefix}postmeta', '{prefix}options', '{prefix}terms', '{prefix}term_taxonomy',
                     '{prefix}term_relationships', '{prefix}termmeta', '{prefix}comments', '{prefix}commentmeta',
                     '{base_prefix}users', '{base_prefix}usermeta')
GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
ORDER BY TABLE_NAME, INDEX_NAME;

-- name: Indexes on core tables that WordPress 7.1.2 does not define (added by a plugin, a host or a person)
SELECT TABLE_NAME AS table_name,
       INDEX_NAME AS index_name,
       GROUP_CONCAT(CONCAT(COLUMN_NAME, IF(SUB_PART IS NULL, '', CONCAT('(', SUB_PART, ')')))
                    ORDER BY SEQ_IN_INDEX SEPARATOR ', ') AS index_columns
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = '{prefix}posts' AND INDEX_NAME NOT IN ('PRIMARY', 'post_name', 'type_status_date', 'post_parent', 'post_author', 'type_status_author'))
    OR (TABLE_NAME = '{prefix}postmeta' AND INDEX_NAME NOT IN ('PRIMARY', 'post_id', 'meta_key'))
    OR (TABLE_NAME = '{prefix}options' AND INDEX_NAME NOT IN ('PRIMARY', 'option_name', 'autoload'))
    OR (TABLE_NAME = '{prefix}terms' AND INDEX_NAME NOT IN ('PRIMARY', 'slug', 'name'))
    OR (TABLE_NAME = '{prefix}term_taxonomy' AND INDEX_NAME NOT IN ('PRIMARY', 'term_id_taxonomy', 'taxonomy'))
    OR (TABLE_NAME = '{prefix}term_relationships' AND INDEX_NAME NOT IN ('PRIMARY', 'term_taxonomy_id'))
    OR (TABLE_NAME = '{prefix}termmeta' AND INDEX_NAME NOT IN ('PRIMARY', 'term_id', 'meta_key'))
    OR (TABLE_NAME = '{prefix}comments' AND INDEX_NAME NOT IN ('PRIMARY', 'comment_post_ID', 'comment_approved_date_gmt', 'comment_date_gmt', 'comment_parent', 'comment_author_email'))
    OR (TABLE_NAME = '{prefix}commentmeta' AND INDEX_NAME NOT IN ('PRIMARY', 'comment_id', 'meta_key'))
    OR (TABLE_NAME = '{base_prefix}users' AND INDEX_NAME NOT IN ('PRIMARY', 'user_login_key', 'user_nicename', 'user_email'))
    OR (TABLE_NAME = '{base_prefix}usermeta' AND INDEX_NAME NOT IN ('PRIMARY', 'user_id', 'meta_key')))
GROUP BY TABLE_NAME, INDEX_NAME
ORDER BY TABLE_NAME, INDEX_NAME;

-- name: Invisible indexes in this database (MySQL 8.x)
SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND IS_VISIBLE = 'NO'
GROUP BY TABLE_NAME, INDEX_NAME
ORDER BY TABLE_NAME, INDEX_NAME;

-- name: Ignored indexes in this database (MariaDB 10.6 and later)
SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND IGNORED = 'YES'
GROUP BY TABLE_NAME, INDEX_NAME
ORDER BY TABLE_NAME, INDEX_NAME;

-- name: Rows per post type and status (scan of the posts table's type_status_date index)
SELECT post_type, post_status, COUNT(*) AS posts
FROM {prefix}posts
GROUP BY post_type, post_status
ORDER BY posts DESC
LIMIT 30;

-- name: Post meta keys with the most rows, digits masked (scan; MySQL 8.0 and MariaDB 10.0.5 and later)
SELECT REGEXP_REPLACE(meta_key, '[0-9]+', '#') AS meta_key_masked,
       COUNT(*) AS meta_rows,
       ROUND(COALESCE(SUM(LENGTH(meta_value)), 0) / 1048576, 1) AS value_mb,
       MAX(CHAR_LENGTH(meta_value)) AS longest_value_chars
FROM {prefix}postmeta
GROUP BY meta_key_masked
ORDER BY meta_rows DESC
LIMIT 20;

-- name: Autoloaded options, rows and size (WordPress 6.6 autoload values)
SELECT COUNT(*) AS autoloaded_rows,
       ROUND(COALESCE(SUM(LENGTH(option_value)), 0) / 1024) AS autoloaded_kb
FROM {prefix}options
WHERE autoload IN ('yes', 'on', 'auto-on', 'auto');

-- name: Largest autoloaded options, digits masked (top 10; cleanup belongs to the wp-autoload-audit skill)
SELECT REGEXP_REPLACE(option_name, '[0-9]+', '#') AS option_name_masked,
       LENGTH(option_value) AS bytes,
       autoload
FROM {prefix}options
WHERE autoload IN ('yes', 'on', 'auto-on', 'auto')
ORDER BY bytes DESC
LIMIT 10;

-- name: Transients in the options table: value rows, timeout rows, expired, autoloaded, size
SELECT COALESCE(SUM(option_name NOT LIKE '\_transient\_timeout\_%' AND option_name NOT LIKE '\_site\_transient\_timeout\_%'), 0) AS value_rows,
       COALESCE(SUM(option_name LIKE '\_transient\_timeout\_%' OR option_name LIKE '\_site\_transient\_timeout\_%'), 0) AS timeout_rows,
       COALESCE(SUM((option_name LIKE '\_transient\_timeout\_%' OR option_name LIKE '\_site\_transient\_timeout\_%') AND option_value < UNIX_TIMESTAMP()), 0) AS expired,
       COALESCE(SUM(option_name NOT LIKE '\_transient\_timeout\_%' AND option_name NOT LIKE '\_site\_transient\_timeout\_%' AND autoload IN ('yes', 'on', 'auto-on', 'auto')), 0) AS autoloaded_value_rows,
       ROUND(COALESCE(SUM(LENGTH(option_value)), 0) / 1024) AS kb
FROM {prefix}options
WHERE option_name LIKE '\_transient\_%' OR option_name LIKE '\_site\_transient\_%';

-- name: Top statements by total time since startup, literals normalized (Performance Schema: MySQL, or MariaDB with it on)
SELECT LEFT(DIGEST_TEXT, 220) AS statement_digest,
       COUNT_STAR AS executions,
       ROUND(SUM_TIMER_WAIT / 1e12, 1) AS total_s,
       ROUND(SUM_TIMER_WAIT / NULLIF(COUNT_STAR, 0) / 1e9, 1) AS avg_ms,
       ROUND(MAX_TIMER_WAIT / 1e9, 1) AS max_ms,
       ROUND(SUM_ROWS_EXAMINED / NULLIF(COUNT_STAR, 0)) AS avg_rows_examined,
       ROUND(SUM_ROWS_SENT / NULLIF(COUNT_STAR, 0)) AS avg_rows_sent,
       SUM_NO_INDEX_USED AS runs_without_index,
       SUM_NO_GOOD_INDEX_USED AS runs_without_good_index,
       SUM_CREATED_TMP_DISK_TABLES AS tmp_disk_tables,
       SUM_SORT_MERGE_PASSES AS sort_merge_passes,
       LAST_SEEN AS last_seen
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME = DATABASE()
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 15;

-- name: Statements that read tables without a usable index, by rows examined (Performance Schema)
SELECT LEFT(DIGEST_TEXT, 220) AS statement_digest,
       COUNT_STAR AS executions,
       SUM_NO_INDEX_USED AS runs_without_index,
       SUM_NO_GOOD_INDEX_USED AS runs_without_good_index,
       ROUND(SUM_ROWS_EXAMINED / NULLIF(COUNT_STAR, 0)) AS avg_rows_examined,
       ROUND(SUM_TIMER_WAIT / 1e12, 1) AS total_s
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME = DATABASE()
  AND (SUM_NO_INDEX_USED > 0 OR SUM_NO_GOOD_INDEX_USED > 0)
ORDER BY SUM_ROWS_EXAMINED DESC
LIMIT 15;

-- name: Digest table overflow row (a large count means the digest lists above are incomplete) (Performance Schema)
SELECT COUNT_STAR AS executions, ROUND(SUM_TIMER_WAIT / 1e12, 1) AS total_s
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME IS NULL AND DIGEST IS NULL;

-- name: Indexes of this site's tables with no recorded use since startup (sys schema; needs representative uptime)
SELECT object_name AS table_name, index_name
FROM sys.schema_unused_indexes
WHERE object_schema = DATABASE()
  AND LEFT(object_name, CHAR_LENGTH('{prefix}')) = '{prefix}'
ORDER BY object_name, index_name;

-- name: Redundant indexes in this database (sys schema)
SELECT table_name,
       redundant_index_name,
       redundant_index_columns,
       dominant_index_name,
       dominant_index_columns
FROM sys.schema_redundant_indexes
WHERE table_schema = DATABASE()
ORDER BY table_name, redundant_index_name;

-- name: Running statements, 1 second or older, text masked (MySQL 8.x)
SELECT ID AS id,
       COMMAND AS command,
       TIME AS seconds,
       STATE AS state,
       LEFT(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(INFO, '''[^'']*''', '?'), '"[^"]*"', '?'), '[0-9]+', 'N'), 200) AS statement_masked
FROM performance_schema.processlist
WHERE COMMAND NOT IN ('Sleep', 'Daemon', 'Binlog Dump', 'Binlog Dump GTID')
  AND TIME >= 1
  AND INFO IS NOT NULL
  AND ID <> CONNECTION_ID()
ORDER BY TIME DESC
LIMIT 20;

-- name: Running statements, 1 second or older, text masked (MariaDB)
SELECT ID AS id,
       COMMAND AS command,
       ROUND(TIME_MS / 1000, 1) AS seconds,
       STATE AS state,
       LEFT(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(INFO, '''[^'']*''', '?'), '"[^"]*"', '?'), '[0-9]+', 'N'), 200) AS statement_masked
FROM information_schema.PROCESSLIST
WHERE COMMAND NOT IN ('Sleep', 'Daemon', 'Binlog Dump')
  AND TIME_MS >= 1000
  AND INFO IS NOT NULL
  AND ID <> CONNECTION_ID()
ORDER BY TIME_MS DESC
LIMIT 20;

-- name: WooCommerce product meta lookup rows against products and variations (WooCommerce only)
SELECT (SELECT COUNT(*) FROM {prefix}posts
        WHERE post_type IN ('product', 'product_variation') AND post_status NOT IN ('auto-draft', 'trash')) AS products_and_variations,
       (SELECT COUNT(*) FROM {prefix}wc_product_meta_lookup) AS meta_lookup_rows;

-- name: WooCommerce product attributes lookup table, products covered (WooCommerce 6.3 and later)
SELECT COUNT(*) AS lookup_rows, COUNT(DISTINCT product_or_parent_id) AS products_covered
FROM {prefix}wc_product_attributes_lookup;

-- name: WooCommerce lookup table and order storage settings (WooCommerce only)
SELECT option_name, option_value
FROM {prefix}options
WHERE option_name IN ('woocommerce_attribute_lookup_enabled', 'woocommerce_attribute_lookup_direct_updates',
                      'woocommerce_attribute_lookup_optimized_updates', 'woocommerce_custom_orders_table_enabled',
                      'woocommerce_custom_orders_table_data_sync_enabled', 'woocommerce_version', 'woocommerce_db_version')
ORDER BY option_name;

-- name: Slow log table, top statements by total time (MySQL 8.x; only with log_output=TABLE and SELECT on mysql.slow_log)
SELECT LEFT(STATEMENT_DIGEST_TEXT(CONVERT(sql_text USING utf8mb4)), 220) AS statement_digest,
       COUNT(*) AS executions,
       ROUND(SUM(HOUR(query_time) * 3600 + MINUTE(query_time) * 60 + SECOND(query_time) + MICROSECOND(query_time) / 1000000), 1) AS total_s,
       ROUND(MAX(HOUR(query_time) * 3600 + MINUTE(query_time) * 60 + SECOND(query_time) + MICROSECOND(query_time) / 1000000), 2) AS max_s,
       ROUND(AVG(rows_examined)) AS avg_rows_examined,
       MAX(start_time) AS last_seen
FROM mysql.slow_log
WHERE db = DATABASE()
GROUP BY statement_digest
ORDER BY total_s DESC
LIMIT 15;

-- name: Slow log table, top statements by total time, text masked (MariaDB; only with log_output=TABLE and SELECT on mysql.slow_log)
SELECT LEFT(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(CONVERT(sql_text USING utf8mb4), '''[^'']*''', '?'), '"[^"]*"', '?'), '[0-9]+', 'N'), 220) AS statement_masked,
       COUNT(*) AS executions,
       ROUND(SUM(HOUR(query_time) * 3600 + MINUTE(query_time) * 60 + SECOND(query_time) + MICROSECOND(query_time) / 1000000), 1) AS total_s,
       ROUND(MAX(HOUR(query_time) * 3600 + MINUTE(query_time) * 60 + SECOND(query_time) + MICROSECOND(query_time) / 1000000), 2) AS max_s,
       ROUND(AVG(rows_examined)) AS avg_rows_examined,
       MAX(start_time) AS last_seen
FROM mysql.slow_log
WHERE db = DATABASE()
GROUP BY statement_masked
ORDER BY total_s DESC
LIMIT 15;
