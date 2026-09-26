---
name: wp-autoload-audit
description: "Measure and clean up autoloaded options on a WordPress site with the autoload values WordPress 6.6 introduced (on, off, auto, auto-on, auto-off, next to the older yes and no), the 150,000-byte rule for new options and the 800,000-byte Site Health check. Counts the loaded set the way WordPress does (wp option list --autoload=on and wp doctor leave out auto and auto-on rows), finds the plugin, theme or core feature that owns each large option, decides whether to keep it, switch autoload off, delete it or fix it in the owner's code, and makes each change with a row export first and an undo tested on staging. Covers the alloptions and notoptions cache keys, persistent object caches and Memcached's default 1 MB item size, transients, multisite, and the WP-CLI option, db and cache commands. Use when Site Health reports that autoloaded options could affect performance, when alloptions is large or keeps growing, when every uncached request is slow, or after removing plugins."
license: MIT
compatibility: "Needs shell access with WP-CLI to the site or a staging copy, the mysql or mariadb client that wp db query uses, and grep for the owner search. Written against WordPress 7.1.2 and WP-CLI 2.12.0 (entity-command 2.8.4, cache-command 2.2.0, db-command 2.1.3), with notes for entity-command 3.0.2 and for WordPress 6.4 to 7.1 in references/version-notes.md."
metadata:
  author: Hamza Ahmad Aslam
  version: "1.0.0"
  last_verified: "2026-09-26"
---

# Autoloaded options audit for WordPress

This skill measures the options WordPress loads on every request, names the code that owns each large one, and takes
out what is not needed, one change at a time, each with an export, a check and an undo tested on staging. It measures
and reads by default. It does not edit plugins or themes, tune the database server or install an object cache: it
reports what the owner of the code or the host should change, with the numbers behind it.

It is written for coding agents that support the Agent Skills format, and a person can follow it the same way. Facts
are sourced in `references/`, next to each fact: the WordPress source at 7.1.2, make.wordpress.org dev notes,
developer.wordpress.org (code reference, handbooks, WP-CLI commands), the WP-CLI source, WordPress VIP's
documentation, and the MySQL, MariaDB and Memcached documentation and source.

## When to use

- Site Health shows "Autoloaded options could affect performance" (WordPress 6.6 and later).
- The loaded total is large, or grows from week to week.
- Every uncached request is slow or uses a lot of memory, whatever the page.
- A persistent object cache misbehaves around options: stale values after a change, the `alloptions` key too large to
  store, or a host limit on it (WordPress VIP answers with "Error 1024 (alloptions)").
- After removing plugins or themes, to find what they left behind.
- Before and after a plugin change, to see what it added to every request.

Not the right tool for one slow SQL query (the collection's `wp-slow-query-investigation` skill), for the scheduled
events inside the `cron` option (`wp-cron-action-scheduler-health`), or for a WooCommerce checkout as a whole
(`woo-checkout-performance-audit`).

## What you need

- Shell access with WP-CLI on the server or on a staging copy, and the `mysql` or `mariadb` client that `wp db query`
  uses.
- Read access to the site's code (`wp-content`) for the owner search.
- A staging copy of the site for every change and for testing each undo.
- The site owner's approval for each change, one step at a time.

## Safety rules

1. Read-only by default. The helpers in `scripts/`, `wp option list`, `wp option get-autoload`, `wp cache type` and
   SELECT queries need no approval. Anything else changes the site: before it, state the step, its export, its check
   and its undo, and wait for the owner's approval of that step. One approval covers one step.
2. Staging first for every kind of change and for its undo (`references/changes-and-rollback.md`), then production
   at a quiet hour.
3. Export first: the whole options table for disaster recovery, and the rows you are about to change as the undo. An
   export counts only after one test restore on staging.
4. Never: delete a core option; switch every option off (WordPress then loads the whole table on each request); write
   the options table with SQL except the documented undo; import the whole-table export over a live site; run
   `wp cache flush` or `wp transient delete --all` on production for this work.
5. Option values can hold licence keys, API tokens and mail passwords. Print names and sizes, never values. Keep
   exports out of chats, tickets and repositories, and delete them when the owner's retention period ends. Do not run
   `wp config list` (it prints the database password).
6. Change one option, or one owner's group of options, at a time, and measure before and after the same way.
7. Multisite: every site has its own options table and cache key. Pass `--url=<site>` to WP-CLI and use that site's
   prefix in SQL.
8. With a persistent object cache, delete the `alloptions`, `notoptions` and option keys after any SQL change or
   `wp option set-autoload` (`references/object-cache.md`).

## Autoload values and limits (WordPress 7.1.2)

| `autoload` value | Meaning | Loaded on every request |
| --- | --- | --- |
| `on` / `off` | Explicit choice (6.6 and later) | yes / no |
| `yes` / `no` | Explicit choice written before 6.6, by SQL, or by `wp option set-autoload` | yes / no |
| `auto` | No choice made; WordPress decides | yes |
| `auto-on` / `auto-off` | No choice made; a filter decided (by default `auto-off` means the value was over 150,000 bytes) | yes / no |

| Limit | Value | Where it applies |
| --- | --- | --- |
| Per-option threshold (`wp_max_autoloaded_option_size`) | 150,000 bytes | New or re-decided options saved without an explicit choice; never options saved with `true` |
| Site Health "Autoloaded options" (`site_status_autoloaded_options_size_limit`) | 800,000 bytes | Sum of all loaded values; critical at or above it |
| Site Health object cache suggestion | over 500 options, or over 100,000 serialized bytes | Production environments, 6.1 and later |
| Memcached default item size | 1 MB | The whole `alloptions` array is one item |
| WordPress VIP | 1 MB compressed, enforced for `alloptions` | VIP sites |

Details and sources: `references/autoload-values.md`, `references/measuring.md`, `references/object-cache.md`.

## Procedure

### 0. Record the setup (read-only)

```sh
bash scripts/autoload-report.sh --path=/path/to/wordpress              # add --url=<site> on multisite
```

The report prints versions and the database revision, the object cache and transient storage, plugins and themes,
then `scripts/autoload-state.php` (the values WordPress loads after filters, the thresholds after filters, every
callback on the autoload hooks with its owner, the cached `alloptions` entry against the database, and the time and
memory the autoload query and unserializing take), then the SELECT blocks in `scripts/autoload-checks.sql`. Parts can
run alone: `wp eval-file scripts/autoload-state.php [option names]`, or one SQL block through `wp db query` with the
placeholders filled in. On a large options table run it on staging or a replica, or at a quiet hour.

Then read `references/version-notes.md`: before 6.6 only `yes` rows load, and before the 6.7 upgrade twelve core
options that 6.7 switches off may still be loaded.

### 1. Measure (read-only)

- The loaded count and bytes, per autoload value, with the share of each large option; bytes by name prefix; options
  over 150,000 bytes; loaded transients; theme mods; the table's size and indexes. All from the report.
- Do not take totals from `wp option list --autoload=on` or `wp doctor`: they count `on` and `yes` only, and the
  WP-CLI 2.12.0 filter also lacks parentheses (`references/measuring.md`).
- The cost, not only the bytes: query and unserialize time and memory from the state helper; on a cached site, the
  size of the `alloptions` entry and any names or values that differ from the database; on staging, the median
  server response time of ten uncached requests.
- Write every number with its method and date. These are the "before" values.

`references/measuring.md` also lists two optional outside helpers: a script that reports by option ID without names,
and a browser page that summarizes a pasted list of names and sizes.

### 2. Find the owner of each large option (read-only)

Work down the largest loaded options until the rest are small enough not to matter for the goal.

```sh
bash scripts/find-option-owner.sh --path=/path/to/wordpress option_a option_b
wp plugin list --fields=name,status,version --skip-update-check
```

The owner search looks for the name in quotes in core, plugins, must-use plugins and themes, then for shorter
prefixes, and handles core storage names (transients, `theme_mods_`, `widget_`, `user_roles`, `_children`). An exact
match is strong evidence; a prefix match is weaker; no match at all makes an orphan candidate. A top-level serialized
object's class name (in the report) leads to the file that defines it. Details: `references/finding-owners.md`.

### 3. Decide per option

| Finding | Decision |
| --- | --- |
| Core option | Keep; fix what makes it grow (events in `cron`, rules in `rewrite_rules`, roles) |
| Read on most front-end requests | Keep; if very large, ask the owner to shrink or split it |
| Read only in admin, cron or on a few URLs | Switch autoload off |
| Changes on many requests (counters, logs, timestamps) | Switch off; report it to the owner |
| Owner installed but inactive | Switch off; delete only through the plugin's uninstall or when it is removed for good |
| No installed code uses it | Delete, after the export |
| Loaded transient, or transient rows left from before an object cache | Delete |
| Unknown | Leave it; ask |

When it is unclear which requests read an option, run the temporary read logger on staging
(`references/changes-and-rollback.md`). Do not decide on size alone: the 150,000-byte figure is how WordPress decides
for new options, not a rule for existing ones.

### 4. Export, and test the undo on staging (change on staging only)

Take the three exports in `references/changes-and-rollback.md` (whole options table, the rows to change with
`--insert-ignore`, and the recorded autoload values with a fingerprint query). On staging, make the change, undo it,
and check that the fingerprint matches again. Say in the report how the undo was tested.

### 5. Make one change (change)

Pick the option with the largest measured cost and the smallest risk. State the step, its export, its check and its
undo, and wait for approval.

- Switch autoload off: `wp eval 'var_dump( wp_set_option_autoload( "opt_a", false ) );'`, which updates the cache
  too. With `wp option set-autoload opt_a off`, delete the `alloptions` cache key afterwards on a cached site.
- Delete an option no installed code uses: `wp option delete opt_a`.
- Transients: `wp transient delete <name>`, or `wp option delete _transient_<name> _transient_timeout_<name>` for rows
  left from before a persistent object cache.
- When the owner's code puts the option back to `on` after its next save: report it to the author, and use the
  must-use plugin stopgap only with approval.

Commands, checks and undo for each: `references/changes-and-rollback.md`. WP-CLI details and version differences:
`references/wp-cli-commands.md`.

### 6. Verify and watch

- Run the report again and fill in the "after" column the same way as step 1.
- `wp option get-autoload <name>` for each changed option, and again after the owner's settings are saved once.
- Site checks: front page, a post, the admin dashboard, the owner's screens, the PHP error log for a day.
- A change that does not move its number, or breaks something, is undone with its tested undo.

## Reference files

| File | Read it when |
| --- | --- |
| `references/autoload-values.md` | Explaining an `autoload` value; how `add_option()`, `update_option()` and the autoload setters decide; core defaults; transients as options |
| `references/measuring.md` | Steps 0, 1 and 6: counting like WordPress, why tools disagree, Site Health, cost, multisite, optional outside helpers |
| `references/object-cache.md` | Any site with a persistent object cache; stale values; size limits; clearing keys |
| `references/finding-owners.md` | Steps 2 and 3: core names, owner search, which requests read an option, the decision table |
| `references/changes-and-rollback.md` | Steps 4 and 5: exports, the undo test, every change with its check and undo, stopgaps, the read logger |
| `references/wp-cli-commands.md` | Before any WP-CLI command: versions, read-only and changing commands, flags |
| `references/version-notes.md` | Step 0, and any site older than WordPress 7.1.2 |
| `scripts/autoload-report.sh` | Steps 0, 1 and 6 (read-only) |
| `scripts/autoload-state.php` | Loaded values, thresholds and callbacks after filters, cache against database, cost (read-only, `wp eval-file`) |
| `scripts/autoload-checks.sql` | The SELECT blocks the report runs; usable alone with the placeholders filled in |
| `scripts/find-option-owner.sh` | Step 2: which code references an option name (read-only, grep) |

## Report format

End every session with this report, filled in from command output and measurements, never from memory:

```text
Autoloaded options audit: <site> (<date, UTC>)
Environment: WordPress <v> (database <revision>), PHP <v>, WP-CLI <v>; multisite <yes: site id|no>;
             object cache <type|none>; loaded values <list after filters>; environment type <type>

| Metric                                         | Before | After | Method                                |
| ---------------------------------------------- | ------ | ----- | ------------------------------------- |
| Loaded options / bytes                         |        |       | autoload-checks.sql, loaded total     |
| Site Health "Autoloaded options"               |        |       | autoload-state.php                    |
| Largest loaded option (name, bytes)            |        |       | autoload-checks.sql                   |
| Loaded transients / bytes                      |        |       | autoload-checks.sql                   |
| Autoload query / unserialize time (ms)         |        |       | autoload-state.php, same server       |
| Memory for the loaded set (KiB)                |        |       | autoload-state.php                    |
| alloptions entry: serialized bytes, stale names|        |       | autoload-state.php (cached sites)     |
| Server response time, median of 10 (ms)        |        |       | curl on staging, page cache bypassed  |

Findings (largest measured cost first):
- <option>: <bytes, autoload value> -> owner <core|plugin|theme|mu-plugin|none> (<exact|prefix|none>) -> read by
  <requests> -> decision <keep|switch off|delete|fix at source|ask> (<reference file>)
Changes made: <option(s)> | export <file, restore tested yes/no> | check <result> | undo <command, tested yes/no>
Not changed, owner decision needed: <option, trade-off>
For plugin or theme authors: <owner, option, size, where it is read, the line that saves it with true>
For the host: <object cache size limit, alloptions entry size, evidence>
Next step: <step, its export, its check, its undo> (needs approval: yes/no)
Files to delete after the audit: <exports, logger output, temporary must-use plugins>
```
