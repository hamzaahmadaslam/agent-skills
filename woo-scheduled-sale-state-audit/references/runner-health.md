# When the queue does not run, sales do not change

Read this for step 5 of the procedure. Since WooCommerce 10.1.0 every scheduled-sale change is an Action Scheduler
action, so a stalled queue freezes `_price`. Repairing the runner itself (a server cron, WP-CLI runners, hosting
variants) is the job of the `wp-cron-action-scheduler-health` skill in this collection; this file covers what a stalled
or failing queue does to sales. Action Scheduler links point at the 4.0.0 tag, WooCommerce links at 11.1.2.

## How the queue is started

- The WP-Cron event `action_scheduler_run_queue` on the `every_minute` schedule starts a runner
  ([ActionScheduler_QueueRunner.php L7-L9](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueRunner.php#L7-L9)).
  WP-Cron itself runs from page requests unless `DISABLE_WP_CRON` is set, in which case only a server cron, WP-CLI or
  admin page loads move it (the `wp-cron-action-scheduler-health` skill has the sources).
- Before 10.1.0, `woocommerce_scheduled_sales` was itself a WP-Cron event scheduled `daily`
  ([10.0.0 class-wc-install.php L898](https://github.com/woocommerce/woocommerce/blob/10.0.0/plugins/woocommerce/includes/class-wc-install.php#L898));
  from 10.1.0 it is an Action Scheduler action
  ([10.1.0 class-woocommerce.php L1403](https://github.com/woocommerce/woocommerce/blob/10.1.0/plugins/woocommerce/includes/class-woocommerce.php#L1403)),
  and the installer clears the old cron hook
  ([11.1.2 class-wc-install.php L1113-L1114](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L1113-L1114)).
  On 10.1.0 and later, `wp cron event list` should not show `woocommerce_scheduled_sales`; look in Action Scheduler.

## What a stalled or slow queue does to sales

| Queue state | Effect on sales | Check |
| --- | --- | --- |
| Not running at all | Per-product events stay pending after their time; `_price` never changes; the daily action does not run either | SQL "still pending after their time", "Queue health in one line" |
| Running late (a backlog, a runner every few minutes) | Sales start and end late by the delay; on 11.1.x the product page and cart are corrected by the reconciler, lists and sorting are not | `minutes_late` in the SQL block |
| Daily action fails or times out | The products it did not reach keep the wrong `_price`; on 10.5.0 to 11.1.x the churn of issue 66720 can leave products at an expired sale price when the run stops between its two loops | Rows for `woocommerce_scheduled_sales` by status; its log |
| Daily action failing five times in a row | Action Scheduler stops creating the next occurrence | below |

- A runner works in batches of 25 actions by default (filter `action_scheduler_queue_runner_batch_size`)
  ([ActionScheduler_QueueRunner.php L183](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueRunner.php#L183))
  and for a limited time per run (filter `action_scheduler_queue_runner_time_limit`)
  ([ActionScheduler_Abstract_QueueRunner.php L315-L326](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Abstract_QueueRunner.php#L315-L326)).
- An action still in progress after 300 seconds (filter `action_scheduler_failure_period`) is marked failed
  ([ActionScheduler_QueueCleaner.php L352-L376](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueCleaner.php#L352-L376)).
  A daily run over thousands of products can hit that; on 10.5.0 to 11.1.x each product it selects is saved twice
  ([scheduled-events.md](scheduled-events.md#the-known-faults-of-the-daily-queries-in-1112)).

## A recurring action that stops recurring

- When a recurring action fails and the most recent actions with the same hook, up to a threshold of 5 (filter
  `action_scheduler_recurring_action_failure_threshold`), all failed, Action Scheduler logs "This action appears to be
  consistently failing. A new instance will not be scheduled." and does not schedule the next one
  ([ActionScheduler_Abstract_QueueRunner.php L207-L247](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Abstract_QueueRunner.php#L207-L247)).
- WooCommerce re-registers its recurring actions, `woocommerce_scheduled_sales` among them, on
  `action_scheduler_ensure_recurring_actions`
  ([class-woocommerce.php L360](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-woocommerce.php#L360)).
  Action Scheduler fires that hook from its own daily action, first at 3 am site time, which it schedules on admin
  page loads and before each queue run
  ([ActionScheduler_RecurringActionScheduler.php L25-L83](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_RecurringActionScheduler.php#L25-L83)).
  A daily sales action that stopped comes back within a day while the queue runs, and fails again if its cause
  remains.
- [Issue 65854](https://github.com/woocommerce/woocommerce/issues/65854) (open) tracks enforcing the scheduled time of
  WooCommerce's recurring actions on existing stores.

## Reading the queue for this skill (read-only)

- `wp action-scheduler action list --hook=woocommerce_scheduled_sales --status=pending --per_page=0 --format=csv`
  and `wp action-scheduler action list --group=woocommerce-sales --status=pending --per_page=0 --format=count`.
  The command passes its options to `as_get_scheduled_actions()`
  ([List_Command.php L12-L26](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action/List_Command.php#L12-L26));
  `per_page` defaults to 5 and 0 removes the limit
  ([ActionScheduler_DBStore.php L448, L617-L620](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L617-L620)).
- `wp action-scheduler action logs <id>` prints an action's log entries, where a failure message or timeout shows
  ([Action_Command.php L276-L288](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action_Command.php#L276-L288)).
- The SQL blocks read `{prefix}actionscheduler_actions` and `{prefix}actionscheduler_groups`; the columns used are in
  the schema ([ActionScheduler_StoreSchema.php L60-L102](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/schema/ActionScheduler_StoreSchema.php#L60-L102)).
  Action args are stored as JSON, so a per-product event for product 123 has `args` = `{"product_id":123}`
  ([ActionScheduler_DBStore.php L110](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L110)).
