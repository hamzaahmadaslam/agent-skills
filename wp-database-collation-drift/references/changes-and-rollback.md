# Changes, each with a backup, a check and an undo

Every step in this file changes the database or the site. Before each one: state the step, its backup, its check and
its undo to the owner, and wait for approval of that step. Run it on staging first, then on production at a quiet
hour. One table per step unless tables are tied by a foreign key. Sources: MySQL 8.4 Reference Manual, mariadb.com/docs,
the WP-CLI handbook and `db-command` v2.1.3, checked on 2026-09-29.

## Backups

| Backup | Command | Restore | Source |
| --- | --- | --- | --- |
| The table, rows and definition | `wp db export /path/outside/webroot/<table>-before.sql --tables=<table> --single-transaction --add-drop-table --default-character-set=utf8mb4` | `wp db import <file>` runs the file, whose `DROP TABLE IF EXISTS` and `CREATE TABLE` replace the table; staging first | [wp db export](https://developer.wordpress.org/cli/commands/db/export/); [wp db import](https://developer.wordpress.org/cli/commands/db/import/) |
| The definition only | `COLLATION_REPORT_DDL_TABLES=<table> bash scripts/collation-report.sh --path=... > <table>-definition.sql` (runs `wp db export - --no-data=true --tables=<table>`) | The rollback statement that `scripts/propose-alters.mjs` prints from it | [wp db export](https://developer.wordpress.org/cli/commands/db/export/) |
| The whole database, before a multi-table step | `wp db export /path/outside/webroot/<name>.sql --single-transaction --default-character-set=utf8mb4` | `wp db import <file>` on staging; never over a live site without the owner | same |
| `wp-config.php`, before a `DB_COLLATE` change | `cp wp-config.php wp-config.php.bak-<date>` | copy it back | |

- `wp db export` runs `mysqldump` with the credentials from `wp-config.php` and passes extra flags on to it
  ([wp db export](https://developer.wordpress.org/cli/commands/db/export/)). `--single-transaction` gives a
  consistent InnoDB dump without blocking the site, as long as no `ALTER TABLE` or other DDL runs on the table during
  the dump ([mysqldump](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)). Never start the change while the
  backup is still running.
- `mysqldump` uses `utf8mb4` when no character set is given ([mysqldump](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html));
  WP-CLI passes `DB_CHARSET` when it is defined ([DB_Command.php L1796-L1806](https://github.com/wp-cli/db-command/blob/v2.1.3/src/DB_Command.php#L1796-L1806)).
  Naming `utf8mb4` for the export keeps four-byte characters intact whatever `DB_CHARSET` says.
- A backup counts only after one test restore on staging. Exports hold personal data: write them outside the web
  root, keep them out of chats, tickets and repositories, and delete them after the retention period the owner sets.
- `wp db query` ignores `--url` on multisite; write the subsite's table names in full
  ([wp db query](https://developer.wordpress.org/cli/commands/db/query/)).

## Before the change on production

1. Run the proposal on staging, restored from a recent production export, on the same server type and version.
2. Time it. On MySQL the table is copied: reads continue, writes wait until the copy is done, and at the end reads
   wait too while the new table replaces the old one. The copy is created in the database directory next to the
   original ([ALTER TABLE](https://dev.mysql.com/doc/refman/8.4/en/alter-table.html)), so production needs free disk
   space of at least the table's size.
3. Run the read-only checks the helper printed: the column list, the row count and size, and the collision count for
   unique keys. A non-zero collision count stops the step until the owner decides.
4. Agree the write pause with the owner: the staging time, at production load or longer. On a primary with
   replicas, the replica runs the statement only after the source finishes it and holds back later changes until it
   has ([online DDL limitations](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-limitations.html)).

## The change

```sql
SET SESSION lock_wait_timeout = 5;
ALTER TABLE `wp_example_log`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci,
  MODIFY COLUMN `object_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci NOT NULL DEFAULT '',
  ALGORITHM=COPY, LOCK=SHARED;
```

(Synthetic table from `examples/synthetic-tables.sql`.)

- `lock_wait_timeout`: the `ALTER` needs a metadata lock on the table, and while it waits, later statements on the
  table queue behind it ([online DDL and metadata locks](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-performance.html)).
  The defaults are one year on MySQL and one day on MariaDB, so set a few seconds and retry later if it times out
  ([MySQL](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_lock_wait_timeout);
  [MariaDB](https://mariadb.com/docs/server/server-management/variables-and-modes/server-system-variables#lock_wait_timeout)).
- `ALGORITHM=COPY, LOCK=SHARED` states the cost: character set and collation changes use the copy algorithm on MySQL
  ([column conversion](https://dev.mysql.com/doc/refman/8.4/en/charset-conversion.html)), and a named algorithm or
  lock makes the server fail the statement rather than pick another one
  ([ALTER TABLE](https://dev.mysql.com/doc/refman/8.4/en/alter-table.html)). On MariaDB 11.2 and later,
  `LOCK=NONE` lets writes continue during the copy, and the server raises an error if it cannot
  ([MariaDB ALTER TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table)).
- Watch from a second session: statements in the state `Waiting for table metadata lock`
  ([thread states](https://dev.mysql.com/doc/refman/8.4/en/general-thread-states.html)) piling up behind the `ALTER`
  mean stop it with `KILL QUERY <id>`, which ends the statement and keeps the connection
  ([KILL](https://dev.mysql.com/doc/refman/8.4/en/kill.html)). InnoDB DDL is atomic on MySQL 8 and `ALTER TABLE` is
  atomic on MariaDB from 10.6, so a stopped or crashed `ALTER` leaves the table as it was
  ([atomic DDL](https://dev.mysql.com/doc/refman/8.4/en/atomic-ddl.html);
  [MariaDB ALTER TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table)).

## Checks after the change

1. `information_schema.COLUMNS` and `TABLES` show the target collation for every column and the table default in
   scope (the helper prints both queries).
2. `SELECT COUNT(*)` on the table matches the count from before, allowing for rows written since.
3. The query from the error, run through WordPress's own connection (`wp eval`, see
   [finding-the-query.md](finding-the-query.md#reproducing-a-query-outside-the-page)) with a value of the kind that
   failed, returns rows and no error.
4. The site flows that use the table work: the plugin's admin screen, the search or the listing that failed.
5. `debug.log` shows no new collation errors for the same query over the following days.
6. Re-run `scripts/collation-report.sh`; the table no longer shows in the "differs" blocks.

## Rollback

- Collation-only change within the same character set (for example `utf8mb4_0900_ai_ci` to
  `utf8mb4_unicode_520_ci`): run the rollback `ALTER` the helper printed, which restores the saved definitions. It
  loses no characters. It can fail on a unique key if rows written since are distinct only under the new collation;
  then restore the table backup, which also removes rows written since the backup.
- Character set widened (for example `utf8mb3` or `latin1` to `utf8mb4`): the rollback `ALTER` works only while no
  stored value holds a character the old set cannot store; any conversion to a set lacking stored characters can lose
  data ([column character set](https://dev.mysql.com/doc/refman/8.4/en/charset-column.html)). Once the site has
  written such values, keep the change or restore the backup and accept losing the rows written since; the owner
  decides.
- A key re-created with a shorter prefix: the rollback statement re-creates it with the original prefix after the
  column is back in its old character set. `SHOW CREATE TABLE` then lists that key last; the definition is the same.
- A `DB_COLLATE` change: restore the `wp-config.php` copy.

## Reporting to the plugin developer

When a plugin created the table with the wrong collation, or its query forces one, send the developer the table
name, the `CREATE TABLE` line or query, the collations on both sides, the WordPress and server versions, and the
request to use `$wpdb->get_charset_collate()` ([wordpress-charset.md](wordpress-charset.md#tables-wordpress-creates)).
Leave out row data and anything from the logs beyond the query shape.
