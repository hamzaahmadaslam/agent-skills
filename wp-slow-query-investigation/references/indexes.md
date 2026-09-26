# Indexes: when one is safe, and how to add and remove it

Read this for step 6 of the procedure. MySQL facts come from the MySQL 8.4 Reference Manual, MariaDB facts from
mariadb.com/docs (both checked on 2026-09-26), WordPress from the 7.1.2 tag, WooCommerce from the 11.1.2 tag. Adding
or removing an index is a change: it needs the owner's approval, a backup and the rollback below.

## When an index is worth testing

Test an index only when every point holds; otherwise fix the query or the configuration first
([query-patterns.md](query-patterns.md)).

1. The query costs a lot in total: its count times its time in the digest or Performance Schema, not one slow run.
2. The plan reads far more rows than it returns: type `ALL` or `index`, or a `ref` that matches much of the table,
   with `rows` (or MariaDB `r_rows`) far above the rows returned. MariaDB's guidance: a full scan keeping less than
   about 15% of rows is a candidate, one keeping about 30% usually is not
   ([MariaDB ANALYZE](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/analyze-and-explain-statements/analyze-statement)).
3. The condition compares the column itself with constants of the same type and collation: no `CAST`, no `+0`, no
   leading `%`. Otherwise no index on that column can serve it
   ([explain.md](explain.md#why-an-index-is-not-used)).
4. The values in the condition match a small share of the table. When a query needs most rows, a scan is faster and
   the optimizer will ignore the index ([how MySQL uses indexes](https://dev.mysql.com/doc/refman/8.4/en/mysql-indexes.html)).
5. The table's writes can carry it: every index adds work to each insert, update and delete, and takes space
   ([optimization and indexes](https://dev.mysql.com/doc/refman/8.4/en/optimization-indexes.html)). `postmeta` on a
   busy store is written on every order and stock change.
6. No existing index already serves it as a leftmost prefix
   ([multiple-column indexes](https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html));
   `sys.schema_redundant_indexes` lists overlaps ([server-statistics.md](server-statistics.md)).
7. It can be tested on a copy with production's data size and the same server version (below).

## Designing it

- Column order: columns compared with `=`, `<=>` or `IS NULL` first, then at most one range or `LIKE 'prefix%'`
  column. The optimizer uses further key parts only while the comparisons are equalities; after a range it considers
  no more key parts ([range optimization](https://dev.mysql.com/doc/refman/8.4/en/range-optimization.html)). An index
  holds at most 16 columns ([multiple-column indexes](https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html)).
- Text columns need a prefix: `TEXT` and `BLOB` columns such as `meta_value` can only be indexed with a length, which
  counts characters for text columns; InnoDB allows 3,072 bytes per prefix with the `DYNAMIC` or `COMPRESSED` row
  format and 767 bytes with `REDUNDANT` or `COMPACT`, and `utf8mb4` takes up to 4 bytes per character. When a value is
  longer than the prefix, the index narrows the rows and the rest are still read
  ([column indexes](https://dev.mysql.com/doc/refman/8.4/en/column-indexes.html)). A prefix index cannot give the sort
  order past its prefix ([ORDER BY optimization](https://dev.mysql.com/doc/refman/8.4/en/order-by-optimization.html)).
- Size prefixes from the data. WooCommerce sized its order meta index `meta_key_value` as `(meta_key(50),
  meta_value(20))` from profiling a production-scale table: every key fit in 47 characters, and 20 characters of the
  value kept full selectivity for its queries. Its earlier attempt to drop `meta_value` from that index caused
  performance problems and was reversed
  ([wc-update-functions.php L3466-L3528](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-update-functions.php#L3466-L3528);
  [OrdersTableDataStore.php L3538-L3539](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3538-L3539)).
  Measure the same on the copy before choosing a length (read-only):

  ```sql
  SELECT MAX(CHAR_LENGTH(meta_value)) AS longest,
         COUNT(DISTINCT meta_value) AS distinct_full,
         COUNT(DISTINCT LEFT(meta_value, 20)) AS distinct_20,
         COUNT(DISTINCT LEFT(meta_value, 32)) AS distinct_32
  FROM wp_postmeta
  WHERE meta_key = '_the_key_from_the_slow_query';
  ```

- InnoDB stores the primary key columns in every secondary index record
  ([InnoDB index types](https://dev.mysql.com/doc/refman/8.4/en/innodb-index-types.html)), so a `postmeta` index
  already carries `meta_id`, but not `post_id`.
- Name it with a prefix core does not use, such as `sqi_`, so a future WordPress schema change cannot collide with it
  ([wordpress-schema.md](wordpress-schema.md#how-core-adds-indexes-and-why-that-matters-for-custom-ones)).
- Candidates to test, never to apply unmeasured:
  - `wp_postmeta (meta_key(191), meta_value(N))` for equality or prefix lookups of short string values under one key
    (the shape WooCommerce uses for order meta).
  - `wp_postmeta (post_id, meta_key(191))` when meta joins match one key per post on tables with many keys per post.
  - An index on a plugin's own table for the columns in its slow `WHERE` or join (ask the plugin's developer to ship
    it in the plugin, so it survives reinstalls).

## Testing on a copy

1. Copy production to staging with a backup you would also restore from: `wp db export <file> --single-transaction`
   ([wp db export](https://developer.wordpress.org/cli/commands/db/export/)). `--single-transaction` gives a
   consistent InnoDB snapshot without blocking the site, but no `ALTER TABLE`, `CREATE TABLE`, `DROP TABLE`,
   `RENAME TABLE` or `TRUNCATE TABLE` may run on production while it dumps
   ([mysqldump](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)). Use the same server type and version.
2. Baseline: `wp eval-file scripts/explain-select.php query.sql` and, on staging, the `analyze` mode, three to five
   times; note the median time, rows examined and the plan. Record the table's `INDEX_LENGTH` (report block "Table
   sizes").
3. Add the index on staging with the production statement from the next section, and time the statement: that is
   roughly how long production will take, at production load or longer.
4. Measure again. Keep the index only if the plan uses it (`key`), the measured rows and time fall clearly beyond
   the run-to-run spread, and the other slow queries on the same table did not get worse (`EXPLAIN` the digest's other
   statements on that table).
5. Note the index size (`INDEX_LENGTH` growth) and the time of a typical write on that table (for example saving a
   product) before and after.

## Adding it on production

Preconditions: approval for this step; a full backup restored once on staging; a quiet hour; free disk space for the
new index (at least the growth measured on staging); on a primary with replicas, a plan for replication lag.

- Set a short metadata lock timeout for your session. An online index build must wait for transactions that hold
  metadata locks on the table, and while its exclusive lock request is pending every later statement on the table
  waits behind it ([online DDL and metadata locks](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-performance.html);
  [online DDL limitations](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-limitations.html)). The default
  `lock_wait_timeout` is one year on MySQL and one day on MariaDB
  ([MySQL lock_wait_timeout](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_lock_wait_timeout);
  [MariaDB lock_wait_timeout](https://mariadb.com/docs/server/server-management/variables-and-modes/server-system-variables#lock_wait_timeout)).
- Ask for the online algorithm explicitly: with `ALGORITHM=INPLACE, LOCK=NONE` the statement fails instead of
  falling back to a more restrictive lock ([online DDL performance](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-performance.html)).
  Adding a secondary index is in place and allows reads and writes on MySQL and MariaDB
  ([MySQL online DDL operations](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html);
  [MariaDB INPLACE operations](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/innodb-online-ddl/innodb-online-ddl-operations-with-the-inplace-alter-algorithm)).

MySQL 8.0 or 8.4: build it invisible, check the plan, then make it visible. Invisible indexes are maintained but
not used, switching visibility is a fast in-place change, and the `SET_VAR` hint lets one statement use an invisible
index ([invisible indexes](https://dev.mysql.com/doc/refman/8.4/en/invisible-indexes.html)).

```sql
SET SESSION lock_wait_timeout = 5;
ALTER TABLE wp_postmeta ADD INDEX sqi_meta_key_value (meta_key(191), meta_value(20)) INVISIBLE,
  ALGORITHM=INPLACE, LOCK=NONE;
-- Check the plan with the index allowed for this statement only:
EXPLAIN SELECT /*+ SET_VAR(optimizer_switch = 'use_invisible_indexes=on') */ post_id
  FROM wp_postmeta WHERE meta_key = '_the_key' AND meta_value = 'the-value';
ALTER TABLE wp_postmeta ALTER INDEX sqi_meta_key_value VISIBLE;
```

MariaDB 10.6 and later: `WAIT n` sets the lock timeout for the statement itself
([WAIT and NOWAIT](https://mariadb.com/docs/server/reference/sql-statements/transactions/wait-and-nowait)); an index
can be created `IGNORED` ([CREATE INDEX](https://mariadb.com/docs/server/reference/sql-statements/data-definition/create/create-index)),
but the optimizer cannot be told to use an ignored index, and an index hint naming one is an error
([ignored indexes](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/optimization-and-indexes/ignored-indexes)),
so the plan check happens on the staging copy.

```sql
CREATE INDEX sqi_meta_key_value ON wp_postmeta (meta_key(191), meta_value(20)) WAIT 5 ALGORITHM=INPLACE LOCK=NONE;
```

While it runs, watch from a second session (`scripts/query-checks.sql`, block "Running statements"). If other
statements pile up in `Waiting for table metadata lock`, stop the build with `KILL QUERY <id of the ALTER>`. DDL on
InnoDB is atomic in MySQL 8 (committed or rolled back as a whole, even if the server stops)
([atomic DDL](https://dev.mysql.com/doc/refman/8.4/en/atomic-ddl.html)) and `ALTER TABLE` is atomic from MariaDB 10.6
([What is MariaDB 10.6](https://mariadb.com/docs/release-notes/community-server/10.6/what-is-mariadb-106)), so a
stopped build leaves the table as it was. Long builds on a busy table have two more limits: the log of writes
made during the build is capped by `innodb_online_alter_log_max_size` (the build fails if it overflows), and the
table is briefly locked at the end while that log is applied
([online DDL space requirements](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-space-requirements.html)).
A replica applies the statement only after it finishes on the source, and holds back later changes until it has
applied it ([online DDL limitations](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-limitations.html)).

After: `EXPLAIN` the target query on production (plain `EXPLAIN` is read-only), and compare the digest or Query
Monitor numbers over the following days with the baseline.

## Removing an index

Only remove indexes this process added (the `sqi_` prefix), never core, WooCommerce or plugin indexes. Hide first,
drop later, because hiding is instant to undo and re-creating a dropped index is a full build.

| Step | MySQL 8.x | MariaDB 10.6+ | Source |
| --- | --- | --- | --- |
| Hide (instant undo: make it visible or not ignored again) | `ALTER TABLE wp_postmeta ALTER INDEX sqi_meta_key_value INVISIBLE;` | `ALTER TABLE wp_postmeta ALTER INDEX sqi_meta_key_value IGNORED;` | [invisible indexes](https://dev.mysql.com/doc/refman/8.4/en/invisible-indexes.html); [ignored indexes](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/optimization-and-indexes/ignored-indexes) |
| Watch for a representative period | slow log, digests, Query Monitor on the pages that used it; the manual lists new slow log entries and changed plans as signs the index was needed | same | [invisible indexes](https://dev.mysql.com/doc/refman/8.4/en/invisible-indexes.html) |
| Drop | `ALTER TABLE wp_postmeta DROP INDEX sqi_meta_key_value, ALGORITHM=INPLACE, LOCK=NONE;` (in place, metadata only) | `ALTER TABLE wp_postmeta WAIT 5 DROP INDEX sqi_meta_key_value, ALGORITHM=INPLACE, LOCK=NONE;` | [MySQL online DDL operations](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html); [MariaDB INPLACE operations](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/innodb-online-ddl/innodb-online-ddl-operations-with-the-inplace-alter-algorithm) |

A hidden index is still maintained on every write
([invisible indexes](https://dev.mysql.com/doc/refman/8.4/en/invisible-indexes.html);
[ignored indexes](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/optimization-and-indexes/ignored-indexes)),
so hiding saves no write cost; only the drop does.

## Keeping track

- Record each custom index where the site's team keeps its runbook: name, table, columns, the date, the query it
  serves, and the before and after numbers.
- `scripts/query-checks.sql` lists indexes on core tables that core does not define, so a later audit sees them.
- `sys.schema_unused_indexes` (MySQL, or MariaDB with the Performance Schema on) shows indexes with no recorded use
  since the server started; read it only after a representative stretch of traffic
  ([schema_unused_indexes](https://dev.mysql.com/doc/refman/8.4/en/sys-schema-unused-indexes.html)).
