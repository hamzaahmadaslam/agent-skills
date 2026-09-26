---
name: wp-slow-query-investigation
description: "Find and fix slow WordPress database queries on MySQL 8.x and MariaDB 10.6 to 11.x, read-only by default. Collects evidence from Query Monitor (slow, duplicate and per-component queries, Ajax and REST headers), SAVEQUERIES, the slow query log (with a digest script for both log formats), Performance Schema digests and sys views; traces each query to the WP_Query, meta, tax, search, option, transient, user or WooCommerce code that built it; reads EXPLAIN, MySQL EXPLAIN ANALYZE and MariaDB ANALYZE, knowing which ones execute the statement; weighs query fixes, object caching and WooCommerce lookup tables before indexes; and adds or removes an index only after a test on a copy, using invisible or ignored indexes, online DDL, a lock timeout, a backup and a rollback. Use when pages, admin screens, Ajax or REST requests spend their time in the database, when the database server is busy, when a query shows in the slow log, or before adding an index to a WordPress table."
license: MIT
compatibility: "Needs WP-CLI read access to the site or a staging copy (the helpers run through wp eval-file and wp db query), and Node.js 20 or later for the slow log digest. Written against WordPress 7.1.2, Query Monitor 4.0.7, WooCommerce 11.1.2, WP-CLI 2.12.0, the MySQL 8.4 Reference Manual and the MariaDB documentation as of 2026-09-26; references/version-notes.md lists what differs on older releases."
metadata:
  author: Hamza Ahmad Aslam
  version: "1.0.1"
  last_verified: "2026-09-26"
---

# WordPress slow query investigation

This skill finds the database queries that cost a WordPress site the most time, traces each one to the code that
built it, reads its execution plan, and fixes it in the cheapest safe way: a change to the query, a setting, a cache,
and only when the evidence holds, an index tested on a copy first. It reads and measures by default. Every change it
proposes comes with a backup, a check and an undo, and waits for the owner's approval. It does not edit plugin or
theme files; it names the code and the fix for its developer.

It is written for coding agents that support the Agent Skills format, and a person can follow it the same way. Facts
are sourced in `references/`, next to each fact: the WordPress source at 7.1.2, Query Monitor 4.0.7, WooCommerce
11.1.2, the MySQL 8.4 Reference Manual and source, the MariaDB documentation and source, and developer.wordpress.org
and developer.woocommerce.com.

## When to use

- Query Monitor, a profiler or the host shows page, admin, Ajax, REST or cron time going to the database.
- The database server runs hot (CPU, threads running) or the host reports slow queries.
- A statement appears in the slow query log, in Query Monitor's Slow Queries panel, or in the Performance Schema
  digests.
- Someone proposes an index, or a WordPress, WooCommerce, plugin or database server update changed query times.

Related skills in this collection, for work outside this one: `wp-autoload-audit` (cleaning autoloaded options),
`wp-cron-action-scheduler-health` (cron and queue backlogs), `woo-checkout-performance-audit` (a live checkout),
`woo-hpos-live-migration` (moving orders out of post meta) and `wp-cwv-field-triage` (front-end Core Web Vitals).

## What you need

- WP-CLI access to the site, or to a staging copy restored from a recent production export. Read commands need no
  approval; the report and `EXPLAIN` helpers use them.
- The database server type and version (the report prints them).
- Query Monitor on staging; on production only with approval ([references/query-monitor.md](references/query-monitor.md)).
- The slow query log if it is already on, or the owner's approval to turn it on for a window; on managed hosts, the
  host's help.
- For measurements and index tests: a staging copy with production's data size and the same server version.
- Node.js 20 or later on the machine that reads the log, for `scripts/slow-log-digest.mjs`.

## Safety rules

1. Read-only by default. `SELECT`, `SHOW`, plain `EXPLAIN`, the helpers in `scripts/` and WP-CLI read commands need
   no approval. Everything else (`SET GLOBAL`, installing Query Monitor, constants in `wp-config.php`, `ANALYZE TABLE`,
   `ALTER TABLE`, `KILL`, settings, code) needs the owner's approval for that step, with its backup, check and undo
   stated first. One approval covers one step.
2. Plain `EXPLAIN` does not run the statement (MariaDB can still run a stored function called in it); MySQL
   `EXPLAIN ANALYZE` and MariaDB `ANALYZE` do. Measure only `SELECT` statements, and only on staging or a replica:
   MariaDB's `ANALYZE UPDATE` and `ANALYZE DELETE` make their changes, and MySQL's `EXPLAIN ANALYZE` executes
   multi-table updates and deletes ([references/explain.md](references/explain.md)).
3. No index goes to production untested. Test it on a copy, then add it at a quiet hour with a full backup, a short
   `lock_wait_timeout`, `ALGORITHM=INPLACE, LOCK=NONE`, and invisible (MySQL) where possible; watch for
   `Waiting for table metadata lock` and stop the build if statements pile up
   ([references/indexes.md](references/indexes.md)).
4. Never drop or alter WordPress core, WooCommerce or plugin indexes or columns. Only indexes this process added are
   removed: its own (named with the `sqi_` prefix), hidden first and dropped later, and a missing core index it
   restored, when that change is undone.
5. Logs and query texts are personal data: the slow log and Query Monitor show literal values (emails, names, search
   terms), users and hosts. Read logs where they are, share only masked digests, keep exports and logs out of chats,
   tickets and repositories, and delete copies when the report is written.
6. Server settings changed for the investigation are runtime only (`SET GLOBAL`, never MySQL's `SET PERSIST` or
   option files) and are set back at the end of the window.
7. Multisite: pass `--url=<site>` to WP-CLI. `wp db query` ignores it, so statements carry the site's table prefix;
   the helpers do this themselves.
8. Evidence before blame. A plugin or theme is named as the cause only when the same query and caller show on several
   requests or in the server-side totals, not from one page load or from reading code.

## Where slow queries come from

| Pattern | How it shows | Read |
| --- | --- | --- |
| Meta queries and sorting by meta value | Joins of `wp_postmeta` (`mt1`, `mt2`), `CAST(... meta_value ...)`, `meta_value+0`, `Using temporary; Using filesort` | [query-patterns.md](references/query-patterns.md) |
| Counting all rows | `SQL_CALC_FOUND_ROWS` then `SELECT FOUND_ROWS()` on queries that print no pagination | [query-patterns.md](references/query-patterns.md) |
| Search and `LIKE '%term%'` | `post_title LIKE`, `post_content LIKE`, WooCommerce product search, role filters on `wp_capabilities` | [query-patterns.md](references/query-patterns.md), [woocommerce-lookup-tables.md](references/woocommerce-lookup-tables.md) |
| Unbounded or random queries | No `LIMIT`, `ORDER BY RAND()` | [query-patterns.md](references/query-patterns.md) |
| Tax queries | `NOT IN ( SELECT object_id ...)`, correlated `SELECT COUNT(1)` subqueries | [query-patterns.md](references/query-patterns.md) |
| Many small queries | The same statement dozens of times in Duplicate Queries | [query-patterns.md](references/query-patterns.md), [object-cache.md](references/object-cache.md) |
| Options and transients | The autoload query, one query per option, the daily transient `DELETE` | [options-and-transients.md](references/options-and-transients.md) |
| No or cold object cache | The same reads on every request; queries back after every post or meta write | [object-cache.md](references/object-cache.md) |
| WooCommerce catalog | Price sort and filter on post meta, attribute filters as tax queries | [woocommerce-lookup-tables.md](references/woocommerce-lookup-tables.md) |
| Missing, extra or unused indexes | Report index blocks, sys schema views | [wordpress-schema.md](references/wordpress-schema.md), [indexes.md](references/indexes.md) |
| The server, not the query | Every query slow at once, buffer pool reads, metadata lock waits, MyISAM tables | [server-statistics.md](references/server-statistics.md) |

## Procedure

### 0. Record the setup (read-only)

```sh
bash scripts/slow-query-readonly-report.sh --path=/path/to/wordpress            # add --url=<site> on multisite
SLOWQ_REPORT_SKIP_SCANS=1 bash scripts/slow-query-readonly-report.sh --path=... # big site at busy hours
```

The report prints versions and the server type, prefixes and collation, debug constants, the `db.php` and
`object-cache.php` drop-ins, the core indexes missing or extra (compared with WordPress 7.1.2), autoload totals,
WooCommerce lookup settings, every non-core callback on the filters that rewrite queries, plugins, and the blocks in
`scripts/query-checks.sql`: slow log settings, status counters, table sizes, engines and collations, index lists,
heavy meta keys, transients, Performance Schema digests, sys schema index views, running statements (masked) and
WooCommerce lookup table counts. Blocks for the other server type fail and are skipped. Parts run alone:
`wp eval-file scripts/query-state.php`, or one SQL block through `wp db query` with `{prefix}` and `{base_prefix}`
filled in. Then read [references/version-notes.md](references/version-notes.md) for the site's versions.

### 1. Rank the expensive queries across all traffic (read-only first)

- `Slow_queries` and `Uptime` from the report: any growth between two runs means statements over `long_query_time`
  now, even with the log off.
- Performance Schema digests (MySQL by default; MariaDB only with it on): the top statements by total time, the
  statements that read tables without a usable index, and the overflow row
  ([references/server-statistics.md](references/server-statistics.md)).
- If the slow query log is on, summarize it where it lives:

  ```sh
  node scripts/slow-log-digest.mjs /var/log/mysql/mysql-slow.log --top=15
  node scripts/slow-log-digest.mjs slow.log.1.gz slow.log --since=2026-09-20 --sort=count --json > digest.json
  ```

- If nothing records slow queries, propose turning the log on for a window (a change with its undo:
  [references/slow-query-log.md](references/slow-query-log.md#turning-it-on-for-an-investigation-a-change)).

Output of this step: a ranked list of statement shapes with count, total time and share, median, 95th percentile,
rows examined per row sent, and the tables named. Rank by total time first: a 30 ms query on every request can
outweigh a 3 s query once a day.

### 2. Tie each query to a request and to code

- Query Monitor on staging (or production with approval): Queries by Component, Queries by Caller, Slow Queries and
  Duplicate Queries on the slow pages, logged out when visitors are; the Ajax headers and REST `?_envelope` data for
  requests without a page ([references/query-monitor.md](references/query-monitor.md)).
- Query Monitor does not load for WP-CLI or cron runs. For shapes seen only in the log or digests, search the code for
  a distinctive fragment of the statement (a meta key, a table name, a column) and name the caller from that.
- The report's hook list shows plugins that rewrite queries (`posts_clauses`, `posts_where`, `query` and others).

Write for each query: the shape, where it runs (page, request, job), the caller and the component.

### 3. Match the pattern

Use the table above and [references/query-patterns.md](references/query-patterns.md): which WordPress API built the
SQL, why the server reads more rows than it returns, and the fixes in order of preference. Options and transients:
[references/options-and-transients.md](references/options-and-transients.md). Product listings, filters and search on
WooCommerce: [references/woocommerce-lookup-tables.md](references/woocommerce-lookup-tables.md).

### 4. Read the plan (read-only; measuring is staging only)

Put the statement, as Query Monitor or the log shows it with real values, in a file and run:

```sh
wp eval-file scripts/explain-select.php query.sql            # plan only; safe on production
wp eval-file scripts/explain-select.php query.sql analyze    # measured; staging copy or replica only
```

The helper accepts one `SELECT` only and refuses writes, `INTO`, locking reads, executable comments and functions
with side effects; in `analyze` mode it also refuses functions it does not know. Read `type`, `key`, `rows` against
the rows returned, `filtered`, and `Extra`, then check [references/explain.md](references/explain.md#why-an-index-is-not-used)
for why an index is not used. Record the median of three to five measured runs as the "before" value.

### 5. Choose the fix, cheapest and safest first

1. The query itself: arguments or code in the theme or plugin (for example `no_found_rows`, a limit, `fields`, no
   `rand`, taxonomy instead of meta, priming caches before a loop), proposed to its developer.
2. Configuration that already exists: WooCommerce's lookup tables, a plugin's own setting, the `postmeta_form_keys`
   filter for the Custom Fields box.
3. Caching: a persistent object cache (the host's change) and what it cannot fix
   ([references/object-cache.md](references/object-cache.md)).
4. Statistics: `ANALYZE TABLE` when estimates and measurements disagree.
5. An index: step 6.
6. The server: buffer pool size, table engine, Performance Schema on MariaDB (recommendations for the host).

### 6. An index, only when the checklist holds

Go through the checklist in [references/indexes.md](references/indexes.md): high total cost, a plan that reads far more
rows than it returns, a condition on the bare column with matching type and collation, a selective value, a table
whose writes can carry the index, no redundant index, and a copy to test on. Design the column order and prefix
lengths from the data, name it `sqi_...`, test it on the copy, then add it on production with the backup, lock
timeout and online DDL settings in that file. Undo is hiding it (invisible or ignored) at once, and dropping it later.

### 7. Make one change (change)

Take the step from [references/changes-and-rollback.md](references/changes-and-rollback.md), which gives each change
its backup, check and undo: slow log window, Query Monitor, debug constants, the Custom Fields key filter, query
argument changes, `ANALYZE TABLE`, restoring a missing core index, adding, hiding or dropping a custom index,
WooCommerce lookup table regeneration and usage, expired transients, and stopping a running statement. State all four
parts and wait for approval.

### 8. Measure again and report

Repeat the measurements of steps 1, 2 and 4 that the change should affect, with the same method, page, data and cache
state. A change that does not move its number is undone, unless it fixed something else worth keeping, which the
report then says. Set every server variable changed in step 1 back to its recorded value.

## Reference files

| File | Read it when |
| --- | --- |
| [references/query-monitor.md](references/query-monitor.md) | Step 2: panels, the slow threshold, SAVEQUERIES, the `db.php` drop-in, Ajax and REST |
| [references/slow-query-log.md](references/slow-query-log.md) | Step 1: variables on MySQL and MariaDB, entry formats, privacy, turning it on and off |
| [references/server-statistics.md](references/server-statistics.md) | Steps 0 and 1: digests, sys views, counters, running statements, server-wide slowness |
| [references/query-patterns.md](references/query-patterns.md) | Step 3: the SQL WordPress builds and the fixes, pattern by pattern |
| [references/options-and-transients.md](references/options-and-transients.md) | Step 3, when the options table is involved |
| [references/object-cache.md](references/object-cache.md) | Step 5: what a persistent object cache removes and what it hides |
| [references/woocommerce-lookup-tables.md](references/woocommerce-lookup-tables.md) | Step 3 on stores: product lookup tables, attribute filters, product search |
| [references/explain.md](references/explain.md) | Step 4: plan and measurement statements, columns, access types, Extra, why an index is ignored |
| [references/wordpress-schema.md](references/wordpress-schema.md) | Steps 0 and 6: core indexes, what they serve, how core adds indexes |
| [references/indexes.md](references/indexes.md) | Step 6: the checklist, design, test on a copy, production rollout, removal |
| [references/changes-and-rollback.md](references/changes-and-rollback.md) | Step 7: every change with its backup, check and undo |
| [references/version-notes.md](references/version-notes.md) | Step 0, and any site or server older than the versions above |
| `scripts/slow-query-readonly-report.sh` | Step 0 and after each change (read-only) |
| `scripts/query-state.php` | Site state, core index check and query filter callbacks (read-only, `wp eval-file`) |
| `scripts/query-checks.sql` | The SELECT and SHOW blocks the report runs; usable alone with the placeholders filled in |
| `scripts/explain-select.php` | Step 4: plan of one SELECT, or its measurement on staging (read-only by default) |
| `scripts/slow-log-digest.mjs` | Step 1: summary of slow log files, literals masked (read-only, local files) |

## Report format

End every session with this report, filled in from measurements and command output, never from memory:

```text
Slow query investigation: <site> (<date, UTC>)
Environment: WordPress <v>, <MySQL|MariaDB> <v>, PHP <v>; WooCommerce <v or none>; object cache <type|none>;
             multisite <yes|no>; Query Monitor <v|not installed>
Evidence window: <slow log period and threshold | Performance Schema since <uptime> | Query Monitor requests>

| # | Statement shape (masked)        | Count | Total s | Share | p95 s | Rows examined per sent | Caller / component | Pattern |
| - | ------------------------------- | ----- | ------- | ----- | ----- | ---------------------- | ------------------ | ------- |

Plans (per query worth fixing):
- #<n> <EXPLAIN type/key/rows/Extra>; measured on <staging|replica>: median <ms> over <runs> runs, rows <r_rows|actual>
Findings (largest total cost first):
- <finding>: <number and where it was measured> -> <cause> (<reference file or source>)
Changes made: <change> | backup <file or id, restore tested yes/no> | check <result> | undo <tested yes/no>
Before and after: <query or page> <metric> <before> -> <after> (<method, runs>)
Indexes added by this work: <table.index (columns), date, the query it serves> or none
Not changed, owner or developer decision needed: <item, trade-off, who>
Recommendations for the host: <item, evidence>
Server settings restored: <variable = value, ...> or none changed
Next step: <step, its backup, its check, its undo> (needs approval: yes/no)
Files to delete after the investigation: <log copies, digests with shapes, exports, query files>
```
