# Multisite networks

Read this whenever `is_multisite()` is true in the state report. Everything in this skill applies per site.

## Each site has its own schedule and queue

- Every site has its own options table ([schema.php L56, L141-L149](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L141-L149)),
  so its own `cron` option and its own due events.
- Action Scheduler registers its tables as per-site tables, so each site has its own four tables
  ([Abstract_Schema L49-L58](https://github.com/woocommerce/action-scheduler/blob/4.2.0/classes/abstracts/ActionScheduler_Abstract_Schema.php#L49-L58)),
  and its own `action_scheduler_run_queue` event. The FAQ: it "has no special handling for running queues across
  multiple sites in a multisite network" ([FAQ](https://actionscheduler.org/faq/)).
- WP-CLI works on one site per run, the one named by `--url`: "In multisite, this argument is how the target site is
  specified" ([global parameters](https://developer.wordpress.org/cli/commands/cron/event/run/)). A cron job without
  `--url` covers one site only.
- WP-CLI runs against every site whatever its status: "Always permit operations against sites, regardless of status"
  ([Runner.php L1544-L1545](https://github.com/wp-cli/wp-cli/blob/v2.12.0/php/WP_CLI/Runner.php#L1544-L1545)).
  Page views reach `init`, where WP-Cron is hooked, before WordPress checks for archived, spam or deleted sites
  ([wp-settings.php L779-L790](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-settings.php#L779-L790)).

## Run every site from one job

In the runner script of [server-cron-setup.md](server-cron-setup.md#the-runner-script), keep everything up to and
including the `flock` check, and replace the lines from `started=` to the end with this loop. Give each network its
own lock file.

```sh
"$WP" --path="$SITE_PATH" site list --field=url 2>>"$LOG" | while IFS= read -r url; do
	started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
	t0=$(date -u +%s)
	timeout "$MAX_SECONDS" "$WP" --path="$SITE_PATH" --url="$url" cron event run --due-now --quiet </dev/null >>"$LOG" 2>&1
	status=$?
	printf '%s run exit=%s seconds=%s url=%s\n' "$started" "$status" "$(( $(date -u +%s) - t0 ))" "$url" >>"$LOG"
done
exit 0
```

- `</dev/null` keeps each `wp` call from reading the list of URLs that the loop reads from. `MAX_SECONDS` applies to
  each site. The exit status of each site is in its log line.

- `wp site list --field=url` prints one URL per site; `--archived=0 --deleted=0 --spam=0` leaves those sites out,
  and `--site__in=<ids>` limits the list to some site IDs
  ([site list](https://developer.wordpress.org/cli/commands/site/list/)). Leaving archived or spam sites out means
  their events wait until the site is active again; decide that with the owner.
- Each site loads WordPress once per pass. When a full pass takes longer than the interval, the lock makes the next
  pass skip; `scripts/cron-run-log.mjs` shows seconds per site. Split the network into several jobs by site ID ranges,
  each with its own lock file, before shortening the interval.

## Why not `--network`

cron-command 2.3.5 and later accept `wp cron event run --due-now --network`, which runs every site's due events in one
PHP process by switching between sites
([v3.0.0 Cron_Event_Command.php L261-L325](https://github.com/wp-cli/cron-command/blob/v3.0.0/src/Cron_Event_Command.php#L261-L325)).
Two reasons to prefer the loop:

- Switching sites does not switch code: "PHP code loaded with the originally requested site, such as code from a
  plugin or theme, does not switch" ([ms-blogs.php L480-L500](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/ms-blogs.php#L480-L500)).
  An event whose callback comes from a plugin active only on another site finds no callback: a WP-Cron event then runs
  without doing anything, and an Action Scheduler action fails with "no callbacks are registered"
  ([ActionScheduler_Action.php L73-L87](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/actions/ActionScheduler_Action.php#L73-L87)).
- When one site's `doing_cron` lock is held, the command prints the skip warning and returns, so the sites after it
  wait for the next pass ([v3.0.0 L289-L294](https://github.com/wp-cli/cron-command/blob/v3.0.0/src/Cron_Event_Command.php#L289-L294)).

`--network` fits networks where every site runs the same plugins and theme.

## Reading the state of a network

- Run `scripts/cron-readonly-report.sh --path=<root> --url=<site>` per site. For a first pass over many sites, the
  loop above with `wp cron event list --format=count` in place of `cron event run` counts events per site without
  running anything.
- Action Scheduler tables are per site: `wp db prefix --url=<site>` gives the prefix the SQL checks need.
- Hosts differ here too: Pantheon Cron is off for multisite by default
  ([Pantheon](https://docs.pantheon.io/guides/wordpress-developer/wordpress-cron#wordpress-multisite)), and WP Engine
  suggests adding each subdomain of a subdomain network to its portal
  ([WP Engine](https://wpengine.com/support/wp-cron-wordpress-scheduling/)).
