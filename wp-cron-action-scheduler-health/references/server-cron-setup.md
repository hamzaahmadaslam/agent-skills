# Moving WP-Cron to a server cron

Read this for steps 5 and 6 of the procedure. Every step on this page that installs, edits or runs something is a
change: its backup, check and undo are in [changes-and-rollback.md](changes-and-rollback.md), and it waits for the
owner's approval. Managed hosts that run cron themselves are in [hosting-variants.md](hosting-variants.md); networks
are in [multisite.md](multisite.md).

The plugin handbook describes the move in two parts: schedule a task on the server that requests `wp-cron.php`, then
add `define( 'DISABLE_WP_CRON', true );` so page loads stop starting runs
([Hooking WP-Cron Into the System Task Scheduler](https://developer.wordpress.org/plugins/cron/hooking-wp-cron-into-the-system-task-scheduler/)).
This page uses WP-CLI for the first part where the host allows it.

## Choose how the job runs WordPress

| Method | Command | Strengths | Weaknesses |
| --- | --- | --- | --- |
| WP-CLI (preferred when there is shell access) | `wp cron event run --due-now` | Runs in PHP CLI, where `max_execution_time` defaults to 0 ([php.net](https://www.php.net/manual/en/info.configuration.php#ini.max-execution-time)); no CDN, WAF, basic auth or web server timeout in the way; exit code and errors land in the job's log; defines `DOING_CRON` ([Runner.php L1288-L1290](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Runner.php#L1288-L1290)) | Needs WP-CLI and a CLI PHP that matches the site's; loads WordPress on every run; in WP-CLI 2.12.0 ignores the `doing_cron` lock (next section) |
| HTTP request | `curl -fsS --max-time 30 -o /dev/null "https://www.example.com/wp-cron.php?doing_wp_cron"` | Works where only a URL can be scheduled (cPanel, Plesk "Fetch a URL"); `wp-cron.php` takes its own lock | Passes through CDN, WAF, basic auth and web server limits; on PHP-FPM or LiteSpeed the response is sent before WordPress even loads, so a 200 proves only that the request reached `wp-cron.php` ([wp-cron.php L19-L47](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-cron.php#L19-L47)) |
| The host's own scheduler | Panel settings | Nothing to maintain | Interval and method set by the host; see [hosting-variants.md](hosting-variants.md) |

## WP-CLI versions and the cron lock

- WP-CLI 2.12.0 (released 2025-05-07) is the latest stable release on 2026-09-26
  ([releases](https://github.com/wp-cli/wp-cli/releases)). Its bundle pins cron-command 2.3.2
  ([wp-cli-bundle v2.12.0 composer.lock L1882-L1883](https://github.com/wp-cli/wp-cli-bundle/blob/v2.12.0/composer.lock#L1882-L1883)).
- In cron-command 2.3.2, `--due-now` selects every event due now and runs them one by one without reading or setting
  the `doing_cron` lock ([Cron_Event_Command.php L227-L246, L344-L361, L498-L510](https://github.com/wp-cli/cron-command/blob/v2.3.2/src/Cron_Event_Command.php#L344-L361)).
  Two overlapping runs, or a run that overlaps a `wp-cron.php` run, can both pick the same due event before either
  removes it. There is no `--network` flag.
- cron-command 2.3.5 (2026-03-19) made `--due-now` respect the lock, added `--network`, an `actions` field to
  `wp cron event list` and `--match-args` to `wp cron event delete`
  ([release notes](https://github.com/wp-cli/cron-command/releases/tag/v2.3.5)). With it, a run that finds a lock
  younger than `WP_CRON_LOCK_TIMEOUT` prints "A cron event run is already in progress; skipping." and exits; it sets
  the lock for `WP_CRON_LOCK_TIMEOUT` seconds and deletes it at the end
  ([v3.0.0 Cron_Event_Command.php L255-L356](https://github.com/wp-cli/cron-command/blob/v3.0.0/src/Cron_Event_Command.php#L255-L356)).
  A run longer than 60 seconds therefore loses the lock to the next starter.
- These versions reach servers through WP-CLI's nightly build or the next stable release. `wp cli update --nightly`
  is "not recommended for production" ([cli update](https://developer.wordpress.org/cli/commands/cli/update/)).
  cron-command 3.0.0 requires WP-CLI 3.0
  ([composer.json](https://github.com/wp-cli/cron-command/blob/v3.0.0/composer.json#L14-L16)).
- With any version, the runner script below holds a `flock` lock so cron-started runs never overlap, and
  `DISABLE_WP_CRON` stops page views from starting another runner. Check the server's version with `wp cli version`
  and `wp help cron event run` (it lists `--network` from 2.3.5 on).

## Find the facts first (read-only)

1. **The site's system user.** The owner of `wp-config.php` and `wp-content` (`ls -l`). The job runs as that user,
   never as root: WP-CLI refuses root without `--allow-root` and warns that "any code on this site will then have full
   control of your server" ([CheckRoot.php L52-L68](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Bootstrap/CheckRoot.php#L52-L68)).
   Cron runs automatic updates, which write files as the job's user
   ([wp-cron-internals.md](wp-cron-internals.md#wp-cli-and-wp-cron)).
2. **Paths.** The WordPress root, the `wp` binary (`command -v wp`), and the PHP binary and `php.ini` that WP-CLI uses
   (`wp cli info`; the CLI `php.ini` "is typically different than web",
   [cli info](https://developer.wordpress.org/cli/commands/cli/info/)). Compare the CLI PHP version and
   `memory_limit` with the web's (Site Health > Info > Server).
3. **Cron's environment.** Cron starts commands with `/bin/sh`, and `HOME` and `LOGNAME` from the user's passwd entry
   ([crontab(5)](https://man7.org/linux/man-pages/man5/crontab.5.html)), not with a login shell's settings. Use
   absolute paths for every program, as cPanel's guide also asks
   ([cPanel Cron Jobs](https://docs.cpanel.net/cpanel/advanced/cron-jobs/)). A `%` in a crontab command line becomes
   a newline unless escaped ([crontab(5)](https://man7.org/linux/man-pages/man5/crontab.5.html)), which is why the
   dates are formatted inside the script and not on the crontab line.
4. **Existing runners.** The user's crontab (`crontab -l`), system cron files and systemd timers
   (`systemctl list-timers --all`), the host panel, and the access log (`scripts/cron-access-log.mjs`). Every runner
   found is either kept as the only one or removed in the change plan.
5. **A rehearsal in cron's environment, read-only.** As the site user, with an empty environment
   (`env -i`, [env(1)](https://man7.org/linux/man-pages/man1/env.1.html)):

   ```sh
   env -i HOME="$HOME" SHELL=/bin/sh PATH=/usr/bin:/bin \
     /usr/local/bin/wp --path=/var/www/example.com/htdocs cron event list --format=count
   ```

   A number means the binary, PHP, paths and database access work from cron. `wp cron event list` reads only; on a
   site where WP-Cron is still on, loading WordPress can start a spawn like any page view.

## The runner script

A new file, outside the web root, owned by the site user, executable by that user only (`chmod 700`). Change the
first five variables.

```sh
#!/bin/sh
# wp-cron-run: runs due WP-Cron events for one WordPress site. Started by cron every minute.
SITE_PATH=/var/www/example.com/htdocs   # WordPress root
WP=/usr/local/bin/wp                    # absolute path to WP-CLI
LOG=/home/example/logs/wp-cron.log      # outside the web root
LOCK=/home/example/.wp-cron-run.lock    # one lock file per site
MAX_SECONDS=600                         # a run that takes longer is stopped

exec 9>>"$LOCK" || exit 1
if ! flock -n 9; then
	printf '%s skip previous-run-active\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOG"
	exit 0
fi
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
t0=$(date -u +%s)
timeout "$MAX_SECONDS" "$WP" --path="$SITE_PATH" cron event run --due-now --quiet >>"$LOG" 2>&1
status=$?
printf '%s run exit=%s seconds=%s\n' "$started" "$status" "$(( $(date -u +%s) - t0 ))" >>"$LOG"
exit "$status"
```

- `flock -n` fails at once instead of waiting when the lock is held; without `-n`, flock "waits until the lock is
  available" and missed runs would queue up ([flock(1)](https://man7.org/linux/man-pages/man1/flock.1.html)). The
  lock lives on one machine: with several web servers, only one of them runs the job.
- `timeout` stops a run after `MAX_SECONDS` and exits with status 124
  ([timeout(1)](https://man7.org/linux/man-pages/man1/timeout.1.html)). A stopped run loses the event it was running:
  that occurrence was already removed or moved to its next time
  ([wp-cron-internals.md](wp-cron-internals.md#what-wp-cronphp-does)). Set it well above the longest normal run.
- `--quiet` suppresses WP-CLI's informational lines and its warnings
  ([global parameters](https://developer.wordpress.org/cli/commands/cron/event/run/),
  [Quiet logger](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Loggers/Quiet.php)); errors and PHP
  warnings still reach the log. cron-command's "already in progress" skip is a WP-CLI warning, so with `--quiet` a
  run that found the lock leaves only a normal `run exit=0` line; the `skip` lines come from the script's `flock`.
  The log gets one `run` or `skip` line per minute, about 1,440 lines a day, plus errors; rotate it with the
  server's usual log rotation.
- `scripts/cron-run-log.mjs` reads this log: runs per hour, gaps, skips, failures and durations.
- For a network, the loop version is in [multisite.md](multisite.md).

## The crontab line

```text
* * * * * /home/example/bin/wp-cron-run
```

- Five time fields, then the command; `*/5 * * * *` runs every 5 minutes
  ([crontab(5)](https://man7.org/linux/man-pages/man5/crontab.5.html);
  [handbook](https://developer.wordpress.org/plugins/cron/hooking-wp-cron-into-the-system-task-scheduler/#macos-and-linux)).
- An agent cannot use `crontab -e` (it opens an editor). Write the new crontab to a file (the current one plus the new
  line), show it to the owner, then install it with `crontab <file>`, which replaces the whole crontab
  ([crontab(1)](https://man7.org/linux/man-pages/man1/crontab.1.html)). Never use `crontab -r`: it removes the whole
  crontab. `crontab -T <file>` checks syntax on cronie systems (same page).
- Some hosts set a minimum interval: Kinsta's is 5 minutes outside dedicated servers
  ([Kinsta](https://kinsta.com/docs/wordpress-hosting/site-management/cron-jobs/)).

## Choose the interval

- Action Scheduler's queue event recurs every 60 seconds
  ([QueueRunner L277-L284](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueRunner.php#L277-L284)).
  With a job every N minutes, queued work waits up to N minutes, unless an administrator's screen starts the async
  runner.
- Scheduled posts publish up to one interval late.
- Every run loads WordPress in PHP once: a job every minute is 1,440 runs a day, every 5 minutes 288.
- Every minute suits stores whose customers wait on queued work (deferred order emails, webhooks, subscription
  renewals); every 5 minutes suits most other sites. The owner decides; record the choice and the reason in the
  report.

## DISABLE_WP_CRON

- `wp config set DISABLE_WP_CRON true --raw --type=constant` adds or updates the constant in `wp-config.php`; `--raw`
  writes `true` unquoted, and new values go before the "That's all, stop editing!" line by default
  ([config set](https://developer.wordpress.org/cli/commands/config/set/)).
- `wp config get DISABLE_WP_CRON --type=constant` reads the file, not the running site
  ([config get](https://developer.wordpress.org/cli/commands/config/get/)). Also check the runtime value, which catches
  a constant defined in another file: `wp eval 'var_export( defined( "DISABLE_WP_CRON" ) && DISABLE_WP_CRON );'`.
- On Pantheon the line must sit above the `require_once` of `wp-config-pantheon.php`
  ([Pantheon](https://docs.pantheon.io/guides/wordpress-developer/wordpress-cron#disable-wp-cron)).
- After the change, WooCommerce > Status shows "WordPress cron" as off
  ([action-scheduler-internals.md](action-scheduler-internals.md#woocommerces-own-actions)), and `wp cron test` stops
  with "The DISABLE_WP_CRON constant is set to true"
  ([Cron_Command.php L31-L35](https://github.com/wp-cli/cron-command/blob/v2.3.2/src/Cron_Command.php#L31-L35)).
  Both are expected.
- Remove `ALTERNATE_WP_CRON` if it is set: with a server cron it has no job left, and it redirects visitors
  ([wp-cron-internals.md](wp-cron-internals.md#constants)).

## Order of the change

1. Back up `wp-config.php` and the site user's crontab; record the current late and past-due numbers (step 0 report).
2. Rehearse in cron's environment (above), read-only.
3. Add the runner script and check its syntax with `sh -n`; do not run it yet.
4. Set `DISABLE_WP_CRON`.
5. Install the crontab line right away.
6. Watch the first two runs in the log, then follow [verification.md](verification.md).

Setting the constant first and the crontab line a minute later leaves at most one interval with no runner, and never
two runners at once; with cron-command 2.3.2, two runners can run the same due event twice. The undo is not the
install order reversed: remove the constant first, so page views run WP-Cron again, then restore the crontab, then
delete the script.

## The HTTP variant

```text
*/5 * * * * curl -fsS --max-time 30 -o /dev/null "https://www.example.com/wp-cron.php?doing_wp_cron" >>/home/example/logs/wp-cron-http.log 2>&1
```

- `?doing_wp_cron` with no value makes `wp-cron.php` take its own lock
  ([wp-cron.php L94-L107](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-cron.php#L94-L107)); a
  value makes it return without running anything, as Pantheon's guide also says.
- `-f` turns HTTP errors of 400 and above into exit code 22, `-sS` hides progress but shows errors, `--max-time` caps
  the request, and curl identifies itself as `curl/<version>`
  ([curl manual](https://curl.se/docs/manpage.html#--fail)).
- The plugin handbook's version uses `wget --delete-after` and, on Windows, a Task Scheduler task running
  `powershell "Invoke-WebRequest http://YOUR_SITE_URL/wp-cron.php"`
  ([handbook](https://developer.wordpress.org/plugins/cron/hooking-wp-cron-into-the-system-task-scheduler/)).
- The request goes through everything a visitor's would. Behind basic auth or a WAF challenge it fails; use WP-CLI
  there rather than opening a hole in the protection.
- A success writes nothing to the log, and a failure writes one curl error line with no time
  (`curl: (22) The requested URL returned error: 404`). Check the work itself with the state report and the SQL
  checks.
