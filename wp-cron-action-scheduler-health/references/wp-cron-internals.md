# How WP-Cron runs

Read this for steps 2 and 4 of the procedure, and before changing anything. Code links point at the WordPress 7.1.2
tag unless they say otherwise. `cron.php` means
[wp-includes/cron.php](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php) and
`wp-cron.php` means [the runner file](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-cron.php).

## Where events are stored

- All events of a site live in one option, `cron`, which WordPress reads and writes back as a whole array and saves
  as autoloaded ([cron.php L1261-L1279, L1297-L1314](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L1261-L1314)).
  A failed save returns `could_not_set`, "The cron event list could not be saved."
- An event's key is its UTC timestamp, its hook and the MD5 of its serialized arguments
  ([cron.php L319-L327](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L319-L327)).
  Recurring events also store their schedule name and interval.
- WordPress VIP's documentation notes that core keeps cron events in `alloptions`, "which can be problematic if
  `alloptions` grows to be over 1 MB in size"
  ([VIP WP-Cron](https://docs.wpvip.com/wordpress-on-vip/cron-control/)).
- Plugins can take over storage through the `pre_schedule_event`, `pre_reschedule_event`, `pre_unschedule_event`,
  `pre_clear_scheduled_hook`, `pre_unschedule_hook`, `pre_get_scheduled_event` and `pre_get_ready_cron_jobs`
  filters ([cron.php L100, L429, L520, L610, L700, L797, L1227](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L1215-L1246)).
  VIP's Cron Control keeps events in a `wp_a8c_cron_control_jobs` table
  ([VIP WP-Cron](https://docs.wpvip.com/wordpress-on-vip/cron-control/)). When `scripts/cron-state.php` lists
  callbacks on these filters, the `cron` option is not the whole truth.

## How a page view starts a run

| Step | What happens | Source |
| --- | --- | --- |
| `init` | `wp_cron()` is hooked on `init`, except when `DOING_CRON` is defined | [default-filters.php L411-L414](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/default-filters.php#L411-L414) |
| Timing | Since 6.9.0 the spawn runs at `shutdown`, after the page is sent; with `ALTERNATE_WP_CRON` it stays at `wp_loaded` | [cron.php L1004-L1032](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L1004-L1032) |
| Gate | Nothing happens when `DISABLE_WP_CRON` is true, when the request is for `wp-cron.php`, or when no event is due | [cron.php L1048-L1092](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L1048-L1092) |
| Lock | The `doing_cron` transient holds the start time of the last spawn. No spawn while it is younger than `WP_CRON_LOCK_TIMEOUT`; a value more than 10 minutes in the future is ignored | [cron.php L899-L924](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L899-L924) |
| Loopback | Non-blocking POST to `wp-cron.php?doing_wp_cron=<lock>`, timeout 0.01 s, SSL not verified unless `https_local_ssl_verify` says so, adjustable with the `cron_request` filter | [cron.php L957-L1001](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L957-L1001) |
| Alternative | With `ALTERNATE_WP_CRON`, only front-end GET requests (no Ajax, no XML-RPC) spawn: the visitor is redirected to the same URL with `?doing_wp_cron` and `wp-cron.php` runs in that request | [cron.php L937-L955](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L937-L955) |

What follows from this:

- No PHP request, no run. The plugin handbook: "WP-Cron does not run constantly as the system cron does; it is only
  triggered on page load" ([Cron](https://developer.wordpress.org/plugins/cron/#what-is-wp-cron)). VIP calls it
  "less than ideal in cached environments where page requests might not reach the origin server"
  ([VIP WP-Cron](https://docs.wpvip.com/wordpress-on-vip/cron-control/)). Pages served from a page cache or CDN start
  nothing.
- The loopback must reach the site from its own server. Basic auth, a firewall or WAF rule, or DNS that sends the
  site's hostname elsewhere stop it. WP Engine states that sites behind basic authentication do not work with wp-cron
  ([WP Engine](https://wpengine.com/support/wp-cron-wordpress-scheduling/)).
- The spawn request carries no `Authorization` header ([cron.php L984-L997](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L984-L997)),
  while Site Health's loopback test copies the administrator's Basic auth credentials when PHP sees them
  ([class-wp-site-health.php L3275-L3303](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L3275-L3303)).
  On a password-protected site the test can pass while real spawns are refused. The access log shows what happened:
  `scripts/cron-access-log.mjs` counts `wp-cron.php` requests by status and client.
- Site Health posts form data to `wp-cron.php` so the test runs no events (same lines; `wp-cron.php` stops at once on
  POST data, [wp-cron.php L33-L35](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-cron.php#L33-L35)).
  `wp cron test` sends a blocking POST without a body and with a fresh `doing_wp_cron` value
  ([cron-command v2.3.2 Cron_Command.php L31-L91](https://github.com/wp-cli/cron-command/blob/v2.3.2/src/Cron_Command.php#L31-L91));
  that value does not match the stored lock, so `wp-cron.php` loads WordPress and returns without running events
  ([wp-cron.php L92-L115](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-cron.php#L92-L115)).
  It is still one HTTP request from the server to the site, and it errors when `DISABLE_WP_CRON` is true.

## What wp-cron.php does

- It works when requested directly with `DISABLE_WP_CRON` set: "Defining DISABLE_WP_CRON as true and calling this
  file directly are mutually exclusive and the latter does not rely on the former to work"
  ([wp-cron.php L5-L14](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-cron.php#L5-L14)).
- It sends no-cache headers, then, on PHP-FPM or LiteSpeed, finishes the HTTP response before running any event
  ([wp-cron.php L19-L31](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-cron.php#L19-L31);
  [fastcgi_finish_request](https://www.php.net/manual/en/function.fastcgi-finish-request.php)). A caller such as
  `curl` gets its status code before the work starts, so that code says nothing about the events.
- It raises the memory limit only (`wp_raise_memory_limit( 'cron' )`,
  [wp-cron.php L49-L50](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-cron.php#L49-L50)).
  The time limit stays the web server's `max_execution_time`; PHP's default is 30 seconds, and 0 (no limit) on the
  command line ([php.net](https://www.php.net/manual/en/info.configuration.php#ini.max-execution-time)).
- Lock: requested without a `doing_wp_cron` value (or with an empty one), it takes the lock itself, unless a lock
  younger than `WP_CRON_LOCK_TIMEOUT` exists; requested with a value, the value must equal the stored lock or it
  returns ([wp-cron.php L91-L115](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-cron.php#L91-L115)).
  Pantheon's documentation says the same for external callers: "Do not add a value to the `doing_wp_cron` query
  variable" ([Pantheon](https://docs.pantheon.io/guides/wordpress-developer/wordpress-cron)).
- For each due event, oldest first: a recurring event is rescheduled, then this occurrence is unscheduled, then the
  hook runs ([wp-cron.php L117-L191](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-cron.php#L117-L191)).
  Failures to reschedule or unschedule go to the PHP error log as "Cron reschedule event error for hook" and
  "Cron unschedule event error for hook", and fire `cron_reschedule_event_error` and `cron_unschedule_event_error`
  (6.1.0).
- After each event it re-reads the lock and stops if another process took it, which another run can do once the lock
  is older than `WP_CRON_LOCK_TIMEOUT`; at the end it deletes its own lock
  ([wp-cron.php L193-L203](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-cron.php#L193-L203)).
- Events run one after another in one PHP process. A slow event delays the rest; a fatal error ends the process, and
  the due events after it wait for the next run. WP Engine: "Crons need to fire sequentially, if there's an error with
  a previous cron, the following cron may not run"
  ([WP Engine](https://wpengine.com/support/wp-cron-wordpress-scheduling/)).

## Rescheduling and missed occurrences

- The next run is `now + interval` for an event that ran on time, and otherwise the next point on the event's
  original grid: a late recurring event runs once, and the occurrences it missed are not replayed
  ([cron.php L458-L466](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L458-L466)).
- When the schedule name is no longer registered (the plugin that added it is gone), the interval saved with the
  event is used; without one, rescheduling fails with `invalid_schedule`
  ([cron.php L380-L456](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L380-L456)).
  Since `wp-cron.php` unschedules the occurrence anyway, such a recurring event disappears after that run.
- Built-in schedules: `hourly`, `twicedaily` (12 hours), `daily` and `weekly` (5.4.0); plugins add others through
  `cron_schedules` ([cron.php L1133-L1170](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L1133-L1170)).
  Action Scheduler adds `every_minute` (60 seconds), see [action-scheduler-internals.md](action-scheduler-internals.md).
- The plugin handbook: "With WP-Cron, all scheduled tasks are put into a queue and will run at the next opportunity"
  ([Cron](https://developer.wordpress.org/plugins/cron/#why-use-wp-cron)).

## How duplicates arise

- `wp_schedule_single_event()` refuses an event with the same hook and arguments within 10 minutes of an existing one;
  outside that window a second identical event is accepted
  ([cron.php L8-L47, L117-L171](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L117-L171)).
- `wp_schedule_event()` has no duplicate check; its docblock says "Use wp_next_scheduled() to prevent duplicate events"
  ([cron.php L211-L331](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L211-L331)).
  The handbook: calling it on each page load "could result in the task being scheduled several thousand times"
  ([Scheduling WP Cron Events](https://developer.wordpress.org/plugins/cron/scheduling-wp-cron-events/#scheduling-the-task)).
- Arguments are part of an event's identity. Arguments that do not match exactly "can lead to duplicate cron events
  being scheduled unintentionally, excessive growth of the 'cron' option, and database performance issues"
  ([cron.php L30-L44](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L30-L44)).
- Two runners that start at the same time can both read the same due event before either one unschedules it, since
  the event is removed only right before it runs (see above). Two writers of the whole `cron` array can also
  overwrite each other's changes. VIP's Cron Control runs one event per hook at a time "to avoid issues where multiple
  events running simultaneously write to the same values in the database, particularly in `alloptions`, causing issues
  related to data loss" ([VIP WP-Cron](https://docs.wpvip.com/wordpress-on-vip/cron-control/)).
- Removing events: `wp_clear_scheduled_hook( $hook, $args )` removes every event with that hook and those arguments;
  `wp_unschedule_hook( $hook )` removes every event of the hook whatever its arguments
  ([cron.php L553-L751](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L553-L751)).
- A removed plugin leaves its events behind: "WordPress will continue to attempt to execute the tasks, even though they
  are no longer in use (or even after your plugin has been deactivated or removed)"
  ([Scheduling WP Cron Events](https://developer.wordpress.org/plugins/cron/scheduling-wp-cron-events/#unscheduling-tasks)).
  With no callback on the hook, such an event runs and does nothing.

## Constants

| Constant | Default | Effect | Source |
| --- | --- | --- | --- |
| `DISABLE_WP_CRON` | not defined | Page views never spawn a run; `wp-cron.php` still runs when requested | [cron.php L1048-L1054](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L1048-L1054); [wp-config](https://developer.wordpress.org/advanced-administration/wordpress/wp-config/#disable-cron-and-cron-timeout) |
| `ALTERNATE_WP_CRON` | not defined | Redirect method on front-end GET requests; the handbook: "This method has certain risks" | [cron.php L937-L955](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L937-L955); [wp-config](https://developer.wordpress.org/advanced-administration/wordpress/wp-config/#alternative-cron) |
| `WP_CRON_LOCK_TIMEOUT` | 60 seconds | Minimum time between spawns, and the lock age after which another run may start | [default-constants.php L395-L400](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/default-constants.php#L395-L400); [cron.php L921-L924](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L921-L924) |

## Site Health thresholds

| Setup | "A scheduled event is late" | "A scheduled event has failed" | Source |
| --- | --- | --- | --- |
| WP-Cron spawned by page views | an event past due by up to 5 minutes | an event more than 5 minutes past due | [class-wp-site-health.php L43-L49, L3136-L3179](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L3136-L3179) |
| `DISABLE_WP_CRON` true | past due by more than 15 minutes and up to 1 hour | more than 1 hour past due | same |

Both are "recommended" results in the Scheduled events test
([L1667-L1727](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L1667-L1727)).
Creating the Site Health object schedules a weekly `wp_site_health_scheduled_check` event
([L37-L38, L3343-L3347](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/class-wp-site-health.php#L3343-L3347)),
so `scripts/cron-state.php` applies the same thresholds without creating it.

## What waits when cron stops

- Scheduled posts: `publish_future_post` is a single event at the post's date
  ([post.php L8205-L8208](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/post.php#L8205-L8208)).
- Update checks, twice a day ([update.php L1089-L1101](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/update.php#L1089-L1101)),
  and automatic background updates, which start only inside a cron run
  ([update.php L330-L338](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/update.php#L330-L338)).
- Core cleanups such as `wp_scheduled_delete`, `wp_scheduled_auto_draft_delete` and `delete_expired_transients`
  ([default-filters.php L464-L469](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/default-filters.php#L464-L469)).
- The Action Scheduler queue, and with it WooCommerce's scheduled sales, unpaid order cancellation and session
  cleanup ([action-scheduler-internals.md](action-scheduler-internals.md)).

## WP-CLI and WP-Cron

- `wp cron event run` defines `DOING_CRON` before WordPress loads
  ([WP-CLI 2.12.0 Runner.php L1288-L1290](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Runner.php#L1288-L1290)),
  so that process never spawns `wp-cron.php`, and `wp_doing_cron()` is true in it
  ([load.php L1781-L1790](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/load.php#L1781-L1790)).
  Automatic updates therefore run as the system user of the cron job, and write files as that user.
- Every other WP-CLI command loads WordPress like a page view: on a site where WP-Cron is on and an event is due, the
  process spawns `wp-cron.php` at shutdown. `scripts/cron-readonly-report.sh` removes `wp_cron` from `init` in its own
  processes (through WP-CLI's `--exec`) so the report does not start a run.
- WP-CLI removes `wp_cron` when `ALTERNATE_WP_CRON` is set, because it cannot follow the redirect
  ([Runner.php L1514-L1522](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Runner.php#L1514-L1522)).
- The WP-CLI commands for cron and their version differences are in [server-cron-setup.md](server-cron-setup.md).
