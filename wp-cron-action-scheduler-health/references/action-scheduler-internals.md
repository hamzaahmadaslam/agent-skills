# How Action Scheduler runs

Read this for steps 3 and 4 of the procedure. WooCommerce 11.1.2 bundles Action Scheduler 4.0.0
([composer.json L56](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/composer.json#L56));
the latest release is 4.2.0 (2026-09-16), and WooCommerce 11.2.0-beta.1 bundles 4.1.0
([composer.json L56](https://github.com/woocommerce/woocommerce/blob/11.2.0-beta.1/plugins/woocommerce/composer.json#L56)).
When several plugins bundle copies, the newest registered version runs
([FAQ](https://actionscheduler.org/faq/)); `wp action-scheduler version --all` and `wp action-scheduler source --all`
show which ([System_Command.php L102-L194](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/System_Command.php#L102-L194)).
Code links point at the 4.0.0 tag unless they say otherwise; `version-notes.md` lists what 4.1.0 and 4.2.0 change.

## Tables and statuses

- Four tables per site: `{prefix}actionscheduler_actions`, `_claims`, `_groups` and `_logs`
  ([StoreSchema L11-L102](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/schema/ActionScheduler_StoreSchema.php#L11-L102);
  [LoggerSchema L51-L59](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/schema/ActionScheduler_LoggerSchema.php#L51-L59)).
- Statuses: `pending`, `in-progress`, `complete`, `failed`, `canceled`
  ([ActionScheduler_Store.php L9-L13](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Store.php#L9-L13)).
  "Past-due" is not a status: the admin screen's Past-due view is pending actions whose date has passed
  ([ListTable L607-L611](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_ListTable.php#L607-L611)).
- `last_attempt_gmt` changes when a runner claims, runs, fails or completes an action; `attempts` counts runs;
  `priority` runs 0 to 255, lower first, default 10; `args` holds the JSON arguments, or their MD5 with the full text
  in `extended_args` when longer than 191 characters
  ([StoreSchema L61-L86](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/schema/ActionScheduler_StoreSchema.php#L61-L86);
  [DBStore L94-L140](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L94-L140)).
- Tables are created and altered through `dbDelta()` on the first request after the stored schema version falls behind
  the code's ([Abstract_Schema L49-L155](https://github.com/woocommerce/action-scheduler/blob/4.2.0/classes/abstracts/ActionScheduler_Abstract_Schema.php#L49-L155)).
  4.2.0 raises the actions table's schema version from 8 to 9 and adds a `unique_key` column with a unique index
  ([4.2.0 StoreSchema L23, L76-L78](https://github.com/woocommerce/action-scheduler/blob/4.2.0/classes/schema/ActionScheduler_StoreSchema.php#L76-L78)).

## What starts the queue

| Runner | When it runs | Context in the log | Limits | Source |
| --- | --- | --- | --- | --- |
| WP-Cron event `action_scheduler_run_queue` | Schedule `every_minute` (60 s), filter `action_scheduler_run_schedule` | WP Cron | Batches of 25; stops before 30 s or at 90% of memory; waits while the concurrency limit is reached | [QueueRunner L7-L9, L78-L104, L163-L194, L277-L284](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueRunner.php#L78-L104) |
| Async request | At `shutdown` of an admin request, at most once per 60 s, only while due actions exist and no batch runs; after its queue it sleeps 5 s and dispatches the next request | Async Request | Same as above | [QueueRunner L106-L147](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueRunner.php#L106-L147); [AsyncRequest_QueueRunner L47-L92](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_AsyncRequest_QueueRunner.php#L47-L92) |
| `wp action-scheduler run` | When a person or a cron job runs it | WP CLI | Batches of 100, all batches until the queue is empty unless `--batches`, no time limit; stops with an error when the concurrency limit is reached unless `--force` | [Scheduler_command L38-L128](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/ActionScheduler_WPCLI_Scheduler_command.php#L38-L128); [WPCLI_QueueRunner L71-L153](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/ActionScheduler_WPCLI_QueueRunner.php#L71-L153) |
| `wp action-scheduler action run <id>` | By hand | Action Scheduler CLI | Pending actions only | [Run_Command L53-L68](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action/Run_Command.php#L53-L68) |
| "Run" link on the admin screen | By hand | Admin List Table | Pending actions only | [ListTable L573](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_ListTable.php#L573) |

- The FAQ: "By default, Action Scheduler is initiated by WP-Cron (and the 'shutdown' hook on admin requests).
  However, it has no dependency on the WP-Cron system" ([FAQ](https://actionscheduler.org/faq/)).
- `admin-ajax.php` defines `WP_ADMIN`, so Ajax requests count as admin requests
  ([admin-ajax.php L16-L18](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/admin-ajax.php#L16-L18);
  [load.php L1356-L1364](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/load.php#L1356-L1364)).
  Open admin screens send Heartbeat requests to `admin-ajax.php` every 15 to 120 seconds
  ([Heartbeat API](https://developer.wordpress.org/plugins/javascript/heartbeat-api/)). A queue that moves only while
  someone has the admin open is running on the async runner alone.
- The async runner posts to `admin-ajax.php?action=as_async_request_queue_runner&nonce=...`, non-blocking with a
  0.01 s timeout and the current visitor's cookies
  ([WP_Async_Request.php L87-L161](https://github.com/woocommerce/action-scheduler/blob/4.0.0/lib/WP_Async_Request.php#L87-L161)).
  It is a loopback request with the same reachability needs as WP-Cron's. The filter
  `action_scheduler_allow_async_request_runner` turns it off
  ([AsyncRequest_QueueRunner L76-L85](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_AsyncRequest_QueueRunner.php#L76-L85));
  `as_async_request_queue_runner_post_args` changes its request, for example to set a User-Agent that names Action
  Scheduler in access logs ([FAQ](https://actionscheduler.org/faq/)).
- The async runner's rate limit is an option lock, `action_scheduler_lock_async-request-runner`, holding
  `uniqid|expiry` for 60 seconds (filter `action_scheduler_lock_duration`)
  ([OptionLock L27-L135](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_OptionLock.php#L27-L135);
  [Lock L22, L58-L60](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Lock.php#L58-L60)).
  4.1.0 fixed "an oversight in the lock implementation ... that could leave a lock permanently stuck"
  ([changelog](https://github.com/woocommerce/action-scheduler/blob/4.2.0/changelog.txt)): in 4.0.0 a lock row with an
  empty value makes every later attempt insert a row with the same `option_name`, which the options table rejects as
  a duplicate of its unique key ([4.0.0 OptionLock L35-L44](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_OptionLock.php#L35-L44);
  [schema.php L147](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L143-L148)).
  The SQL report shows the lock rows.

## Claims and concurrency

- A runner claims up to its batch size of pending, unclaimed, due actions in one statement, ordered by priority,
  attempts, scheduled date and ID (filter `action_scheduler_claim_actions_order_by`), and sets their `claim_id` and
  `last_attempt_gmt` ([DBStore L934-L1036](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L934-L1036)).
  The claim query uses `SKIP LOCKED` on MySQL 8.0.1 and later and MariaDB 10.6.0 and later
  ([DBStore L1039-L1073](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L1039-L1073)).
- The concurrency count is the number of claims that still hold pending or in-progress actions
  ([DBStore L1080-L1097](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L1080-L1097));
  the limit is 1, filter `action_scheduler_queue_runner_concurrent_batches`
  ([Abstract_QueueRunner L297-L308](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Abstract_QueueRunner.php#L297-L308)).
  At the limit, the WP-Cron and async runners do nothing, and the WP-CLI runner stops with "There are too many
  concurrent batches." unless `--force` ([WPCLI_QueueRunner L86-L93](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/ActionScheduler_WPCLI_QueueRunner.php#L86-L93)).
- A runner re-checks its claim before each action and stops the batch if it lost it
  ([QueueRunner L213-L217](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueRunner.php#L207-L230)).
  After the batch, the pending actions left in the claim are released and the claim row deleted
  ([DBStore L1158-L1199](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L1158-L1199)).
- At the start of each run the cleaner releases pending actions claimed more than `action_scheduler_timeout_period`
  seconds ago ("action reset") and marks in-progress actions older than `action_scheduler_failure_period` as failed.
  Inside a run both are 10 times the time limit, 300 seconds by default, and each pass handles 20 actions
  (`action_scheduler_cleanup_batch_size`)
  ([QueueRunner L163-L179](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueRunner.php#L163-L179);
  [QueueCleaner L320-L401](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueCleaner.php#L320-L401)).
  An action that really takes longer than 300 seconds is marked failed while it still runs. Stale claims clear only
  when some runner starts.

## Running one action

| Outcome | Log message (English sites) | Source |
| --- | --- | --- |
| Not pending when its turn comes | action ignored via `<context>` | [Abstract_QueueRunner L92-L96](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Abstract_QueueRunner.php#L63-L128); [Logger L202-L209](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Logger.php#L202-L209) |
| Data cannot be read (4.0.0 and later) | cancelled, "This action data appears to be corrupt..." | [Abstract_QueueRunner L100-L105, L155-L166](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Abstract_QueueRunner.php#L155-L166) |
| No callback on the hook | failed: "Scheduled action for `<hook>` will not be executed as no callbacks are registered." | [ActionScheduler_Action.php L73-L87](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/actions/ActionScheduler_Action.php#L73-L87) |
| Exception or PHP error in the callback | failed: "action failed via `<context>`: `<message>`" | [Abstract_QueueRunner L113-L120, L178-L199](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Abstract_QueueRunner.php#L178-L199); [Logger L152-L160](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Logger.php#L152-L160) |
| PHP fatal error | failed: "unexpected shutdown: PHP Fatal error ..." | [Logger L180-L185](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Logger.php#L180-L185) |
| In progress longer than the failure period | failed: "action was in-progress for at least 300 seconds without completing and has been marked as failed..." | [Logger L169-L172](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Logger.php#L169-L172) |
| Completed | action complete via `<context>` | [Logger L135-L142](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Logger.php#L135-L142) |

- Log messages are translated, so they are stored in the site's language
  ([Logger L99-L238](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Logger.php#L99-L238)).
  The context names (WP Cron, Async Request, WP CLI) are not.
- Failed actions are not retried. Only pending actions can be run by hand, so a failed action is repeated by creating a
  new one ([action-scheduler-wp-cli.md](action-scheduler-wp-cli.md)).
- A recurring action schedules its next instance after each run. When the last 5 actions of its hook all failed
  (filter `action_scheduler_recurring_action_failure_threshold`), no new instance is created and the log says "This
  action appears to be consistently failing. A new instance will not be scheduled."
  ([Abstract_QueueRunner L207-L281](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Abstract_QueueRunner.php#L207-L281)).
  Since 3.9.3, plugins can re-create lost recurring actions on the daily `action_scheduler_ensure_recurring_actions`
  hook ([Usage](https://actionscheduler.org/usage/);
  [RecurringActionScheduler L18-L83](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_RecurringActionScheduler.php#L18-L83)).

## Unique actions and duplicates

- With `$unique = true`, no action is created while a pending or in-progress action with the same hook and group
  exists, and since 4.0.0 the same arguments too; the function returns 0
  ([DBStore L185-L219](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L185-L219);
  [What's changing in 4.0.0](https://developer.woocommerce.com/2026/06/17/changes-to-action-scheduler/)).
- Up to 4.1.0 the check is a sub-query inside the insert without a unique index; 4.2.0 "Enforce[s] unique action
  inserts atomically" with the `unique_key` index
  ([changelog](https://github.com/woocommerce/action-scheduler/blob/4.2.0/changelog.txt);
  [4.2.0 DBStore L255-L270, L361-L376](https://github.com/woocommerce/action-scheduler/blob/4.2.0/classes/data-stores/ActionScheduler_DBStore.php#L361-L376)).
- Without `$unique`, code that schedules on every request without checking `as_has_scheduled_action()` (3.3.0) creates
  a new action each time; the usage guide checks before scheduling
  ([Usage](https://actionscheduler.org/usage/);
  [functions.php L385-L399](https://github.com/woocommerce/action-scheduler/blob/4.0.0/functions.php#L385-L399)).
- Two runners never run the same action at once: claims are exclusive, and a runner that lost its claim stops. Running
  more runners in parallel can still run related actions out of order; the WP-CLI page warns about `--hooks` and
  `--group` splitting actions that depend on each other ([WP-CLI](https://actionscheduler.org/wp-cli/)).

## Housekeeping actions (group `ActionScheduler`)

| Hook | When | Source |
| --- | --- | --- |
| `action_scheduler_run_recurring_actions_schedule_hook` | Daily at 3 am site time, priority 20; fires `action_scheduler_ensure_recurring_actions` | [RecurringActionScheduler L18, L39-L83](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_RecurringActionScheduler.php#L39-L83) |
| `action_scheduler_run_actions_cleanup_hook` | Daily at 3 am site time, priority 0 (4.0.0 and later) | [QueueCleaner L12, L71-L98](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueCleaner.php#L71-L98) |
| `action_scheduler_continue_actions_cleanup_hook` | Right away, while a cleanup has more to delete | [QueueCleaner L19, L250-L255](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueCleaner.php#L250-L255) |
| `action_scheduler_clear_deleted_action_logs_hook` | When a deleted action had more than 4,000 log rows | [DBLogger L123-L150](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBLogger.php#L123-L150) |

## Retention and cleanup (4.0.0 and later)

- `complete` and `canceled` actions are deleted once their `last_attempt_gmt` is more than 31 days old, filter
  `action_scheduler_retention_period` in seconds
  ([QueueCleaner L40-L113, L231-L243](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueCleaner.php#L106-L177);
  the cleaner's "modified" date is `last_attempt_gmt`,
  [DBStore L557-L562](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L557-L562)).
  Cancelling changes only the status, not `last_attempt_gmt`
  ([DBStore L689-L709](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L689-L709)).
- `failed` actions are deleted after 3 times that, 93 days (filter `action_scheduler_retention_period_for_failed`),
  unless `action_scheduler_enable_failed_action_cleanup` returns false; the statuses come from
  `action_scheduler_default_cleaner_statuses` ([QueueCleaner L115-L169](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueCleaner.php#L115-L169)).
  The 4.0.0 announcement: "failed actions are now removed once they are older than 3 months"
  ([What's changing in 4.0.0](https://developer.woocommerce.com/2026/06/17/changes-to-action-scheduler/)).
- The daily job deletes at least 250 per status per run and schedules a continuation while a full batch was found
  ([QueueCleaner L191-L258](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueCleaner.php#L191-L258)).
  It is an action like any other, so it waits when the queue does.
- Log rows are deleted with their action, up to 4,000 at once and the rest in follow-up actions
  ([DBLogger L105-L150](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBLogger.php#L105-L150)),
  triggered by `action_scheduler_deleted_action`, which only the store's own delete fires
  ([DBStore L797-L810](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L797-L810)).
  Rows deleted from the actions table with SQL leave their logs behind.
- Before 4.0.0, cleanup ran inside each queue run in small slices and failed actions were kept
  ([What's changing in 4.0.0](https://developer.woocommerce.com/2026/06/17/changes-to-action-scheduler/)).
- Leftovers from before 3.0: actions stored as posts of type `scheduled-action` and logs as comments of type
  `action_log` ([FAQ](https://actionscheduler.org/faq/);
  [wpPostStore L7](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_wpPostStore.php#L7)).
  After the migration, the comment logs are deleted six months later by `action_scheduler/cleanup_wp_comment_logs`
  ([WPCommentCleaner L64-L85](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_WPCommentCleaner.php#L64-L85)).

## The past-due notice

- Users who can `manage_options` see "Action Scheduler: N past-due actions found; something may be wrong." when at
  least 1 pending action is more than 1 day past its date (filters `action_scheduler_pastdue_actions_seconds` and
  `action_scheduler_pastdue_actions_min`). After a check that finds nothing, the next check waits a quarter of the
  threshold, 6 hours ([AdminView L142-L241](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_AdminView.php#L142-L241)).
- In 4.1.0 the notice prints `%1$d` instead of the number
  ([4.1.0 AdminView L215-L238](https://github.com/woocommerce/action-scheduler/blob/4.1.0/classes/ActionScheduler_AdminView.php#L215-L238));
  4.2.0 fixed it ([changelog](https://github.com/woocommerce/action-scheduler/blob/4.2.0/changelog.txt)).
- The FAQ: "it is normal to have some past-due actions. If there are several past-due actions more than one day old,
  there may be something wrong with your site" ([FAQ](https://actionscheduler.org/faq/#my-site-has-past-due-actions-what-can-i-do)).
- The actions are listed under Tools > Scheduled Actions, and WooCommerce > Status > Scheduled Actions when WooCommerce
  is installed ([Admin](https://actionscheduler.org/admin/)).

## Execution limits of the WP-Cron and async runners

- Time: 30 seconds, filter `action_scheduler_queue_runner_time_limit`. A run stops when, at the average time per
  action so far, 3 more actions would pass the limit
  ([Abstract_QueueRunner L315-L368](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Abstract_QueueRunner.php#L315-L368)).
  On Pantheon it counts CPU time instead (filter `action_scheduler_use_cpu_execution_time`, on when
  `PANTHEON_ENVIRONMENT` is defined).
- Memory: a run stops at 90% of `memory_limit`; -1 counts as 32 GB
  ([L377-L408](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Abstract_QueueRunner.php#L377-L408)).
- Batch: 25 actions, filter `action_scheduler_queue_runner_batch_size`
  ([QueueRunner L183](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueRunner.php#L181-L190)).
  After each batch the runner flushes the runtime object cache
  ([L238-L269](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueRunner.php#L238-L269)).
- The scaling guide sums it up: processing stops at "90% of available memory", when "processing another 3 actions would
  exceed 30 seconds", and runs "in a single concurrent queue" ([Scaling](https://actionscheduler.org/perf/)).

## WooCommerce's own actions

- "WooCommerce 10.1 ... migration of all WooCommerce cron jobs to the Action Scheduler system"
  ([advisory](https://developer.woocommerce.com/2025/08/08/developer-advisory-changes-to-session-management-and-cron-jobs-in-woocommerce-10-1/)).
- In 11.1.2 these are re-created daily through `action_scheduler_ensure_recurring_actions`, all in group
  `woocommerce` and unique ([class-woocommerce.php L360, L1726-L1790](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-woocommerce.php#L1726-L1790)):

  | Hook | Interval |
  | --- | --- |
  | `woocommerce_scheduled_sales` | Daily, midnight site time: sale prices start and end |
  | `woocommerce_cancel_unpaid_orders` | Single action after the hold-stock minutes |
  | `woocommerce_cleanup_personal_data` | Daily |
  | `woocommerce_cleanup_logs` | Daily, 3 am |
  | `woocommerce_cleanup_sessions` | Every 12 hours from 6 am |
  | `woocommerce_geoip_updater` | Every 15 days |
  | `woocommerce_cleanup_rate_limits_wrapper`, `wc_admin_daily_wrapper` | Daily, 3 am |

- A stalled queue therefore means sale prices that do not change on time, unpaid orders that keep their stock, and
  sessions and logs that are not cleaned. The checkout's own actions are in the `woo-checkout-performance-audit` skill.
- WooCommerce > Status shows "WordPress cron" as off whenever `DISABLE_WP_CRON` is true, even with a working server
  cron: the row reports the constant only
  ([system status controller L1016](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-system-status-v2-controller.php#L1016);
  [status report L199-L208](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/views/html-admin-page-status-report.php#L199-L208)).

## Multisite

The FAQ: Action Scheduler "is designed to manage the scheduled actions on a single site. It has no special handling for
running queues across multiple sites in a multisite network" ([FAQ](https://actionscheduler.org/faq/)). Each site has
its own tables and its own `action_scheduler_run_queue` event; see [multisite.md](multisite.md).
