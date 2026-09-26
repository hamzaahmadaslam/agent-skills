---
name: woo-hpos-live-migration
description: "Migrate a live WooCommerce store's orders from WordPress posts storage to High-Performance Order Storage (HPOS) with a backup before and a verification after every change step. Covers the compatibility audit (FeaturesUtil::declare_compatibility, wp wc hpos compatibility-info, and the themes, mu-plugins and custom code that WooCommerce never checks), compatibility mode and the background sync, the wp wc hpos commands (status, count_unmigrated, sync, verify_data, diff, backfill, enable, disable, compatibility-mode, cleanup), data parity checks, the cut-over, the soak period with sync on, rollback to posts storage, and what to watch afterwards (order search, reports, custom queries on wp_posts). Use when a store on posts storage wants HPOS, when a migration is stuck or half done, when orders differ between the two storages, or when something broke after the switch. Read-only by default."
license: MIT
compatibility: "Needs shell access with WP-CLI to the store or to a staging copy, and WooCommerce 8.2 or later. Written against WooCommerce 11.1.2; references/version-notes.md lists what differs on older releases."
metadata:
  author: Hamza Ahmad Aslam
  version: "1.0.1"
  last_verified: "2026-09-26"
---

# WooCommerce HPOS migration on a live store

This skill moves order storage from the WordPress posts tables to HPOS on a store that keeps taking orders the whole
time. The path is: audit, rehearse on staging, turn on compatibility mode, backfill, verify, switch, soak with sync on,
turn sync off, and optionally clean up. Every change step has a backup before it and a check after it, and the agent
runs read commands only until the user approves a specific change. The skill does not rewrite plugin code for you; it
finds what needs fixing and tells you why.

It is written for coding agents that support the Agent Skills format, and a person can follow it the same way. Facts
in this file are sourced in `references/`, next to each fact, from WooCommerce's code at the 11.1.2 tag, its developer
docs and its pull requests.

## When to use

- A store still on posts storage (`woocommerce_custom_orders_table_enabled` is `no`) needs to move to HPOS.
- A migration stalled: the unsynced count stops falling, sync errors in the logs, the settings are greyed out.
- Orders look different in the two storages, or after the switch.
- Something broke after the switch or after sync was turned off: order search, reports, admin columns, exports,
  custom SQL, permissions.
- A rollback to posts storage is being considered.

New stores need none of this: HPOS is the default for new installs since WooCommerce 8.2.0.

## Safety rules

1. Read-only by default. Before any write command, state the step, its backup, its check and its undo, and wait for
   the user's approval of that step. One approval covers one step.
2. Back up before each change step and verify after it. A backup counts only after one test restore on staging.
3. Rehearse the whole path on a staging copy of production first. Production follows the same script.
4. Switch storage only when `wp wc hpos status` shows `Unsynced orders: 0`, and switch with `wp wc hpos enable` and
   `wp wc hpos disable`. They use the full pending count; the settings screen's check could miss changed orders from
   9.9.0 to 11.0.x.
5. Never on production: `wp wc hpos enable --ignore-plugin-compatibility`, the filter
   `wc_allow_changing_orders_storage_while_sync_is_pending`, `wp wc hpos verify_data --re-migrate` once HPOS has ever
   been authoritative, `wp wc hpos cleanup --force` without reading `wp wc hpos diff` first, and the "Delete the custom
   orders tables" tool.
6. Roll back through sync, not by restoring a backup: a restore discards every order placed after the backup.
7. Keep extensions that register their own order types (subscriptions, bookings) active until the migration is done.
   The sync covers only registered order types.
8. Multisite: each site has its own HPOS tables and settings. Pass `--url=<site>` to every command and use that site's
   table prefix (`wp db prefix --url=<site>`).

## The four storage states

| Order data storage | Compatibility mode | Phase | What a rollback costs |
| --- | --- | --- | --- |
| Posts | Off | Before the migration | Nothing to roll back |
| Posts | On | Backfilling HPOS | Turn compatibility mode off |
| HPOS | On | Soak after the switch | `wp wc hpos disable`, immediate |
| HPOS | Off | Done | Backfill posts from HPOS first, then disable |

Compatibility mode (the code calls it data sync) copies every order change to the other storage as it happens.
Details: `references/sync-mechanics.md`.

## Procedure

### 0. Read the current state (read-only)

```sh
bash scripts/hpos-readonly-report.sh --path=/path/to/wordpress   # add --url=<site> on multisite
```

The report prints the WooCommerce version, the HPOS options, `wp wc hpos status`, queued batch processors, plugin
compatibility, plugins and themes, the registered order types and the SQL parity checks. On a busy store run it at a
quiet hour, or set `HPOS_REPORT_SKIP_SQL=1`. Without the script:

```sh
wp plugin get woocommerce --field=version
wp wc hpos status
wp option get woocommerce_custom_orders_table_enabled
wp option get woocommerce_custom_orders_table_data_sync_enabled
```

Then check `references/version-notes.md`. Before 11.1.0, plan a WooCommerce update (staging first, then production)
as its own change before the migration. Before 8.9.0, the sync commands are named `wp wc cot ...`. Also note the order
count, whether WP-Cron runs (background sync depends on it or on admin traffic), and whether the site is multisite.

### 1. Audit compatibility (read-only)

- `wp wc hpos compatibility-info --include-inactive --display-filenames` (9.2.0+) lists WooCommerce-aware plugins as
  compatible, incompatible or uncertain. For HPOS, uncertain counts as incompatible and blocks the switch.
- WooCommerce counts a plugin that declares nothing only if it has a `WC tested up to` header. Themes, must-use
  plugins, drop-ins, site plugins with neither, snippets stored in the database, and outside systems that read the
  database are never checked.
- `bash scripts/scan-code.sh /path/to/wp-content` lists, per component, the header, the HPOS declaration and how many
  lines match WooCommerce's audit patterns (direct post and post meta access, `shop_order`, order admin hooks);
  `--details` also prints the matching lines that mention "order".
- Ask the user about database-stored snippets, the Legacy REST API, and systems such as warehouses, ERP, shipping or
  accounting connectors that read `wp_posts` or `wp_postmeta` directly.
- Record a decision for every component: update, replace, fix and declare, remove, or accept after testing.

Read `references/compatibility-audit.md` for the declaration rules, the patterns and their replacements. Do not go to
step 3 while any component lacks a decision.

### 2. Rehearse on staging

- Copy production to staging, with outgoing email and live payment processing turned off there.
- Run steps 3 to 8 on staging and time `wp wc hpos sync`. WooCommerce's own test store with 9 million orders took about
  a week (`references/cli-commands.md`).
- Test with compatibility mode on, then again with it off: checkout with every payment method, refunds, subscription
  renewals if present, the store's own critical flows, order search, reports and exports. The sync-off pass is the one
  that exposes code reading `wp_posts`.
- Fix what fails and repeat until a full pass is clean.

### 3. Turn on compatibility mode (change)

- Backup: full database backup, finished before this step (it may create tables, and a `--single-transaction` dump
  must not overlap DDL), written outside the web root because it holds customer data:
  `wp db export /path/outside/webroot/hpos-1-before-sync.sql --single-transaction`.
- Command: `wp wc hpos compatibility-mode enable` (9.1.0+; before 9.5.0 it stops with "HPOS tables do not exist."
  when the tables are missing, so use the checkbox there), or tick "Enable compatibility mode" in WooCommerce >
  Settings > Advanced > Features. Posts stay authoritative. Every new or changed order is copied to HPOS at once, and
  the backlog is queued as background batches.
- Check: `wp wc hpos status` shows `HPOS enabled?: no`, `Compatibility mode enabled?: yes`, and `Unsynced orders`
  falling. After the next order or order edit, `wp wc hpos diff <id>` prints "No differences found."
- Undo: `wp wc hpos compatibility-mode disable`.

### 4. Backfill and watch the sync (change: writes only the HPOS tables)

- Background: batches of 250 orders run through Action Scheduler (`wc_schedule_pending_batch_processes`,
  `wc_run_batch_process`). Enough for small stores.
- CLI, for large stores: `wp wc hpos sync` inside `screen` or `tmux`. Stopping and resuming it is safe.
- Watch: `wp wc hpos count_unmigrated`, the Action Scheduler rows in the report, and WooCommerce > Status > Logs,
  source `batch-processing`. After 5 consecutive failures the background processor gives up; the log names the first
  and last order ID of the failing batch. Fix the cause, then restart with "Sync orders now" or the CLI.
- With WP-Cron disabled and no system cron, background batches move only on admin page loads. Use the CLI.
- Check: `Unsynced orders: 0`. The step 3 backup covers this step, because while posts are authoritative the sync
  writes only the HPOS tables.

### 5. Verify parity (read-only)

- `wp wc hpos status`: `Unsynced orders: 0`. This counts missing rows and newer dates, not field values.
- `wp wc hpos verify_data --verbose`, in ID ranges on large stores (`--start-from`, `--end-at`); exit code 0 means no
  differences.
- `wp wc hpos diff <id>` on every reported order and on a sample: the newest orders, each status, refunds, and each
  extension order type.
- The SQL checks in the report: counts per type and status, totals, missing rows, date and status mismatches.
- Fix differences as described in `references/verification.md`. Before the first switch, the posts copy is the truth.
- Gate: everything passes, or every exception is explained in writing and accepted by the user.

### 6. Switch to HPOS (change)

- Backup: a new full backup just before; save the `wp wc hpos status` output with it.
- Timing: a quiet hour, with someone ready to test. No downtime is needed.
- Command: `wp wc hpos enable`. It re-checks plugins, tables and pending orders, and stops before switching storage if
  one check fails. Leave compatibility mode on.
- Check: `wp wc hpos status` shows `HPOS enabled?: yes`, `Compatibility mode enabled?: yes`, `Unsynced orders: 0`. The
  order list opens at `wp-admin/admin.php?page=wc-orders`. Test orders with every payment method and one refund. A new
  order's `wp_posts` row is a full `shop_order` and `diff` is clean. Logs are quiet.
- Undo: `wp wc hpos disable` (rollback path A below).

### 7. Soak with compatibility mode on

- Keep sync on for at least one full business cycle; WooCommerce's high-volume migration kept it on for a week. Cover
  the weekly peak, subscription renewals and scheduled exports.
- Daily: `wp wc hpos status` (unsynced stays at 0; a rising count means post backfills fail), the logs, support
  channels, and the list in `references/after-cutover.md`.
- From 10.7.0, sync-on-read is off by default, so code that writes straight to `wp_posts` or `wp_postmeta` for orders
  does not reach HPOS. Find that code now. On older releases the large-store guide turns sync-on-read off with
  `add_filter( 'woocommerce_hpos_enable_sync_on_read', '__return_false' );` a few hours after the switch.

### 8. Turn off compatibility mode (change)

- Backup: full.
- Command: `wp wc hpos compatibility-mode disable`.
- Check: `Compatibility mode enabled?: no`. A new order's `wp_posts` row is a `shop_order_placehold` draft. Run the
  flow tests and the after-cutover list again: code that reads orders from `wp_posts` breaks now.
- Undo: `wp wc hpos compatibility-mode enable`, then wait for `Unsynced orders: 0`.
- Optional fallback: a scheduled `wp wc hpos sync` keeps the posts copy close to current; with HPOS authoritative it
  writes only the posts side.

### 9. Clean up legacy data (optional, destructive)

- Only when nobody plans to return to posts storage. It deletes the order post meta and turns order posts into
  placeholders.
- Backup: full, kept for the retention period. It is the last copy of the posts-side order data.
- Command: `wp wc hpos cleanup 1-50000`, then the next range, or `wp wc hpos cleanup all --batch-size=200`. Orders whose
  post looks newer are skipped with an error; compare them with `diff` before any `--force`.
- Check: `Orders subject to cleanup: 0` in `wp wc hpos status`, and the flow tests pass.
- Undo: rollback path C (a full backfill) or a restore.

## Rolling back to posts storage

Full steps: `references/cutover-and-rollback.md`. Each path starts with a full backup, since HPOS now holds the newest
data.

- A. Sync still on: confirm `Unsynced orders: 0`, then `wp wc hpos disable`. Leave compatibility mode on if a retry is
  planned.
- B. Sync off: `wp wc hpos compatibility-mode enable`, run `wp wc hpos sync`, wait for `Unsynced orders: 0`, `diff` the
  orders created while sync was off, then `wp wc hpos disable`.
- C. After cleanup: as B, but the backfill rebuilds every order's post data; budget the time of the first migration.
- D. Restore a backup: last resort. Orders placed after the backup must be reconciled from gateway and email records.

## After the switch: what to watch

Check these right after the switch and again after sync is turned off (`references/after-cutover.md`):

- Order search: the HPOS list has a search-type dropdown remembered per user, and extra searchable meta must use
  `woocommerce_order_table_search_query_meta_keys`, not `woocommerce_shop_order_search_fields`.
- Reports: before 11.1.0, legacy WooCommerce > Reports read `wp_posts` and miss HPOS-only orders once sync is off.
  Analytics reads its own lookup tables.
- Custom queries: `WP_Query`, `get_posts`, `get_post_meta` and `$wpdb` joins for orders see placeholders or stale data
  once sync is off. Exports, feeds and outside systems too.
- Admin customizations: the list and edit screens move to `admin.php?page=wc-orders`, with different screen IDs and
  hook names.
- Permissions: before 10.7.0, `edit_post` checks on HPOS orders could fail for Shop Managers once sync was off.

## Reference files

| File | Read it when |
| --- | --- |
| `references/cli-commands.md` | Before running any `wp wc hpos` command: exact names, flags, what writes, name traps |
| `references/sync-mechanics.md` | Before changing a setting, or when the sync looks stuck or the counts disagree |
| `references/compatibility-audit.md` | Step 1, and whenever a plugin, theme or snippet is in doubt |
| `references/verification.md` | Steps 3 to 8, and whenever the two storages disagree |
| `references/cutover-and-rollback.md` | Backups, steps 6 to 9, and every rollback |
| `references/after-cutover.md` | After the switch, after sync is turned off, and for bug reports that follow |
| `references/version-notes.md` | Step 0, and whenever the store runs something older than 11.1.2 |
| `scripts/hpos-readonly-report.sh` | State snapshot at any step (read-only) |
| `scripts/parity-checks.sql` | The SELECT queries the report runs; usable on their own after filling in the placeholders |
| `scripts/scan-code.sh` | Step 1, code audit of a wp-content folder (read-only) |

## Report format

End every session with this report, filled in from command output (never from memory):

```text
HPOS migration report: <site> (<date, UTC>)
WooCommerce: <version>   Multisite: <yes/no>   Orders: <count>
Storage: <posts|HPOS>   Compatibility mode: <on|off>   Unsynced orders: <n>   Subject to cleanup: <n>
Phase: <audit | rehearsal | syncing | verified | switched, soaking | sync off | cleaned up | rolled back>

Compatibility: <n> compatible, <n> incompatible, <n> uncertain; code scan: <n> components with findings
Open decisions: <component: decision needed>

Backups taken: <file or snapshot id, time, restore tested yes/no>
Commands run: <command, read or write, result>
Verification: status <...>; verify_data <ranges, exit codes>; diff <sample, result>; SQL <mismatches found>

Issues found: <issue, evidence, suggested fix>
Next step: <step, its backup, its check, its undo> (needs approval: yes/no)
```
