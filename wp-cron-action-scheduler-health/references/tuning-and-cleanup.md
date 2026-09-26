# Tuning the queue and cleaning up

Read this after the runner works (steps 6 and 7). Tuning a queue that has no working runner only hides the cause.
Every change here has its backup, check and undo in [changes-and-rollback.md](changes-and-rollback.md). Code links
point at Action Scheduler 4.0.0.

## Filters, their defaults and when to change them

| Filter | Default | Change it when | What it costs | Source |
| --- | --- | --- | --- | --- |
| `action_scheduler_queue_runner_batch_size` | 25 | Actions take milliseconds, so claiming is a large share of the work | A bigger claim holds more actions at once | [QueueRunner L183](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueRunner.php#L181-L190); [Scaling](https://actionscheduler.org/perf/) |
| `action_scheduler_queue_runner_time_limit` | 30 seconds | The host allows longer requests; the scaling guide lists 60 s on WP Engine and 120 s on Pantheon and SiteGround | A run the host kills leaves claims and in-progress actions for the cleaner | [Abstract_QueueRunner L315-L326](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Abstract_QueueRunner.php#L315-L326); [Scaling](https://actionscheduler.org/perf/) |
| `action_scheduler_queue_runner_concurrent_batches` | 1 | PHP workers and the database have measured headroom | "can substantially increase server load and take down a site" | [L297-L308](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Abstract_QueueRunner.php#L297-L308); [Scaling](https://actionscheduler.org/perf/) |
| `action_scheduler_timeout_period`, `action_scheduler_failure_period` | 300 seconds inside a run | Some actions really run longer than 5 minutes | Dead runs are noticed later | [QueueCleaner L320-L376](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueCleaner.php#L320-L376) |
| `action_scheduler_cleanup_batch_size` | 20 (the daily job deletes at least 250) | The daily cleanup does not keep up | Longer delete statements | [L394-L401](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueCleaner.php#L394-L401); [4.0.0 post](https://developer.woocommerce.com/2026/06/17/changes-to-action-scheduler/) |
| `action_scheduler_retention_period` | 31 days | Data retention rules, or a table that is too big | Less history to debug with | [L106-L113](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueCleaner.php#L106-L113) |
| `action_scheduler_retention_period_for_failed` | 93 days | Retention rules; the 4.0.0 post suggests matching an accounting cycle | As above | [L115-L122](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueCleaner.php#L115-L122) |
| `action_scheduler_enable_failed_action_cleanup` | true | Failed actions must be kept | The tables grow without bound, the problem 4.0.0 fixed | [L155-L169](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueCleaner.php#L155-L169) |
| `action_scheduler_allow_async_request_runner` | true while actions are due | A server cron runs the queue and admin requests should not start runs | The queue then moves only through the cron job | [AsyncRequest_QueueRunner L76-L85](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_AsyncRequest_QueueRunner.php#L76-L85) |
| `action_scheduler_async_request_sleep_seconds` | 5 | Rarely | The comment says chaining without a pause "can crash MySQL" | [L87-L92](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_AsyncRequest_QueueRunner.php#L87-L92) |
| `action_scheduler_recurring_action_failure_threshold` | 5 | Rarely | | [Abstract_QueueRunner L236-L246](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Abstract_QueueRunner.php#L236-L246) |
| `action_scheduler_pastdue_actions_seconds`, `action_scheduler_pastdue_actions_min` | 1 day, 1 action | The notice should warn earlier or later | | [AdminView L164-L168](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_AdminView.php#L164-L168) |

Put the chosen filters in one must-use plugin, so the undo is deleting one file:

```php
<?php
/**
 * Plugin Name: Action Scheduler settings
 * Description: Queue settings chosen after measuring. Delete this file to return to the defaults.
 */
add_filter( 'action_scheduler_queue_runner_batch_size', static function () {
	return 50;
} );

// PHP CLI has no max_execution_time by default, so runs started from WP-CLI may take longer than web runs.
if ( defined( 'WP_CLI' ) && WP_CLI ) {
	add_filter( 'action_scheduler_queue_runner_time_limit', static function () {
		return 120;
	} );
}
```

Change one value at a time, and compare completions per hour and run durations before and after
([verification.md](verification.md)). The WP-CLI part relies on PHP's command-line default of no time limit
([php.net](https://www.php.net/manual/en/info.configuration.php#ini.max-execution-time)); the runner script's
`timeout` still bounds the whole run.

## A dedicated WP-CLI queue run

Use it when the past-due count keeps rising with a working server cron and completions per hour sit at the ceiling of
the default runner. The WP-CLI page: "For large sites, WP CLI is a much better choice for running queues of actions
than the default WP Cron runner" ([WP-CLI](https://actionscheduler.org/wp-cli/)).

1. Add a second command to the runner script, after the WP-Cron run and under the same lock, so the two never compete
   for the single batch slot:

   ```sh
   started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
   t0=$(date -u +%s)
   timeout "$MAX_SECONDS" "$WP" --path="$SITE_PATH" action-scheduler run --batch-size=100 --batches=10 --quiet >>"$LOG" 2>&1
   status=$?
   printf '%s queue exit=%s seconds=%s\n' "$started" "$status" "$(( $(date -u +%s) - t0 ))" >>"$LOG"
   ```

   `--batches` bounds a run, since the command has no time limit of its own
   ([action-scheduler-wp-cli.md](action-scheduler-wp-cli.md#wp-action-scheduler-run)). Size `--batch-size` and
   `--batches` from the measured time per action so a run ends well within the interval.
2. After a day of clean runs, the async runner can be switched off with
   `add_filter( 'action_scheduler_allow_async_request_runner', '__return_false' );` in the must-use plugin. Admin
   requests then stop starting runs, so the WP-CLI run no longer meets a batch that an admin request started ("There
   are too many concurrent batches."). Keep it on while the cron job is new.
3. Leave the default WP-Cron runner hooked. Unhooking it (the code of the "Disable Default Queue Runner" plugin
   removes `ActionScheduler::runner()`'s `run` from `action_scheduler_run_queue` at `init` priority 10,
   [as-disable-default-runner.php](https://github.com/woocommerce/action-scheduler-disable-default-runner/blob/master/as-disable-default-runner.php))
   makes the WP-CLI job the only runner: if it stops, nothing runs the queue. The WP-CLI page warns of exactly that
   ([WP-CLI](https://actionscheduler.org/wp-cli/)).

Separate jobs per `--group` or `--hooks` can raise throughput further, but actions that depend on each other's order
can then run out of order ([WP-CLI](https://actionscheduler.org/wp-cli/)). Only with the plugin vendor's agreement.

## Cleaning up a backlog

1. Fix the runner first. From 4.0.0 on, the daily cleanup then deletes old actions in batches of at least 250 per
   status and continues until done ([action-scheduler-internals.md](action-scheduler-internals.md#retention-and-cleanup-400-and-later)).
2. To go faster, with backups of both tables and at a quiet hour:

   ```sh
   wp action-scheduler clean --status=complete,canceled --before='31 days ago' --batch-size=200 --pause=1
   wp action-scheduler clean --status=failed --before='93 days ago' --batch-size=200 --pause=1
   ```

   Always pass `--before`: on 4.0.0, the version WooCommerce 11.1.2 bundles, leaving it out deletes every complete and
   cancelled action ([action-scheduler-wp-cli.md](action-scheduler-wp-cli.md#wp-action-scheduler-clean)).
3. Never `TRUNCATE` the tables and never `DELETE` from them with SQL: pending actions, and with them scheduled work,
   would go, and log rows would stay behind without their actions.
4. Deleting rows does not shrink the table files. On InnoDB with one file per table, `OPTIMIZE TABLE` rebuilds the
   table and "disk space can be reclaimed for use by the operating system"; it uses online DDL with brief exclusive
   locks ([MySQL 8.4](https://dev.mysql.com/doc/refman/8.4/en/optimize-table.html)). Plan it with the host, as its own
   change.

## Before updating to Action Scheduler 4.2.0

4.2.0 adds a `unique_key` column and a unique index to the actions table, applied with `dbDelta()` on the first
request after the update ([action-scheduler-internals.md](action-scheduler-internals.md#tables-and-statuses)). On a
large actions table that is a long `ALTER TABLE` inside a web request. Clean the backlog first, time the update on a
staging copy of the database, and take it at a quiet hour. The update usually arrives with a plugin update
(WooCommerce 11.2.0-beta.1 bundles 4.1.0), which is a change of its own.
