# Versions checked, and what changed by release

Read the site's versions first (the report prints WordPress, the database server, WooCommerce and Query Monitor) and
apply the rows at or below them. A fix that needs a newer release is an update first, as its own change on staging.

## Versions this skill was checked against (2026-09-26)

| Software | Version checked | Source |
| --- | --- | --- |
| WordPress | 7.1.2 (current release) | [version check API](https://api.wordpress.org/core/version-check/1.7/) |
| Query Monitor | 4.0.7 | [plugin directory](https://wordpress.org/plugins/query-monitor/); [tag 4.0.7](https://github.com/johnbillion/query-monitor/tree/4.0.7) |
| WooCommerce | 11.1.2 | [release](https://github.com/woocommerce/woocommerce/releases/tag/11.1.2) |
| WP-CLI | 2.12.0 | [release](https://github.com/wp-cli/wp-cli/releases/tag/v2.12.0) |
| MySQL | 8.4 Reference Manual; newest 8.4 LTS release 8.4.11 (the newest `mysql-8.4.*` source tag on 2026-09-26); newest 8.0 release 8.0.46 (2026-04-21); log format read from the `mysql-8.4.11` source tag | [8.4 release notes](https://dev.mysql.com/doc/relnotes/mysql/8.4/en/); [8.0 release notes](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/); [release model](https://dev.mysql.com/doc/refman/8.4/en/mysql-releases.html) |
| MariaDB | mariadb.com/docs as of the date; newest releases 10.6.28 (series end of life 2026-07-06), 10.11.19, 11.4.13, 11.8.9; log format read from the `mariadb-11.4.13` source tag | [MariaDB downloads REST API](https://downloads.mariadb.org/rest-api/mariadb/) |

MySQL 9.x and MariaDB 12.x were not checked. On them, confirm any fact this skill relies on in their own manual.

## WordPress

| Release | Change | Source |
| --- | --- | --- |
| 5.3 | `options.autoload` index added | [5.3.0 schema.php](https://github.com/WordPress/wordpress-develop/blob/5.3.0/src/wp-admin/includes/schema.php) |
| 6.1 | `WP_Query` results cached in the object cache (`post-queries`) | [class-wp-query.php L5002-L5010](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L5002-L5010) |
| 6.2 | `search_columns` query argument and `post_search_columns` filter | [class-wp-query.php L670, L1465-L1489](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-query.php#L1465-L1489) |
| 6.3 | `WP_User_Query` `cache_results`; `wp_cache_set_last_changed()` | [class-wp-user-query.php L146](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-user-query.php#L146); [functions.php L8245-L8253](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/functions.php#L8245-L8253) |
| 6.4 | `WP_Term_Query` `cache_results`; `wp_prime_option_caches()` | [class-wp-term-query.php L94](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wp-term-query.php#L94); [option.php L264-L270](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L264-L270) |
| 6.6 | Autoload values `on`, `off`, `auto`, `auto-on`, `auto-off`; options over 150,000 bytes not autoloaded by default; Site Health autoloaded options test (800,000 bytes) | [option.php L1290-L1370, L3252-L3275](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L3252-L3275); [class-wp-site-health.php L2657-L2720](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L2657-L2720) |
| 6.9 | `posts.type_status_author` index; query caches keyed without `last_changed` and "salted" instead | [commit 601ddd4](https://github.com/WordPress/wordpress-develop/commit/601ddd41b1e7a8fe8c1bca691aa3ba942949bce8); [cache-compat.php L203-L262](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cache-compat.php#L203-L262) |

## MySQL

| Release | Change | Source |
| --- | --- | --- |
| 8.0 | Invisible indexes; query cache removed | [MySQL 8.0 what is new](https://dev.mysql.com/doc/refman/8.0/en/mysql-nutshell.html) |
| 8.0.14 | `log_slow_extra` | [8.0 slow query log](https://dev.mysql.com/doc/refman/8.0/en/slow-query-log.html) |
| 8.0.16 | `EXPLAIN FORMAT=TREE` | [8.0 EXPLAIN](https://dev.mysql.com/doc/refman/8.0/en/explain.html) |
| 8.0.17 | `SQL_CALC_FOUND_ROWS` and `FOUND_ROWS()` deprecated | [8.0 information functions](https://dev.mysql.com/doc/refman/8.0/en/information-functions.html) |
| 8.0.18 | `EXPLAIN ANALYZE` | [8.0 EXPLAIN](https://dev.mysql.com/doc/refman/8.0/en/explain.html) |
| 8.0.20 | `EXPLAIN ANALYZE` can be stopped with `KILL QUERY` or Ctrl-C | same |
| 8.0.32 | `explain_format` variable | same |
| 8.4 manual | `INFORMATION_SCHEMA.PROCESSLIST` and the `SHOW PROCESSLIST` built on it marked deprecated; read `performance_schema.processlist` instead | [8.4 PROCESSLIST](https://dev.mysql.com/doc/refman/8.4/en/information-schema-processlist-table.html) |

## MariaDB

| Release | Change | Source |
| --- | --- | --- |
| 10.6 | Ignored indexes; sys schema bundled; atomic `ALTER TABLE` | [What is MariaDB 10.6](https://mariadb.com/docs/release-notes/community-server/10.6/what-is-mariadb-106) |
| 10.6.15 | `engine` slow log verbosity | [extended statistics](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/query-optimizations/statistics-for-optimizing-queries/slow-query-log-extended-statistics) |
| 10.6.16 | `warnings` and `all` slow log verbosity; notes when an index cannot be used (`note_verbosity`) | same; [notes when an index cannot be used](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/query-optimizer/notes-when-an-index-cannot-be-used) |
| 10.11 | Slow log variables renamed to `log_slow_query`, `log_slow_query_file`, `log_slow_query_time`, `log_slow_min_examined_row_limit`; old names kept as aliases | [server system variables](https://mariadb.com/docs/server/server-management/variables-and-modes/server-system-variables) |
| 11.0 | New optimizer cost model (plans can change on upgrade from 10.x); `log_slow_admin_statements` deprecated in favor of `log_slow_filter` | [cost model](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/query-optimizer/the-optimizer-cost-model-from-mariadb-11-0); [slow query log overview](https://mariadb.com/docs/server/server-management/server-monitoring-logs/slow-query-log/slow-query-log-overview) |
| 12.1 | `mariadb-dumpslow --json` | [mariadb-dumpslow](https://mariadb.com/docs/server/clients-and-utilities/logging-tools/mariadb-dumpslow) |

## Query Monitor and WooCommerce

| Release | Change | Source |
| --- | --- | --- |
| Query Monitor 4.0 | Panels rendered in the browser; new Timeline panel | [Query Monitor 4](https://querymonitor.com/help/query-monitor-4/) |
| WooCommerce 3.6 | Product meta lookup table | [performance improvements in 3.6](https://developer.woocommerce.com/2019/04/01/performance-improvements-in-3-6/) |
| WooCommerce 6.3 | Product attributes lookup table for catalog filtering | [new product filtering in 6.3](https://developer.woocommerce.com/2022/02/02/new-product-filtering-by-attributes-rolling-out-in-woocommerce-6-3/) |
| WooCommerce 9.1 | "Optimized updates" for the attributes lookup table; `wp wc palt` commands | [lookup table optimization](https://developer.woocommerce.com/2024/06/20/an-optimization-for-the-product-attributes-lookup-table-is-coming/) |
| WooCommerce 10.8 | `wc_orders_meta.meta_key_value` reshaped to `(meta_key(50), meta_value(20))` | [wc-update-functions.php L3466-L3528](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-update-functions.php#L3466-L3528) |

## What this means for the investigation

- MySQL before 8.0.18 has no `EXPLAIN ANALYZE`; measure with the slow log or timed `SELECT` runs on staging.
- MariaDB 10.6: use the old slow log variable names (`slow_query_log`, `long_query_time`). The 10.6 series reached its
  end of life on 2026-07-06; plan the server upgrade with the host as its own change.
- After a MariaDB upgrade from 10.x to 11.x, re-run `EXPLAIN` on the queries that matter: the cost model changed.
- WordPress before 6.9: the posts table lacks `type_status_author`, and each query cache invalidation leaves old
  entries behind in the object cache until they are evicted.
