# Changes, each with a backup, a check and an undo

Every step in this file changes the site or the database server. Before each one: state the step, its backup, its
check and its undo to the owner, and wait for approval of that step. Run it on staging first, then on production at a
quiet hour. Change one thing at a time, and measure before and after with the same method.

## Backups used below

| Backup | Command | Restore | Source |
| --- | --- | --- | --- |
| Full database | `wp db export /path/outside/webroot/<name>.sql --single-transaction` | `wp db import <file>`, on staging first; never blindly over a live site | [db export](https://developer.wordpress.org/cli/commands/db/export/) (extra flags go to `mysqldump`); [db import](https://developer.wordpress.org/cli/commands/db/import/) |
| One table | `wp db export /path/outside/webroot/<name>.sql --tables=<prefix><table> --single-transaction` | `wp db import <file>` replaces that table with the saved copy | same |
| Table definition | `wp db query "SHOW CREATE TABLE <prefix><table>\G" > <table>-definition.txt` | re-create a dropped index from the saved definition | [wp db query](https://developer.wordpress.org/cli/commands/db/query/) |
| Server variables | the `SHOW GLOBAL VARIABLES` statement in [slow-query-log.md](slow-query-log.md#turning-it-on-for-an-investigation-a-change), output saved to a file | `SET GLOBAL <name> = <saved value>` | [using system variables](https://dev.mysql.com/doc/refman/8.4/en/using-system-variables.html) |
| One option | `wp option get <name> --format=json > <name>.json` | `wp option update <name> --format=json < <name>.json` | [option get](https://developer.wordpress.org/cli/commands/option/get/); [option update](https://developer.wordpress.org/cli/commands/option/update/) |
| A file | `cp <file> <file>.bak-<date>` | copy it back | |

- `--single-transaction` dumps InnoDB tables consistently without blocking the site; no `ALTER TABLE` or other DDL
  may run while it dumps ([mysqldump](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)).
- Exports hold personal data: write them outside the web root, keep them out of chats, tickets and repositories, and
  delete them after the retention period the owner sets. A backup counts only after one test restore on staging.
- `wp db query` ignores `--url` on multisite; write the site's table prefix into the statement
  ([wp db query](https://developer.wordpress.org/cli/commands/db/query/)).

## Turn on the slow query log for a window

- Change: the `SET GLOBAL` statements in [slow-query-log.md](slow-query-log.md#turning-it-on-for-an-investigation-a-change).
- Backup: the saved `SHOW GLOBAL VARIABLES` output.
- Check: entries appear in the file (or `mysql.slow_log`); the file grows at a rate the disk can take.
- Undo: `SET GLOBAL` each variable back to its saved value. Delete copies of the log once the digest is written.

## Install Query Monitor

- Change: `wp plugin install query-monitor --activate`, staging first.
- Backup: note whether `wp-content/db.php` exists and what it is (`wp plugin list --status=dropin`); Query Monitor
  does not replace an existing one ([query-monitor.md](query-monitor.md#the-dbphp-drop-in)).
- Check: the toolbar entry appears for administrators; the site behaves as before.
- Undo: `wp plugin deactivate query-monitor`, then `wp plugin delete query-monitor`; on multisite with a per-site
  deactivation, check that `wp-content/db.php` is gone.

## Debug constants on staging

- Change: in `wp-config.php` on staging, `define( 'QM_DB_EXPENSIVE', 0.01 );` to see more slow candidates, or
  `define( 'SAVEQUERIES', true );` without Query Monitor ([query-monitor.md](query-monitor.md)).
- Backup: a copy of `wp-config.php`.
- Check: the Slow Queries panel lists more queries; no PHP errors.
- Undo: restore the copy.

## Skip the Custom Fields key query

Only when [query-patterns.md](query-patterns.md#the-custom-fields-box-in-the-classic-editor) shows that query as
slow. As `wp-content/mu-plugins/sqi-postmeta-form-keys.php`:

```php
<?php
/**
 * Plugin Name: Custom Fields box without the meta key query
 * Description: Returns an empty key list to postmeta_form_keys so WordPress skips SELECT DISTINCT meta_key.
 */
add_filter( 'postmeta_form_keys', static function () {
	return array();
} );
```

- Backup: none needed, the file is new.
- Check: the query is gone from Query Monitor on the classic editor screen; the Custom Fields box shows a text field
  for a new key instead of the drop-down, and existing fields still list
  ([template.php L694-L770](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/template.php#L694-L770)).
- Undo: delete the file.

## Change query arguments in theme or plugin code

- Change: the developer applies a fix from [query-patterns.md](query-patterns.md) (for example `'no_found_rows' =>
  true`, `'fields' => 'ids'`, a limit, a narrower post type), in the theme or plugin's own code or a small
  must-use plugin that adjusts one query through `pre_get_posts`.
- Backup: the code is in version control, or a copy of the changed file.
- Check: Query Monitor shows the new SQL and a lower time for that query on the same page; the page output is the same
  (same items, same pagination where it is shown).
- Undo: revert the commit or restore the file.

## Refresh index statistics (`ANALYZE TABLE`)

Only when [explain.md](explain.md#estimates-against-measurements) shows estimates far from measurements.

- Change: `ANALYZE TABLE <prefix><table>;`
- Effects to state first: MySQL takes a read lock on the table while it analyzes, needs `SELECT` and `INSERT`
  privileges, and writes the statement to the binary log so replicas run it too, unless `NO_WRITE_TO_BINLOG` (or
  `LOCAL`) is given ([MySQL ANALYZE TABLE](https://dev.mysql.com/doc/refman/8.4/en/analyze-table.html)). On MariaDB a
  plain `ANALYZE TABLE` asks the storage engine for its statistics; `PERSISTENT FOR` adds engine-independent statistics
  collected with full table and index scans, which can be expensive
  ([engine-independent statistics](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/query-optimizations/statistics-for-optimizing-queries/engine-independent-table-statistics)).
- Backup: none for data; save the `EXPLAIN` output before.
- Check: `EXPLAIN` estimates closer to the measured rows; the plan of the target query.
- Undo: none. With `innodb_stats_auto_recalc` on (the default), InnoDB also recalculates statistics after more than
  10% of a table's rows change ([persistent statistics](https://dev.mysql.com/doc/refman/8.4/en/innodb-persistent-stats.html)).

## Restore a missing core index

When the report shows a WordPress core index missing ([wordpress-schema.md](wordpress-schema.md)).

- Change (example for `type_status_author`, WordPress 6.9 and later), with the definition copied from core:

  ```sql
  SET SESSION lock_wait_timeout = 5;
  ALTER TABLE wp_posts ADD INDEX type_status_author (post_type, post_status, post_author), ALGORITHM=INPLACE, LOCK=NONE;
  ```

- Backup: full database.
- Check: the index block of the report lists it; the queries that use it are faster.
- Undo: `ALTER TABLE wp_posts DROP INDEX type_status_author;`, only if it causes trouble, since core expects it.

## Add, hide or drop a custom index

The statements, the test on a copy and the watch during the build are in [indexes.md](indexes.md).

- Backup: full database before adding; the table definition before hiding or dropping.
- Check: the target query's plan uses the index and its measured time falls; the other slow queries on the table are
  not worse; replication lag stays normal.
- Undo: hide it (MySQL `ALTER INDEX ... INVISIBLE`, MariaDB `ALTER INDEX ... IGNORED`) at once, drop it later. A
  dropped index is undone by creating it again from the saved definition, which is a full build.

## Regenerate the WooCommerce product lookup table

- Change: WooCommerce > Status > Tools > "Product lookup tables", Regenerate
  ([woocommerce-lookup-tables.md](woocommerce-lookup-tables.md)). It runs through scheduled actions, so Action
  Scheduler must be running.
- Backup: one-table export of `<prefix>wc_product_meta_lookup`.
- Check: its row count matches products and variations; catalog sorting and the price filter return the expected
  products.
- Undo: import the table export, which also drops changes made since.

## Turn on the product attributes lookup table for filtering

- Change: WooCommerce > Settings > Products > Advanced, "Enable table usage", after the table has finished generating
  ([woocommerce-lookup-tables.md](woocommerce-lookup-tables.md#the-product-attributes-lookup-table)).
- Backup: the value of `woocommerce_attribute_lookup_enabled`.
- Check: on staging, the same filter combinations return the same products before and after, including variable
  products with out-of-stock variations; Query Monitor shows `wc_product_attributes_lookup` in place of the tax query
  subqueries.
- Undo: untick the setting.

## Delete expired transients

- Change: `wp transient delete --expired`
  ([transient delete](https://developer.wordpress.org/cli/commands/transient/delete/)).
- Backup: one-table export of `<prefix>options`.
- Check: the expired count in the report is zero; the site behaves as before.
- Undo: expired transients are dead data, so there is nothing to put back. Never import the whole options export over
  a live site, since it would roll back every option changed since the export.

## Stop a running statement

- Change: `KILL QUERY <id>` ends the statement and keeps the connection; without `CONNECTION_ADMIN` (or `SUPER`) an
  account can kill only its own statements ([KILL](https://dev.mysql.com/doc/refman/8.4/en/kill.html)).
- Only for a `SELECT` or for an index build of this process. A statement that writes outside a transaction is not
  rolled back when killed (same page).
- Backup: none. Check: the statement is gone from the process list. Undo: none; the page or job that ran it can run
  again.

## For the host, not for this skill

Record these as recommendations with their evidence; they are server changes the host makes and tests:
a persistent object cache ([object-cache.md](object-cache.md)), the InnoDB buffer pool size, enabling the Performance
Schema on MariaDB (needs a restart), converting non-InnoDB tables, and making the slow query log permanent
([server-statistics.md](server-statistics.md)).
