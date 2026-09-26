-- Read-only: every statement below is a SELECT. Nothing here changes data, settings or tables.
--
-- WP-Cron and Action Scheduler checks for one WordPress site: the cron option, the WP-Cron and Action Scheduler lock
-- rows, queue counts, past-due buckets, runs by runner, throughput, failures by cause, stuck actions and claims,
-- duplicate actions, recurring and housekeeping actions, the retention backlog, log rows, table sizes and pre-3.0
-- leftovers.
-- Placeholder, filled in by cron-readonly-report.sh (or by hand):
--   {prefix}   the site's table prefix, from `wp db prefix` (per site on multisite: wp db prefix --url=...)
-- Each block starts with a "-- name:" line and holds one statement; the report script runs them one at a time, so a
-- block that fails (for example on a site without Action Scheduler) does not stop the others.
-- Blocks marked "(scan)" read whole tables. On a big site run them on a replica or staging copy, or at a quiet hour;
-- CRON_REPORT_SKIP_SCANS=1 makes the report skip them.
-- Blocks marked "(English)" match Action Scheduler's log messages, which are stored in the site's language: on a site
-- in another language they return nothing.
-- Output holds counts, dates, hook names, group slugs, option names and lock values only: no arguments, no log texts.
-- Tables and columns: Action Scheduler 4.0.0 and 4.2.0 schema, WordPress 7.1.2 schema. references/*.md explain the
-- results.

-- name: The cron option: stored size and autoload
SELECT option_name, LENGTH(option_value) AS bytes, autoload
FROM {prefix}options
WHERE option_name = 'cron';

-- name: WP-Cron lock, Action Scheduler locks, schema versions and markers
SELECT option_name, LEFT(option_value, 60) AS value, autoload
FROM {prefix}options
WHERE option_name IN ('_transient_doing_cron', '_transient_timeout_doing_cron',
                      'schema-ActionScheduler_StoreSchema', 'schema-ActionScheduler_LoggerSchema',
                      'action_scheduler_migration_status', 'as_has_wp_comment_logs',
                      '_transient_as_is_ensure_recurring_actions_scheduled',
                      '_transient_action_scheduler_last_pastdue_actions_check')
   OR option_name LIKE 'action\_scheduler\_lock\_%'
ORDER BY option_name;

-- name: Actions by status
SELECT status,
       COUNT(*) AS actions,
       MIN(scheduled_date_gmt) AS oldest_scheduled_gmt,
       MAX(scheduled_date_gmt) AS newest_scheduled_gmt
FROM {prefix}actionscheduler_actions
GROUP BY status
ORDER BY status;

-- name: Past-due pending actions by age (the admin notice counts those over 1 day)
SELECT COALESCE(SUM(scheduled_date_gmt <= UTC_TIMESTAMP()), 0) AS due_now,
       COALESCE(SUM(scheduled_date_gmt < UTC_TIMESTAMP() - INTERVAL 5 MINUTE), 0) AS over_5_minutes,
       COALESCE(SUM(scheduled_date_gmt < UTC_TIMESTAMP() - INTERVAL 1 HOUR), 0) AS over_1_hour,
       COALESCE(SUM(scheduled_date_gmt < UTC_TIMESTAMP() - INTERVAL 1 DAY), 0) AS over_1_day,
       MIN(CASE WHEN scheduled_date_gmt <= UTC_TIMESTAMP() THEN scheduled_date_gmt END) AS oldest_due_gmt
FROM {prefix}actionscheduler_actions
WHERE status = 'pending';

-- name: Pending actions by hook and group (top 20)
SELECT a.hook,
       g.slug AS action_group,
       COUNT(*) AS pending,
       COALESCE(SUM(a.scheduled_date_gmt <= UTC_TIMESTAMP()), 0) AS due_now,
       MIN(a.scheduled_date_gmt) AS oldest_gmt
FROM {prefix}actionscheduler_actions a
LEFT JOIN {prefix}actionscheduler_groups g ON g.group_id = a.group_id
WHERE a.status = 'pending'
GROUP BY a.hook, g.slug
ORDER BY pending DESC
LIMIT 20;

-- name: Actions started per runner, last hour and last 24 hours (English)
SELECT SUBSTRING(message, 20) AS runner,
       COALESCE(SUM(log_date_gmt > UTC_TIMESTAMP() - INTERVAL 1 HOUR), 0) AS last_hour,
       COUNT(*) AS last_24_hours,
       MAX(log_date_gmt) AS latest_gmt
FROM {prefix}actionscheduler_logs
WHERE log_date_gmt > UTC_TIMESTAMP() - INTERVAL 1 DAY
  AND message LIKE 'action started via %'
GROUP BY runner
ORDER BY last_24_hours DESC;

-- name: Actions completed per hour, last 24 hours (throughput)
SELECT DATE_FORMAT(last_attempt_gmt, '%Y-%m-%d %H:00') AS hour_gmt,
       COUNT(*) AS completed
FROM {prefix}actionscheduler_actions
WHERE status = 'complete'
  AND last_attempt_gmt > UTC_TIMESTAMP() - INTERVAL 1 DAY
GROUP BY hour_gmt
ORDER BY hour_gmt;

-- name: Failed actions in the last 7 days by hook
SELECT hook,
       COUNT(*) AS failed,
       MAX(last_attempt_gmt) AS last_failure_gmt
FROM {prefix}actionscheduler_actions
WHERE status = 'failed'
  AND last_attempt_gmt > UTC_TIMESTAMP() - INTERVAL 7 DAY
GROUP BY hook
ORDER BY failed DESC
LIMIT 20;

-- name: Failure and reset messages in the last 7 days by cause (English)
SELECT CASE
         WHEN message LIKE '%will not be executed as no callbacks are registered%' THEN 'no callback registered'
         WHEN message LIKE 'action failed via %' THEN 'exception in the callback'
         WHEN message LIKE 'action failed:%' THEN 'exception in the callback'
         WHEN message LIKE 'unexpected shutdown:%' THEN 'PHP fatal error'
         WHEN message LIKE 'action was in-progress for at least %' THEN 'in progress too long, marked failed'
         WHEN message LIKE 'action reset%' THEN 'claim released after timeout'
         WHEN message LIKE 'action ignored%' THEN 'not pending when run'
         WHEN message LIKE 'This action appears to be consistently failing%' THEN 'recurring action not rescheduled'
         WHEN message LIKE 'This action data appears to be corrupt%' THEN 'corrupt data, cancelled'
         WHEN message LIKE 'There was a failure%' THEN 'fetch or reschedule failure'
       END AS cause,
       COUNT(*) AS log_rows,
       MAX(log_date_gmt) AS latest_gmt
FROM {prefix}actionscheduler_logs
WHERE log_date_gmt > UTC_TIMESTAMP() - INTERVAL 7 DAY
  AND (message LIKE 'action failed%'
       OR message LIKE 'unexpected shutdown:%'
       OR message LIKE 'action was in-progress for at least %'
       OR message LIKE 'action reset%'
       OR message LIKE 'action ignored%'
       OR message LIKE 'This action appears to be consistently failing%'
       OR message LIKE 'This action data appears to be corrupt%'
       OR message LIKE 'There was a failure%')
GROUP BY cause
ORDER BY log_rows DESC;

-- name: Hooks whose recurring action stopped after repeated failures, last 30 days (English)
SELECT a.hook, COUNT(*) AS times, MAX(l.log_date_gmt) AS latest_gmt
FROM {prefix}actionscheduler_logs l
JOIN {prefix}actionscheduler_actions a ON a.action_id = l.action_id
WHERE l.log_date_gmt > UTC_TIMESTAMP() - INTERVAL 30 DAY
  AND l.message LIKE 'This action appears to be consistently failing%'
GROUP BY a.hook
ORDER BY latest_gmt DESC
LIMIT 20;

-- name: In-progress actions and how long ago they were claimed or started
SELECT COUNT(*) AS in_progress,
       COALESCE(SUM(last_attempt_gmt < UTC_TIMESTAMP() - INTERVAL 5 MINUTE), 0) AS older_than_5_minutes,
       MIN(last_attempt_gmt) AS oldest_gmt
FROM {prefix}actionscheduler_actions
WHERE status = 'in-progress';

-- name: Claims (batches) and their age
SELECT COUNT(*) AS claims,
       COALESCE(SUM(date_created_gmt < UTC_TIMESTAMP() - INTERVAL 5 MINUTE), 0) AS older_than_5_minutes,
       MIN(date_created_gmt) AS oldest_gmt
FROM {prefix}actionscheduler_claims;

-- name: Duplicate pending actions: same hook, group and arguments (top 20)
SELECT a.hook,
       g.slug AS action_group,
       COUNT(*) AS copies,
       MIN(a.scheduled_date_gmt) AS first_gmt,
       MAX(a.scheduled_date_gmt) AS last_gmt
FROM {prefix}actionscheduler_actions a
LEFT JOIN {prefix}actionscheduler_groups g ON g.group_id = a.group_id
WHERE a.status IN ('pending', 'in-progress')
GROUP BY a.hook, a.group_id, g.slug, a.args
HAVING COUNT(*) > 1
ORDER BY copies DESC
LIMIT 20;

-- name: Recurring and housekeeping hooks: pending instance, next date, last completion
SELECT hook,
       COALESCE(SUM(status = 'pending'), 0) AS pending,
       MIN(CASE WHEN status = 'pending' THEN scheduled_date_gmt END) AS next_gmt,
       MAX(CASE WHEN status = 'complete' THEN last_attempt_gmt END) AS last_complete_gmt,
       MAX(CASE WHEN status = 'failed' THEN last_attempt_gmt END) AS last_failed_gmt
FROM {prefix}actionscheduler_actions
WHERE hook IN ('action_scheduler_run_recurring_actions_schedule_hook',
               'action_scheduler_run_actions_cleanup_hook',
               'action_scheduler_continue_actions_cleanup_hook',
               'woocommerce_scheduled_sales',
               'woocommerce_cancel_unpaid_orders',
               'woocommerce_cleanup_sessions',
               'woocommerce_cleanup_logs',
               'woocommerce_cleanup_personal_data',
               'woocommerce_geoip_updater',
               'woocommerce_cleanup_rate_limits_wrapper',
               'wc_admin_daily_wrapper')
GROUP BY hook
ORDER BY hook;

-- name: Retention backlog: rows the daily cleanup should have removed (by last_attempt_gmt)
SELECT COALESCE(SUM(status IN ('complete', 'canceled') AND last_attempt_gmt < UTC_TIMESTAMP() - INTERVAL 31 DAY), 0) AS complete_or_canceled_over_31_days,
       COALESCE(SUM(status = 'failed' AND last_attempt_gmt < UTC_TIMESTAMP() - INTERVAL 93 DAY), 0) AS failed_over_93_days
FROM {prefix}actionscheduler_actions
WHERE status IN ('complete', 'canceled', 'failed');

-- name: Log rows and the oldest (scan)
SELECT COUNT(*) AS log_rows, MIN(log_date_gmt) AS oldest_log_gmt
FROM {prefix}actionscheduler_logs;

-- name: Log rows whose action no longer exists (scan)
SELECT COUNT(*) AS orphaned_log_rows
FROM {prefix}actionscheduler_logs l
LEFT JOIN {prefix}actionscheduler_actions a ON a.action_id = l.action_id
WHERE a.action_id IS NULL;

-- name: Sizes of the Action Scheduler tables and the options table (TABLE_ROWS is an estimate for InnoDB)
SELECT TABLE_NAME AS table_name,
       ENGINE AS engine,
       TABLE_ROWS AS approx_rows,
       ROUND(DATA_LENGTH / 1048576, 1) AS data_mb,
       ROUND(INDEX_LENGTH / 1048576, 1) AS index_mb,
       ROUND(DATA_FREE / 1048576, 1) AS free_mb
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('{prefix}actionscheduler_actions', '{prefix}actionscheduler_logs',
                     '{prefix}actionscheduler_claims', '{prefix}actionscheduler_groups', '{prefix}options')
ORDER BY DATA_LENGTH + INDEX_LENGTH DESC;

-- name: Leftovers from Action Scheduler before 3.0: actions stored as posts
SELECT post_status, COUNT(*) AS posts
FROM {prefix}posts
WHERE post_type = 'scheduled-action'
GROUP BY post_status;

-- name: Leftovers from Action Scheduler before 3.0: logs stored as comments
SELECT COUNT(*) AS action_log_comments
FROM {prefix}comments
WHERE comment_type = 'action_log';
