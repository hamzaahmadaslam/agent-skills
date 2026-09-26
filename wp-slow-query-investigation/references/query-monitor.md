# Query Monitor and SAVEQUERIES: the per-request view

Read this for step 2 of the procedure. Query Monitor links point at the 4.0.7 tag, WordPress links at the 7.1.2 tag.
Query Monitor shows the queries of one request with the PHP code that ran them; the slow query log
([slow-query-log.md](slow-query-log.md)) shows the server's view across all requests. Use both.

## The query panels

| Panel | What it shows | Use it to | Source |
| --- | --- | --- | --- |
| Queries | Every query of the request: SQL colored by type, caller and full call stack, component (core, plugin or theme), rows returned or affected, time (highlighted above the slow threshold), and any error | Read one query and where it came from; the "Non-SELECT" filter finds writes on page views | [Database queries](https://querymonitor.com/wordpress-debugging/database-queries/) |
| Queries by Caller | Count and total time per calling function, split by query type | Find the function responsible for most database work | same page |
| Queries by Component | Count and total time per plugin, theme or core, sorted by total time | Find the plugin or theme with the highest database cost | same page |
| Duplicate Queries | Identical SQL run more than once in the request, with callers and components | Find queries run inside a loop (a common cause of hundreds of small queries) | same page |
| Slow Queries | Queries over the slow threshold | Pick candidates for `EXPLAIN` | same page |
| Query Errors | Queries that returned a database error | Missing tables or columns, syntax errors | same page |
| Timeline (Query Monitor 4) | Queries, HTTP calls, errors and timings on one time axis, filterable by component | See when in the request the slow queries run | [Query Monitor 4](https://querymonitor.com/help/query-monitor-4/) |
| Object Cache | Hit percentage from the cache's own hit and miss counters, and whether a persistent object cache is in use | Check whether repeated reads are cached ([object-cache.md](object-cache.md)) | [collectors/cache.php L26-L95](https://github.com/johnbillion/query-monitor/blob/4.0.7/collectors/cache.php#L26-L95); [cache hit rate](https://querymonitor.com/help/cache-hit-rate/) |

- The slow threshold is the constant `QM_DB_EXPENSIVE`, 0.05 seconds by default; a query is marked slow when its
  time is greater than that ([configuration constants](https://querymonitor.com/help/configuration-constants/);
  [collectors/db_queries.php L15-L17, L84-L86](https://github.com/johnbillion/query-monitor/blob/4.0.7/collectors/db_queries.php#L84-L86)).
  Lower it on staging (for example `define( 'QM_DB_EXPENSIVE', 0.01 );` in `wp-config.php`) to see more candidates.
- The duplicate list leaves out `SELECT FOUND_ROWS()`, which every paginated `WP_Query` runs
  ([collectors/db_queries.php L218-L221](https://github.com/johnbillion/query-monitor/blob/4.0.7/collectors/db_queries.php#L218-L221)).
- Query Monitor marks the main `WP_Query` request of the page so it can be told apart from secondary queries
  ([collectors/db_queries.php L178-L187](https://github.com/johnbillion/query-monitor/blob/4.0.7/collectors/db_queries.php#L178-L187)).
- A constant hit rate of 0% or 100% in the Object Cache panel can come from the drop-in's counters rather than the
  site ([cache hit rate](https://querymonitor.com/help/cache-hit-rate/)).

## SAVEQUERIES is switched on by Query Monitor

- Query Monitor defines `SAVEQUERIES` as `true` when the site has not defined it, so query logging runs on every
  request where Query Monitor loads
  ([collectors/db_queries.php L12-L14](https://github.com/johnbillion/query-monitor/blob/4.0.7/collectors/db_queries.php#L12-L14);
  [wp-content/db.php L85-L87](https://github.com/johnbillion/query-monitor/blob/4.0.7/wp-content/db.php#L85-L87)).
- With `SAVEQUERIES` on, WordPress times each query around its `mysqli_query()` call and stores the SQL, the seconds,
  the list of calling functions and the start time in `$wpdb->queries`
  ([class-wpdb.php L2347-L2367, L2380-L2404](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L2347-L2404)).
  The time is taken in PHP, so it includes the round trip to the database server, not only the server's execution
  time.
- The caller list comes from `wp_debug_backtrace_summary()`
  ([class-wpdb.php L4196-L4198](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L4196-L4198)).
- The WordPress handbook says `SAVEQUERIES` has a performance impact and should be off when you are not debugging
  ([debugging in WordPress](https://developer.wordpress.org/advanced-administration/debug/debug-wordpress/)). Use it,
  and Query Monitor, on staging; on production only with approval and for a short window.
- The SQL that Query Monitor shows is the SQL the server received: `wpdb` removes its own `%` placeholder escape on
  the `query` filter at priority 0, before the query runs and is logged
  ([class-wpdb.php L2220-L2230, L2420-L2429](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L2420-L2429)).
  A query copied from the Queries panel can be run through `EXPLAIN` as it is.
- Plugins can rewrite every query through the same `query` filter
  ([class-wpdb.php L2220-L2230](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L2220-L2230)).
  `scripts/query-state.php` lists the callbacks on it.

## The db.php drop-in

- On activation Query Monitor symlinks its `wp-content/db.php` drop-in, which adds the result count, the full stack
  trace and error detection to each query. Without it Query Monitor still works with less detail
  ([db.php symlink](https://querymonitor.com/help/db-php-symlink/)).
- It skips the symlink when `QM_DB_SYMLINK` is false, when `DISALLOW_FILE_MODS` is true, or when a `wp-content/db.php`
  already exists ([Activation.php L31-L41](https://github.com/johnbillion/query-monitor/blob/4.0.7/classes/Activation.php#L31-L41)).
  Only one `db.php` can exist: W3 Total Cache, LudicrousDB, HyperDB and SQLite Database Integration use the same file
  ([db.php symlink](https://querymonitor.com/help/db-php-symlink/)). `wp plugin list --status=dropin` shows which
  drop-in is installed ([wp plugin list](https://developer.wordpress.org/cli/commands/plugin/list/)).
- On deactivation it deletes `db.php` only when the file belongs to Query Monitor and the site is not multisite, or
  the deactivation is network-wide
  ([Activation.php L55-L68](https://github.com/johnbillion/query-monitor/blob/4.0.7/classes/Activation.php#L55-L68)).
  On a multisite deactivated per site, check for the file afterwards.
- Neither the drop-in nor the plugin loads for WP-CLI or during WP-Cron runs
  ([wp-content/db.php L38-L47](https://github.com/johnbillion/query-monitor/blob/4.0.7/wp-content/db.php#L38-L47);
  [query-monitor.php L75-L83](https://github.com/johnbillion/query-monitor/blob/4.0.7/query-monitor.php#L75-L83)).
  Queries from cron events, Action Scheduler runs started by WP-CLI and other CLI commands never appear in Query
  Monitor; find them in the slow query log or the Performance Schema ([server-statistics.md](server-statistics.md)).

## Requests without an HTML page

- Ajax: the response to any jQuery-initiated Ajax request on the page carries Query Monitor data in its headers
  ([readme.txt L44](https://github.com/johnbillion/query-monitor/blob/4.0.7/readme.txt#L44)).
- REST: an authenticated request (a user allowed to see Query Monitor, with a `_wpnonce` from
  `wp-admin/admin-ajax.php?action=rest-nonce` or an Application Password) gets `x-qm-overview-time-taken`,
  `x-qm-overview-memory` and PHP error headers. Adding `?_envelope` adds a `qm` property with every database query
  (`qm.db_queries.dbs`, with time, stack and rows), duplicates (`qm.db_queries.dupes`), query errors, object cache
  hits and misses, HTTP calls and updated transients
  ([REST API requests](https://querymonitor.com/wordpress-debugging/rest-api-requests/)).

## Reading one request well

- Look at a request that is slow for the visitor: logged out when visitors are logged out, the same URL, the same
  query string. Query Monitor's authentication cookie (Settings panel) shows its output while logged out
  ([readme.txt L49](https://github.com/johnbillion/query-monitor/blob/4.0.7/readme.txt#L49)).
- Load the page several times. The first request after a cache flush or a deploy is not typical; compare the
  median, and write down whether the object cache and page cache were warm.
- Record for each slow query: the SQL, its time, the rows, the caller, the component, and whether it repeats in
  Duplicate Queries. The Queries by Component total ranks plugins; a plugin is named as the cause only after the same
  pattern shows on several requests.
- The per-request list shows what ran, not how often across all visitors. A 30 ms query on every page view can cost
  the server more than a 2 s query once a day; the server-side digests in
  [server-statistics.md](server-statistics.md) and [slow-query-log.md](slow-query-log.md) give the totals.
