---
name: wp-cron-action-scheduler-health
description: "Move WordPress WP-Cron from page-view spawning to a real server cron and keep Action Scheduler healthy, with read-only checks first and a backup, a check and an undo for every change. Covers how WP-Cron spawns, locks and reschedules, DISABLE_WP_CRON, ALTERNATE_WP_CRON and WP_CRON_LOCK_TIMEOUT, a system cron that runs WP-CLI `wp cron event run --due-now` under flock (or requests wp-cron.php), hosting variants (cPanel, Plesk, systemd, Kubernetes, several web servers, WordPress VIP, WP Engine, Kinsta, Pantheon), multisite, Action Scheduler runners, past-due and failed actions, claims, the async request runner, `wp action-scheduler` commands, retention and cleanup of actions and logs, queue tuning filters, and diagnosing missed or duplicated schedules. Ends with verification and a report. Use when scheduled posts miss their time, WooCommerce shows past-due actions, emails, webhooks or renewals run late or twice, the Action Scheduler tables keep growing, or before moving a site to a server cron."
license: MIT
compatibility: "Needs shell access with WP-CLI to the site or a staging copy, the mysql client that `wp db query` uses, and Node.js 20 or later for the log summaries. Written against WordPress 7.1.2, WP-CLI 2.12.0 (its bundled cron-command 2.3.2; 2.3.5 to 3.0.0 checked), Action Scheduler 4.0.0 (inside WooCommerce 11.1.2) and 4.2.0, and WooCommerce 11.1.2; references/version-notes.md lists what differs."
metadata:
  author: Hamza Ahmad Aslam
  version: "1.0.1"
  last_verified: "2026-09-26"
---

# WP-Cron and Action Scheduler health

This skill moves a WordPress site's scheduled work from page-view spawning to a real server cron, keeps Action
Scheduler's queue moving and small, and explains missed and duplicated schedules from evidence. It reads and measures
first. Every change it proposes comes with a backup, a check and an undo, and waits for the owner's approval. It does
not fix plugin code: it names the hook, the plugin behind it and the evidence, and says who should change what.

It is written for coding agents that support the Agent Skills format, and a person can follow it the same way. Facts
are sourced in `references/`, next to each fact: the WordPress 7.1.2 source, WP-CLI and cron-command source, Action
Scheduler 4.0.0 and 4.2.0 source, actionscheduler.org, developer.wordpress.org, developer.woocommerce.com, and the
hosts' and tools' own documentation.

## When to use

- Scheduled posts show "Missed schedule", or Site Health says "A scheduled event is late" or "has failed".
- WooCommerce or Action Scheduler shows "past-due actions found; something may be wrong", or order emails, webhooks,
  subscription renewals or sale prices run late.
- Work happens twice: duplicate emails, webhook deliveries or renewals.
- `{prefix}actionscheduler_actions` or `{prefix}actionscheduler_logs` keeps growing.
- Before moving a site to a server cron, changing hosts, or turning on a host's cron feature.
- The queue moves only while someone has the admin open.

Related skills in this collection: `woo-checkout-performance-audit` (what the queue does to checkout),
`wp-slow-query-investigation` (one slow query, including queue queries), `wp-autoload-audit` (autoloaded options, of
which `cron` is one) and `wp-multisite-migration` (moving a site in or out of a network).

## Safety rules

1. Read-only by default. Before any change, state the step, its backup, its check and its undo, and wait for the
   owner's approval of that step. One approval covers one step.
2. Running scheduled work is a change. `wp cron event run`, `wp action-scheduler run` and `action run` do the site's
   scheduled work now: they send emails, deliver webhooks, charge renewals and call APIs, and cannot be taken back;
   `action create` schedules more of it. Never run a hook by name on production to test it; `--due-now` runs only
   what is already due.
3. One runner per site. Find every existing runner before adding one (step 1). Two runners can run the same due event
   twice, and WP-CLI 2.12.0's `--due-now` takes no lock.
4. Cron jobs run as the site's own system user, never as root: WP-CLI refuses root, and cron runs automatic updates
   that write files.
5. Back up first: `wp-config.php`, the site user's crontab, and both Action Scheduler tables before any delete. A backup
   counts after one test restore on staging.
6. Never on production: `crontab -r`, `wp action-scheduler clean` without `--before` (on 4.0.0 it deletes every
   complete and cancelled action), `TRUNCATE` or `DELETE` on the Action Scheduler tables, `wp cron event delete --all`
   or `--due-now`, `wp action-scheduler action generate`, `--force` or raised concurrency without a load test.
7. Undo `DISABLE_WP_CRON` before removing a cron job, never the other way round, so the site always has a runner.
8. Event and action arguments and Action Scheduler log texts can hold customer data (emails, order numbers). The
   helpers print hook names, counts and times only. Read arguments only for the few items under investigation, and
   keep them, access logs and exports out of chats, tickets and the report.
9. Multisite: everything is per site. Pass `--url=<site>` to every WP-CLI command.
10. Staging first for anything that installs code or changes a schedule; production at a quiet hour.

## How the parts fit

| What starts work | What it runs | What limits it | Read |
| --- | --- | --- | --- |
| A page view with WP-Cron on | A loopback request to `wp-cron.php` at `shutdown` (6.9.0 and later), at most once per 60 s | Traffic, page caches, the loopback reaching the site, the `doing_cron` lock | `references/wp-cron-internals.md` |
| A server cron job | `wp cron event run --due-now` (or a request to `wp-cron.php`) | The interval, the job's `flock`, the WP-CLI version | `references/server-cron-setup.md` |
| WP-Cron event `action_scheduler_run_queue`, every 60 s | Action Scheduler batches of 25 for up to 30 s | One batch at a time | `references/action-scheduler-internals.md` |
| An admin or `admin-ajax.php` request | Action Scheduler's async runner, at most once per 60 s, chained while actions are due | Same | `references/action-scheduler-internals.md` |
| `wp action-scheduler run` | Batches of 100 until the queue is empty unless `--batches` | The concurrency check, unless `--force` | `references/action-scheduler-wp-cli.md` |
| The host | WP Engine Alternate Cron, Pantheon Cron, VIP Cron Control, Plesk WP Toolkit, Kinsta crontab | The host's interval | `references/hosting-variants.md` |

## Procedure

### 0. Record the setup (read-only)

Run as the site's system user, where WP-CLI reaches the site:

```sh
bash scripts/cron-readonly-report.sh --path=/path/to/wordpress              # add --url=<site> on multisite
```

The report prints WP-CLI, PHP and WordPress versions, the cron constants as written in `wp-config.php`, then
`scripts/cron-state.php` (runtime constants, the `doing_cron` lock, custom cron storage, schedules, every event by hook
with late and failed counts by Site Health's thresholds and duplicate, argument-set, unknown-schedule and no-callback
flags, Action Scheduler's runner, effective tuning values and housekeeping actions), the next 40 events, Action
Scheduler's version, sources and status, the user's cron-related crontab lines, systemd timers, and the SELECT blocks in
`scripts/cron-checks.sql`. It does not spawn WP-Cron and makes no network calls of its own. On a big site add
`CRON_REPORT_SKIP_SCANS=1`, or run it against a replica or staging copy.

Then read `references/version-notes.md` for the site's versions. Three matter most: whether WP-CLI's cron-command takes
the lock (2.3.5 and later), whether Action Scheduler is 4.0.0 (`clean --before` default, the async lock defect), and
whether WooCommerce is 10.1.0 or later (its cleanups live in the queue).

### 1. Find every runner (read-only)

- The report's constants: `DISABLE_WP_CRON`, `ALTERNATE_WP_CRON`, `WP_CRON_LOCK_TIMEOUT`, file value and runtime value.
- The site user's crontab lines and systemd timers from the report; system crontabs and other users' need root or the
  host.
- The host's own scheduler: `references/hosting-variants.md` (WordPress VIP and WP Engine disable or replace
  `wp-cron.php` handling; Kinsta keeps its jobs at the top of the site's crontab; Plesk WP Toolkit can add a second
  task).
- The access log: `node scripts/cron-access-log.mjs <access logs>` counts `wp-cron.php` requests per hour by client
  (`WordPress/` is the site's own loopback, `curl/` a server job) and status, and the async runner's requests.

Write down each runner with its interval and user. More than one runner for the same site is a finding.

### 2. Read WP-Cron's health (read-only)

From the state section: due, late and failed counts; the most overdue event; hooks flagged DUP (same arguments at
several times), ARGS (several argument sets), SCHED (schedule no longer registered), NOCB (no callback in this process)
and LATE or FAILED; the lock state; the `cron` option size; callbacks on the `pre_*` filters (another system stores the
events). NOCB can be a false alarm for plugins that add callbacks only in cron or front-end requests: confirm with the
plugin before calling an event orphaned. Mechanisms: `references/wp-cron-internals.md`.

### 3. Read the queue's health (read-only)

From the Action Scheduler section and the SQL blocks: counts by status; past-due over 5 minutes, 1 hour and 1 day;
pending by hook; runs per runner in the last hour and day (WP Cron, Async Request, WP CLI); completions per hour;
failures by cause; recurring actions stopped after repeated failures; stuck in-progress actions and claims older than 5
minutes; duplicate pending actions; housekeeping and WooCommerce recurring actions; the retention backlog; log rows and
orphaned logs; table sizes. `wp action-scheduler action list` needs `--per_page=0` to count past 5
(`references/action-scheduler-wp-cli.md`). Mechanisms: `references/action-scheduler-internals.md`.

### 4. Diagnose

Match each finding to a row of `references/diagnosis.md`: WP-Cron late or missed, WP-Cron duplicated, actions late,
failures by log message, action duplicates, and tables that keep growing. Each row gives the likely cause, the
read-only check that confirms it and where the fix is. Confirm before you name a cause; list what stays unconfirmed.
Duplicates that come from plugin code need the vendor: clearing them before the code is fixed only lets them return.

### 5. Plan the change (get approval)

Write the plan for the owner, one change per line, each with backup, check and undo from
`references/changes-and-rollback.md`:

- Where the site's host runs cron itself (`references/hosting-variants.md`), use the host's switch, not a crontab.
- Otherwise choose the method (WP-CLI when there is shell access, the HTTP request where only a URL can be scheduled),
  the interval (every minute for stores whose customers wait on queued work, every 5 minutes for most sites; the host's
  minimum), the system user, the paths, the log file and the lock file (`references/server-cron-setup.md`).
- Networks: one job that loops over the sites, not `--network` when plugins differ per site
  (`references/multisite.md`).
- List every runner to remove, and any `ALTERNATE_WP_CRON` or raised `WP_CRON_LOCK_TIMEOUT` to delete.

### 6. Make the change, one step at a time

In this order, each step approved on its own (`references/server-cron-setup.md#order-of-the-change`):

1. Back up `wp-config.php` and the site user's crontab.
2. Rehearse in cron's environment with a read-only command (`env -i ... wp cron event list --format=count`).
3. Add the runner script (flock, timeout, one log line per run); check it with `sh -n`.
4. Set `DISABLE_WP_CRON` with `wp config set DISABLE_WP_CRON true --raw --type=constant`.
5. Install the crontab line right away (or the systemd timer, or the host switch).
6. Watch the first two runs in the log: `node scripts/cron-run-log.mjs <log> --interval=<seconds>`.

Remove other runners found in step 1 as separate steps. If the owner wants the backlog cleared at once, `wp cron event
run --due-now` is a step of its own with no undo.

### 7. Verify

Follow `references/verification.md`: the runtime constant; one `run` line per interval with `exit=0` and no `skip`
lines; no event more than about one interval past due; Site Health's Scheduled events test; no new `WordPress/` spawns
of `wp-cron.php` (requests with `doing_wp_cron`); "WP Cron" runs and a falling past-due count in the SQL report; and
after 24 hours, the daily events and Action Scheduler's 3 am cleanup. Roll back with the order in that file when a
rollback trigger holds at two checks in a row.

### 8. Tune and clean up (only after step 7 passes)

- Queue too slow with a working cron: one filter at a time in a must-use plugin, or a dedicated
  `wp action-scheduler run --batches=<n>` in the runner script (`references/tuning-and-cleanup.md`).
- Backlog of old rows: let the daily cleanup (4.0.0 and later) catch up, or `wp action-scheduler clean` with
  `--status` and always `--before`, after a backup of both tables.
- Duplicates: after the vendor's fix, delete the extras by ID (`action cancel` works by hook and cancels the earliest
  match); remove WP-Cron events only for plugins that are gone or fixed.
- Before updating to Action Scheduler 4.2.0, which alters the actions table, shrink the table and time the update on
  staging.

## Reference files

| File | Read it when |
| --- | --- |
| `references/wp-cron-internals.md` | Steps 2 and 4: storage, spawn, lock, `wp-cron.php`, rescheduling, duplicates, constants, Site Health thresholds |
| `references/action-scheduler-internals.md` | Steps 3 and 4: tables, runners, claims, failures, unique actions, housekeeping, retention, WooCommerce's actions |
| `references/action-scheduler-wp-cli.md` | Before any `wp action-scheduler` command: read-only and changing commands, `run` and `clean` options and traps |
| `references/diagnosis.md` | Step 4: symptom, cause, read-only check and fix for missed, late and duplicated schedules and growing tables |
| `references/server-cron-setup.md` | Steps 5 and 6: WP-CLI or HTTP, WP-CLI versions and the lock, the runner script, crontab, interval, `DISABLE_WP_CRON`, order of the change |
| `references/hosting-variants.md` | Steps 1 and 5: VIP, WP Engine, Kinsta, Pantheon, Plesk, cPanel, systemd, Kubernetes, several servers, no shell, Windows |
| `references/multisite.md` | Any network: per-site schedules and queues, the loop, why not `--network` |
| `references/changes-and-rollback.md` | Steps 5, 6 and 8: every change with its backup, check and undo |
| `references/verification.md` | Step 7: what to check when, expected values, rollback triggers |
| `references/tuning-and-cleanup.md` | Step 8: filters and defaults, a dedicated WP-CLI queue run, cleaning a backlog, the 4.2.0 schema change |
| `references/version-notes.md` | Step 0 and any site not on the versions above; documentation that disagrees with the code |
| `scripts/cron-readonly-report.sh` | Step 0 and after each change (read-only) |
| `scripts/cron-state.php` | The WP-Cron and Action Scheduler state alone (read-only, `wp eval-file`) |
| `scripts/cron-checks.sql` | The SELECT blocks the report runs; usable alone after filling in `{prefix}` |
| `scripts/cron-access-log.mjs` | Steps 1 and 7: `wp-cron.php` and async runner requests from access logs (read-only, local files) |
| `scripts/cron-run-log.mjs` | Steps 6 and 7: runs, gaps, skips, failures and durations from the runner script's log (read-only, local files) |

The helper scripts only read the files and database they are pointed at and print a report; they write nothing and
make no network requests of their own.

## Report format

End every session with this report, filled in from command output, never from memory:

```text
WP-Cron and Action Scheduler health: <site> (<date, UTC>)
Environment: WordPress <v>, PHP CLI <v> / web <v>, WP-CLI <v> (cron-command lock: yes/no), Action Scheduler <v>
             (source <plugin>), WooCommerce <v or none>; multisite <no | n sites>; host <name or self-managed>
Runners found: <runner, interval, user> ... ; DISABLE_WP_CRON <file / runtime>; ALTERNATE_WP_CRON <..>

| Number                                              | Before | After | How                        |
| --------------------------------------------------- | ------ | ----- | -------------------------- |
| WP-Cron events due / late / failed (Site Health)    |        |       | cron-state.php             |
| Hooks flagged DUP / ARGS / SCHED / NOCB             |        |       | cron-state.php             |
| cron option size (bytes) / events                   |        |       | cron-state.php             |
| Actions past due > 1 h / > 1 day                    |        |       | cron-checks.sql            |
| Actions completed per hour (median of last 24 h)    |        |       | cron-checks.sql            |
| Runs by runner, last 24 h (WP Cron / Async / CLI)   |        |       | cron-checks.sql            |
| Failed actions, last 7 days / top cause             |        |       | cron-checks.sql            |
| Claims or in-progress actions older than 5 min      |        |       | cron-checks.sql            |
| Retention backlog (complete+canceled > 31 d)        |        |       | cron-checks.sql            |
| Runner runs per hour / gaps / skips / failures      |        |       | cron-run-log.mjs           |
| wp-cron.php requests from WordPress/ per hour       |        |       | cron-access-log.mjs        |

Findings (largest effect first):
- <finding>: <evidence and where it was measured> -> <cause> (<confirmed | likely | unconfirmed>; <reference file>)
Changes made: <change> | backup <file, restore tested yes/no> | check <result> | undo <tested yes/no>
Runner now: <method, interval, user, script path, log path, lock path>
Not changed, owner decision needed: <item, trade-off>
For plugin vendors or the host: <hook or setting, evidence, request>
Next step: <step, its backup, its check, its undo> (needs approval: yes/no)
Re-check: <what, when>
Files to delete after the work: <exports, backups past retention, copied logs>
```
