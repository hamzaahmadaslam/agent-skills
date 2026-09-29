---
name: wp-database-collation-drift
description: "Trace a WordPress database error such as \"Illegal mix of collations (...) for operation '='\" (1267), \"COLLATION ... is not valid for CHARACTER SET\" (1253), \"Unknown collation\" (1273), a key too long after a conversion (1071), or emoji rejected or stripped, to the exact tables and columns involved, then propose the narrowest conversion with a backup, a check and a rollback. Reads the error's collations and derivations, finds the query in debug.log or Query Monitor, maps server, database, connection, table and column collations through information_schema, explains how WordPress picks its connection collation (DB_CHARSET, DB_COLLATE, determine_charset) and how the mix arose (plugin tables, imports, MySQL 8 and MariaDB 11.5+ defaults), and prints MODIFY COLUMN statements with their rollback in place of converting every table. Read-only until the owner approves each step, staging first. Use when WordPress logs a collation or character set error, emoji disappear, or before moving a site between MySQL and MariaDB."
license: MIT
compatibility: "Needs WP-CLI read access to the site or a staging copy (wp eval, wp db query, wp db export with --no-data) and Node.js 20 or later for the proposal helper. Written against WordPress 7.1.2, WP-CLI 2.12.0, Query Monitor 4.0.7, the MySQL 8.4 Reference Manual and the MariaDB documentation as of 2026-09-29, for MySQL 8.0 and 8.4 and MariaDB 10.6 to 13.0; references/version-notes.md lists what differs by release."
metadata:
  author: Hamza Ahmad Aslam
  version: "1.0.0"
  last_verified: "2026-09-29"
---

# WordPress database collation drift

This skill takes a character set or collation error from a WordPress site to the tables and columns that caused it,
explains how they drifted apart, and proposes the smallest change that makes them agree: a `COLLATE` clause in the
plugin's own query, a `MODIFY COLUMN` on the columns in the error, or one table; the whole database only when the
owner decides so. It reads and maps first. Every change comes with a backup, a check and an undo,
runs on staging first, and waits for the owner's approval. It does not edit plugin or theme files; it names the code
and the fix for its developer.

It is written for coding agents that support the Agent Skills format, and a person can follow it the same way. Facts
are sourced in `references/`, next to each fact: the WordPress source at 7.1.2, WP-CLI's `db-command`, the MySQL 8.4
Reference Manual and the `mysql-8.4.11` source, the MariaDB documentation, and Query Monitor's documentation.

## When to use

- `debug.log`, Query Monitor or a host log shows `Illegal mix of collations`, `COLLATION '...' is not valid for
  CHARACTER SET`, `Unknown collation`, `Incorrect string value` or `Specified key was too long`.
- WordPress reports `Could not perform query because it contains invalid data` or `Processing the value for the
  following field failed`, or emoji in titles turn into HTML entities or vanish.
- A search, a filter or a plugin screen fails only for some input (accented letters, CJK text, emoji).
- An import between servers stopped on an unknown collation, or a site is about to move between MySQL and MariaDB.
- Someone proposes converting every table, or installing a plugin that does, to fix one error.

Related skills in this collection, for work outside this one: `wp-slow-query-investigation` (a query that is slow
rather than failing, including joins that lose their index), `wp-multisite-migration` (moving a subsite, where the
import step can bring in foreign collations) and `wp-full-site-scan` (a site that may be compromised).

## What you need

- WP-CLI access to the site, or to a staging copy restored from a recent production export on the same server type
  and version. Read commands need no approval.
- The error text as logged, with its collations, derivations and operation; or access to `debug.log`.
- Node.js 20 or later wherever you run `scripts/propose-alters.mjs` (it reads a local file only).
- For changes: the owner's approval per step, a tested backup, and a staging copy to time the statement on.

## Safety rules

1. Read-only by default. `SELECT`, `SHOW`, `wp eval` code that only reads, `wp db export --no-data` to standard
   output, and the helpers in `scripts/` need no approval. Everything else (`ALTER TABLE`, `SET GLOBAL`, constants in
   `wp-config.php`, installing Query Monitor, plugin settings) needs the owner's approval for that step, with its
   backup, check and undo stated first. One approval covers one step.
2. Staging first. Every `ALTER` runs on a staging copy of the same size and server version before production, and the
   staging time sets the write pause the owner agrees to ([references/fixes.md](references/fixes.md#what-each-option-costs-in-time)).
3. Narrowest change. Change only the columns and tables the error and the map name, toward the collation the other
   side already uses (normally WordPress's `$wpdb->collate`). Converting every table, `CONVERT TO` on a table whose
   text types could grow, and changing `DB_COLLATE` are owner decisions, each a step of its own.
4. Never narrow a character set: no `utf8mb4` to `utf8mb3` or `latin1`. Stop and report when a column may hold UTF-8
   bytes under a `latin1` label; that is a different repair ([references/fixes.md](references/fixes.md#data-stored-under-the-wrong-label)).
5. Check before converting: unique keys for values that would collide, key lengths against the engine's limit,
   foreign keys on both sides, row size. A failed check stops the step.
6. A backup before each change: the table (`wp db export --tables=... --add-drop-table`) and its definition, restore
   tested on staging. Set `lock_wait_timeout` to a few seconds for the `ALTER`, and stop it with `KILL QUERY` if
   statements pile up behind it ([references/changes-and-rollback.md](references/changes-and-rollback.md)).
7. Logs and query texts are personal data: `debug.log` holds full SQL with what visitors typed. Read logs where they
   are, copy only query shapes and callers, and keep exports and logs out of chats, tickets and repositories.
8. Multisite: pass `--url=<site>` to WP-CLI. `wp db query` ignores it, so the helpers write the table prefix into each
   statement.

## Where the errors come from

| Symptom | Usual cause | Read |
| --- | --- | --- |
| 1267 with two `IMPLICIT` operands | A plugin table in another collation joined with a core table or another plugin table | [how-mixes-arise.md](references/how-mixes-arise.md), [reading-the-error.md](references/reading-the-error.md) |
| 1267 with `IMPLICIT` and `COERCIBLE`, only for some input | A `latin1` or `utf8mb3` column compared with a WordPress literal holding characters it cannot store | [reading-the-error.md](references/reading-the-error.md#why-the-error-comes-and-goes) |
| 1253 or 1267 with `EXPLICIT` | A `COLLATE` clause in plugin code that fits neither side | [fixes.md](references/fixes.md) |
| 1273 on import | A MySQL 8 `_0900_` or MariaDB `uca1400` name on a server without it | [mysql-mariadb-differences.md](references/mysql-mariadb-differences.md) |
| 1071 during a conversion | A key on a long text column in a `COMPACT` or MyISAM table | [fixes.md](references/fixes.md#index-key-length) |
| Emoji become entities, "contains invalid data" | A column or table not in `utf8mb4` | [reading-the-error.md](references/reading-the-error.md#wordpress-messages-that-point-to-the-same-cause), [wordpress-charset.md](references/wordpress-charset.md#what-wordpress-checks-on-writes) |
| Errors after a server upgrade or a plugin update | New tables took the new server default | [how-mixes-arise.md](references/how-mixes-arise.md), [version-notes.md](references/version-notes.md) |

## Procedure

### 0. Record the setup (read-only)

```sh
bash scripts/collation-report.sh --path=/path/to/wordpress            # add --url=<site> on multisite
COLLATION_REPORT_SKIP_SQL=1 bash scripts/collation-report.sh --path=... # WordPress side only
```

The report prints `DB_CHARSET`, `DB_COLLATE`, the charset and collation WordPress chose (`$wpdb->charset`,
`$wpdb->collate`), the session variables of WordPress's own connection, then the blocks in
`scripts/collation-checks.sql`: server, database and client session variables, the database default, table
collations, this site's tables against WordPress's collation, columns that differ from their table or from
WordPress, columns that cannot store four-byte characters, index key bytes now and as `utf8mb4`, unique and foreign
keys on text columns, views, pad attributes (MySQL) and collation aliases (MariaDB 11.4.5 and later). Blocks for the
other server type fail and are skipped. One block can run alone through `wp db query` with `{prefix}` and
`{wp_collate}` filled in. Then read [references/version-notes.md](references/version-notes.md) for the site's versions.

### 1. Read the error

Take the two collations, their derivations and the operation from the message
([references/reading-the-error.md](references/reading-the-error.md)). Write down which side is a column (`IMPLICIT`),
which a literal (`COERCIBLE`, the connection collation) and which an explicit `COLLATE` (`EXPLICIT`), and whether
the failing input had non-ASCII characters.

### 2. Find the query and the code (read-only)

Search `debug.log` for the message; each line carries the SQL and the calling functions. On staging, Query Monitor's
Query Errors panel shows the same with the component. Reproduce the `SELECT` the way WordPress runs it, with its
`SET NAMES`, because `wp db query` connects with a different collation
([references/finding-the-query.md](references/finding-the-query.md)). Record the query shape, the tables and columns
in the failing condition, the caller and the component.

### 3. Map the columns involved

From the report, for each table and column in the failing condition: its character set and collation, the table
default, the engine and row format, the indexes it is in, and whether it is in a unique or foreign key. Compare with
WordPress's connection collation and with the core table on the other side
([references/wordpress-charset.md](references/wordpress-charset.md)).

### 4. Explain how it drifted

Match the map to a cause: a plugin table created without `get_charset_collate()`, core tables from the WordPress
4.3 conversion, an import from another server, a server upgrade that changed defaults, replication, or a hand-written
`COLLATE` ([references/how-mixes-arise.md](references/how-mixes-arise.md)). The cause decides who acts: the plugin's
developer, the owner, or the host.

### 5. Choose the narrowest fix

Pick the target collation (normally `$wpdb->collate`) and the smallest option that removes the error: a `COLLATE`
in the plugin's query, `MODIFY COLUMN` on the columns in the error, then the table default with its text columns
([references/fixes.md](references/fixes.md)). Then produce the statements:

```sh
COLLATION_REPORT_DDL_TABLES=wp_example_log bash scripts/collation-report.sh --path=... > tables.sql
node scripts/propose-alters.mjs tables.sql --target=utf8mb4_unicode_520_ci                   # whole table
node scripts/propose-alters.mjs tables.sql --target=utf8mb4_unicode_520_ci --column=wp_example_log.object_name
node scripts/propose-alters.mjs tables.sql --target=... --server=mariadb --assume-collation=utf8mb3=utf8mb3_general_ci
```

The helper prints, per table, the columns to change, the key bytes against the limit, warnings (foreign keys, a
`latin1` source, `TINYTEXT`, names that exist on one server type only), read-only checks including a collision count
for unique keys, the backup commands, the `ALTER` with full column definitions and explicit `CHARACTER SET` and
`COLLATE`, checks after, and the rollback. It refuses to narrow a character set and never runs anything.
`examples/synthetic-proposal.txt` is its output for `examples/synthetic-tables.sql`, from
`node scripts/propose-alters.mjs examples/synthetic-tables.sql --target=utf8mb4_unicode_520_ci --assume-collation=utf8mb3=utf8mb3_general_ci`
run in the skill folder.

### 6. Check on staging (read-only, then the change on staging)

Run the printed checks on staging. A collision count above zero, a key over the limit on a unique key, a foreign key
whose other side is not in the plan, or a `latin1` column of uncertain content stops the step and goes to the owner.
Then run the change on staging, time it, run the checks after, and test the site flow that failed.

### 7. Make the change on production (change)

With the owner's approval of this step: take the table backup and test its restore, agree the write pause from the
staging time, run the `ALTER` at a quiet hour with `lock_wait_timeout` set, and watch for metadata lock waits
([references/changes-and-rollback.md](references/changes-and-rollback.md)). One table per step, unless a foreign key
ties two.

### 8. Verify and report

Run the checks after, the failing query through WordPress with the same kind of input, the site flow, and the report
again. Watch `debug.log` for the same error over the following days. Send the plugin's developer the details when
its table or query was the cause.

## Reference files

| File | Read it when |
| --- | --- |
| [references/reading-the-error.md](references/reading-the-error.md) | Step 1: error codes, derivations and coercibility, repertoire, WordPress's own messages |
| [references/finding-the-query.md](references/finding-the-query.md) | Step 2: debug.log format, Query Monitor, SAVEQUERIES, reproducing with WordPress's connection |
| [references/wordpress-charset.md](references/wordpress-charset.md) | Steps 3 and 5: DB_CHARSET, DB_COLLATE, determine_charset, get_charset_collate, the utf8mb4 upgrade routines |
| [references/how-mixes-arise.md](references/how-mixes-arise.md) | Step 4: how defaults are filled in, server defaults, the usual causes, prevention |
| [references/mysql-mariadb-differences.md](references/mysql-mariadb-differences.md) | Steps 4 to 7: collation names on one server only, imports, pad attributes, ALTER locks and timeouts |
| [references/fixes.md](references/fixes.md) | Steps 5 and 6: the options narrowest first, lossy conversions, wrong labels, key length, unique and foreign keys, time |
| [references/changes-and-rollback.md](references/changes-and-rollback.md) | Steps 6 to 8: backups, the change, checks after, rollback, the developer report |
| [references/version-notes.md](references/version-notes.md) | Step 0, and any site or server older than the versions above |
| `scripts/collation-report.sh` | Step 0 and after each change (read-only) |
| `scripts/collation-checks.sql` | The SELECT and SHOW blocks the report runs; usable alone with the placeholders filled in |
| `scripts/propose-alters.mjs` | Step 5: prints the narrowest ALTER statements, checks and rollback as text (read-only, local file) |
| `examples/synthetic-tables.sql`, `examples/synthetic-proposal.txt` | A synthetic input for the helper and the output it prints |

## Report format

End every session with this report, filled in from command output, never from memory:

```text
Collation drift: <site> (<date, UTC>)
Environment: WordPress <v>, <MySQL|MariaDB> <v>, PHP <v>; multisite <yes|no>
WordPress connection: DB_CHARSET <v>, DB_COLLATE <v|empty|undefined> -> $wpdb->charset <v>, $wpdb->collate <v>
Server defaults: character_set_server <v>, collation_server <v>; database default <charset/collation>

Error: <message as logged, values masked> (<count> times, <first> to <last>, source <debug.log|Query Monitor|host log>)
Operands: <collation, derivation> vs <collation, derivation>, operation '<op>'
Query: <shape, literals masked>; caller <function>; component <plugin|theme|core>

| Table | Column | Type | Charset / collation now | In keys (unique?) | Target | Key bytes after / limit |
| ----- | ------ | ---- | ----------------------- | ----------------- | ------ | ----------------------- |

Other drift found (not in the error, not changed): <table: collation> or none
Cause: <how it drifted, with the evidence> (<reference file or source>)
Fix chosen: <option and why it is the narrowest>; alternatives not taken: <option, reason>
Checks before: collisions <n per unique key>; foreign keys <none|list>; latin1 content <n/a|confirmed|stopped>
Staging: <statement> took <s> on <rows> rows; checks after <result>; site flow <result>
Changes made: <change> | backup <file, restore tested yes/no> | check <result> | undo <statement or restore, tested yes/no>
Verification: failing query through WordPress <passes|fails>; debug.log <no new errors since <time>|...>
Not changed, owner or developer decision needed: <item, trade-off, who>
Report to plugin developer: <plugin, table or query, request> or none
Next step: <step, its backup, its check, its undo> (needs approval: yes/no)
Files to delete after the work: <log copies, exports, definition files>
```
