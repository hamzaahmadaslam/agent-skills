-- Read-only: every statement below is a SELECT. Nothing here changes data, settings or tables.
--
-- Scheduled sale state checks for one WooCommerce site: stored _price against the sale window, the rows the daily
-- safety net would pick up, the per-product Action Scheduler events, the daily action itself, variable parents, the
-- product lookup table and the price transients.
--
-- Placeholders, filled in by sale-readonly-report.sh (or by hand):
--   {prefix}  the site's table prefix, from `wp db prefix` (per site on multisite: wp db prefix --url=...)
--   {now}     the audit time as a Unix timestamp (UTC seconds), for example from `date -u +%s`. Use the same value
--             in every block so the results agree with each other. Where WooCommerce compares against a quoted
--             time() (get_starting_sales, get_ending_sales), the copy here quotes it too.
-- Each block starts with a "-- name:" line and holds one statement; the report script runs them one at a time, so a
-- block that fails (for example Action Scheduler tables that do not exist) does not stop the others.
-- Blocks marked "(scan)" read every product price row. On a big store run them on a replica or staging copy, or at a
-- quiet hour.
-- Output holds product IDs, prices, dates, hook names and counts: no customer data.
-- Dates are shown in UTC with DATE_ADD('1970-01-01 00:00:00', INTERVAL <ts> SECOND), which does not depend on the
-- MySQL session time zone (FROM_UNIXTIME does).
-- Portability: derived tables only (no CTEs, no window functions, no JSON functions), so MySQL 5.7 and later and
-- MariaDB 10.2 and later run every block. `<=>` is the null-safe equality operator of both.
-- Names: WooCommerce 11.1.2 (meta keys, product_type taxonomy, wc_product_meta_lookup) and Action Scheduler 4.0.0
-- (actionscheduler_actions, actionscheduler_groups). references/*.md explain each result.

-- name: Sale data: products and variations with a sale price or sale dates, by state at {now} (scan)
SELECT y.post_type,
       SUM(y.sale_num IS NOT NULL) AS with_sale_price,
       SUM(y.from_ts IS NOT NULL OR y.to_ts IS NOT NULL) AS with_sale_dates,
       SUM(y.from_ts IS NOT NULL AND y.from_ts > {now}) AS start_in_future,
       SUM(y.to_ts IS NOT NULL AND y.to_ts < {now}) AS end_in_past,
       SUM(y.on_sale_expected) AS window_open_now,
       SUM(y.priced AND NOT (y.price_num <=> y.expected_num)) AS price_disagrees
FROM (
  SELECT x.*,
         (x.product_type IS NULL OR x.product_type NOT IN ('variable', 'grouped')) AS priced,
         IF(x.sale_num IS NOT NULL AND x.regular_num IS NOT NULL AND x.regular_num > x.sale_num
            AND NOT (x.from_ts IS NOT NULL AND x.from_ts > {now})
            AND NOT (x.to_ts IS NOT NULL AND x.to_ts < {now}), 1, 0) AS on_sale_expected,
         IF(x.sale_num IS NOT NULL AND x.regular_num IS NOT NULL AND x.regular_num > x.sale_num
            AND NOT (x.from_ts IS NOT NULL AND x.from_ts > {now})
            AND NOT (x.to_ts IS NOT NULL AND x.to_ts < {now}), x.sale_num, x.regular_num) AS expected_num
  FROM (
    SELECT s.id, s.post_type, pt.product_type,
           NULLIF(CAST(COALESCE(NULLIF(s.date_from, ''), '0') AS UNSIGNED), 0) AS from_ts,
           NULLIF(CAST(COALESCE(NULLIF(s.date_to, ''), '0') AS UNSIGNED), 0) AS to_ts,
           IF(COALESCE(s.regular_price, '') = '', NULL, CAST(s.regular_price AS DECIMAL(19,4))) AS regular_num,
           IF(COALESCE(s.sale_price, '') = '', NULL, CAST(s.sale_price AS DECIMAL(19,4))) AS sale_num,
           IF(COALESCE(s.price, '') = '', NULL, CAST(s.price AS DECIMAL(19,4))) AS price_num
    FROM (
      SELECT p.ID AS id, p.post_type,
             MAX(CASE WHEN m.meta_key = '_regular_price' THEN m.meta_value END) AS regular_price,
             MAX(CASE WHEN m.meta_key = '_sale_price' THEN m.meta_value END) AS sale_price,
             MAX(CASE WHEN m.meta_key = '_price' THEN m.meta_value END) AS price,
             MAX(CASE WHEN m.meta_key = '_sale_price_dates_from' THEN m.meta_value END) AS date_from,
             MAX(CASE WHEN m.meta_key = '_sale_price_dates_to' THEN m.meta_value END) AS date_to
      FROM {prefix}posts p
      JOIN {prefix}postmeta m ON m.post_id = p.ID
       AND m.meta_key IN ('_regular_price', '_sale_price', '_price', '_sale_price_dates_from', '_sale_price_dates_to')
      WHERE p.post_type IN ('product', 'product_variation')
        AND p.post_status NOT IN ('trash', 'auto-draft')
      GROUP BY p.ID, p.post_type
    ) s
    LEFT JOIN (
      SELECT tr.object_id, MAX(t.slug) AS product_type
      FROM {prefix}term_relationships tr
      JOIN {prefix}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_type'
      JOIN {prefix}terms t ON t.term_id = tt.term_id
      GROUP BY tr.object_id
    ) pt ON pt.object_id = s.id
  ) x
  WHERE x.sale_num IS NOT NULL OR x.from_ts IS NOT NULL OR x.to_ts IS NOT NULL
) y
GROUP BY y.post_type;

-- name: Stored _price disagrees with the sale window at {now} (simple, external and variations; top 200) (scan)
SELECT y.id, y.post_type, COALESCE(y.product_type, '') AS product_type, y.parent_id, y.post_status,
       y.regular_price, y.sale_price, y.price AS stored_price, y.price_rows,
       IF(y.from_ts IS NULL, '', DATE_ADD('1970-01-01 00:00:00', INTERVAL y.from_ts SECOND)) AS sale_from_utc,
       IF(y.to_ts IS NULL, '', DATE_ADD('1970-01-01 00:00:00', INTERVAL y.to_ts SECOND)) AS sale_to_utc,
       CASE
         WHEN y.on_sale_expected = 1 THEN 'window open'
         WHEN y.sale_num IS NULL THEN 'no sale price'
         WHEN y.regular_num IS NULL OR y.regular_num <= y.sale_num THEN 'sale price not below regular'
         WHEN y.from_ts IS NOT NULL AND y.from_ts > {now} THEN 'not started'
         ELSE 'ended'
       END AS window_state,
       CASE
         WHEN y.price_num <=> y.sale_num THEN 'stored sale price, window closed'
         WHEN y.price_num <=> y.regular_num THEN 'stored regular price, window open'
         WHEN y.price_num IS NULL THEN 'no stored price'
         ELSE 'stored price matches neither'
       END AS finding
FROM (
  SELECT x.*,
         IF(x.sale_num IS NOT NULL AND x.regular_num IS NOT NULL AND x.regular_num > x.sale_num
            AND NOT (x.from_ts IS NOT NULL AND x.from_ts > {now})
            AND NOT (x.to_ts IS NOT NULL AND x.to_ts < {now}), 1, 0) AS on_sale_expected,
         IF(x.sale_num IS NOT NULL AND x.regular_num IS NOT NULL AND x.regular_num > x.sale_num
            AND NOT (x.from_ts IS NOT NULL AND x.from_ts > {now})
            AND NOT (x.to_ts IS NOT NULL AND x.to_ts < {now}), x.sale_num, x.regular_num) AS expected_num
  FROM (
    SELECT s.*, pt.product_type,
           NULLIF(CAST(COALESCE(NULLIF(s.date_from, ''), '0') AS UNSIGNED), 0) AS from_ts,
           NULLIF(CAST(COALESCE(NULLIF(s.date_to, ''), '0') AS UNSIGNED), 0) AS to_ts,
           IF(COALESCE(s.regular_price, '') = '', NULL, CAST(s.regular_price AS DECIMAL(19,4))) AS regular_num,
           IF(COALESCE(s.sale_price, '') = '', NULL, CAST(s.sale_price AS DECIMAL(19,4))) AS sale_num,
           IF(COALESCE(s.price, '') = '', NULL, CAST(s.price AS DECIMAL(19,4))) AS price_num
    FROM (
      SELECT p.ID AS id, p.post_type, p.post_parent AS parent_id, p.post_status,
             MAX(CASE WHEN m.meta_key = '_regular_price' THEN m.meta_value END) AS regular_price,
             MAX(CASE WHEN m.meta_key = '_sale_price' THEN m.meta_value END) AS sale_price,
             MAX(CASE WHEN m.meta_key = '_price' THEN m.meta_value END) AS price,
             SUM(m.meta_key = '_price') AS price_rows,
             MAX(CASE WHEN m.meta_key = '_sale_price_dates_from' THEN m.meta_value END) AS date_from,
             MAX(CASE WHEN m.meta_key = '_sale_price_dates_to' THEN m.meta_value END) AS date_to
      FROM {prefix}posts p
      JOIN {prefix}postmeta m ON m.post_id = p.ID
       AND m.meta_key IN ('_regular_price', '_sale_price', '_price', '_sale_price_dates_from', '_sale_price_dates_to')
      WHERE p.post_type IN ('product', 'product_variation')
        AND p.post_status NOT IN ('trash', 'auto-draft')
      GROUP BY p.ID, p.post_type, p.post_parent, p.post_status
    ) s
    LEFT JOIN (
      SELECT tr.object_id, MAX(t.slug) AS product_type
      FROM {prefix}term_relationships tr
      JOIN {prefix}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_type'
      JOIN {prefix}terms t ON t.term_id = tt.term_id
      GROUP BY tr.object_id
    ) pt ON pt.object_id = s.id
  ) x
  WHERE (x.product_type IS NULL OR x.product_type NOT IN ('variable', 'grouped'))
    AND (x.sale_num IS NOT NULL OR x.from_ts IS NOT NULL OR x.to_ts IS NOT NULL)
) y
WHERE NOT (y.price_num <=> y.expected_num)
ORDER BY y.id
LIMIT 200;

-- name: Export for explain-sale-state.mjs: every product and variation with sale data (tab-separated; top 2000) (scan)
SELECT s.id, s.post_type, COALESCE(pt.product_type, '') AS product_type, s.parent_id,
       COALESCE(s.regular_price, '') AS regular_price, COALESCE(s.sale_price, '') AS sale_price,
       COALESCE(s.price, '') AS price, s.price_rows,
       COALESCE(s.date_from, '') AS date_from, COALESCE(s.date_to, '') AS date_to
FROM (
  SELECT p.ID AS id, p.post_type, p.post_parent AS parent_id,
         MAX(CASE WHEN m.meta_key = '_regular_price' THEN m.meta_value END) AS regular_price,
         MAX(CASE WHEN m.meta_key = '_sale_price' THEN m.meta_value END) AS sale_price,
         MAX(CASE WHEN m.meta_key = '_price' THEN m.meta_value END) AS price,
         SUM(m.meta_key = '_price') AS price_rows,
         MAX(CASE WHEN m.meta_key = '_sale_price_dates_from' THEN m.meta_value END) AS date_from,
         MAX(CASE WHEN m.meta_key = '_sale_price_dates_to' THEN m.meta_value END) AS date_to
  FROM {prefix}posts p
  JOIN {prefix}postmeta m ON m.post_id = p.ID
   AND m.meta_key IN ('_regular_price', '_sale_price', '_price', '_sale_price_dates_from', '_sale_price_dates_to')
  WHERE p.post_type IN ('product', 'product_variation')
    AND p.post_status NOT IN ('trash', 'auto-draft')
  GROUP BY p.ID, p.post_type, p.post_parent
) s
LEFT JOIN (
  SELECT tr.object_id, MAX(t.slug) AS product_type
  FROM {prefix}term_relationships tr
  JOIN {prefix}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_type'
  JOIN {prefix}terms t ON t.term_id = tt.term_id
  GROUP BY tr.object_id
) pt ON pt.object_id = s.id
WHERE COALESCE(s.sale_price, '') <> '' OR COALESCE(s.date_from, '') <> '' OR COALESCE(s.date_to, '') <> ''
ORDER BY s.id
LIMIT 2000;

-- name: Daily safety net, starting query as in WooCommerce 11.1.2 get_starting_sales() at {now}, with the end date shown
SELECT postmeta.post_id,
       COALESCE(ended.meta_value, '') AS date_to,
       IF(ended.meta_value > 0 AND ended.meta_value < '{now}', 'end date passed: reprocessed every run on 10.5.0 to 11.1.x', '') AS note
FROM {prefix}postmeta AS postmeta
LEFT JOIN {prefix}postmeta AS postmeta_2 ON postmeta.post_id = postmeta_2.post_id
LEFT JOIN {prefix}postmeta AS postmeta_3 ON postmeta.post_id = postmeta_3.post_id
LEFT JOIN {prefix}postmeta AS ended ON ended.post_id = postmeta.post_id AND ended.meta_key = '_sale_price_dates_to'
WHERE postmeta.meta_key = '_sale_price_dates_from'
  AND postmeta_2.meta_key = '_price'
  AND postmeta_3.meta_key = '_sale_price'
  AND postmeta.meta_value > 0
  AND postmeta.meta_value < '{now}'
  AND postmeta_2.meta_value != postmeta_3.meta_value
ORDER BY postmeta.post_id
LIMIT 500;

-- name: Daily safety net, ending query as in WooCommerce 11.1.2 get_ending_sales() at {now}
SELECT postmeta.post_id
FROM {prefix}postmeta AS postmeta
LEFT JOIN {prefix}postmeta AS postmeta_2 ON postmeta.post_id = postmeta_2.post_id
LEFT JOIN {prefix}postmeta AS postmeta_3 ON postmeta.post_id = postmeta_3.post_id
WHERE postmeta.meta_key = '_sale_price_dates_to'
  AND postmeta_2.meta_key = '_price'
  AND postmeta_3.meta_key = '_regular_price'
  AND postmeta.meta_value > 0
  AND postmeta.meta_value < '{now}'
  AND postmeta_2.meta_value != postmeta_3.meta_value
ORDER BY postmeta.post_id
LIMIT 500;

-- name: Count of rows each daily query returns at {now} (large counts mean a long, memory-heavy daily run)
SELECT 'starting' AS query, COUNT(*) AS product_ids
FROM {prefix}postmeta AS postmeta
LEFT JOIN {prefix}postmeta AS postmeta_2 ON postmeta.post_id = postmeta_2.post_id
LEFT JOIN {prefix}postmeta AS postmeta_3 ON postmeta.post_id = postmeta_3.post_id
WHERE postmeta.meta_key = '_sale_price_dates_from'
  AND postmeta_2.meta_key = '_price'
  AND postmeta_3.meta_key = '_sale_price'
  AND postmeta.meta_value > 0
  AND postmeta.meta_value < '{now}'
  AND postmeta_2.meta_value != postmeta_3.meta_value
UNION ALL
SELECT 'ending' AS query, COUNT(*) AS product_ids
FROM {prefix}postmeta AS postmeta
LEFT JOIN {prefix}postmeta AS postmeta_2 ON postmeta.post_id = postmeta_2.post_id
LEFT JOIN {prefix}postmeta AS postmeta_3 ON postmeta.post_id = postmeta_3.post_id
WHERE postmeta.meta_key = '_sale_price_dates_to'
  AND postmeta_2.meta_key = '_price'
  AND postmeta_3.meta_key = '_regular_price'
  AND postmeta.meta_value > 0
  AND postmeta.meta_value < '{now}'
  AND postmeta_2.meta_value != postmeta_3.meta_value;

-- name: Empty or zero sale price with a sale start date (the shape of issue 67995)
SELECT f.post_id, COALESCE(sp.meta_value, '(no _sale_price row)') AS sale_price, f.meta_value AS date_from,
       COALESCE(pr.meta_value, '') AS stored_price
FROM {prefix}postmeta f
LEFT JOIN {prefix}postmeta sp ON sp.post_id = f.post_id AND sp.meta_key = '_sale_price'
LEFT JOIN {prefix}postmeta pr ON pr.post_id = f.post_id AND pr.meta_key = '_price'
WHERE f.meta_key = '_sale_price_dates_from'
  AND f.meta_value > 0
  AND (sp.meta_value IS NULL OR sp.meta_value IN ('', '0'))
ORDER BY f.post_id
LIMIT 200;

-- name: Sale dates stored in a form other than digits, or an end before the start
SELECT f.post_id,
       COALESCE(f.meta_value, '') AS date_from,
       COALESCE(t.meta_value, '') AS date_to,
       CASE
         WHEN f.meta_value IS NOT NULL AND f.meta_value <> '' AND f.meta_value NOT REGEXP '^[0-9]+$' THEN 'start is not a Unix timestamp'
         WHEN t.meta_value IS NOT NULL AND t.meta_value <> '' AND t.meta_value NOT REGEXP '^[0-9]+$' THEN 'end is not a Unix timestamp'
         ELSE 'end before start'
       END AS finding
FROM {prefix}postmeta f
LEFT JOIN {prefix}postmeta t ON t.post_id = f.post_id AND t.meta_key = '_sale_price_dates_to'
WHERE f.meta_key = '_sale_price_dates_from'
  AND f.meta_value <> ''
  AND ( f.meta_value NOT REGEXP '^[0-9]+$'
     OR (t.meta_value IS NOT NULL AND t.meta_value <> '' AND t.meta_value NOT REGEXP '^[0-9]+$')
     OR (t.meta_value REGEXP '^[0-9]+$' AND f.meta_value REGEXP '^[0-9]+$' AND CAST(t.meta_value AS UNSIGNED) < CAST(f.meta_value AS UNSIGNED)) )
UNION ALL
SELECT t.post_id, '', t.meta_value, 'end is not a Unix timestamp'
FROM {prefix}postmeta t
LEFT JOIN {prefix}postmeta f ON f.post_id = t.post_id AND f.meta_key = '_sale_price_dates_from'
WHERE t.meta_key = '_sale_price_dates_to'
  AND t.meta_value <> ''
  AND t.meta_value NOT REGEXP '^[0-9]+$'
  AND (f.meta_value IS NULL OR f.meta_value = '')
LIMIT 200;

-- name: Sale end dates by UTC time of day (the product editor stores 23:59:59 site time; compare with the site's UTC offset)
SELECT TIME(DATE_ADD('1970-01-01 00:00:00', INTERVAL CAST(meta_value AS UNSIGNED) SECOND)) AS end_time_utc,
       COUNT(*) AS rows_with_this_end_time
FROM {prefix}postmeta
WHERE meta_key = '_sale_price_dates_to'
  AND meta_value REGEXP '^[0-9]+$'
GROUP BY end_time_utc
ORDER BY rows_with_this_end_time DESC
LIMIT 20;

-- name: Lookup table disagrees with _price or _sale_price (simple, external and variations; top 200)
SELECT l.product_id, p.post_type, l.min_price, l.max_price, l.onsale,
       pr.meta_value AS stored_price, COALESCE(sp.meta_value, '') AS sale_price,
       CASE
         WHEN l.min_price IS NULL AND COALESCE(pr.meta_value, '') <> '' THEN 'lookup price missing'
         WHEN COALESCE(pr.meta_value, '') <> '' AND NOT (l.min_price <=> CAST(pr.meta_value AS DECIMAL(19,4))) THEN 'min_price differs from _price'
         ELSE 'onsale flag differs from _price = _sale_price'
       END AS finding
FROM {prefix}wc_product_meta_lookup l
JOIN {prefix}posts p ON p.ID = l.product_id AND p.post_status NOT IN ('trash', 'auto-draft')
LEFT JOIN {prefix}postmeta pr ON pr.post_id = l.product_id AND pr.meta_key = '_price'
LEFT JOIN {prefix}postmeta sp ON sp.post_id = l.product_id AND sp.meta_key = '_sale_price'
LEFT JOIN (
  SELECT tr.object_id, MAX(t.slug) AS product_type
  FROM {prefix}term_relationships tr
  JOIN {prefix}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_type'
  JOIN {prefix}terms t ON t.term_id = tt.term_id
  GROUP BY tr.object_id
) pt ON pt.object_id = l.product_id
WHERE (pt.product_type IS NULL OR pt.product_type NOT IN ('variable', 'grouped'))
  AND ( (l.min_price IS NULL AND COALESCE(pr.meta_value, '') <> '')
     OR (COALESCE(pr.meta_value, '') <> '' AND NOT (l.min_price <=> CAST(pr.meta_value AS DECIMAL(19,4))))
     OR l.onsale <> IF(COALESCE(sp.meta_value, '') NOT IN ('', '0') AND CAST(pr.meta_value AS DECIMAL(19,4)) = CAST(sp.meta_value AS DECIMAL(19,4)), 1, 0) )
ORDER BY l.product_id
LIMIT 200;

-- name: Variable parents: _price rows against their published variations' _price values (top 200)
SELECT par.parent_id,
       par.parent_price_rows, par.parent_min, par.parent_max,
       ch.published_variations, ch.child_distinct_prices, ch.child_min, ch.child_max,
       l.min_price AS lookup_min, l.max_price AS lookup_max,
       CASE
         WHEN NOT (par.parent_min <=> ch.child_min) OR NOT (par.parent_max <=> ch.child_max) THEN 'parent range differs from variations'
         WHEN par.parent_price_rows <> ch.child_distinct_prices THEN 'row count differs (hidden out-of-stock variations can explain it)'
         ELSE 'lookup range differs from parent rows'
       END AS finding
FROM (
  SELECT m.post_id AS parent_id, COUNT(*) AS parent_price_rows,
         MIN(CAST(m.meta_value AS DECIMAL(19,4))) AS parent_min, MAX(CAST(m.meta_value AS DECIMAL(19,4))) AS parent_max
  FROM {prefix}postmeta m
  JOIN {prefix}term_relationships tr ON tr.object_id = m.post_id
  JOIN {prefix}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_type'
  JOIN {prefix}terms t ON t.term_id = tt.term_id AND t.slug = 'variable'
  WHERE m.meta_key = '_price' AND m.meta_value <> ''
  GROUP BY m.post_id
) par
JOIN (
  SELECT v.post_parent AS parent_id, COUNT(DISTINCT v.ID) AS published_variations,
         COUNT(DISTINCT m.meta_value) AS child_distinct_prices,
         MIN(CAST(m.meta_value AS DECIMAL(19,4))) AS child_min, MAX(CAST(m.meta_value AS DECIMAL(19,4))) AS child_max
  FROM {prefix}posts v
  JOIN {prefix}postmeta m ON m.post_id = v.ID AND m.meta_key = '_price' AND m.meta_value <> ''
  WHERE v.post_type = 'product_variation' AND v.post_status = 'publish'
  GROUP BY v.post_parent
) ch ON ch.parent_id = par.parent_id
LEFT JOIN {prefix}wc_product_meta_lookup l ON l.product_id = par.parent_id
WHERE NOT (par.parent_min <=> ch.child_min)
   OR NOT (par.parent_max <=> ch.child_max)
   OR par.parent_price_rows <> ch.child_distinct_prices
   OR NOT (l.min_price <=> par.parent_min)
   OR NOT (l.max_price <=> par.parent_max)
ORDER BY par.parent_id
LIMIT 200;

-- name: Price transients in the options table (only meaningful without a persistent object cache)
SELECT CASE
         WHEN option_name LIKE '\_transient\_wc\_var\_prices\_%' THEN 'wc_var_prices_<id>'
         WHEN option_name = '_transient_wc_products_onsale' THEN 'wc_products_onsale'
         WHEN option_name LIKE '\_transient\_wc\_product\_children\_%' THEN 'wc_product_children_<id>'
       END AS transient,
       COUNT(*) AS rows_found,
       ROUND(COALESCE(SUM(LENGTH(option_value)), 0) / 1024) AS kb
FROM {prefix}options
WHERE option_name LIKE '\_transient\_wc\_var\_prices\_%'
   OR option_name = '_transient_wc_products_onsale'
   OR option_name LIKE '\_transient\_wc\_product\_children\_%'
GROUP BY transient;

-- name: Per-product sale events in Action Scheduler by hook and status (WooCommerce 10.5.0 and later)
SELECT a.hook, a.status, COUNT(*) AS actions,
       MIN(a.scheduled_date_gmt) AS earliest_gmt, MAX(a.scheduled_date_gmt) AS latest_gmt,
       MAX(a.last_attempt_gmt) AS last_attempt_gmt
FROM {prefix}actionscheduler_actions a
WHERE a.hook IN ('wc_product_start_scheduled_sale', 'wc_product_end_scheduled_sale')
GROUP BY a.hook, a.status
ORDER BY a.hook, a.status;

-- name: Per-product sale events still pending after their time at {now} (top 100)
SELECT a.action_id, a.hook, a.args, a.scheduled_date_gmt, a.claim_id,
       TIMESTAMPDIFF(MINUTE, a.scheduled_date_gmt, DATE_ADD('1970-01-01 00:00:00', INTERVAL {now} SECOND)) AS minutes_late
FROM {prefix}actionscheduler_actions a
WHERE a.hook IN ('wc_product_start_scheduled_sale', 'wc_product_end_scheduled_sale')
  AND a.status = 'pending'
  AND a.scheduled_date_gmt < DATE_ADD('1970-01-01 00:00:00', INTERVAL {now} SECOND)
ORDER BY a.scheduled_date_gmt
LIMIT 100;

-- name: Per-product sale events: more than one pending action for the same product and hook (issue 63517 shape)
SELECT a.hook, a.args, COUNT(*) AS pending_actions,
       MIN(a.scheduled_date_gmt) AS earliest_gmt, MAX(a.scheduled_date_gmt) AS latest_gmt,
       COUNT(DISTINCT a.scheduled_date_gmt) AS distinct_times
FROM {prefix}actionscheduler_actions a
WHERE a.hook IN ('wc_product_start_scheduled_sale', 'wc_product_end_scheduled_sale')
  AND a.status = 'pending'
GROUP BY a.hook, a.args
HAVING COUNT(*) > 1
ORDER BY pending_actions DESC
LIMIT 100;

-- name: Future sale boundaries at {now} with no pending event at that exact time (10.5.0 and later; top 200)
SELECT b.id, b.boundary, DATE_ADD('1970-01-01 00:00:00', INTERVAL b.ts SECOND) AS boundary_utc
FROM (
  SELECT post_id AS id, 'start' AS boundary, 'wc_product_start_scheduled_sale' AS hook, CAST(meta_value AS UNSIGNED) AS ts
  FROM {prefix}postmeta
  WHERE meta_key = '_sale_price_dates_from' AND meta_value REGEXP '^[0-9]+$' AND CAST(meta_value AS UNSIGNED) > {now}
  UNION ALL
  SELECT post_id, 'end', 'wc_product_end_scheduled_sale', CAST(meta_value AS UNSIGNED)
  FROM {prefix}postmeta
  WHERE meta_key = '_sale_price_dates_to' AND meta_value REGEXP '^[0-9]+$' AND CAST(meta_value AS UNSIGNED) > {now}
) b
JOIN {prefix}posts p ON p.ID = b.id AND p.post_type IN ('product', 'product_variation') AND p.post_status NOT IN ('trash', 'auto-draft')
WHERE NOT EXISTS (
  SELECT 1 FROM {prefix}actionscheduler_actions a
  WHERE a.hook = b.hook
    AND a.status = 'pending'
    AND a.args = CONCAT('{"product_id":', b.id, '}')
    AND a.scheduled_date_gmt = DATE_ADD('1970-01-01 00:00:00', INTERVAL b.ts SECOND)
)
ORDER BY b.ts
LIMIT 200;

-- name: The daily safety net action woocommerce_scheduled_sales (latest 10 rows)
SELECT a.action_id, a.status, g.slug AS group_slug, a.scheduled_date_gmt, a.scheduled_date_local,
       TIME(a.scheduled_date_local) AS local_time_of_day, a.attempts, a.last_attempt_gmt
FROM {prefix}actionscheduler_actions a
LEFT JOIN {prefix}actionscheduler_groups g ON g.group_id = a.group_id
WHERE a.hook = 'woocommerce_scheduled_sales'
ORDER BY a.scheduled_date_gmt DESC
LIMIT 10;

-- name: The daily safety net action woocommerce_scheduled_sales: rows by status in the last 30 days before {now}
SELECT a.status, COUNT(*) AS actions, MAX(a.last_attempt_gmt) AS last_attempt_gmt
FROM {prefix}actionscheduler_actions a
WHERE a.hook = 'woocommerce_scheduled_sales'
  AND a.scheduled_date_gmt >= DATE_SUB(DATE_ADD('1970-01-01 00:00:00', INTERVAL {now} SECOND), INTERVAL 30 DAY)
GROUP BY a.status;

-- name: Queue health in one line: pending actions more than 1 hour past due, and the latest completion before {now}
SELECT (SELECT COUNT(*) FROM {prefix}actionscheduler_actions
        WHERE status = 'pending'
          AND scheduled_date_gmt < DATE_SUB(DATE_ADD('1970-01-01 00:00:00', INTERVAL {now} SECOND), INTERVAL 1 HOUR)) AS pending_over_1h_late,
       (SELECT MAX(last_attempt_gmt) FROM {prefix}actionscheduler_actions WHERE status = 'complete') AS latest_completion_gmt;
