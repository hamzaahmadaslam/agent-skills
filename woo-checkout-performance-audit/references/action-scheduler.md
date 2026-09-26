# Action Scheduler and the checkout

Read this for step 5 of the procedure. WooCommerce 11.1.2 bundles Action Scheduler 4.0.0
([composer.json](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/composer.json)); another
plugin can load a newer copy, and the newest registered copy runs. Code links point at the Action Scheduler 4.0.0 tag
unless they say otherwise. Moving WP-Cron to a server cron is covered by the `wp-cron-action-scheduler-health` skill
in this collection; this file covers what the queue does to checkout.

## How the queue runs

| Item | Value | Source |
| --- | --- | --- |
| Trigger | WP-Cron event `action_scheduler_run_queue`, schedule `every_minute` | [ActionScheduler_QueueRunner.php L7-L9, L78-L104](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueRunner.php#L78-L104) |
| Extra trigger | On admin requests only, an async loopback request at `shutdown`, at most once per 60 seconds | [L138-L147](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueRunner.php#L138-L147) |
| Batch size | 25 actions, filter `action_scheduler_queue_runner_batch_size` | [L183](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueRunner.php#L183) |
| Concurrent batches | 1, filter `action_scheduler_queue_runner_concurrent_batches` | [ActionScheduler_Abstract_QueueRunner.php L297-L299](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Abstract_QueueRunner.php#L297-L299) |
| Time per run | 30 seconds, filter `action_scheduler_queue_runner_time_limit`; also stops at 90% of memory | [L315-L326](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Abstract_QueueRunner.php#L315-L326); [scaling guide](https://actionscheduler.org/perf/) |
| Stuck claims and actions | Claims older than 300 seconds are released; actions in progress for over 300 seconds are marked failed (filters `action_scheduler_timeout_period`, `action_scheduler_failure_period`) | [ActionScheduler_QueueCleaner.php L320-L376](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueCleaner.php#L320-L376); [QueueRunner L163-L194](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueRunner.php#L163-L194) |

- WP-Cron starts from page requests with a non-blocking loopback request to `wp-cron.php`
  ([WordPress 7.1.2 cron.php L899-L1002](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L899-L1002)).
  Since WordPress 6.9.0 that spawn happens at `shutdown`, because a request at `wp_loaded` could delay the page's first
  byte by up to a second ([cron.php L1005-L1032](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L1005-L1032)).
- With `DISABLE_WP_CRON` set, page requests start nothing
  ([cron.php L1048-L1054](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L1048-L1054)),
  so the queue moves only through a system cron that calls `wp-cron.php`
  ([plugin handbook](https://developer.wordpress.org/plugins/cron/hooking-wp-cron-into-the-system-task-scheduler/)),
  through WP-CLI, or through admin page loads.
- For large queues the Action Scheduler docs recommend WP-CLI over the WP-Cron runner
  ([WP-CLI](https://actionscheduler.org/wp-cli/)), and warn that raising concurrent batches can overload a site
  ([scaling guide](https://actionscheduler.org/perf/)).

## Why the queue matters to checkout

1. Checkout work waits in it. After the request, these run as actions:

   | Hook | What | Source |
   | --- | --- | --- |
   | `woocommerce_deliver_webhook_async` | Webhook deliveries | [wc-webhook-functions.php L16-L45](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-webhook-functions.php#L16-L45) |
   | `woocommerce_send_queued_transactional_email` | Emails, when deferred (10.8.0 and later) | [DeferredEmailQueue.php L24-L29](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Email/DeferredEmailQueue.php#L24-L29) |
   | `wc-admin_import_orders` | Analytics import per order, in "Immediately" mode | [ImportScheduler.php L93-L97](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/Schedulers/ImportScheduler.php#L93-L97); [OrdersScheduler.php L30, L352-L363](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/Schedulers/OrdersScheduler.php#L352-L363) |
   | `wc-admin_process_pending_orders_batch` | Analytics import batch, in "Scheduled" mode | [OrdersScheduler.php L181](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/Schedulers/OrdersScheduler.php#L181) |
   | `woocommerce_cleanup_sessions` | Expired session removal, every 12 hours | [class-woocommerce.php L1777](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-woocommerce.php#L1777) |
   | `woocommerce_cancel_unpaid_orders` | Cancels unpaid orders after the hold stock time, which frees their reserved stock | [class-woocommerce.php L1746-L1758](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-woocommerce.php#L1746-L1758) |
   | `woocommerce_cleanup_draft_orders` | Deletes `checkout-draft` orders not changed for a day, 20 per batch | [DraftOrders.php L20, L79-L87, L179-L216](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Blocks/Domain/Services/DraftOrders.php#L179-L216) |
   | `wc_run_batch_process` | WooCommerce batch processors, among them the deletion of place-order debug logs | [wc-order-step-logger-functions.php L96-L107](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-step-logger-functions.php#L96-L107) |

   A stalled queue shows up at checkout as late emails and webhooks, a growing sessions table, piles of draft orders,
   and stock held by unpaid orders that are never cancelled.
2. Runners compete with shoppers. A runner is a PHP request that works for up to 30 seconds per run, using a PHP worker
   and database connections that checkouts also need. A large backlog keeps a runner busy continuously.
3. Scheduling costs a write. Each action scheduled during a checkout inserts a row into the actions table and an
   "action created" log row
   ([ActionScheduler_Logger.php L84, L99-L101](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Logger.php#L99-L101)),
   so the size and indexes of `{prefix}actionscheduler_actions` and `{prefix}actionscheduler_logs` matter
   ([schema L60-L86](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/schema/ActionScheduler_StoreSchema.php#L60-L86);
   [logs schema L51-L59](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/schema/ActionScheduler_LoggerSchema.php#L51-L59)).

## Retention and cleanup

- Completed and cancelled actions are deleted once their last attempt (`last_attempt_gmt`, set when a runner claims,
  runs, fails or completes the action) is more than 31 days old, not 31 days after their scheduled date (filter
  `action_scheduler_retention_period`, value in seconds; the cleaner's "modified" date is `last_attempt_gmt`,
  [DBStore L557-L562](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L557-L562));
  since 4.0.0 failed actions are deleted after 3 times that
  (filter `action_scheduler_retention_period_for_failed`, switch `action_scheduler_enable_failed_action_cleanup`)
  ([ActionScheduler_QueueCleaner.php L39-L50, L106-L177](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueCleaner.php#L106-L177);
  [4.0.0 changelog](https://github.com/woocommerce/action-scheduler/blob/4.0.0/changelog.txt)).
- Since 4.0.0 the cleanup is its own daily action, `action_scheduler_run_actions_cleanup_hook`, at 3 am site time
  ([L85-L98](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueCleaner.php#L85-L98)).
  It needs a running queue like everything else.

## Past-due actions

- Administrators see "past-due actions found; something may be wrong" when at least 1 pending action is more than
  1 day past its date (filters `action_scheduler_pastdue_actions_seconds`, `action_scheduler_pastdue_actions_min`)
  ([ActionScheduler_AdminView.php L142-L241](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_AdminView.php#L164-L241)).
- The FAQ calls a few past-due actions normal and several over a day old a sign of trouble
  ([FAQ](https://actionscheduler.org/faq/)).

## Reading the queue (read-only)

- `wp action-scheduler status`: data store, runner, version, and for each status the count and the oldest and newest
  date ([System_Command.php L61-L88](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/System_Command.php#L61-L88)).
  The command arrived in Action Scheduler 3.9.1, bundled from WooCommerce 9.8.0 (3.9.2)
  ([WooCommerce 9.8.0 composer.json](https://github.com/woocommerce/woocommerce/blob/9.8.0/plugins/woocommerce/composer.json)).
- `wp action-scheduler action list --hook=<hook> --status=pending --per_page=0 --format=count` passes its options to
  `as_get_scheduled_actions()` ([Action_Command.php L215-L269](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action_Command.php#L215-L269)).
  Keep `--per_page=0`: `per_page` defaults to 5 and `--format=count` counts the rows returned, so without it the
  count never goes above 5
  ([DBStore L436-L452](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L436-L452)).
- `wp action-scheduler version` shows which copy is active
  ([WP-CLI commands](https://actionscheduler.org/wp-cli/)).
- The Action Scheduler blocks of `scripts/checkout-checks.sql`: counts by status, past-due over 1 hour and 1 day,
  pending by hook, failures in the last 7 days, the checkout-related hooks above, completions per hour, open claims,
  log rows.

| Result | Meaning | Next |
| --- | --- | --- |
| Past-due pending rising, completions per hour flat or zero | Runner not running or not keeping up | Check `DISABLE_WP_CRON` and the system cron; the `wp-cron-action-scheduler-health` skill |
| Thousands of pending `wc-admin_import_orders` | Analytics in "Immediately" mode on a busy store | Consider "Scheduled" ([changes-and-rollback.md](changes-and-rollback.md#analytics-import-mode)) |
| Many failures of one hook | That callback errors | Read its log entries: `wp action-scheduler action logs <id>` |
| Complete or cancelled actions older than 31 days in bulk | Cleanup not running, or retention raised by a filter | Rows for `action_scheduler_run_actions_cleanup_hook`; callbacks on the retention filters |
| Open claims older than a few minutes | Runners dying mid-batch (time or memory limits) | PHP error log, `max_execution_time`, memory |
| Pending `woocommerce_deliver_webhook_async` backlog | Webhook endpoint slow or failing | Webhook failure counts in the SQL report |
