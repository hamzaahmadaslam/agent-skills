-- Read-only: every statement below is a SELECT. Nothing here changes data, settings or tables.
--
-- Row checks for WooCommerce's product lookup tables: {prefix}wc_product_meta_lookup and
-- {prefix}wc_product_attributes_lookup, each row compared with the product data it is built from (post meta, term
-- relationships, variations). Written against WooCommerce 11.1.2 with products stored as posts (the only product
-- storage in that release), on MySQL 8.x or MariaDB 10.6 and later.
--
-- Placeholders, filled in by lookup-readonly-report.sh (or by hand):
--   {prefix}  the site's table prefix, from `wp db prefix` (per site on multisite: wp db prefix --url=...)
--   {limit}   how many rows a "Detail" block lists (the report script uses 200 unless LOOKUP_DETAIL_LIMIT is set)
--
-- Each block starts with a "-- name:" line and holds one statement. Blocks whose name starts with "Detail" return
-- the same six columns, which scripts/summarise-lookup-report.mjs reads:
--   class, product_id, parent_id, taxonomy, term_id, detail
-- The report script also runs every Detail block once as SELECT COUNT(*) FROM (...), so the counts are complete even
-- when the listing stops at {limit}. references/mismatch-classes.md explains each class.
--
-- Blocks marked "(scan)" read whole tables (postmeta, term_relationships, the lookup tables). On a big store run them
-- on a replica or a staging copy restored from production, or at a quiet hour.
-- Output holds product and variation IDs, SKUs, prices, stock values, taxonomy names and term IDs: catalog data, no
-- customer data. Detail blocks must not contain a semicolon inside a string: the count wrapper cuts at the last one.

-- name: Versions and the settings that decide how the lookup tables are written
SELECT option_name, option_value
FROM {prefix}options
WHERE option_name IN ('woocommerce_version', 'woocommerce_db_version', 'woocommerce_schema_version',
                      'woocommerce_attribute_lookup_enabled', 'woocommerce_attribute_lookup_direct_updates',
                      'woocommerce_attribute_lookup_optimized_updates',
                      'woocommerce_attribute_lookup_regeneration_in_progress',
                      'woocommerce_attribute_lookup_regeneration_aborted',
                      'woocommerce_attribute_lookup_last_product_id_to_process',
                      'woocommerce_attribute_lookup_processed_count',
                      'woocommerce_product_lookup_table_is_generating', 'woocommerce_hide_out_of_stock_items')
ORDER BY option_name;

-- name: Lookup table actions in Action Scheduler, by hook and status
SELECT a.hook,
       a.status,
       g.slug AS action_group,
       COUNT(*) AS actions,
       MIN(a.scheduled_date_gmt) AS oldest_scheduled_gmt,
       MAX(a.last_attempt_gmt) AS last_attempt_gmt
FROM {prefix}actionscheduler_actions a
LEFT JOIN {prefix}actionscheduler_groups g ON g.group_id = a.group_id
WHERE a.hook IN ('woocommerce_run_product_attribute_lookup_update_callback',
                 'woocommerce_run_product_attribute_lookup_regeneration_callback',
                 'wc_update_product_lookup_tables_column',
                 'wc_update_product_lookup_tables_rating_count_batch')
GROUP BY a.hook, a.status, g.slug
ORDER BY a.hook, a.status;

-- name: Attribute lookup updates not yet done (args hold [product id, action]: 1 rebuild, 2 stock only, 3 delete)
SELECT a.action_id, a.status, a.args, a.scheduled_date_gmt, a.last_attempt_gmt
FROM {prefix}actionscheduler_actions a
WHERE a.hook = 'woocommerce_run_product_attribute_lookup_update_callback'
  AND a.status IN ('pending', 'in-progress', 'failed')
ORDER BY a.scheduled_date_gmt DESC
LIMIT {limit};

-- name: Attribute lookup errors in the database log (source palt-updates, only when the log handler is the database)
SELECT COUNT(*) AS log_entries, MIN(`timestamp`) AS first_entry, MAX(`timestamp`) AS last_entry
FROM {prefix}woocommerce_log
WHERE source = 'palt-updates';

-- name: Sizes of the two lookup tables (TABLE_ROWS is an estimate for InnoDB)
SELECT TABLE_NAME AS table_name,
       ENGINE AS engine,
       TABLE_ROWS AS approx_rows,
       ROUND(DATA_LENGTH / 1048576, 1) AS data_mb,
       ROUND(INDEX_LENGTH / 1048576, 1) AS index_mb
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('{prefix}wc_product_meta_lookup', '{prefix}wc_product_attributes_lookup');

-- name: Indexes on the two lookup tables (compare with references/lookup-tables.md)
SELECT TABLE_NAME AS table_name,
       INDEX_NAME AS index_name,
       NON_UNIQUE AS non_unique,
       GROUP_CONCAT(CONCAT(COLUMN_NAME, IF(SUB_PART IS NULL, '', CONCAT('(', SUB_PART, ')')))
                    ORDER BY SEQ_IN_INDEX SEPARATOR ', ') AS index_columns
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('{prefix}wc_product_meta_lookup', '{prefix}wc_product_attributes_lookup')
GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
ORDER BY TABLE_NAME, INDEX_NAME;

-- name: Attribute lookup table contents (scan)
SELECT COUNT(*) AS lookup_rows,
       COUNT(DISTINCT product_or_parent_id) AS products_covered,
       COUNT(DISTINCT product_id) AS products_and_variations_covered,
       COALESCE(SUM(is_variation_attribute = 1), 0) AS variation_attribute_rows,
       COALESCE(SUM(in_stock = 0), 0) AS out_of_stock_rows
FROM {prefix}wc_product_attributes_lookup;

-- name: Attribute lookup rows repeating the same key (non-zero only when the primary key is missing) (scan)
SELECT COUNT(*) - COUNT(DISTINCT product_or_parent_id, term_id, product_id, taxonomy) AS repeated_rows
FROM {prefix}wc_product_attributes_lookup;

-- name: Products with attribute terms, by status and catalog visibility (scan)
SELECT p.post_status,
       IF(hc.object_id IS NULL, 'shown in catalog', 'hidden from catalog') AS catalog,
       COUNT(DISTINCT p.ID) AS products,
       COUNT(DISTINCT al.product_or_parent_id) AS with_lookup_rows
FROM {prefix}posts p
JOIN {prefix}term_relationships tr ON tr.object_id = p.ID
JOIN {prefix}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy LIKE 'pa\_%'
LEFT JOIN (SELECT DISTINCT tr2.object_id
           FROM {prefix}term_relationships tr2
           JOIN {prefix}term_taxonomy tt2 ON tt2.term_taxonomy_id = tr2.term_taxonomy_id AND tt2.taxonomy = 'product_visibility'
           JOIN {prefix}terms t2 ON t2.term_id = tt2.term_id AND t2.name = 'exclude-from-catalog') hc ON hc.object_id = p.ID
LEFT JOIN {prefix}wc_product_attributes_lookup al ON al.product_or_parent_id = p.ID
WHERE p.post_type = 'product'
GROUP BY p.post_status, catalog
ORDER BY p.post_status, catalog;

-- name: Products and variations by status, with and without a meta lookup row (scan)
SELECT p.post_type,
       p.post_status,
       COUNT(*) AS posts,
       COALESCE(SUM(ml.product_id IS NOT NULL), 0) AS with_row,
       COALESCE(SUM(ml.product_id IS NULL), 0) AS without_row
FROM {prefix}posts p
LEFT JOIN {prefix}wc_product_meta_lookup ml ON ml.product_id = p.ID
WHERE p.post_type IN ('product', 'product_variation')
GROUP BY p.post_type, p.post_status
ORDER BY p.post_type, p.post_status;

-- name: Meta lookup stale values per column (scan)
SELECT COUNT(*) AS rows_checked,
       COALESCE(SUM(c_sku), 0) AS sku,
       COALESCE(SUM(c_global_unique_id), 0) AS global_unique_id,
       COALESCE(SUM(c_virtual), 0) AS virtual_flag,
       COALESCE(SUM(c_downloadable), 0) AS downloadable,
       COALESCE(SUM(c_price), 0) AS min_max_price,
       COALESCE(SUM(c_onsale), 0) AS onsale,
       COALESCE(SUM(c_stock_quantity), 0) AS stock_quantity,
       COALESCE(SUM(c_stock_quantity_unmanaged), 0) AS stock_quantity_unmanaged,
       COALESCE(SUM(c_stock_status), 0) AS stock_status,
       COALESCE(SUM(c_rating_count), 0) AS rating_count_suspect,
       COALESCE(SUM(c_average_rating), 0) AS average_rating,
       COALESCE(SUM(c_total_sales), 0) AS total_sales,
       COALESCE(SUM(c_tax_status), 0) AS tax_status,
       COALESCE(SUM(c_tax_class), 0) AS tax_class
FROM (
  SELECT (CAST(COALESCE(v.l_sku, '') AS BINARY) <> CAST(COALESCE(v.m_sku, '') AS BINARY)) AS c_sku,
         (CAST(COALESCE(v.l_guid, '') AS BINARY) <> CAST(COALESCE(v.m_guid, '') AS BINARY)) AS c_global_unique_id,
         (COALESCE(v.l_virtual, 0) <> IF(v.m_virtual = 'yes', 1, 0)) AS c_virtual,
         (COALESCE(v.l_downloadable, 0) <> IF(v.m_downloadable = 'yes', 1, 0)) AS c_downloadable,
         (COALESCE(v.m_price_rows, 0) > 0
           AND (v.l_min IS NULL OR v.l_max IS NULL
                OR ABS(v.l_min - ROUND(v.m_min, 4)) >= 0.0001
                OR ABS(v.l_max - ROUND(v.m_max, 4)) >= 0.0001)) AS c_price,
         (COALESCE(v.l_onsale, 0) NOT IN (
            COALESCE(COALESCE(v.m_price_rows, 0) > 0 AND COALESCE(v.m_sale, '') <> '' AND v.m_min = v.m_sale + 0, 0),
            COALESCE(COALESCE(v.m_price_rows, 0) > 0 AND COALESCE(v.m_sale, '') <> '' AND v.m_min = v.m_sale + 0 AND v.m_sale + 0 <> 0, 0),
            COALESCE(COALESCE(v.m_price_rows, 0) > 0 AND v.m_min >= 0 AND COALESCE(v.m_sale, '') <> '' AND v.m_min = v.m_sale + 0
                     AND COALESCE(v.m_regular, '') <> '' AND v.m_regular + 0 > v.m_sale + 0, 0))) AS c_onsale,
         (v.m_manage = 'yes'
           AND NOT ((COALESCE(v.m_stock, '') = '' AND (v.l_stock IS NULL OR v.l_stock = 0))
                    OR (COALESCE(v.m_stock, '') <> '' AND v.l_stock IS NOT NULL
                        AND (ABS(v.l_stock - (v.m_stock + 0)) < 0.000001
                             OR ABS(v.l_stock - TRUNCATE(v.m_stock + 0, 0)) < 0.000001)))) AS c_stock_quantity,
         (COALESCE(v.m_manage, '') <> 'yes' AND v.l_stock IS NOT NULL) AS c_stock_quantity_unmanaged,
         (CAST(COALESCE(v.l_stock_status, '') AS BINARY) <> CAST(COALESCE(v.m_stock_status, '') AS BINARY)) AS c_stock_status,
         ((COALESCE(v.m_rating_raw, '') IN ('', 'a:0:{}') AND COALESCE(v.l_rating_count, 0) <> 0)
           OR (COALESCE(v.m_rating_raw, '') NOT IN ('', 'a:0:{}') AND COALESCE(v.l_rating_count, 0) = 0)) AS c_rating_count,
         (ABS(COALESCE(v.l_average_rating, 0) - ROUND(COALESCE(NULLIF(v.m_average_rating, '') + 0, 0), 2)) >= 0.01) AS c_average_rating,
         (COALESCE(v.l_total_sales, 0) <> TRUNCATE(COALESCE(NULLIF(v.m_total_sales, '') + 0, 0), 0)) AS c_total_sales,
         (CAST(COALESCE(v.l_tax_status, '') AS BINARY) <> CAST(COALESCE(v.m_tax_status, '') AS BINARY)) AS c_tax_status,
         (CAST(COALESCE(v.l_tax_class, '') AS BINARY) <> CAST(COALESCE(v.m_tax_class, '') AS BINARY)) AS c_tax_class
  FROM (
    SELECT ml.product_id,
           ml.sku AS l_sku, e.sku AS m_sku,
           ml.global_unique_id AS l_guid, e.global_unique_id AS m_guid,
           ml.virtual AS l_virtual, e.is_virtual AS m_virtual,
           ml.downloadable AS l_downloadable, e.is_downloadable AS m_downloadable,
           ml.min_price AS l_min, ml.max_price AS l_max, e.price_rows AS m_price_rows, e.min_price AS m_min, e.max_price AS m_max,
           ml.onsale AS l_onsale, e.sale_price AS m_sale, e.regular_price AS m_regular,
           ml.stock_quantity AS l_stock, e.manage_stock AS m_manage, e.stock AS m_stock,
           ml.stock_status AS l_stock_status, e.stock_status AS m_stock_status,
           ml.rating_count AS l_rating_count, e.rating_raw AS m_rating_raw,
           ml.average_rating AS l_average_rating, e.average_rating AS m_average_rating,
           ml.total_sales AS l_total_sales, e.total_sales AS m_total_sales,
           ml.tax_status AS l_tax_status, e.tax_status AS m_tax_status,
           ml.tax_class AS l_tax_class, e.tax_class AS m_tax_class
    FROM {prefix}wc_product_meta_lookup ml
    JOIN {prefix}posts p ON p.ID = ml.product_id AND p.post_type IN ('product', 'product_variation')
    LEFT JOIN (
      SELECT pm.post_id,
             MAX(CASE WHEN pm.meta_key = '_sku' THEN pm.meta_value END) AS sku,
             MAX(CASE WHEN pm.meta_key = '_global_unique_id' THEN pm.meta_value END) AS global_unique_id,
             MAX(CASE WHEN pm.meta_key = '_virtual' THEN pm.meta_value END) AS is_virtual,
             MAX(CASE WHEN pm.meta_key = '_downloadable' THEN pm.meta_value END) AS is_downloadable,
             SUM(pm.meta_key = '_price' AND pm.meta_value <> '') AS price_rows,
             MIN(CASE WHEN pm.meta_key = '_price' AND pm.meta_value <> '' THEN pm.meta_value + 0 END) AS min_price,
             MAX(CASE WHEN pm.meta_key = '_price' AND pm.meta_value <> '' THEN pm.meta_value + 0 END) AS max_price,
             MAX(CASE WHEN pm.meta_key = '_sale_price' THEN pm.meta_value END) AS sale_price,
             MAX(CASE WHEN pm.meta_key = '_regular_price' THEN pm.meta_value END) AS regular_price,
             MAX(CASE WHEN pm.meta_key = '_manage_stock' THEN pm.meta_value END) AS manage_stock,
             MAX(CASE WHEN pm.meta_key = '_stock' THEN pm.meta_value END) AS stock,
             MAX(CASE WHEN pm.meta_key = '_stock_status' THEN pm.meta_value END) AS stock_status,
             MAX(CASE WHEN pm.meta_key = '_wc_rating_count' THEN pm.meta_value END) AS rating_raw,
             MAX(CASE WHEN pm.meta_key = '_wc_average_rating' THEN pm.meta_value END) AS average_rating,
             MAX(CASE WHEN pm.meta_key = 'total_sales' THEN pm.meta_value END) AS total_sales,
             MAX(CASE WHEN pm.meta_key = '_tax_status' THEN pm.meta_value END) AS tax_status,
             MAX(CASE WHEN pm.meta_key = '_tax_class' THEN pm.meta_value END) AS tax_class
      FROM {prefix}postmeta pm
      JOIN {prefix}posts pp ON pp.ID = pm.post_id AND pp.post_type IN ('product', 'product_variation')
      WHERE pm.meta_key IN ('_sku', '_global_unique_id', '_virtual', '_downloadable', '_price', '_sale_price',
                            '_regular_price', '_manage_stock', '_stock', '_stock_status', '_wc_rating_count',
                            '_wc_average_rating', 'total_sales', '_tax_status', '_tax_class')
      GROUP BY pm.post_id
    ) e ON e.post_id = ml.product_id
  ) v
) f;

-- name: Detail meta.missing_row: products and variations without a meta lookup row (scan)
SELECT 'meta.missing_row' AS class,
       p.ID AS product_id,
       p.post_parent AS parent_id,
       '' AS taxonomy,
       '' AS term_id,
       CONCAT(p.post_type, ' ', p.post_status) AS detail
FROM {prefix}posts p
LEFT JOIN {prefix}wc_product_meta_lookup ml ON ml.product_id = p.ID
WHERE p.post_type IN ('product', 'product_variation')
  AND p.post_status NOT IN ('trash', 'auto-draft')
  AND ml.product_id IS NULL
ORDER BY p.ID
LIMIT {limit};

-- name: Detail meta.orphan_row: meta lookup rows with no product or variation behind them
SELECT 'meta.orphan_row' AS class,
       ml.product_id,
       COALESCE(p.post_parent, '') AS parent_id,
       '' AS taxonomy,
       '' AS term_id,
       IF(p.ID IS NULL, 'no post with this ID', CONCAT('post type ', p.post_type)) AS detail
FROM {prefix}wc_product_meta_lookup ml
LEFT JOIN {prefix}posts p ON p.ID = ml.product_id
WHERE p.ID IS NULL OR p.post_type NOT IN ('product', 'product_variation')
ORDER BY ml.product_id
LIMIT {limit};

-- name: Detail meta.stale_value: meta lookup rows whose values differ from post meta (scan)
SELECT 'meta.stale_value' AS class,
       f.product_id,
       f.post_parent AS parent_id,
       '' AS taxonomy,
       '' AS term_id,
       CONCAT_WS(' | ',
         CONCAT('columns: ', CONCAT_WS(',',
           IF(f.c_sku, 'sku', NULL), IF(f.c_global_unique_id, 'global_unique_id', NULL),
           IF(f.c_virtual, 'virtual', NULL), IF(f.c_downloadable, 'downloadable', NULL),
           IF(f.c_price, 'min_max_price', NULL), IF(f.c_onsale, 'onsale', NULL),
           IF(f.c_stock_quantity, 'stock_quantity', NULL), IF(f.c_stock_quantity_unmanaged, 'stock_quantity_unmanaged', NULL),
           IF(f.c_stock_status, 'stock_status', NULL), IF(f.c_rating_count, 'rating_count_suspect', NULL),
           IF(f.c_average_rating, 'average_rating', NULL), IF(f.c_total_sales, 'total_sales', NULL),
           IF(f.c_tax_status, 'tax_status', NULL), IF(f.c_tax_class, 'tax_class', NULL))),
         IF(f.c_sku, CONCAT('sku ', QUOTE(COALESCE(f.l_sku, '')), ' expected ', QUOTE(COALESCE(f.m_sku, ''))), NULL),
         IF(f.c_price, CONCAT('price ', COALESCE(f.l_min, 'NULL'), '-', COALESCE(f.l_max, 'NULL'),
                              ' expected ', ROUND(f.m_min, 4), '-', ROUND(f.m_max, 4)), NULL),
         IF(f.c_onsale, CONCAT('onsale ', COALESCE(f.l_onsale, 'NULL'), ' with price ', COALESCE(ROUND(f.m_min, 4), 'none'),
                               ' sale ', QUOTE(COALESCE(f.m_sale, '')), ' regular ', QUOTE(COALESCE(f.m_regular, ''))), NULL),
         IF(f.c_stock_quantity OR f.c_stock_quantity_unmanaged,
            CONCAT('stock_quantity ', COALESCE(f.l_stock, 'NULL'), ' with _manage_stock ', QUOTE(COALESCE(f.m_manage, '')),
                   ' _stock ', QUOTE(COALESCE(f.m_stock, ''))), NULL),
         IF(f.c_stock_status, CONCAT('stock_status ', QUOTE(COALESCE(f.l_stock_status, '')), ' expected ',
                                     QUOTE(COALESCE(f.m_stock_status, ''))), NULL),
         IF(f.c_rating_count, CONCAT('rating_count ', COALESCE(f.l_rating_count, 'NULL'), ' with _wc_rating_count ',
                                     IF(COALESCE(f.m_rating_raw, '') IN ('', 'a:0:{}'), 'empty', 'set')), NULL),
         IF(f.c_average_rating, CONCAT('average_rating ', COALESCE(f.l_average_rating, 'NULL'), ' expected ',
                                       QUOTE(COALESCE(f.m_average_rating, ''))), NULL),
         IF(f.c_total_sales, CONCAT('total_sales ', COALESCE(f.l_total_sales, 'NULL'), ' expected ',
                                    QUOTE(COALESCE(f.m_total_sales, ''))), NULL),
         IF(f.c_tax_status OR f.c_tax_class, CONCAT('tax ', QUOTE(COALESCE(f.l_tax_status, '')), '/', QUOTE(COALESCE(f.l_tax_class, '')),
                                                  ' expected ', QUOTE(COALESCE(f.m_tax_status, '')), '/',
                                                  QUOTE(COALESCE(f.m_tax_class, ''))), NULL),
         IF(f.c_virtual OR f.c_downloadable, CONCAT('virtual/downloadable ', COALESCE(f.l_virtual, 'NULL'), '/',
                                                    COALESCE(f.l_downloadable, 'NULL'), ' with meta ',
                                                    QUOTE(COALESCE(f.m_virtual, '')), '/', QUOTE(COALESCE(f.m_downloadable, ''))), NULL),
         IF(f.c_global_unique_id, CONCAT('global_unique_id ', QUOTE(COALESCE(f.l_guid, '')), ' expected ',
                                         QUOTE(COALESCE(f.m_guid, ''))), NULL)
       ) AS detail
FROM (
  SELECT v.*,
         (CAST(COALESCE(v.l_sku, '') AS BINARY) <> CAST(COALESCE(v.m_sku, '') AS BINARY)) AS c_sku,
         (CAST(COALESCE(v.l_guid, '') AS BINARY) <> CAST(COALESCE(v.m_guid, '') AS BINARY)) AS c_global_unique_id,
         (COALESCE(v.l_virtual, 0) <> IF(v.m_virtual = 'yes', 1, 0)) AS c_virtual,
         (COALESCE(v.l_downloadable, 0) <> IF(v.m_downloadable = 'yes', 1, 0)) AS c_downloadable,
         (COALESCE(v.m_price_rows, 0) > 0
           AND (v.l_min IS NULL OR v.l_max IS NULL
                OR ABS(v.l_min - ROUND(v.m_min, 4)) >= 0.0001
                OR ABS(v.l_max - ROUND(v.m_max, 4)) >= 0.0001)) AS c_price,
         (COALESCE(v.l_onsale, 0) NOT IN (
            COALESCE(COALESCE(v.m_price_rows, 0) > 0 AND COALESCE(v.m_sale, '') <> '' AND v.m_min = v.m_sale + 0, 0),
            COALESCE(COALESCE(v.m_price_rows, 0) > 0 AND COALESCE(v.m_sale, '') <> '' AND v.m_min = v.m_sale + 0 AND v.m_sale + 0 <> 0, 0),
            COALESCE(COALESCE(v.m_price_rows, 0) > 0 AND v.m_min >= 0 AND COALESCE(v.m_sale, '') <> '' AND v.m_min = v.m_sale + 0
                     AND COALESCE(v.m_regular, '') <> '' AND v.m_regular + 0 > v.m_sale + 0, 0))) AS c_onsale,
         (v.m_manage = 'yes'
           AND NOT ((COALESCE(v.m_stock, '') = '' AND (v.l_stock IS NULL OR v.l_stock = 0))
                    OR (COALESCE(v.m_stock, '') <> '' AND v.l_stock IS NOT NULL
                        AND (ABS(v.l_stock - (v.m_stock + 0)) < 0.000001
                             OR ABS(v.l_stock - TRUNCATE(v.m_stock + 0, 0)) < 0.000001)))) AS c_stock_quantity,
         (COALESCE(v.m_manage, '') <> 'yes' AND v.l_stock IS NOT NULL) AS c_stock_quantity_unmanaged,
         (CAST(COALESCE(v.l_stock_status, '') AS BINARY) <> CAST(COALESCE(v.m_stock_status, '') AS BINARY)) AS c_stock_status,
         ((COALESCE(v.m_rating_raw, '') IN ('', 'a:0:{}') AND COALESCE(v.l_rating_count, 0) <> 0)
           OR (COALESCE(v.m_rating_raw, '') NOT IN ('', 'a:0:{}') AND COALESCE(v.l_rating_count, 0) = 0)) AS c_rating_count,
         (ABS(COALESCE(v.l_average_rating, 0) - ROUND(COALESCE(NULLIF(v.m_average_rating, '') + 0, 0), 2)) >= 0.01) AS c_average_rating,
         (COALESCE(v.l_total_sales, 0) <> TRUNCATE(COALESCE(NULLIF(v.m_total_sales, '') + 0, 0), 0)) AS c_total_sales,
         (CAST(COALESCE(v.l_tax_status, '') AS BINARY) <> CAST(COALESCE(v.m_tax_status, '') AS BINARY)) AS c_tax_status,
         (CAST(COALESCE(v.l_tax_class, '') AS BINARY) <> CAST(COALESCE(v.m_tax_class, '') AS BINARY)) AS c_tax_class
  FROM (
    SELECT ml.product_id, p.post_parent,
           ml.sku AS l_sku, e.sku AS m_sku,
           ml.global_unique_id AS l_guid, e.global_unique_id AS m_guid,
           ml.virtual AS l_virtual, e.is_virtual AS m_virtual,
           ml.downloadable AS l_downloadable, e.is_downloadable AS m_downloadable,
           ml.min_price AS l_min, ml.max_price AS l_max, e.price_rows AS m_price_rows, e.min_price AS m_min, e.max_price AS m_max,
           ml.onsale AS l_onsale, e.sale_price AS m_sale, e.regular_price AS m_regular,
           ml.stock_quantity AS l_stock, e.manage_stock AS m_manage, e.stock AS m_stock,
           ml.stock_status AS l_stock_status, e.stock_status AS m_stock_status,
           ml.rating_count AS l_rating_count, e.rating_raw AS m_rating_raw,
           ml.average_rating AS l_average_rating, e.average_rating AS m_average_rating,
           ml.total_sales AS l_total_sales, e.total_sales AS m_total_sales,
           ml.tax_status AS l_tax_status, e.tax_status AS m_tax_status,
           ml.tax_class AS l_tax_class, e.tax_class AS m_tax_class
    FROM {prefix}wc_product_meta_lookup ml
    JOIN {prefix}posts p ON p.ID = ml.product_id AND p.post_type IN ('product', 'product_variation')
    LEFT JOIN (
      SELECT pm.post_id,
             MAX(CASE WHEN pm.meta_key = '_sku' THEN pm.meta_value END) AS sku,
             MAX(CASE WHEN pm.meta_key = '_global_unique_id' THEN pm.meta_value END) AS global_unique_id,
             MAX(CASE WHEN pm.meta_key = '_virtual' THEN pm.meta_value END) AS is_virtual,
             MAX(CASE WHEN pm.meta_key = '_downloadable' THEN pm.meta_value END) AS is_downloadable,
             SUM(pm.meta_key = '_price' AND pm.meta_value <> '') AS price_rows,
             MIN(CASE WHEN pm.meta_key = '_price' AND pm.meta_value <> '' THEN pm.meta_value + 0 END) AS min_price,
             MAX(CASE WHEN pm.meta_key = '_price' AND pm.meta_value <> '' THEN pm.meta_value + 0 END) AS max_price,
             MAX(CASE WHEN pm.meta_key = '_sale_price' THEN pm.meta_value END) AS sale_price,
             MAX(CASE WHEN pm.meta_key = '_regular_price' THEN pm.meta_value END) AS regular_price,
             MAX(CASE WHEN pm.meta_key = '_manage_stock' THEN pm.meta_value END) AS manage_stock,
             MAX(CASE WHEN pm.meta_key = '_stock' THEN pm.meta_value END) AS stock,
             MAX(CASE WHEN pm.meta_key = '_stock_status' THEN pm.meta_value END) AS stock_status,
             MAX(CASE WHEN pm.meta_key = '_wc_rating_count' THEN pm.meta_value END) AS rating_raw,
             MAX(CASE WHEN pm.meta_key = '_wc_average_rating' THEN pm.meta_value END) AS average_rating,
             MAX(CASE WHEN pm.meta_key = 'total_sales' THEN pm.meta_value END) AS total_sales,
             MAX(CASE WHEN pm.meta_key = '_tax_status' THEN pm.meta_value END) AS tax_status,
             MAX(CASE WHEN pm.meta_key = '_tax_class' THEN pm.meta_value END) AS tax_class
      FROM {prefix}postmeta pm
      JOIN {prefix}posts pp ON pp.ID = pm.post_id AND pp.post_type IN ('product', 'product_variation')
      WHERE pm.meta_key IN ('_sku', '_global_unique_id', '_virtual', '_downloadable', '_price', '_sale_price',
                            '_regular_price', '_manage_stock', '_stock', '_stock_status', '_wc_rating_count',
                            '_wc_average_rating', 'total_sales', '_tax_status', '_tax_class')
      GROUP BY pm.post_id
    ) e ON e.post_id = ml.product_id
  ) v
) f
WHERE f.c_sku OR f.c_global_unique_id OR f.c_virtual OR f.c_downloadable OR f.c_price OR f.c_onsale
   OR f.c_stock_quantity OR f.c_stock_quantity_unmanaged OR f.c_stock_status OR f.c_rating_count
   OR f.c_average_rating OR f.c_total_sales OR f.c_tax_status OR f.c_tax_class
ORDER BY f.product_id
LIMIT {limit};

-- name: Detail meta.no_price: products and variations with no non-empty _price in post meta (scan)
SELECT 'meta.no_price' AS class,
       p.ID AS product_id,
       p.post_parent AS parent_id,
       '' AS taxonomy,
       '' AS term_id,
       CONCAT(p.post_type, ' ', p.post_status, ' ', COALESCE(pt.product_type, ''),
              IF(EXISTS (SELECT 1 FROM {prefix}postmeta rp
                         WHERE rp.post_id = p.ID AND rp.meta_key = '_regular_price' AND rp.meta_value <> ''),
                 ', _regular_price is set', ', no _regular_price')) AS detail
FROM {prefix}posts p
LEFT JOIN (SELECT tr.object_id, MAX(t.slug) AS product_type
           FROM {prefix}term_relationships tr
           JOIN {prefix}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_type'
           JOIN {prefix}terms t ON t.term_id = tt.term_id
           GROUP BY tr.object_id) pt ON pt.object_id = p.ID
WHERE p.post_type IN ('product', 'product_variation')
  AND p.post_status NOT IN ('trash', 'auto-draft')
  AND NOT EXISTS (SELECT 1 FROM {prefix}postmeta pr WHERE pr.post_id = p.ID AND pr.meta_key = '_price' AND pr.meta_value <> '')
ORDER BY p.ID
LIMIT {limit};

-- name: Detail attr.orphan_row: attribute lookup rows for products that are gone or in the trash
SELECT x.class, x.product_id, x.parent_id, x.taxonomy, x.term_id, x.detail
FROM (
  SELECT 'attr.orphan_row' AS class,
         al.product_id,
         al.product_or_parent_id AS parent_id,
         al.taxonomy,
         al.term_id,
         CASE
           WHEN p.ID IS NULL THEN 'product_id has no post'
           WHEN p.post_type NOT IN ('product', 'product_variation') THEN CONCAT('product_id is a ', p.post_type)
           WHEN p.post_status = 'trash' THEN 'product or variation is in the trash'
           WHEN pp.ID IS NULL THEN 'product_or_parent_id has no post'
           WHEN pp.post_status = 'trash' THEN 'parent product is in the trash'
           ELSE NULL
         END AS detail
  FROM {prefix}wc_product_attributes_lookup al
  LEFT JOIN {prefix}posts p ON p.ID = al.product_id
  LEFT JOIN {prefix}posts pp ON pp.ID = al.product_or_parent_id
) x
WHERE x.detail IS NOT NULL
ORDER BY x.parent_id, x.product_id
LIMIT {limit};

-- name: Detail attr.structure_mismatch: attribute lookup rows whose parent or variation flag contradicts the posts
SELECT x.class, x.product_id, x.parent_id, x.taxonomy, x.term_id, x.detail
FROM (
  SELECT 'attr.structure_mismatch' AS class,
         al.product_id,
         al.product_or_parent_id AS parent_id,
         al.taxonomy,
         al.term_id,
         CASE
           WHEN p.post_type = 'product_variation' AND al.product_or_parent_id <> p.post_parent
             THEN CONCAT('variation belongs to product ', p.post_parent)
           WHEN p.post_type = 'product_variation' AND al.is_variation_attribute <> 1
             THEN 'variation row not flagged is_variation_attribute'
           WHEN p.post_type = 'product' AND al.product_or_parent_id <> al.product_id
             THEN 'product row with a different product_or_parent_id'
           WHEN p.post_type = 'product' AND al.is_variation_attribute <> 0
             THEN 'product row flagged is_variation_attribute'
           ELSE NULL
         END AS detail
  FROM {prefix}wc_product_attributes_lookup al
  JOIN {prefix}posts p ON p.ID = al.product_id AND p.post_type IN ('product', 'product_variation')
) x
WHERE x.detail IS NOT NULL
ORDER BY x.parent_id, x.product_id
LIMIT {limit};

-- name: Detail attr.deleted_term: attribute lookup rows for a term that no longer exists in that taxonomy
SELECT 'attr.deleted_term' AS class,
       al.product_id,
       al.product_or_parent_id AS parent_id,
       al.taxonomy,
       al.term_id,
       'no term_taxonomy row for this term and taxonomy' AS detail
FROM {prefix}wc_product_attributes_lookup al
LEFT JOIN {prefix}term_taxonomy tt ON tt.term_id = al.term_id AND tt.taxonomy = al.taxonomy
WHERE tt.term_taxonomy_id IS NULL
ORDER BY al.product_or_parent_id, al.product_id
LIMIT {limit};

-- name: Detail attr.stale_term: attribute lookup rows for a term the product no longer has (scan)
SELECT u.class, u.product_id, u.parent_id, u.taxonomy, u.term_id, u.detail
FROM (
  SELECT 'attr.stale_term' AS class,
         al.product_id,
         al.product_or_parent_id AS parent_id,
         al.taxonomy,
         al.term_id,
         'product row: term not assigned to the product, or attribute not listed in _product_attributes' AS detail
  FROM {prefix}wc_product_attributes_lookup al
  JOIN {prefix}posts p ON p.ID = al.product_id AND p.post_type = 'product'
                      AND p.post_status IN ('publish', 'draft', 'pending', 'private')
  JOIN {prefix}term_taxonomy tt ON tt.term_id = al.term_id AND tt.taxonomy = al.taxonomy
  LEFT JOIN {prefix}term_relationships tr ON tr.object_id = al.product_id AND tr.term_taxonomy_id = tt.term_taxonomy_id
  LEFT JOIN {prefix}postmeta pa ON pa.post_id = al.product_id AND pa.meta_key = '_product_attributes'
  WHERE al.is_variation_attribute = 0
    AND (tr.object_id IS NULL OR pa.meta_id IS NULL OR LOCATE(CONCAT('"', al.taxonomy, '"'), pa.meta_value) = 0)
  UNION ALL
  SELECT 'attr.stale_term' AS class,
         al.product_id,
         al.product_or_parent_id AS parent_id,
         al.taxonomy,
         al.term_id,
         'variation row for "any" value: term not assigned to the parent product' AS detail
  FROM {prefix}wc_product_attributes_lookup al
  JOIN {prefix}posts v ON v.ID = al.product_id AND v.post_type = 'product_variation'
                      AND v.post_status IN ('publish', 'private')
  JOIN {prefix}postmeta vm ON vm.post_id = al.product_id AND vm.meta_key = CONCAT('attribute_', al.taxonomy)
                          AND vm.meta_value = ''
  JOIN {prefix}term_taxonomy tt ON tt.term_id = al.term_id AND tt.taxonomy = al.taxonomy
  LEFT JOIN {prefix}term_relationships tr ON tr.object_id = al.product_or_parent_id
                                         AND tr.term_taxonomy_id = tt.term_taxonomy_id
  WHERE al.is_variation_attribute = 1
    AND tr.object_id IS NULL
) u
ORDER BY u.parent_id, u.product_id
LIMIT {limit};

-- name: Detail attr.missing_term_row: terms of simple, grouped and external products with no lookup row (scan)
SELECT 'attr.missing_term_row' AS class,
       lt.product_id,
       lt.product_id AS parent_id,
       lt.taxonomy,
       lt.term_id,
       CONCAT(COALESCE(pt.product_type, 'no product_type'), ' ', lt.post_status) AS detail
FROM (
  SELECT p.ID AS product_id, p.post_status, tt.taxonomy, tt.term_id
  FROM {prefix}posts p
  JOIN {prefix}term_relationships tr ON tr.object_id = p.ID
  JOIN {prefix}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy LIKE 'pa\_%'
  JOIN {prefix}woocommerce_attribute_taxonomies wat ON CONCAT('pa_', wat.attribute_name) = tt.taxonomy
  JOIN {prefix}postmeta pa ON pa.post_id = p.ID AND pa.meta_key = '_product_attributes'
  WHERE p.post_type = 'product'
    AND p.post_status IN ('publish', 'draft', 'pending', 'private')
    AND LOCATE(CONCAT('"', tt.taxonomy, '"'), pa.meta_value) > 0
) lt
LEFT JOIN (SELECT tr.object_id, MAX(t.slug) AS product_type
           FROM {prefix}term_relationships tr
           JOIN {prefix}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_type'
           JOIN {prefix}terms t ON t.term_id = tt.term_id
           GROUP BY tr.object_id) pt ON pt.object_id = lt.product_id
LEFT JOIN {prefix}wc_product_attributes_lookup al ON al.product_or_parent_id = lt.product_id
                                                 AND al.product_id = lt.product_id
                                                 AND al.taxonomy = lt.taxonomy
                                                 AND al.term_id = lt.term_id
WHERE COALESCE(pt.product_type, '') <> 'variable'
  AND al.product_id IS NULL
  AND lt.product_id NOT IN (SELECT tr3.object_id
                            FROM {prefix}term_relationships tr3
                            JOIN {prefix}term_taxonomy tt3 ON tt3.term_taxonomy_id = tr3.term_taxonomy_id AND tt3.taxonomy = 'product_visibility'
                            JOIN {prefix}terms t3 ON t3.term_id = tt3.term_id AND t3.name = 'exclude-from-catalog')
ORDER BY lt.product_id, lt.taxonomy, lt.term_id
LIMIT {limit};

-- name: Detail attr.missing_product_rows: products with attribute terms and no lookup rows at all (scan)
SELECT 'attr.missing_product_rows' AS class,
       lt.product_id,
       lt.product_id AS parent_id,
       '' AS taxonomy,
       '' AS term_id,
       CONCAT(COALESCE(pt.product_type, 'no product_type'), ' ', p.post_status, ', ', lt.terms, ' attribute terms') AS detail
FROM (
  SELECT p0.ID AS product_id, COUNT(*) AS terms
  FROM {prefix}posts p0
  JOIN {prefix}term_relationships tr ON tr.object_id = p0.ID
  JOIN {prefix}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy LIKE 'pa\_%'
  JOIN {prefix}woocommerce_attribute_taxonomies wat ON CONCAT('pa_', wat.attribute_name) = tt.taxonomy
  JOIN {prefix}postmeta pa ON pa.post_id = p0.ID AND pa.meta_key = '_product_attributes'
  WHERE p0.post_type = 'product'
    AND p0.post_status IN ('publish', 'draft', 'pending', 'private')
    AND LOCATE(CONCAT('"', tt.taxonomy, '"'), pa.meta_value) > 0
  GROUP BY p0.ID
) lt
JOIN {prefix}posts p ON p.ID = lt.product_id
LEFT JOIN (SELECT tr.object_id, MAX(t.slug) AS product_type
           FROM {prefix}term_relationships tr
           JOIN {prefix}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_type'
           JOIN {prefix}terms t ON t.term_id = tt.term_id
           GROUP BY tr.object_id) pt ON pt.object_id = lt.product_id
WHERE NOT EXISTS (SELECT 1 FROM {prefix}wc_product_attributes_lookup al WHERE al.product_or_parent_id = lt.product_id)
  AND (COALESCE(pt.product_type, '') <> 'variable'
       OR EXISTS (SELECT 1 FROM {prefix}posts v
                  WHERE v.post_parent = lt.product_id AND v.post_type = 'product_variation'
                    AND v.post_status IN ('publish', 'private')))
  AND lt.product_id NOT IN (SELECT tr3.object_id
                            FROM {prefix}term_relationships tr3
                            JOIN {prefix}term_taxonomy tt3 ON tt3.term_taxonomy_id = tr3.term_taxonomy_id AND tt3.taxonomy = 'product_visibility'
                            JOIN {prefix}terms t3 ON t3.term_id = tt3.term_id AND t3.name = 'exclude-from-catalog')
ORDER BY lt.product_id
LIMIT {limit};

-- name: Detail attr.missing_variation_rows: variations with no lookup row for one of their attributes (scan)
SELECT 'attr.missing_variation_rows' AS class,
       v.ID AS product_id,
       v.post_parent AS parent_id,
       lt.taxonomy,
       '' AS term_id,
       CONCAT('variation ', v.post_status, IF(vm.meta_value = '', ', value any', CONCAT(', value ', QUOTE(vm.meta_value)))) AS detail
FROM {prefix}posts v
JOIN {prefix}postmeta vm ON vm.post_id = v.ID AND vm.meta_key LIKE 'attribute\_pa\_%'
JOIN (
  SELECT DISTINCT p0.ID AS product_id, tt.taxonomy
  FROM {prefix}posts p0
  JOIN {prefix}term_relationships tr ON tr.object_id = p0.ID
  JOIN {prefix}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy LIKE 'pa\_%'
  JOIN {prefix}woocommerce_attribute_taxonomies wat ON CONCAT('pa_', wat.attribute_name) = tt.taxonomy
  JOIN {prefix}postmeta pa ON pa.post_id = p0.ID AND pa.meta_key = '_product_attributes'
  JOIN {prefix}term_relationships trt ON trt.object_id = p0.ID
  JOIN {prefix}term_taxonomy ttt ON ttt.term_taxonomy_id = trt.term_taxonomy_id AND ttt.taxonomy = 'product_type'
  JOIN {prefix}terms tt_type ON tt_type.term_id = ttt.term_id AND tt_type.slug = 'variable'
  WHERE p0.post_type = 'product'
    AND p0.post_status IN ('publish', 'draft', 'pending', 'private')
    AND LOCATE(CONCAT('"', tt.taxonomy, '"'), pa.meta_value) > 0
) lt ON lt.product_id = v.post_parent AND vm.meta_key = CONCAT('attribute_', lt.taxonomy)
LEFT JOIN {prefix}wc_product_attributes_lookup al ON al.product_id = v.ID AND al.taxonomy = lt.taxonomy
WHERE v.post_type = 'product_variation'
  AND v.post_status IN ('publish', 'private')
  AND al.product_id IS NULL
  AND (vm.meta_value = ''
       OR EXISTS (SELECT 1
                  FROM {prefix}term_relationships tr2
                  JOIN {prefix}term_taxonomy tt2 ON tt2.term_taxonomy_id = tr2.term_taxonomy_id AND tt2.taxonomy = lt.taxonomy
                  JOIN {prefix}terms t2 ON t2.term_id = tt2.term_id AND t2.slug = vm.meta_value
                  WHERE tr2.object_id = v.post_parent))
  AND v.post_parent NOT IN (SELECT tr3.object_id
                            FROM {prefix}term_relationships tr3
                            JOIN {prefix}term_taxonomy tt3 ON tt3.term_taxonomy_id = tr3.term_taxonomy_id AND tt3.taxonomy = 'product_visibility'
                            JOIN {prefix}terms t3 ON t3.term_id = tt3.term_id AND t3.name = 'exclude-from-catalog')
ORDER BY v.post_parent, v.ID, lt.taxonomy
LIMIT {limit};

-- name: Detail attr.variation_term_mismatch: variation rows whose term differs from the variation's own value
SELECT 'attr.variation_term_mismatch' AS class,
       al.product_id,
       al.product_or_parent_id AS parent_id,
       al.taxonomy,
       al.term_id,
       CONCAT('row term ', QUOTE(t.slug), ', variation value ', QUOTE(vm.meta_value)) AS detail
FROM {prefix}wc_product_attributes_lookup al
JOIN {prefix}postmeta vm ON vm.post_id = al.product_id AND vm.meta_key = CONCAT('attribute_', al.taxonomy)
                        AND vm.meta_value <> ''
JOIN {prefix}terms t ON t.term_id = al.term_id
WHERE al.is_variation_attribute = 1
  AND CAST(t.slug AS BINARY) <> CAST(vm.meta_value AS BINARY)
ORDER BY al.product_or_parent_id, al.product_id
LIMIT {limit};

-- name: Detail attr.stale_stock: attribute lookup rows whose in_stock contradicts _stock_status
SELECT 'attr.stale_stock' AS class,
       al.product_id,
       al.product_or_parent_id AS parent_id,
       al.taxonomy,
       al.term_id,
       CONCAT('in_stock ', al.in_stock, ', _stock_status ', ss.meta_value) AS detail
FROM {prefix}wc_product_attributes_lookup al
JOIN {prefix}postmeta ss ON ss.post_id = al.product_id AND ss.meta_key = '_stock_status'
WHERE (ss.meta_value = 'instock' AND al.in_stock = 0)
   OR (ss.meta_value = 'outofstock' AND al.in_stock = 1)
ORDER BY al.product_or_parent_id, al.product_id
LIMIT {limit};

-- name: Attribute lookup rows that depend on how they were written (information, not mismatches) (scan)
SELECT 'rows of products hidden from the catalog (a save removes them, a regeneration writes them)' AS finding,
       COUNT(*) AS lookup_rows
FROM {prefix}wc_product_attributes_lookup al
WHERE al.product_or_parent_id IN (SELECT tr3.object_id
                                  FROM {prefix}term_relationships tr3
                                  JOIN {prefix}term_taxonomy tt3 ON tt3.term_taxonomy_id = tr3.term_taxonomy_id AND tt3.taxonomy = 'product_visibility'
                                  JOIN {prefix}terms t3 ON t3.term_id = tt3.term_id AND t3.name = 'exclude-from-catalog')
UNION ALL
SELECT CONCAT('rows of onbackorder items with in_stock ', al.in_stock, ' (object path writes 1, optimized path writes 0)'),
       COUNT(*)
FROM {prefix}wc_product_attributes_lookup al
JOIN {prefix}postmeta ss ON ss.post_id = al.product_id AND ss.meta_key = '_stock_status' AND ss.meta_value = 'onbackorder'
GROUP BY al.in_stock
UNION ALL
SELECT CONCAT('rows of ', v.post_status, ' variations (private is a disabled variation; see version-notes.md for 11.3.0)'),
       COUNT(*)
FROM {prefix}wc_product_attributes_lookup al
JOIN {prefix}posts v ON v.ID = al.product_id AND v.post_type = 'product_variation' AND v.post_status <> 'publish'
GROUP BY v.post_status
UNION ALL
SELECT 'rows for pa_ taxonomies not registered in woocommerce_attribute_taxonomies (object path skips them)',
       COUNT(*)
FROM {prefix}wc_product_attributes_lookup al
LEFT JOIN {prefix}woocommerce_attribute_taxonomies wat ON CONCAT('pa_', wat.attribute_name) = al.taxonomy
WHERE wat.attribute_id IS NULL;
