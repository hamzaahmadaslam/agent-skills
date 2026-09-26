# WordPress query patterns that scan

Read this for step 3 of the procedure: find the code that built the query (Query Monitor's caller column), then the
row below that matches its SQL. Links point at the WordPress 7.1.2 tag. Each pattern lists the SQL WordPress
generates, why the server reads more rows than it returns, and the fixes in order of preference. Fixes to theme or
plugin code are proposals for the developer; this skill does not edit plugin files.

## Meta queries (`meta_query`, `meta_key` and `meta_value`)

- SQL: every clause joins the meta table once more (the first as `wp_postmeta`, then
  `INNER JOIN wp_postmeta AS mt1 ON ( wp_posts.ID = mt1.post_id )`, `mt2` and so on; clauses under an `OR` relation
  can share a join)
  ([class-wp-meta-query.php L590-L615](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-meta-query.php#L590-L615)).
  - A `type` other than `CHAR` wraps the value in a cast: `CAST(mt1.meta_value AS SIGNED) > '10'`; `NUMERIC`
    becomes `SIGNED`
    ([L319-L335, L779-L785](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-meta-query.php#L779-L785)).
  - `LIKE` and `NOT LIKE` wrap the value in `%...%`
    ([L753-L757](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-meta-query.php#L753-L757)).
  - `NOT EXISTS` becomes a `LEFT JOIN` with the key in the join condition and `IS NULL` in `WHERE`, and turns every
    other meta join of the query into a `LEFT JOIN`
    ([L596-L605, L646-L647, L373-L379](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-meta-query.php#L596-L605)).
- Why it scans: `meta_value` is `longtext` with no index; only `meta_key(191)` and `post_id` are indexed
  ([wordpress-schema.md](wordpress-schema.md)). A cast or a leading `%` rules out any index on the value
  ([explain.md](explain.md#why-an-index-is-not-used)). Every meta or tax query also adds `GROUP BY wp_posts.ID`
  ([class-wp-query.php L2392-L2394](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L2392-L2394)),
  which with an `ORDER BY` on another column gives `Using temporary; Using filesort`.
- Fixes, in order:
  1. Narrow the rows before the meta join: a specific `post_type`, a date range, a `post__in` list from a cheaper
     query, a smaller `posts_per_page`.
  2. Compare as the stored string (`'type' => 'CHAR'`, the default, with an exact value) instead of a cast, when the
     stored values allow it. Only then can an index on `(meta_key, meta_value(N))` help, and only after the tests in
     [indexes.md](indexes.md).
  3. Store data that is filtered often (a status, a flag, a category) as taxonomy terms: tax queries go through
     `term_relationships`, which is indexed on `term_taxonomy_id`
     ([schema.php L85-L91](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L85-L91)).
  4. Cache the result (transient or object cache) when it can be a few minutes old
     ([object-cache.md](object-cache.md)).
  5. For WooCommerce product data, use the lookup tables it already maintains
     ([woocommerce-lookup-tables.md](woocommerce-lookup-tables.md)).

## Ordering by a meta value

- SQL: `orderby => meta_value` sorts by the meta join's `meta_value` column, as text unless the meta query sets a
  `type` (then `CAST(... AS <type>)`), and `meta_value_num` by `meta_value+0`
  ([class-wp-query.php L1772-L1782](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L1772-L1782)).
- Why it scans: no index gives this order (`meta_value` has no index, and a cast or `+0` is computed per row), so
  every matching row is read and sorted (`Using filesort`) before `LIMIT` applies ([ORDER BY optimization](https://dev.mysql.com/doc/refman/8.4/en/order-by-optimization.html)).
- Fixes: sort a smaller set (narrow first); sort by a posts column (`date`, `title`, `menu_order`) where the design
  allows; keep a precomputed order in a lookup table (WooCommerce does this for price, popularity and rating).

## Counting all rows: `SQL_CALC_FOUND_ROWS`

- SQL: a query with a `LIMIT` gets `SQL_CALC_FOUND_ROWS` unless `no_found_rows` is true, then WordPress runs
  `SELECT FOUND_ROWS()` to fill `found_posts` and `max_num_pages`
  ([class-wp-query.php L3184-L3187, L3692-L3714](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L3184-L3187)).
  `no_found_rows` defaults to false
  ([L2062-L2067](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L2062-L2067)).
- Why it costs: MySQL must work out the size of the full result, and the modifier disables some optimizations; it has
  been deprecated since MySQL 8.0.17 ([information functions](https://dev.mysql.com/doc/refman/8.4/en/information-functions.html)).
  A query for the 10 newest matching posts can read every matching row to count them.
- Fixes: `'no_found_rows' => true` on every query that does not print pagination (related posts, widgets, sliders,
  REST lookups). `get_posts()` already sets it, together with `suppress_filters => true` and 5 posts by default
  ([post.php L2625-L2662](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/post.php#L2625-L2662)).

## Unbounded queries

- SQL: `posts_per_page => -1` sets `nopaging`, and a query without paging has no `LIMIT`
  ([class-wp-query.php L2023-L2029, L2809-L2824](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L2809-L2824)).
- Why it costs: it returns and loads every matching row, and primes the meta and term caches for all of them
  (`update_post_meta_cache` and `update_post_term_cache` default to true)
  ([L1983-L2003](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L1983-L2003)).
- Fixes: a limit; `'fields' => 'ids'` when only IDs are needed (it selects `wp_posts.ID` only and returns without
  loading posts or priming caches)
  ([L2069-L2072, L3319-L3339](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L3319-L3339));
  `'update_post_meta_cache' => false` and `'update_post_term_cache' => false` when the loop does not use meta or terms.

## Random order

- SQL: `orderby => rand` becomes `ORDER BY RAND()`
  ([class-wp-query.php L1769-L1771](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L1769-L1771)),
  and WordPress never caches a random query
  ([L3240-L3253](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L3240-L3253)).
- Why it costs: every matching row gets a random sort key and is sorted, on every request.
- Fixes: pick random IDs from a cached ID list in PHP, or rotate a cached selection every few minutes.

## Search (`s`)

- SQL: each search term becomes `(wp_posts.post_title LIKE '%term%') OR (wp_posts.post_excerpt LIKE '%term%') OR
  (wp_posts.post_content LIKE '%term%')`, the terms are joined with `AND`, and the results are ordered by a `CASE`
  over more `LIKE` tests
  ([class-wp-query.php L1461-L1529, L1639-L1686](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L1461-L1529)).
- Why it scans: a `LIKE` pattern that starts with `%` cannot use an index
  ([B-tree index use](https://dev.mysql.com/doc/refman/8.4/en/index-btree-hash.html)), and `post_content` is
  `longtext`. No index added to `wp_posts` changes this.
- Fixes: limit the post types searched; `search_columns` (WordPress 6.2 and later, filter `post_search_columns`) to
  search only `post_title`
  ([L1465-L1489](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L1465-L1489));
  a search service outside MySQL for large sites.

## Taxonomy queries (`tax_query`, `cat`, `tag`, product categories)

- SQL ([class-wp-tax-query.php L403-L481](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-tax-query.php#L403-L481)):
  - `IN`: `LEFT JOIN wp_term_relationships` and `term_taxonomy_id IN (...)`.
  - `NOT IN`: `wp_posts.ID NOT IN ( SELECT object_id FROM wp_term_relationships WHERE term_taxonomy_id IN (...) )`.
  - `AND`: a correlated subquery per row, `( SELECT COUNT(1) FROM wp_term_relationships WHERE term_taxonomy_id IN
    (...) AND object_id = wp_posts.ID ) = N`.
- `include_children` defaults to true, so a query on a parent category of a hierarchical taxonomy adds every child
  term ([L144, L566-L578](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-tax-query.php#L566-L578)).
- Fixes: `'include_children' => false` when the children are not wanted; prefer `IN` over `AND` for several terms
  where the meaning allows; on WooCommerce, the attributes lookup table for layered navigation
  ([woocommerce-lookup-tables.md](woocommerce-lookup-tables.md)).

## Many small queries (N+1)

- Shape: the same short query repeated per item (`SELECT ... FROM wp_postmeta WHERE post_id IN (123)`, one per post)
  in Query Monitor's Duplicate Queries panel ([query-monitor.md](query-monitor.md)).
- Cause: code loops over IDs from its own SQL or from `'fields' => 'ids'` and calls `get_post()`, `get_post_meta()`
  or `get_the_terms()` per ID, so nothing was primed in one batch.
- Fixes: prime once before the loop: `_prime_post_caches( $ids )` (posts, meta and terms), `update_postmeta_cache(
  $ids )`, or `wp_prime_option_caches( $names )` for options (WordPress 6.4 and later)
  ([post.php L8092-L8094, L8494-L8499](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/post.php#L8494-L8499);
  [option.php L264-L270](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L264-L270)).
  With a persistent object cache the repeats become cache reads after the first request
  ([object-cache.md](object-cache.md)).

## Two queries where you expected one

When the query is unfiltered and either has a `LIMIT` under 500 posts or a persistent object cache is in use,
`WP_Query` first selects only `wp_posts.ID` and then loads the posts with `SELECT wp_posts.* FROM wp_posts WHERE ID
IN (...)` for the ones not in the cache (filter `split_the_query`)
([class-wp-query.php L3378-L3445](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L3378-L3445);
[post.php L8494-L8499](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/post.php#L8494-L8499)).
The first query is the one to `EXPLAIN`.

## Users by role (`WP_User_Query`, `get_users()`)

- SQL: a role or capability filter is a meta query on the `{prefix}capabilities` user meta key with
  `LIKE '%"role"%'`; on multisite, a query without a role still joins that key with an `EXISTS` test to keep
  the site's members
  ([class-wp-user-query.php L516-L605](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-user-query.php#L516-L605)).
  `count_total` defaults to true, which adds `SQL_CALC_FOUND_ROWS`
  ([L113, L327-L328](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-user-query.php#L327-L328)).
- Why it scans: the value test has a leading wildcard, so the server reads every capabilities row; on a store or
  membership site that is one row per customer.
- Fixes: `'count_total' => false` when no total is shown; `'fields' => 'ID'`; cache the result; avoid role queries on
  front-end requests.

## The Custom Fields box in the classic editor

- SQL: `SELECT DISTINCT meta_key FROM wp_postmeta WHERE meta_key NOT BETWEEN '_' AND '_z' HAVING meta_key NOT LIKE
  '\_%' ORDER BY meta_key LIMIT 30`, on every editor load with that box
  ([template.php L694-L735](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/template.php#L694-L735)).
- Why it costs: it walks the distinct keys of the whole `postmeta` table.
- Fix: the `postmeta_form_keys` filter (WordPress 4.4 and later) returns a fixed list and skips the query, as its
  docblock describes (same lines). A one-line must-use plugin; see
  [changes-and-rollback.md](changes-and-rollback.md#skip-the-custom-fields-key-query).

## Options and transients

Loading autoloaded options, reading options one by one, and cleaning expired transients each have their own query
shapes: [options-and-transients.md](options-and-transients.md).
