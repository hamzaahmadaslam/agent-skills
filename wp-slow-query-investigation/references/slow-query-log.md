# The slow query log on MySQL and MariaDB

Read this for step 1 of the procedure. MySQL facts come from the MySQL 8.4 Reference Manual (8.4.11 was the newest
8.4 release on 2026-09-26), MariaDB facts from mariadb.com/docs on the same date. Enabling the log is a server
change: it follows the backup, check and undo form in [changes-and-rollback.md](changes-and-rollback.md).

## What gets logged

| Setting | MySQL 8.4 | MariaDB | Source |
| --- | --- | --- | --- |
| Log on or off | `slow_query_log`, off by default | `log_slow_query` from 10.11, with `slow_query_log` kept as an alias; off by default | [MySQL slow query log](https://dev.mysql.com/doc/refman/8.4/en/slow-query-log.html); [MariaDB overview](https://mariadb.com/docs/server/server-management/server-monitoring-logs/slow-query-log/slow-query-log-overview) |
| Threshold | `long_query_time`, default 10 seconds, minimum 0, microsecond resolution | `log_slow_query_time` from 10.11 (alias `long_query_time`), default 10 | same pages |
| File | `slow_query_log_file`, default `host_name-slow.log` in the data directory | `log_slow_query_file` from 10.11 (alias `slow_query_log_file`), default `${hostname}-slow.log` in the datadir | same pages |
| Destination | `log_output`: `FILE` (default), `TABLE` (the `mysql.slow_log` table) or `NONE` | `log_output`: `FILE` (default), `TABLE` (the `mysql.slow_log` table) or `NONE` | [MySQL log_output](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_log_output); [MariaDB overview](https://mariadb.com/docs/server/server-management/server-monitoring-logs/slow-query-log/slow-query-log-overview) |
| Minimum rows examined | `min_examined_row_limit`, default 0 | `log_slow_min_examined_row_limit` from 10.11 (alias `min_examined_row_limit`), default 0 | same pages |
| Queries without an index | `log_queries_not_using_indexes`, off; logs them whatever their time; `log_throttle_queries_not_using_indexes` caps them per minute (0, no cap, by default) | `log_queries_not_using_indexes`, off, or `not_using_index` in `log_slow_filter`; ignores the time threshold | same pages |
| Administrative statements (`ALTER TABLE`, `ANALYZE TABLE`, `CREATE INDEX`, `DROP INDEX`, `OPTIMIZE TABLE` and others) | Not logged unless `log_slow_admin_statements` is on | Logged by default; remove `admin` from `log_slow_filter` to stop | same pages |
| Extra fields | `log_slow_extra` (MySQL 8.0.14 and later, off by default): thread, errors, bytes, handler reads, sorts, temporary tables, start and end time | `log_slow_verbosity`: `query_plan`, `explain`, `engine`, `warnings`, `all` | [MySQL slow query log](https://dev.mysql.com/doc/refman/8.4/en/slow-query-log.html); [MariaDB extended statistics](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/query-optimizations/statistics-for-optimizing-queries/slow-query-log-extended-statistics) |
| Sampling | none | `log_slow_rate_limit`: log one query in N | [MariaDB extended statistics](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/query-optimizations/statistics-for-optimizing-queries/slow-query-log-extended-statistics) |

More details that change how to read the log:

- MySQL does not count the time to acquire the initial locks as execution time, and writes a statement after it has
  finished and released its locks, so the log order can differ from the execution order
  ([MySQL slow query log](https://dev.mysql.com/doc/refman/8.4/en/slow-query-log.html)).
- `long_query_time` is measured in real time, not CPU time: a query under the threshold on a quiet server can be over
  it under load ([long_query_time](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_long_query_time)).
  Compare runs taken under similar load.
- MySQL's `Slow_queries` status counter counts queries over `long_query_time` whether or not the log is on
  ([Slow_queries](https://dev.mysql.com/doc/refman/8.4/en/server-status-variables.html#statvar_Slow_queries)). Read it
  first; it costs nothing (`scripts/query-checks.sql`).
- With `log_queries_not_using_indexes` on, MySQL logs queries expected to read all rows, including full index scans,
  except on tables with fewer than two rows, and the log can grow quickly
  ([MySQL slow query log](https://dev.mysql.com/doc/refman/8.4/en/slow-query-log.html);
  [log_queries_not_using_indexes](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_log_queries_not_using_indexes)).
- A MySQL replica does not log replicated statements unless `log_slow_replica_statements` is on, and even then only
  statements replicated in statement format
  ([MySQL slow query log](https://dev.mysql.com/doc/refman/8.4/en/slow-query-log.html)).
- MariaDB's `query_plan` verbosity adds `Full_scan`, `Full_join`, `Tmp_table`, `Tmp_table_on_disk`, `Filesort`,
  `Filesort_on_disk` and `Merge_passes`; `explain` adds the `EXPLAIN` of the statement with the measured `r_rows` and
  `r_filtered` columns; `engine` (10.6.15 and later) adds pages accessed and read time; `warnings` (10.6.16 and later)
  adds notes such as an index that could not be used. Verbosity does not apply when `log_output` is `TABLE`
  ([MariaDB extended statistics](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/query-optimizations/statistics-for-optimizing-queries/slow-query-log-extended-statistics);
  [EXPLAIN in the slow query log](https://mariadb.com/docs/server/server-management/server-monitoring-logs/slow-query-log/explain-in-the-slow-query-log)).
- MariaDB's `log_slow_filter` values: `admin`, `filesort`, `filesort_on_disk`, `filesort_priority_queue`,
  `full_join`, `full_scan`, `not_using_index`, `query_cache`, `query_cache_miss`, `tmp_table`, `tmp_table_on_disk`
  (same page). `full_scan,filesort_on_disk,tmp_table_on_disk` with a threshold limits the log to expensive plans.

## Privacy

The log holds the literal values of each statement: email addresses, names, order numbers, search terms, and the
database user and client host of each entry. MySQL rewrites passwords only
([MySQL slow query log](https://dev.mysql.com/doc/refman/8.4/en/slow-query-log.html)); MariaDB says the log can hold
sensitive information and is not encrypted by the server
([MariaDB overview](https://mariadb.com/docs/server/server-management/server-monitoring-logs/slow-query-log/slow-query-log-overview)).
Read it where it is, share only digests with literals masked (`scripts/slow-log-digest.mjs` masks them), and delete
copies when the investigation ends.

## Entry format

The examples are synthetic. MySQL 8.4 writes each entry as follows
([sql/log.cc L692-L720, L728-L788, L809-L856](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/log.cc#L692-L856)):

```text
# Time: 2026-09-26T08:15:02.481516Z
# User@Host: wpuser[wpuser] @ localhost []  Id:    41
# Query_time: 2.804115  Lock_time: 0.000009 Rows_sent: 10  Rows_examined: 412330
use wordpress;
SET timestamp=1790410502;
SELECT wp_posts.ID FROM wp_posts INNER JOIN wp_postmeta ON ( wp_posts.ID = wp_postmeta.post_id ) WHERE ...;
```

- `# Time:` is ISO 8601, in UTC unless `log_timestamps` is `SYSTEM`
  ([log_timestamps](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_log_timestamps)).
  With `log_slow_extra` the `# Query_time:` line continues with `Thread_id`, `Errno`, `Killed`, `Bytes_received`,
  `Bytes_sent`, the `Read_*` handler counts, `Sort_*` counts, `Created_tmp_disk_tables`, `Created_tmp_tables`,
  `Start` and `End`.
- `use` appears only when the database changes; `SET timestamp=` (the statement's start time, in epoch seconds) comes
  before every statement.

MariaDB 11.4 writes
([sql/log.cc L3341-L3437, L3470-L3521](https://github.com/MariaDB/server/blob/mariadb-11.4.13/sql/log.cc#L3341-L3521)):

```text
# Time: 260926  8:15:02
# User@Host: wpuser[wpuser] @ localhost []
# Thread_id: 41  Schema: wordpress  QC_hit: No
# Query_time: 2.804115  Lock_time: 0.000009  Rows_sent: 10  Rows_examined: 412330
# Rows_affected: 0  Bytes_sent: 1180
# Full_scan: Yes  Full_join: No  Tmp_table: Yes  Tmp_table_on_disk: No
# Filesort: Yes  Filesort_on_disk: No  Merge_passes: 0  Priority_queue: No
use `wordpress`;
SET timestamp=1790410502;
SELECT ...;
```

- `# Time:` is `YYMMDD H:MM:SS` in the server's local time and is written only when the second changes, so several
  entries can share one; use `SET timestamp=` for each entry's time. The two plan lines appear only with
  `query_plan` verbosity and only when one of the flags applies; `explain` verbosity adds `# explain:` lines.
- Both servers write administrator commands as `# administrator command: <name>;`, and start the file (and every
  reopened file) with a header of three lines: `<program>, Version: ... started with:`, `Tcp port: ...`, and
  `Time Id Command Argument`
  ([MySQL sql/log.cc L559-L577](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/log.cc#L559-L577);
  [MariaDB sql/log.cc L3002-L3017](https://github.com/MariaDB/server/blob/mariadb-11.4.13/sql/log.cc#L3002-L3017)).

## Summarizing the log

- `scripts/slow-log-digest.mjs` (read-only, local files, plain or `.gz`) groups entries by statement shape with
  numbers and strings masked, and prints per group: count, total and share of time, median, 95th percentile and
  maximum, lock time, rows examined and sent, the MariaDB plan flags, and the tables named. It prints no user, host or
  literal values. Run it on a copy of the log that stays on your machine or on the server:

  ```sh
  node scripts/slow-log-digest.mjs /var/log/mysql/mysql-slow.log --top=15
  node scripts/slow-log-digest.mjs slow.log.1.gz slow.log --since=2026-09-20 --sort=count --json > digest.json
  ```

- `mysqldumpslow` ships with MySQL and groups statements that differ only in numbers and strings, shown as `N` and
  `'S'`; `-s` sorts by `t`, `at`, `l`, `al`, `r`, `ar` or `c` (average time by default), `-t N` keeps the first N,
  `-g` filters by a pattern ([mysqldumpslow](https://dev.mysql.com/doc/refman/8.4/en/mysqldumpslow.html)).
  MariaDB ships the same tool as `mariadb-dumpslow`, with `--json` from MariaDB 12.1
  ([mariadb-dumpslow](https://mariadb.com/docs/server/clients-and-utilities/logging-tools/mariadb-dumpslow)).
- With `log_output=TABLE` the entries are rows of `mysql.slow_log`, readable with SQL
  ([log destinations](https://dev.mysql.com/doc/refman/8.4/en/log-destinations.html)). On MySQL,
  `STATEMENT_DIGEST_TEXT()` turns each statement into its normalized form
  ([encryption functions](https://dev.mysql.com/doc/refman/8.4/en/encryption-functions.html)); the
  `scripts/query-checks.sql` blocks for the log table use it on MySQL and a masking expression on MariaDB. The
  WordPress database user usually cannot read the `mysql` schema; the blocks then fail without stopping the report.

## Turning it on for an investigation (a change)

Record the current values, change them at runtime only, and set them back afterwards. `SET GLOBAL` lasts until the
server restarts; MySQL's `SET PERSIST` also writes `mysqld-auto.cnf` and survives restarts, so do not use it here
([using system variables](https://dev.mysql.com/doc/refman/8.4/en/using-system-variables.html)).

```sql
-- Read the current values first (read-only). Works on MySQL and MariaDB; missing names are simply not listed.
SHOW GLOBAL VARIABLES WHERE Variable_name IN ('slow_query_log', 'log_slow_query', 'slow_query_log_file',
  'log_slow_query_file', 'long_query_time', 'log_slow_query_time', 'log_output', 'log_slow_extra',
  'log_slow_verbosity', 'log_slow_filter', 'log_queries_not_using_indexes', 'min_examined_row_limit');

-- MySQL 8.x (change):
SET GLOBAL long_query_time = 1;
SET GLOBAL log_slow_extra = ON;
SET GLOBAL slow_query_log = ON;

-- MariaDB 10.11 and later (change); on 10.6 use the old names slow_query_log and long_query_time:
SET GLOBAL log_slow_query_time = 1;
SET GLOBAL log_slow_verbosity = 'query_plan,explain';
SET GLOBAL log_slow_query = ON;

-- Undo: SET GLOBAL each variable back to the value recorded above.
```

- A new global value reaches connections opened after the change: session values are copied from the global values
  at connect time ([using system variables](https://dev.mysql.com/doc/refman/8.4/en/using-system-variables.html)).
  WordPress connects once per PHP request, when `wpdb` is constructed
  ([class-wpdb.php L751-L772, L1956-L1993](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/class-wpdb.php#L1956-L1993)),
  so page requests pick it up at once; a long-running worker keeps the value its connection started with.
- On MySQL, `SET GLOBAL` needs the `SYSTEM_VARIABLES_ADMIN` privilege (or the deprecated `SUPER`)
  ([system variable privileges](https://dev.mysql.com/doc/refman/8.4/en/system-variable-privileges.html)). An access
  error means the host controls the setting: ask the host to enable the log for a window and share the file or a
  digest.
- Start with 1 second on production and lower it only for a short window. A threshold of 0 logs every statement.
  Watch the file size while it runs, and stop at the end of the window whatever the result.
