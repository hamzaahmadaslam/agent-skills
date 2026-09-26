# Diagnosing missed, late and duplicated schedules

Read this for step 4 of the procedure. Each row names the evidence to look for in the step 0 output, the likely cause,
a read-only check that confirms it, and where the fix is. Mechanisms and sources are in
[wp-cron-internals.md](wp-cron-internals.md) and [action-scheduler-internals.md](action-scheduler-internals.md); fixes
with their backups and undo are in [changes-and-rollback.md](changes-and-rollback.md).

## Where the evidence is

| Evidence | Where |
| --- | --- |
| Late and failed events by Site Health's thresholds, duplicates, unknown schedules, hooks without callbacks, lock age, `cron` option size | `scripts/cron-state.php` (inside the report) |
| Queue counts, past-due buckets, failures by cause, runs by runner, throughput, claims, retention backlog, duplicate actions, lock rows | `scripts/cron-checks.sql` (inside the report) |
| Who requests `wp-cron.php` and the async runner, with status codes, per hour | `node scripts/cron-access-log.mjs <access logs>` |
| Runs, gaps, skips, failures and durations of the server cron job | `node scripts/cron-run-log.mjs <runner log>` |
| PHP fatal errors; "Cron reschedule event error for hook" and "Cron unschedule event error for hook" ([wp-cron.php L128-L180](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-cron.php#L128-L180)) | The PHP error log. Read it in place and quote only the lines that matter |
| Existing runners | `crontab -l`, `systemctl list-timers --all`, the host panel ([hosting-variants.md](hosting-variants.md)) |

## WP-Cron events late or missed

| Evidence | Likely cause | Confirm (read-only) | Fix |
| --- | --- | --- | --- |
| Every due event late; `DISABLE_WP_CRON` is true; no runs in the runner log | No runner: the constant was set without a job, or the job fails before WordPress loads | `crontab -l`, the host panel, the rehearsal command in [server-cron-setup.md](server-cron-setup.md#find-the-facts-first-read-only) | Install or repair the job |
| Every due event late; WP-Cron on; `wp-cron.php` requests from the `WordPress/` client missing, or answered 401, 403 or 5xx | The loopback is blocked: basic auth, a firewall or WAF rule, DNS, TLS | `cron-access-log.mjs` by client and status; Site Health's loopback test, which can pass behind basic auth when the real spawn fails; `wp cron test`, which sends one HTTP request and runs no events | Remove the block, or move to a WP-CLI server cron |
| Events late at quiet hours, or on a site served mostly from a page cache | No PHP request starts a run | `cron-access-log.mjs`: hours with no `wp-cron.php` requests | A server cron |
| `wp-cron.php` requested, events still late, `doing_cron` lock old or far ahead, or `WP_CRON_LOCK_TIMEOUT` set high | Spawns refused by the lock | The report's lock age and constants ([spawn_cron L915-L924](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L915-L924)) | Remove a large `WP_CRON_LOCK_TIMEOUT` |
| Some events run, the ones after them stay late; PHP fatal errors at run times | A fatal error or a slow event ends or holds the run | The PHP error log around the run times; durations in the runner log | The failing plugin's vendor; on staging, `wp cron event run <hook>` to reproduce |
| A recurring event disappeared after running; "Cron reschedule event error for hook" in the error log | Its schedule is no longer registered and no interval was stored (`invalid_schedule`) | The report's unknown-schedule list ([cron.php L380-L456](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L380-L456)) | Re-activate the plugin that registers the schedule, or leave the event removed if the plugin is gone |
| The same events come back or vanish; "Cron unschedule event error" in the error log; a very large `cron` option | The `cron` option cannot be saved, or two writers overwrote each other | The report's option size and event count; the database error log; the number of runners | Fewer events (clear duplicates after fixing their source), one runner |
| Late on some sites of a network only | The job covers one site | Site URLs in the runner log | The loop in [multisite.md](multisite.md) |
| Late by up to an hour on Pantheon, 30 minutes with Plesk WP Toolkit's task, 5 minutes on Kinsta | The host scheduler's interval | [hosting-variants.md](hosting-variants.md) | A tighter job where the host allows it |
| A post shows "Missed schedule" | Its `publish_future_post` event ran late or not at all ([post.php L8205-L8208](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/post.php#L8205-L8208)) | `wp cron event list --hook=publish_future_post --fields=hook,next_run_gmt,args` | Fix the runner; the post publishes at the next run |

`next_run_gmt` is UTC and `next_run` is site time
([Cron_Event_Command.php L386-L395](https://github.com/wp-cli/cron-command/blob/v2.3.2/src/Cron_Event_Command.php#L386-L395));
compare like with like before calling an event late.

## WP-Cron events duplicated

| Evidence | Likely cause | Confirm (read-only) | Fix |
| --- | --- | --- | --- |
| One hook with many events, same arguments, different times | Code calls `wp_schedule_event()` without a `wp_next_scheduled()` check ([cron.php L211-L331](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L211-L331)) | The report's hooks with more than one event; the owning plugin from the callback list | Report to the plugin's vendor; clear the extras only after the code is fixed, or they return |
| One hook with a growing number of argument sets | Arguments carry changing values such as times or random strings ([cron.php L30-L44](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L30-L44)) | The report's distinct argument sets per hook | Same |
| Work done twice at the same moment: two identical emails, two webhook deliveries | Two runners: a server job while page views still spawn, two crontab lines, the host's scheduler plus your own, WP Toolkit's second task, the job on two servers | The runner inventory; `WordPress/` requests to `wp-cron.php` in the access log after `DISABLE_WP_CRON`; two `run` lines in the same minute | Keep one runner |
| Runs longer than the interval, no `skip` lines in the runner log | Overlapping runs without a lock; cron-command 2.3.2 takes no lock ([server-cron-setup.md](server-cron-setup.md#wp-cli-versions-and-the-cron-lock)) | Durations in the runner log | The runner script with `flock` |
| Two identical single events more than 10 minutes apart | Expected: duplicates are refused only within 10 minutes ([cron.php L117-L171](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L117-L171)) | The report | The plugin's own code |

## Action Scheduler actions late

| Evidence | Likely cause | Confirm (read-only) | Fix |
| --- | --- | --- | --- |
| Past-due count rising, no completions per hour, no runs by any runner | The queue has no runner: WP-Cron is not running (above), or the default runner is unhooked | `wp action-scheduler status` shows "(disabled)" after the runner ([System_Command L61-L70](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/System_Command.php#L61-L70)); `wp cron event list --hook=action_scheduler_run_queue` | Repair WP-Cron; or re-hook the runner |
| Past-due rises at nights and weekends; runs come mostly from "Async Request" | Only the admin async runner moves the queue | Runs by runner in the SQL report | A server cron |
| Past-due high, completions per hour flat at a ceiling | Throughput limit: 25 per batch, 30 seconds per run, 1 batch at a time | Completions per hour and actions per run in the SQL report | [tuning-and-cleanup.md](tuning-and-cleanup.md) |
| One hook holds most pending actions | A plugin floods the queue | Pending by hook | That plugin's setting; for WooCommerce Analytics see the `woo-checkout-performance-audit` skill |
| Claims older than 5 minutes; "There are too many concurrent batches." in the runner log | A runner died mid-batch (timeout, fatal error, memory) and no runner started since, or a claim younger than 5 minutes remains | Claims and in-progress actions with their age in the SQL report; the PHP error log | The next run releases claims older than 300 seconds ([QueueCleaner L320-L376](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueCleaner.php#L320-L376)); fix what kills the runs |
| A recurring action (for example `woocommerce_cleanup_sessions`) has no pending instance | It failed 5 times in a row and was not rescheduled, or it was lost | The recurring-hooks block in the SQL report; its log: "This action appears to be consistently failing" ([Abstract_QueueRunner L207-L281](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Abstract_QueueRunner.php#L207-L281)) | Fix the failure; plugins that use `action_scheduler_ensure_recurring_actions` re-create it at the next daily check, WooCommerce among them |
| The async runner never starts on 4.0.0 although actions are due and admins are active | The 4.0.0 lock defect: a lock row with an empty value | The lock rows block in the SQL report | Update to Action Scheduler 4.1.0 or later (a WooCommerce update, as a change of its own) |
| A new action was not created | A pending or in-progress identical action exists and the code asked for a unique action | Pending actions of that hook | Expected behaviour ([action-scheduler-internals.md](action-scheduler-internals.md#unique-actions-and-duplicates)) |

## Action Scheduler failures by log message

Messages are stored in the site's language; the SQL report groups the English ones
([Logger L99-L238](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Logger.php#L99-L238)).

| Message starts with | Cause | Next step |
| --- | --- | --- |
| "Scheduled action for ... will not be executed as no callbacks are registered" | The plugin that scheduled it is inactive, or adds its callback only on some requests | Re-activate the plugin, or cancel that hook's actions with the owner's approval |
| "action failed via ...:" | An exception in the callback | Read one action's log (`wp action-scheduler action logs <id>`) and hand it to the vendor |
| "unexpected shutdown: PHP Fatal error" | A fatal error, often memory | The PHP error log; the CLI and web memory limits |
| "action was in-progress for at least ... seconds" | The runner was killed (timeout, fatal error without a trace), or the action really runs longer than the failure period | The runner log's durations and exit codes; `timeout` in the runner script |
| "This action data appears to be corrupt" | Unreadable action data, cancelled by 4.0.0 or later | The vendor of the hook, if it recurs |

## Action Scheduler duplicates

| Evidence | Likely cause | Confirm (read-only) | Fix |
| --- | --- | --- | --- |
| Several pending actions with the same hook, arguments and group | Scheduling without `$unique` or an `as_has_scheduled_action()` check; before 4.2.0 also two requests racing past the unique check | The duplicates block in the SQL report | Vendor fix first, then cancel the extras by ID |
| The same work done twice | Two actions, not one action run twice: claims are exclusive | Completed actions of that hook and arguments close together in time | As above |

## Tables that keep growing

| Evidence | Likely cause | Next |
| --- | --- | --- |
| Complete or cancelled actions last attempted more than 31 days ago | The daily cleanup is not running (queue stalled), or a filter raised the retention | The housekeeping block in the SQL report; callbacks on the retention filters in the state report |
| Failed actions older than 93 days on 4.0.0 or later | Failed cleanup turned off by filter | Callbacks on `action_scheduler_enable_failed_action_cleanup` |
| Log rows whose action no longer exists | Actions deleted with SQL instead of the store | The orphaned logs block (scan) |
| Many actions per hour from one hook | Normal volume for that plugin | [tuning-and-cleanup.md](tuning-and-cleanup.md) |
