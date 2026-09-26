# Hosting variants

Read this in step 1 (find every runner) and step 5 (plan the change). Hosts change their platforms: the facts below
come from each host's documentation as read on 2026-09-26, with the page's own date where it shows one. Re-read the
page before acting on a host's behalf.

## Managed hosts and panels

| Platform | What the platform does | What that means for the change | Source |
| --- | --- | --- | --- |
| WordPress VIP | `/wp-cron.php` is disabled for all sites. Cron Control keeps events in its own table, a runner polls for due events every 30 seconds and runs them in separate containers, several at once, and by default one event per hook at a time (filter `a8c_cron_control_concurrent_event_whitelist`) | Add neither `DISABLE_WP_CRON` nor a server cron. Check with `wp cron event list` through VIP-CLI | [VIP WP-Cron](https://docs.wpvip.com/wordpress-on-vip/cron-control/) |
| WordPress VIP, Action Scheduler | The front-end async queue is disabled "in favor of a Dynamic Queue", which checks due actions about every 120 seconds and starts parallel queues as one-time cron events (page updated 2023-12-26) | Read the queue with `wp action-scheduler status`; the async runner facts in this skill do not apply | [VIP Action Scheduler](https://docs.wpvip.com/wordpress-on-vip/action-scheduler/) |
| WP Engine | "Alternate Cron", switched on in the User Portal, requests `wp-cron.php` every minute. It sets `DISABLE_WP_CRON` and re-checks it daily; defining the constant yourself does not switch it on. It fails behind basic auth other than WP Engine's own password protection; a 502 for `wp-cron.php` in the access log is a timeout, and cron work should finish within 60 seconds (page updated 2025-07-28) | Use the portal switch, not a crontab | [WP Engine](https://wpengine.com/support/wp-cron-wordpress-scheduling/) |
| Kinsta | Each site container has its own crontab; add jobs over SSH at the bottom; the jobs at the top belong to Kinsta and must stay; the minimum interval is 5 minutes except on dedicated servers; servers use UTC (page updated 2025-01-20) | Read the top of `crontab -l` before adding anything. If a WP-Cron job is already there, keep it as the only runner or ask Kinsta; do not add a second one | [Kinsta Cron Jobs](https://kinsta.com/docs/wordpress-hosting/site-management/cron-jobs/) |
| Pantheon | The WordPress upstream disables WP-Cron; Pantheon Cron runs WordPress cron hourly or on demand through Terminus; it skips sleeping environments; it is off by default for multisite, which uses WP-Cron; cron may run 180 seconds; Terminus cannot run cron when the dashboard's Security setting is on (reviewed 2025-12-10) | Action Scheduler then advances once an hour from cron, plus admin activity. For a tighter schedule, the guide describes calling `wp-cron.php` from an external scheduler | [Pantheon](https://docs.pantheon.io/guides/wordpress-developer/wordpress-cron) |
| Plesk WP Toolkit | "Take over wp-cron.php" disables the default execution and creates a scheduled task that runs `wp-cron.php` every 30 minutes; if you already had your own task, it offers to keep both | Keep exactly one task and set its interval | [WP Toolkit](https://docs.plesk.com/en-US/obsidian/administrator-guide/website-management/wordpress-toolkit.73391/#setting-up-a-regular-run-of-wp-cron-php) |
| Plesk scheduled tasks | Task types "Run a command", "Fetch a URL" and "Run a PHP script"; server time zone by default; each task runs as a chosen system user | "Run a command" with the runner script where the subscription allows it, otherwise "Fetch a URL" (the HTTP variant) | [Plesk Scheduling Tasks](https://docs.plesk.com/en-US/obsidian/administrator-guide/server-administration/scheduling-tasks.64993/) |
| cPanel | Cron jobs per account, with absolute paths to commands; cPanel asks to "allow enough time between cron jobs for the previous cron job to complete"; jobs mail their output unless silenced; the host can turn the interface off (modified 2026-07-08) | The runner script with its own lock and log fits this well; it runs as the cPanel account | [cPanel Cron Jobs](https://docs.cpanel.net/cpanel/advanced/cron-jobs/) |

On any host not listed, find three things in its own documentation before the change: whether it already runs
WP-Cron, whether it sets `DISABLE_WP_CRON` itself, and the shortest interval it allows.

## systemd timers instead of crontab

Two unit files, installed by root, for example `/etc/systemd/system/wp-cron-example.service`:

```ini
[Unit]
Description=WP-Cron for example.com

[Service]
Type=oneshot
User=example
ExecStart=/home/example/bin/wp-cron-run
```

and `/etc/systemd/system/wp-cron-example.timer`:

```ini
[Unit]
Description=Run WP-Cron for example.com every minute

[Timer]
OnCalendar=*:*:00
AccuracySec=1s
Persistent=true

[Install]
WantedBy=timers.target
```

- A timer activates the service of the same name, and does not start it again while it is still running: "it is not
  restarted, but simply left running" ([systemd.timer](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html#Description)).
  The runner script's `flock` stays as a second guard.
- `AccuracySec=` defaults to 1 minute, so a per-minute timer needs a smaller value; `Persistent=true` runs the service
  once after downtime when a run was missed ([systemd.timer](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html#Persistent=)).
- `OnCalendar=*:0/5` runs every 5 minutes; `systemd-analyze calendar '*:0/5'` prints the next times before anything is
  installed.
- `Type=oneshot` services have no start timeout by default
  ([systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html#Type=)), which is
  why the runner script carries its own `timeout`. `User=` sets the system user
  ([systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#User=)).

## Containers and Kubernetes

- The job needs the same code, `wp-config.php`, PHP and database access as the web containers: run it from the same
  image with WP-CLI added, not from the web container's shell by hand.
- A Kubernetes CronJob runs Jobs on a schedule. With `concurrencyPolicy: Forbid` it "skips the new Job run" while the
  previous one is still running; the default, `Allow`, lets them overlap. Creation is approximate: "there are certain
  circumstances where two Jobs might be created, or no Job might be created", so the Jobs "should be idempotent"
  ([CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)). `.spec.timeZone` sets the time
  zone.
- `flock` inside a pod does not coordinate with other pods. Coordination comes from `concurrencyPolicy: Forbid` and,
  with cron-command 2.3.5 or later, from WordPress's `doing_cron` lock
  ([server-cron-setup.md](server-cron-setup.md#wp-cli-versions-and-the-cron-lock)).

## Several web servers

- Run the job on one machine. `flock` locks a file on the machine it runs on
  ([flock(1)](https://man7.org/linux/man-pages/man1/flock.1.html)), so the same job on two servers runs twice.
- WordPress's own lock is the `doing_cron` transient. `spawn_cron()` notes that "Multiple processes on multiple web
  servers can run this code concurrently, this lock attempts to make spawning as atomic as possible"
  ([cron.php L908-L924](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/cron.php#L908-L924)).
  It is shared only when the servers share the database or the object cache.
- Pick the machine that stays up (not one that autoscaling removes), and record which one it is in the report.

## Shared hosting without a shell

- Use the HTTP variant from the panel's scheduler ([server-cron-setup.md](server-cron-setup.md#the-http-variant)).
- An outside scheduling service that requests `wp-cron.php` works the same way; the site then depends on that
  service's uptime, and the request passes through the CDN and firewall like a visitor's.
- Without any scheduler, leave WP-Cron on. `DISABLE_WP_CRON` without a replacement stops scheduled posts, update
  checks and the Action Scheduler queue ([wp-cron-internals.md](wp-cron-internals.md#what-waits-when-cron-stops)).

## Windows servers

The plugin handbook describes a Task Scheduler basic task running
`powershell "Invoke-WebRequest http://YOUR_SITE_URL/wp-cron.php"`
([handbook](https://developer.wordpress.org/plugins/cron/hooking-wp-cron-into-the-system-task-scheduler/#windows)).
A task that runs `wp cron event run --due-now` through the site's PHP works too; the runner script above is for
Linux shells.
