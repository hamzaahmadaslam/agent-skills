# What changed by release

Read the site's versions first (the report prints them) and apply the rows at or below them. Versions checked on
2026-09-26: WordPress 7.1.2 (released 2026-09-22, [releases](https://wordpress.org/download/releases/)), WP-CLI 2.12.0
([releases](https://github.com/wp-cli/wp-cli/releases)), cron-command 2.3.2 in that bundle and 3.0.0 as the newest tag
([releases](https://github.com/wp-cli/cron-command/releases)), Action Scheduler 4.2.0 as the newest release and 4.0.0
inside WooCommerce 11.1.2 ([releases](https://github.com/woocommerce/action-scheduler/releases)), WooCommerce 11.1.2
(released 2026-09-22, [release](https://github.com/woocommerce/woocommerce/releases/tag/11.1.2)).

## WordPress

| Release | Change | Source |
| --- | --- | --- |
| 5.1.0 | The `pre_*` filters that let plugins store events elsewhere; `wp_get_ready_cron_jobs()`; scheduling functions return success or failure | [cron.php](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L85-L100) (`@since` tags) |
| 5.2.0, 5.3.0 | Site Health's scheduled events test, then its "late" result | [class-wp-site-health.php L1663, L3158](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L3151-L3162) |
| 5.4.0 | The `weekly` schedule | [cron.php L1119-L1120](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L1119-L1120) |
| 5.7.0 | `$wp_error` parameters; the spawn logic moves to `_wp_cron()` | [cron.php L1014-L1018, L1042](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L1014-L1018) |
| 6.1.0 | `wp-cron.php` logs failed reschedules and unschedules and fires `cron_reschedule_event_error` and `cron_unschedule_event_error` | [wp-cron.php L143-L152, L170-L179](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-cron.php#L143-L179) |
| 6.8.0 | The `wp_next_scheduled` filter | [cron.php L866-L887](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L866-L887) |
| 6.9.0 | The spawn moves from `wp_loaded` to `shutdown` (not with `ALTERNATE_WP_CRON`) | [cron.php L1004-L1032](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L1004-L1032) |

Before 6.9.0 a spawn could delay a page's first byte, the reason given for the move
([cron.php L1007-L1012](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L1004-L1018)).

## WP-CLI cron-command

| Release | Change | Source |
| --- | --- | --- |
| 2.2.2 (2023-05-25) | `--exclude=<hooks>` for `wp cron event run` | [releases](https://github.com/wp-cli/cron-command/releases/tag/v2.2.2) |
| 2.3.0 (2024-05-04) | `--all` for `wp cron event delete` | [releases](https://github.com/wp-cli/cron-command/releases/tag/v2.3.0) |
| 2.3.2 (2025-04-29) | The version inside WP-CLI 2.12.0: `--due-now` without a lock, no `--network` | [bundle composer.lock](https://github.com/wp-cli/wp-cli-bundle/blob/v2.12.0/composer.lock#L1882-L1883) |
| 2.3.4 (2026-02-15) | Debug lines for each event's start and arguments | [releases](https://github.com/wp-cli/cron-command/releases/tag/v2.3.4) |
| 2.3.5 (2026-03-19) | `--due-now` respects `doing_cron`; `--network`; `actions` field in `event list`; `--match-args` for `event delete` | [releases](https://github.com/wp-cli/cron-command/releases/tag/v2.3.5) |
| 3.0.0 (2026-08-04) | Requires WP-CLI 3.0; no behaviour change listed | [releases](https://github.com/wp-cli/cron-command/releases/tag/v3.0.0) |

## Action Scheduler

| Release | Change | Source |
| --- | --- | --- |
| 3.3.0 (2021-09-15) | `as_has_scheduled_action()` | [changelog](https://github.com/woocommerce/action-scheduler/blob/4.2.0/changelog.txt) |
| 3.5.0 (2022-08-25) | Unique actions | same |
| 3.6.0 (2023-05-10) | `$unique` in the function signatures; action priorities | same |
| 3.9.1 (2025-01-21) | New WP-CLI commands, among them `status`, `source` and `action` | same |
| 3.9.3 (2025-07-15) | The `action_scheduler_ensure_recurring_actions` hook; `SKIP LOCKED` when claiming; claims released only on pending actions | same |
| 4.0.0 (2026-06-16) | Failed actions purged after 3 months; unique actions compare arguments; cleanup as a daily action at 3 am; corrupted actions cancelled; requires WordPress 6.8 | same; [announcement](https://developer.woocommerce.com/2026/06/17/changes-to-action-scheduler/) |
| 4.1.0 (2026-08-05) | Fix for an async runner lock that could stay stuck; `clean --before` defaults to 31 days ago; the option lock uses the object cache; the past-due notice prints `%1$d` instead of the count | same; [4.1.0 AdminView L215-L238](https://github.com/woocommerce/action-scheduler/blob/4.1.0/classes/ActionScheduler_AdminView.php#L215-L238) |
| 4.2.0 (2026-09-16) | Unique inserts enforced by a `unique_key` column and index (schema 9); stale unique keys released by the daily cleanup; past-due notice fixed | same |

## WooCommerce

| Release | Change | Source |
| --- | --- | --- |
| 9.8.0 (2025-04-07) | Bundles Action Scheduler 3.9.2, the first with `wp action-scheduler status` | [composer.json](https://github.com/woocommerce/woocommerce/blob/9.8.0/plugins/woocommerce/composer.json) |
| 10.1.0 (2025-08-12) | All WooCommerce cron jobs move to Action Scheduler; bundles 3.9.3 | [advisory](https://developer.woocommerce.com/2025/08/08/developer-advisory-changes-to-session-management-and-cron-jobs-in-woocommerce-10-1/); [composer.json](https://github.com/woocommerce/woocommerce/blob/10.1.0/plugins/woocommerce/composer.json) |
| 11.0.0 (2026-08-04) | Bundles Action Scheduler 4.0.0 | [composer.json](https://github.com/woocommerce/woocommerce/blob/11.0.0/plugins/woocommerce/composer.json) |
| 11.1.2 (2026-09-22) | Current release; still bundles 4.0.0 | [composer.json L56](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/composer.json#L56) |
| 11.2.0-beta.1 (2026-09-21) | Bundles 4.1.0 | [composer.json L56](https://github.com/woocommerce/woocommerce/blob/11.2.0-beta.1/plugins/woocommerce/composer.json#L56) |

## What this means on older or newer sites

- Before WooCommerce 10.1.0, WooCommerce's cleanups are WP-Cron events: look for them in `wp cron event list`, not in
  the Action Scheduler tables.
- Before Action Scheduler 3.9.1 the `status` and `action` commands are missing; use the SQL report.
- Before 4.0.0, old actions are cleaned inside queue runs 20 at a time and failed actions are kept; a big table there
  is normal growth, not a stalled daily job.
- On 4.0.0 (WooCommerce 11.0.0 to 11.1.2), always pass `--before` to `wp action-scheduler clean`, and check the async
  runner's lock rows when admin activity no longer moves the queue.
- On 4.1.0 the past-due notice shows `%1$d`; count with the SQL report.
- Before WordPress 6.9.0, a spawn happens at `wp_loaded` and can add up to about a second to the first byte of the
  page that triggers it; a server cron removes that too.

## Documentation that disagrees with the code

- WooCommerce's "Scheduled actions" document describes storage in a `scheduled-action` post type, batches of 20, up to
  five queues and the hook `action_scheduler_run_schedule`
  ([woocommerce.com](https://woocommerce.com/document/understanding-the-woocommerce-system-status-report/scheduled-actions/)).
  The 4.0.0 code uses its own tables, batches of 25, one batch at a time and the WP-Cron hook
  `action_scheduler_run_queue`; `action_scheduler_run_schedule` is the filter for that event's schedule
  ([action-scheduler-internals.md](action-scheduler-internals.md#what-starts-the-queue)).
- The Action Scheduler WP-CLI page lists `datastore` (the code's command is `data-store`) and says `clean --before`
  "Defaults to 31 days", which 4.0.0 does not do ([action-scheduler-wp-cli.md](action-scheduler-wp-cli.md)).
- The docblocks of `as_enqueue_async_action()` and the scheduling functions still say a unique action matches "the same
  hook and group"; since 4.0.0 the arguments count too
  ([functions.php L8-L18](https://github.com/woocommerce/action-scheduler/blob/4.2.0/functions.php#L8-L18);
  [announcement](https://developer.woocommerce.com/2026/06/17/changes-to-action-scheduler/)).
- The plugin handbook's introduction says due tasks "will be called during that page load"
  ([Cron](https://developer.wordpress.org/plugins/cron/#what-is-wp-cron)); the code starts them in a separate
  loopback request to `wp-cron.php` ([wp-cron-internals.md](wp-cron-internals.md#how-a-page-view-starts-a-run)).
