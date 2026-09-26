-- Read-only: every statement below is a SELECT. Nothing here changes data, settings or tables.
--
-- Autoload checks for one WordPress site: rows and bytes per autoload value, the loaded total that Site Health
-- measures, the largest loaded options with their share and value type, bytes by name prefix, options over the
-- 150,000-byte threshold, autoloaded and expired transients, theme mods, core options that WordPress 6.7 switches off,
-- and the size and indexes of the options table.
--
-- Placeholders, filled in by autoload-report.sh (or by hand):
--   {prefix}         the site's table prefix, from `wp db prefix` (per site on multisite: wp db prefix --url=...)
--   {loaded_values}  the autoload values WordPress loads, quoted and comma-separated. Default since WordPress 6.6:
--                    'yes', 'on', 'auto-on', 'auto'. Before 6.6: 'yes'. autoload-state.php prints the site's list
--                    after filters.
-- Each block starts with a "-- name:" line and holds one statement; the report runs them one at a time, so a block
-- that fails does not stop the others. Blocks marked "(long)" print one line per loaded option; the report skips
-- them unless AUTOLOAD_REPORT_LONG=1.
-- Blocks marked "(scan)" read the whole options table. On a large table run them on a staging copy or a replica, or
-- at a quiet hour.
-- Output holds option names, autoload values, sizes and counts, the class name of top-level serialized objects, and
-- the value of db_version (a number). It prints no other option values.
-- Table and column names: WordPress 7.1.2 schema (wp-admin/includes/schema.php). references/*.md explain the results.

-- name: Rows and bytes per autoload value; loaded = in {loaded_values} (scan)
SELECT autoload,
       CASE WHEN autoload IN ({loaded_values}) THEN 'yes' ELSE 'no' END AS loaded,
       COUNT(*) AS options,
       COALESCE(SUM(LENGTH(option_value)), 0) AS bytes,
       COALESCE(MAX(LENGTH(option_value)), 0) AS largest_bytes
FROM {prefix}options
GROUP BY autoload
ORDER BY bytes DESC;

-- name: Loaded total: the bytes Site Health compares with 800,000 (scan)
SELECT COUNT(*) AS loaded_options,
       COALESCE(SUM(LENGTH(option_value)), 0) AS loaded_bytes,
       ROUND(COALESCE(SUM(LENGTH(option_value)), 0) / 1024, 1) AS loaded_kib,
       COALESCE(SUM(LENGTH(option_value) > 150000), 0) AS options_over_150000_bytes,
       COALESCE(SUM(option_name LIKE '\_transient\_%' OR option_name LIKE '\_site\_transient\_%'), 0) AS transient_rows
FROM {prefix}options
WHERE autoload IN ({loaded_values});

-- name: Largest loaded options, first 40, with share of the loaded total and value type (scan)
SELECT o.option_name,
       o.autoload,
       LENGTH(o.option_value) AS size_bytes,
       ROUND(100 * LENGTH(o.option_value) / t.total_bytes, 1) AS pct_of_loaded,
       CASE
         WHEN LEFT(o.option_value, 2) = 'a:' THEN 'serialized array'
         WHEN LEFT(o.option_value, 2) = 'O:' THEN 'serialized object'
         WHEN LEFT(o.option_value, 2) = 'C:' THEN 'serialized object (custom)'
         WHEN LEFT(o.option_value, 2) IN ('s:', 'i:', 'd:', 'b:') OR LEFT(o.option_value, 2) = 'N;' THEN 'serialized scalar'
         WHEN LEFT(o.option_value, 1) IN ('{', '[') THEN 'JSON-like text'
         ELSE 'plain text'
       END AS value_type,
       CASE
         WHEN LEFT(o.option_value, 2) IN ('O:', 'C:')
           THEN LEFT(SUBSTRING_INDEX(SUBSTRING_INDEX(o.option_value, '"', 2), '"', -1), 100)
       END AS object_class
FROM {prefix}options o
CROSS JOIN (
  SELECT GREATEST(COALESCE(SUM(LENGTH(option_value)), 0), 1) AS total_bytes
  FROM {prefix}options
  WHERE autoload IN ({loaded_values})
) t
WHERE o.autoload IN ({loaded_values})
ORDER BY size_bytes DESC
LIMIT 40;

-- name: Loaded bytes by name prefix, first 25; transients, theme mods and widgets grouped (scan)
SELECT p.name_prefix,
       COUNT(*) AS options,
       SUM(p.size_bytes) AS bytes
FROM (
  SELECT CASE
           WHEN option_name LIKE '\_transient\_%' OR option_name LIKE '\_site\_transient\_%' THEN '(transients)'
           WHEN option_name LIKE 'theme\_mods\_%' THEN 'theme_mods_*'
           WHEN option_name LIKE 'widget\_%' THEN 'widget_*'
           ELSE SUBSTRING_INDEX(SUBSTRING_INDEX(TRIM(LEADING '_' FROM option_name), '_', 1), '-', 1)
         END AS name_prefix,
         LENGTH(option_value) AS size_bytes
  FROM {prefix}options
  WHERE autoload IN ({loaded_values})
) p
GROUP BY p.name_prefix
ORDER BY bytes DESC
LIMIT 25;

-- name: Options over 150,000 bytes, loaded or not (scan)
SELECT option_name,
       autoload,
       LENGTH(option_value) AS size_bytes,
       CASE WHEN autoload IN ({loaded_values}) THEN 'yes' ELSE 'no' END AS loaded
FROM {prefix}options
WHERE LENGTH(option_value) > 150000
ORDER BY size_bytes DESC
LIMIT 50;

-- name: Loaded transients (saved without an expiration), first 25
SELECT option_name,
       autoload,
       LENGTH(option_value) AS size_bytes
FROM {prefix}options
WHERE autoload IN ({loaded_values})
  AND (option_name LIKE '\_transient\_%' OR option_name LIKE '\_site\_transient\_%')
ORDER BY size_bytes DESC
LIMIT 25;

-- name: Transients in the table: value rows, expired, loaded, without a timeout row
SELECT COUNT(*) AS transient_value_rows,
       COALESCE(SUM(t.option_value < UNIX_TIMESTAMP()), 0) AS expired,
       COALESCE(SUM(v.autoload IN ({loaded_values})), 0) AS loaded,
       COALESCE(SUM(t.option_id IS NULL), 0) AS without_timeout_row,
       COALESCE(SUM(LENGTH(v.option_value)), 0) AS value_bytes
FROM {prefix}options v
LEFT JOIN {prefix}options t
  ON t.option_name = CONCAT('_transient_timeout_', SUBSTRING(v.option_name, 12))
WHERE v.option_name LIKE '\_transient\_%'
  AND v.option_name NOT LIKE '\_transient\_timeout\_%';

-- name: Theme mods: only the active theme's row should load (WordPress 6.5 and later)
SELECT option_name,
       autoload,
       LENGTH(option_value) AS size_bytes,
       CASE WHEN autoload IN ({loaded_values}) THEN 'yes' ELSE 'no' END AS loaded
FROM {prefix}options
WHERE option_name LIKE 'theme\_mods\_%'
ORDER BY size_bytes DESC;

-- name: Database revision: 58975 or later means the WordPress 6.7 upgrade has run
SELECT option_value AS db_version
FROM {prefix}options
WHERE option_name = 'db_version';

-- name: Core options that the WordPress 6.7 upgrade switches off, when they still load
SELECT option_name,
       autoload,
       LENGTH(option_value) AS size_bytes
FROM {prefix}options
WHERE option_name IN ('recently_activated', '_wp_suggested_policy_text_has_changed', 'dashboard_widget_options',
                      'ftp_credentials', 'adminhash', 'nav_menu_options', 'wp_force_deactivated_plugins',
                      'delete_blog_hash', 'allowedthemes', 'recovery_keys', 'https_detection_errors', 'fresh_site')
  AND autoload IN ({loaded_values})
ORDER BY size_bytes DESC;

-- name: Options table size and engine (row count is an estimate for InnoDB)
SELECT TABLE_NAME AS table_name,
       ENGINE AS engine,
       TABLE_ROWS AS approx_rows,
       ROUND((DATA_LENGTH + INDEX_LENGTH) / 1048576, 1) AS total_mib
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = '{prefix}options';

-- name: Indexes on the options table (WordPress defines PRIMARY, option_name unique and autoload)
SELECT INDEX_NAME AS index_name,
       NON_UNIQUE AS non_unique,
       GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS index_columns
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = '{prefix}options'
GROUP BY INDEX_NAME, NON_UNIQUE;

-- name: Names and sizes of every loaded option, for pasting into a summary tool (long) (scan)
SELECT option_name,
       LENGTH(option_value) AS size_bytes
FROM {prefix}options
WHERE autoload IN ({loaded_values})
ORDER BY size_bytes DESC;
