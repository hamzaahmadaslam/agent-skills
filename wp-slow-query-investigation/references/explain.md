# Reading EXPLAIN on MySQL and MariaDB

Read this for step 4 of the procedure. MySQL facts come from the MySQL 8.4 Reference Manual (with the 8.0 release
that introduced each feature), MariaDB facts from mariadb.com/docs, both checked on 2026-09-26.

## Plan or measurement: know which one runs the statement

| Statement | Runs the statement? | Server | Source |
| --- | --- | --- | --- |
| `EXPLAIN <select>` | No: shows the optimizer's plan and estimates | Both | [MySQL EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/explain.html); [MariaDB EXPLAIN](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/analyze-and-explain-statements/explain) |
| `EXPLAIN ANALYZE <statement>` | Yes, and reports measured time and rows per step. Works with `SELECT`, multi-table `UPDATE` and `DELETE`, and `TABLE` statements, so it performs those writes | MySQL 8.0.18 and later | [MySQL EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/explain.html#explain-analyze); [MySQL 8.0 EXPLAIN](https://dev.mysql.com/doc/refman/8.0/en/explain.html) |
| `ANALYZE <statement>` and `ANALYZE FORMAT=JSON <statement>` | Yes: `ANALYZE SELECT` runs the select and discards the result; `ANALYZE UPDATE` and `ANALYZE DELETE` make their changes | MariaDB | [MariaDB ANALYZE](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/analyze-and-explain-statements/analyze-statement) |
| `ANALYZE TABLE <table>` | A different statement: updates index statistics (a change) | Both | [MySQL ANALYZE TABLE](https://dev.mysql.com/doc/refman/8.4/en/analyze-table.html) |

Rules that follow from the table:

- Only ever measure a `SELECT`. To study a slow `UPDATE` or `DELETE`, `EXPLAIN` it without `ANALYZE`, or measure the
  `SELECT` with the same `WHERE` clause.
- Measuring runs the full query on the server, as expensive as the slow request itself. Measure on a staging copy or
  a replica, not on the primary production database at peak hours.
- MySQL's `EXPLAIN ANALYZE` can be stopped with `KILL QUERY` or Ctrl-C (MySQL 8.0.20 and later)
  ([MySQL 8.0 EXPLAIN](https://dev.mysql.com/doc/refman/8.0/en/explain.html)). `scripts/explain-select.php` prints its
  connection id before it measures, so another session can run `KILL QUERY <id>`.
- `EXPLAIN` needs the same privileges as the statement, plus `SHOW VIEW` for views
  ([MySQL EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/explain.html)). In MariaDB it can take metadata locks as a
  `SELECT` does, and sometimes reads data while planning: a `const` table (one matching row) is read before the
  optimization phase
  ([MariaDB EXPLAIN](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/analyze-and-explain-statements/explain)).
  So a plain `EXPLAIN` can run a stored function: in a check on 2026-09-26, MariaDB 10.11.14 ran a `DETERMINISTIC`
  function that inserts a row while it planned `WHERE ID = f(1)` and `WHERE ID = (SELECT f(1))`; MySQL 8.4.11 ran it
  in neither case. `scripts/explain-select.php` therefore refuses unknown functions on MariaDB even without `analyze`.

## Output formats

- MySQL: `FORMAT=TRADITIONAL` (the table), `JSON`, or `TREE` (8.0.16 and later; the plan as nested steps). All three
  show hash joins: the table as `Using join buffer (hash join)` in `Extra`. The default is set by `explain_format`
  (8.0.32 and later), `TRADITIONAL` unless changed. `EXPLAIN ANALYZE` uses `TREE`, or `JSON` when
  `explain_json_format_version` is 2 (8.3 and later), and shows, per step, the estimated cost and rows, the time to the
  first row, the time spent in the step in milliseconds (an average per loop when the step runs several times), the
  rows returned and the number of loops
  ([MySQL EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/explain.html);
  [explain_format](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_explain_format)).
- MariaDB: `EXPLAIN`, `EXPLAIN EXTENDED` (adds `filtered`), `EXPLAIN FORMAT=JSON`; `ANALYZE` adds `r_rows` (rows
  actually read) and `r_filtered` (share of rows left after the condition); `ANALYZE FORMAT=JSON` adds `r_loops` and
  `r_total_time_ms` per step
  ([MariaDB EXPLAIN](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/analyze-and-explain-statements/explain);
  [MariaDB ANALYZE](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/analyze-and-explain-statements/analyze-statement);
  [ANALYZE FORMAT=JSON](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/analyze-and-explain-statements/analyze-format-json)).
- MariaDB 10.6.16 and later adds a note after `EXPLAIN` when an index cannot be used because the compared value has
  another type or collation; read it with `SHOW WARNINGS`
  ([notes when an index cannot be used](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/query-optimizer/notes-when-an-index-cannot-be-used)).

## The columns

| Column | Meaning | Source |
| --- | --- | --- |
| `id`, `select_type` | Which `SELECT` of the statement the row belongs to (`SIMPLE`, `PRIMARY`, `SUBQUERY`, `DERIVED`, `UNION` and others) | [MySQL output](https://dev.mysql.com/doc/refman/8.4/en/explain-output.html) |
| `table` | The table, in the order the server reads them | same |
| `type` | The access (join) type; the next section ranks them | same |
| `possible_keys` | Indexes that could be used; `NULL` means none is relevant to the conditions | same |
| `key` | The index chosen, or `NULL`. It can name an index missing from `possible_keys` when that index covers every selected column | same |
| `key_len` | Bytes of the index used, which shows how many columns of a multi-column index serve the lookup (one byte more for a nullable column) | same |
| `ref` | The columns or constants compared with the index | same |
| `rows` | Estimated rows to examine (an estimate for InnoDB) | same |
| `filtered` | Estimated percentage of those rows left after the table's conditions; `rows` x `filtered` is what passes to the next table. MariaDB shows it with `EXTENDED` or `ANALYZE` | same; [MariaDB EXPLAIN](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/analyze-and-explain-statements/explain) |
| `Extra` | How the rows are processed (below) | [MySQL output](https://dev.mysql.com/doc/refman/8.4/en/explain-output.html) |
| `r_rows`, `r_filtered` | MariaDB `ANALYZE`: measured rows read and share kept | [MariaDB ANALYZE](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/analyze-and-explain-statements/analyze-statement) |

The product of the `rows` values of all rows of the plan is a rough measure of the rows the server must examine
([MySQL output](https://dev.mysql.com/doc/refman/8.4/en/explain-output.html)).

## Access types, best to worst

From the MySQL manual's list ([join types](https://dev.mysql.com/doc/refman/8.4/en/explain-output.html)); MariaDB uses
the same names and can add `|filter` (for example `ref|filter`) when it applies a rowid filter
([MariaDB EXPLAIN](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/analyze-and-explain-statements/explain)).

| Type | Meaning | On a large WordPress table |
| --- | --- | --- |
| `system`, `const` | At most one matching row, read once (primary key or unique index compared with constants) | Ideal |
| `eq_ref` | One row per row of the previous table, through a primary key or unique `NOT NULL` index | Ideal for joins (for example `wp_posts` by `ID`) |
| `ref` | All rows matching one value of a non-unique index or a leftmost prefix | Good when the value matches few rows; poor when it matches most of the table (a common `meta_key`) |
| `fulltext`, `ref_or_null`, `index_merge`, `unique_subquery`, `index_subquery` | Specialized lookups | Read the `key` column |
| `range` | Rows in one or more index ranges (`=`, `<>`, `>`, `>=`, `<`, `<=`, `IS NULL`, `<=>`, `BETWEEN`, `LIKE 'prefix%'`, `IN()`) | Good when the ranges are narrow |
| `index` | A full scan of an index; with `Using index` the index covers the query | Reads every index entry |
| `ALL` | A full table scan for each combination of rows from the tables before it | The usual problem |

## Extra values that matter

From [MySQL EXPLAIN Extra information](https://dev.mysql.com/doc/refman/8.4/en/explain-output.html) and the MariaDB
Extra table ([MariaDB EXPLAIN](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/analyze-and-explain-statements/explain)):

| Extra | Meaning | Typical WordPress cause |
| --- | --- | --- |
| `Using filesort` | An extra pass sorts the rows; no index gives the order | `orderby` on a meta value, `rand`, or a sort column the chosen index does not cover |
| `Using temporary` | A temporary table holds the result, typically when `GROUP BY` and `ORDER BY` differ | `WP_Query` adds `GROUP BY wp_posts.ID` to every meta or tax query ([query-patterns.md](query-patterns.md)) |
| `Using where` with type `ALL` or `index` | Every row is read and then tested | Leading-wildcard `LIKE`, a condition on an expression, a column without an index |
| `Using index` | Answered from the index alone (covering index) | Good |
| `Using index condition` | Conditions tested on index entries before rows are read | Good |
| `Using join buffer (Block Nested Loop)`, `(hash join)` | Rows are joined through a buffer; MySQL uses a hash join when no index can serve the join condition ([hash joins](https://dev.mysql.com/doc/refman/8.4/en/hash-joins.html)) | A plugin table joined on a column without an index |
| `Range checked for each record` | No good index was found; the server re-checks for a usable index for each row of the previous tables | Compare the types and collations of the join columns |
| `Impossible WHERE`, `Select tables optimized away` | No rows can match, or the answer came from the index during planning | Fine |

## Estimates against measurements

- `rows` is an estimate. When the measured rows (`r_rows` in MariaDB, `rows=` in the `actual` part of MySQL's
  `EXPLAIN ANALYZE`) are far from it, statistics may be stale. MySQL's manual suggests `ANALYZE TABLE` when an index is
  not used as expected ([MySQL EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/explain.html)), and MariaDB's gives
  the same advice when the numbers stay far apart
  ([MariaDB ANALYZE](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/analyze-and-explain-statements/analyze-statement)).
  `ANALYZE TABLE` is a change with its own entry in [changes-and-rollback.md](changes-and-rollback.md).
- MariaDB's guidance: with a full scan and `r_filtered` below about 15%, consider an index; a condition that keeps
  around 30% of rows is usually not selective enough to warrant one
  ([MariaDB ANALYZE](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/analyze-and-explain-statements/analyze-statement)).
- When a query needs most of a table's rows, a sequential scan is faster than an index, and the optimizer may
  rightly choose `ALL` ([how MySQL uses indexes](https://dev.mysql.com/doc/refman/8.4/en/mysql-indexes.html)).
- Plans depend on the data. Test on a copy with production's data size, not a nearly empty staging site, and keep
  the same server version: MariaDB 11.0 introduced a new cost model, so plans can differ between 10.x and 11.x
  ([MariaDB 11.0 cost model](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/query-optimizer/the-optimizer-cost-model-from-mariadb-11-0)).

## Why an index is not used

| Cause | What it looks like | Source |
| --- | --- | --- |
| `LIKE` with a leading wildcard (`'%term%'`) | `ALL` or `index` with `Using where` | [B-tree index use](https://dev.mysql.com/doc/refman/8.4/en/index-btree-hash.html) |
| The column is inside an expression: `CAST(meta_value AS SIGNED)`, `meta_value+0`, a function | No `range` access on that column; a range condition compares the indexed column itself with a constant | [range optimization](https://dev.mysql.com/doc/refman/8.4/en/range-optimization.html) |
| A string column compared with a number (`meta_value = 5` instead of `'5'`) | The index is skipped because values must be converted; MariaDB 10.6.16 and later adds a note | [how MySQL uses indexes](https://dev.mysql.com/doc/refman/8.4/en/mysql-indexes.html); [MariaDB notes](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/query-optimizer/notes-when-an-index-cannot-be-used) |
| Columns with different character sets or collations compared or joined (a plugin table in another collation than the WordPress tables) | `Range checked for each record`, `ALL` on the joined table | same two sources |
| The conditions do not start with the index's first column | `possible_keys` lacks the index | [multiple-column indexes](https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html) |
| An `OR` between conditions on different columns | Index not used unless it spans every `OR` branch | [B-tree index use](https://dev.mysql.com/doc/refman/8.4/en/index-btree-hash.html) |
| `ORDER BY` a column indexed only by a prefix | `Using filesort` | [ORDER BY optimization](https://dev.mysql.com/doc/refman/8.4/en/order-by-optimization.html) |
| Most rows match | `ALL` chosen on purpose | [how MySQL uses indexes](https://dev.mysql.com/doc/refman/8.4/en/mysql-indexes.html) |
| The index is invisible (MySQL) or ignored (MariaDB) | Not listed in `possible_keys` | [indexes.md](indexes.md) |
| Stale statistics | Estimates far from measurements | above |
