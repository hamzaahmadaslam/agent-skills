# Verifying the change

Read this for step 7 of the procedure. Take the "before" numbers from the step 0 report, then check the same numbers
the same way at each point below. All checks here are read-only.

## Numbers to record before and after

| Number | How |
| --- | --- |
| WP-Cron events past due, late and failed by Site Health's thresholds | `scripts/cron-state.php` (in the report) |
| Distinct hooks with more than one event; total events; `cron` option size | Same |
| Action Scheduler pending, past due over 1 hour and over 1 day, failed in 7 days | `scripts/cron-checks.sql` (in the report) |
| Actions completed per hour, and runs by runner (WP Cron, Async Request, WP CLI) | Same |
| Open claims and in-progress actions older than 5 minutes | Same |
| Runner runs per hour, gaps, skips, failures, p50 and p95 duration | `node scripts/cron-run-log.mjs <log> --interval=<seconds>` |
| `wp-cron.php` and async runner requests per hour by client and status | `node scripts/cron-access-log.mjs <access logs>` |

## When to check what

| When | Check | Expected | If not |
| --- | --- | --- | --- |
| Right after setting the constant | `wp eval 'var_export( defined( "DISABLE_WP_CRON" ) && DISABLE_WP_CRON );'` | `true` | The line is in the wrong place, or another file defines it as false |
| First two intervals | The runner log | One `run` line per interval with `exit=0`, no `skip` lines | Read the lines above the failing `run` line. `exit=124` means `timeout` stopped the run; 126 and 127 mean the command could not be started or found ([timeout(1)](https://man7.org/linux/man-pages/man1/timeout.1.html)). A WP-CLI error exits with 1 |
| After two intervals | `wp cron event list --fields=hook,next_run_gmt,next_run_relative,recurrence` | No event more than about one interval in the past; recurring events show their next run ahead | [diagnosis.md](diagnosis.md) |
| After two intervals | The report's WP-Cron block | No event late by Site Health's `DISABLE_WP_CRON` thresholds: 15 minutes late, 1 hour failed ([class-wp-site-health.php L43-L49](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L43-L49)) | [diagnosis.md](diagnosis.md) |
| After two intervals | The SQL report's Action Scheduler blocks | "WP Cron" runs in the last hour; past-due over 1 hour falling; no claim older than 5 minutes | [diagnosis.md](diagnosis.md) |
| After the next page views | `cron-access-log.mjs` | No new `wp-cron.php` requests with a `doing_wp_cron` value from the `WordPress/` client (Site Health's loopback test posts there without one); with the HTTP method, one `curl/` request per interval with status 200 | A second runner still starts runs: find it |
| After the next admin visit | Tools > Site Health, "Scheduled events" | "Scheduled events are running" | The event it names, through [diagnosis.md](diagnosis.md) |
| After the next scheduled post time, if any | The post's status | Published within one interval of its time | `publish_future_post` in `wp cron event list` |
| 24 hours later | The runner log summary | Runs per hour equal to 60 divided by the interval in minutes; no gaps longer than two intervals; no failures | [diagnosis.md](diagnosis.md) |
| 24 hours later | Daily work | Core events such as `wp_scheduled_delete` and `delete_expired_transients` ran; `action_scheduler_run_actions_cleanup_hook` completed after 3 am site time; on WooCommerce, `woocommerce_cleanup_sessions` completed twice | The hook's own failure in the logs |
| 24 hours later | Completions per hour and past-due counts against the "before" numbers | Past-due near zero; completions at least as high as before | [tuning-and-cleanup.md](tuning-and-cleanup.md) |

Expected side notes, not failures:

- WooCommerce > Status shows "WordPress cron" off, because the row reports the constant
  ([action-scheduler-internals.md](action-scheduler-internals.md#woocommerces-own-actions)).
- `wp cron test` stops with an error once `DISABLE_WP_CRON` is set
  ([wp-cron-internals.md](wp-cron-internals.md#how-a-page-view-starts-a-run)).
- The Action Scheduler past-due notice rechecks at most every 6 hours after a clean check, so it can lag the SQL
  numbers ([action-scheduler-internals.md](action-scheduler-internals.md#the-past-due-notice)).

## When to roll back

Undo the change ([changes-and-rollback.md](changes-and-rollback.md)) and report, when any of these holds at two checks
in a row:

- the past-due count over 1 hour rises;
- the runner log shows failures or no runs;
- WP-Cron events are due more than two intervals ago;
- work is done twice (a second runner) and cannot be stopped at once.

Undo in this order: remove `DISABLE_WP_CRON` so page views run WP-Cron again, then restore the crontab, then delete
the runner script. Then run the step 0 report again and compare.
