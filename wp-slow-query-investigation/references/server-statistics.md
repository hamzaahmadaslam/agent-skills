# Server statistics: digests, counters and running queries

Read this for steps 0 and 1 of the procedure. Everything here is read-only: `SELECT` and `SHOW` statements that
`scripts/query-checks.sql` runs. MySQL facts come from the MySQL 8.4 Reference Manual, MariaDB facts from
mariadb.com/docs, both checked on 2026-09-26.

## Statement digests (the Performance Schema)

- MySQL normalizes each statement into a digest: literal values become `?` placeholders and whitespace is adjusted,
  so statements that differ only in their values are counted together, and a normalized statement keeps no names,
  dates or passwords from the values
  ([statement digests](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-statement-digests.html)).
- `performance_schema.events_statements_summary_by_digest` holds one row per schema and digest with `COUNT_STAR`,
  `SUM_TIMER_WAIT`, `MAX_TIMER_WAIT`, rows examined and sent, `SUM_NO_INDEX_USED`, `SUM_NO_GOOD_INDEX_USED`, temporary
  table and sort counts, `FIRST_SEEN`, `LAST_SEEN` and, in MySQL 8, `QUANTILE_95`
  ([statement summary tables](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-statement-summary-tables.html)).
  The table has a fixed size; once it is full, statements with new digests are counted together in one row whose
  `SCHEMA_NAME` and `DIGEST` are `NULL`
  ([statement digests](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-statement-digests.html)). A large
  `NULL` row means the list is incomplete.
- Timer columns are in picoseconds (divide by 1e12 for seconds)
  ([event timing](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-timing.html)). `NO_INDEX_USED` is 1 when
  a statement scanned a table without an index; `NO_GOOD_INDEX_USED` is 1 when the server found no good index
  ([events_statements_current](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-events-statements-current-table.html)).
- `QUERY_SAMPLE_TEXT` in the same table stores a real statement with its values
  ([statement digests](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-statement-digests.html)). The
  helper selects only `DIGEST_TEXT`, never the sample, so no personal data leaves the server.
- The Performance Schema is enabled by default in MySQL
  ([quick start](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-quick-start.html)). In MariaDB it is
  disabled by default, and the `performance_schema` variable is not dynamic: turning it on needs a configuration change
  and a restart ([MariaDB Performance Schema](https://mariadb.com/docs/server/reference/system-tables/performance-schema/performance-schema-overview);
  [performance_schema variable](https://mariadb.com/docs/server/reference/system-tables/performance-schema/performance-schema-system-variables)).
  On MariaDB without it, use the slow query log.
- Digests are counted since the server started or the table was last truncated. Read `Uptime` with them: numbers
  from a server that restarted an hour ago describe that hour.

## The sys schema views

The sys schema turns Performance Schema data into readable views; MySQL installs it by default
([sys schema](https://dev.mysql.com/doc/refman/8.4/en/sys-schema.html)), and MariaDB bundles it from 10.6
([What is MariaDB 10.6](https://mariadb.com/docs/release-notes/community-server/10.6/what-is-mariadb-106)), where it
needs the Performance Schema on.

| View | What it lists | Source |
| --- | --- | --- |
| `sys.statement_analysis` | Normalized statements with counts, latency, full scans, rows, temporary tables, sorted by total latency | [statement_analysis](https://dev.mysql.com/doc/refman/8.4/en/sys-statement-analysis.html) |
| `sys.statements_with_full_table_scans` | Normalized statements that did full table scans, by share of scans and latency | [statements_with_full_table_scans](https://dev.mysql.com/doc/refman/8.4/en/sys-statements-with-full-table-scans.html) |
| `sys.schema_unused_indexes` | Indexes with no recorded use since the server started; meaningful only after a representative stretch of traffic | [schema_unused_indexes](https://dev.mysql.com/doc/refman/8.4/en/sys-schema-unused-indexes.html) |
| `sys.schema_redundant_indexes` | Indexes made redundant by another index (the dominant one), with both column lists | [schema_redundant_indexes](https://dev.mysql.com/doc/refman/8.4/en/sys-schema-redundant-indexes.html) |

An index in the unused list may still be needed by a monthly report or by the optimizer's estimates; hide it first
([indexes.md](indexes.md#removing-an-index)), never drop it straight away.

## Status counters

Read these with `SHOW GLOBAL STATUS`, twice some minutes apart, and compare the difference with `Uptime` and
`Questions`: totals since startup hide what happens now.

| Counter | Meaning | Source |
| --- | --- | --- |
| `Slow_queries` | Queries over `long_query_time`, counted even when the slow query log is off | [server status variables](https://dev.mysql.com/doc/refman/8.4/en/server-status-variables.html#statvar_Slow_queries) |
| `Select_full_join` | Joins that scan a table because they use no index; the manual says to check the indexes when it is not 0 | [Select_full_join](https://dev.mysql.com/doc/refman/8.4/en/server-status-variables.html#statvar_Select_full_join) |
| `Select_scan` | Joins that did a full scan of the first table | [Select_scan](https://dev.mysql.com/doc/refman/8.4/en/server-status-variables.html#statvar_Select_scan) |
| `Handler_read_rnd_next` | Requests to read the next row of the data file; high with many table scans | [Handler_read_rnd_next](https://dev.mysql.com/doc/refman/8.4/en/server-status-variables.html#statvar_Handler_read_rnd_next) |
| `Created_tmp_disk_tables` and `Created_tmp_tables` | Internal temporary tables on disk, and all internal temporary tables | [Created_tmp_disk_tables](https://dev.mysql.com/doc/refman/8.4/en/server-status-variables.html#statvar_Created_tmp_disk_tables) |
| `Sort_merge_passes` | Merge passes of sorts; large values point at sorts too big for `sort_buffer_size` | [Sort_merge_passes](https://dev.mysql.com/doc/refman/8.4/en/server-status-variables.html#statvar_Sort_merge_passes) |
| `Innodb_buffer_pool_reads` and `Innodb_buffer_pool_read_requests` | Logical reads that had to go to disk, and all logical reads | [Innodb_buffer_pool_reads](https://dev.mysql.com/doc/refman/8.4/en/server-status-variables.html#statvar_Innodb_buffer_pool_reads) |

## When every query is slow

A single query with a bad plan is slow on its own; when all queries slow down together, look at the server before
adding indexes.

- The InnoDB buffer pool caches table and index data in memory; the manual notes that dedicated servers often give it
  up to 80% of memory ([buffer pool](https://dev.mysql.com/doc/refman/8.4/en/innodb-buffer-pool.html)). Its default
  size is 128 MB on MySQL 8.4 and on MariaDB
  ([innodb_buffer_pool_size](https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_buffer_pool_size);
  [MariaDB InnoDB variables](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/innodb-system-variables)).
  The report compares it with the database's data and index size; a buffer pool far smaller than the tables the site
  reads, with `Innodb_buffer_pool_reads` growing, is a sizing question for the host, not an index question.
- MariaDB's query cache is off by default because it does not scale on busy multi-core servers
  ([query cache](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/buffers-caches-and-threads/query-cache)).
  If `query_cache_type` is `ON`, note it for the host. MySQL 8 has no query cache
  ([MySQL 8.0 removed features](https://dev.mysql.com/doc/refman/8.0/en/mysql-nutshell.html)).
- MySQL locks MyISAM tables as a whole, so only one session at a time can update one, while InnoDB locks rows
  ([internal locking](https://dev.mysql.com/doc/refman/8.4/en/internal-locking.html)). The report lists every table
  that is not InnoDB.

## Queries running right now

- Process list: with the `PROCESS` privilege you see every thread; without it (the usual WordPress database user)
  you see only the threads of your own account
  ([process list access](https://dev.mysql.com/doc/refman/8.4/en/processlist-access.html)). Since WordPress and its
  cron runs use one account, that still shows the site's own queries.
- MySQL 8.4 deprecates `INFORMATION_SCHEMA.PROCESSLIST` (and the `SHOW PROCESSLIST` built on it); on MySQL the helper reads
  `performance_schema.processlist`, which has the `ID`, `COMMAND`, `TIME`, `STATE` and `INFO` columns it needs
  ([INFORMATION_SCHEMA PROCESSLIST](https://dev.mysql.com/doc/refman/8.4/en/information-schema-processlist-table.html);
  [performance_schema.processlist](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-processlist-table.html)).
  MariaDB's `INFORMATION_SCHEMA.PROCESSLIST` has `TIME_MS` for sub-second times
  ([MariaDB PROCESSLIST](https://mariadb.com/docs/server/reference/system-tables/information-schema/information-schema-tables/information-schema-processlist-table)).
  The helper masks the statement text (quoted strings and numbers) before printing it.
- A state of `Waiting for table metadata lock` means a statement waits for a lock held by another transaction, often
  behind a pending `ALTER TABLE`, which then blocks every later statement on that table
  ([online DDL and metadata locks](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-performance.html)).
  That is a locking problem, not an index problem.
- The plan of a statement that is running now: MySQL `EXPLAIN FOR CONNECTION <id>` (needs `PROCESS` for another
  account's connection) ([EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/explain.html)); MariaDB
  `SHOW EXPLAIN FOR <id>`, with `EXPLAIN FOR CONNECTION` as an alias
  ([SHOW EXPLAIN](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/show/show-explain)).
  Both read the plan without running the statement again.
- Stopping a running statement (`KILL QUERY <id>`) is a change to someone's work in progress: the owner decides, and
  never for a statement that writes.
