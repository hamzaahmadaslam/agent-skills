# Changes, each with a backup, a check and an undo

Every step here changes the site or the server. Before each one, state the step, its backup, its check and its undo
to the owner and wait for approval of that step. Run it on staging first when a staging copy exists, then on
production at a quiet hour. One change at a time; measure before and after the same way ([verification.md](verification.md)).

## Backups used below

| Backup | Command | Restore | Source |
| --- | --- | --- | --- |
| `wp-config.php` | `cp -p wp-config.php ~/backups/wp-config.php.<date>` (outside the web root: the file holds the database password) | Copy it back | |
| The site user's crontab | `crontab -l > ~/backups/crontab.<date>`; if it prints "no crontab for" the user, write that down and keep an empty file instead | `crontab ~/backups/crontab.<date>` replaces the whole crontab with the saved one | [crontab(1)](https://man7.org/linux/man-pages/man1/crontab.1.html) |
| Action Scheduler tables | `wp db export ~/backups/as-<date>.sql --tables=<prefix>actionscheduler_actions,<prefix>actionscheduler_logs --single-transaction` | `wp db import ~/backups/as-<date>.sql` replaces those two tables | [db export](https://developer.wordpress.org/cli/commands/db/export/) (extra flags go to `mysqldump`); [db import](https://developer.wordpress.org/cli/commands/db/import/) |
| The `cron` option | `wp option get cron --format=json > ~/backups/cron-<date>.json` | Re-schedule single events from it (below); restoring the whole option is a last resort, right after the change | [option get](https://developer.wordpress.org/cli/commands/option/get/); [option update](https://developer.wordpress.org/cli/commands/option/update/) |
| A file | `cp -p <file> <file>.bak-<date>` | Copy it back | |

Exports and the `cron` backup can hold customer data in action and event arguments. Keep them outside the web root,
out of chats and tickets, and delete them when the owner's retention period ends. A backup counts only after one test
restore on staging.

## Add the runner script

- Change: create the script from [server-cron-setup.md](server-cron-setup.md#the-runner-script), owned by the site
  user, `chmod 700`, outside the web root.
- Backup: none, the file is new.
- Check: `sh -n <script>` prints nothing; `ls -l` shows the site user as owner. Do not run it yet.
- Undo: delete the file (after the crontab line that calls it is gone).

## Set DISABLE_WP_CRON

- Change: `wp config set DISABLE_WP_CRON true --raw --type=constant`
  ([config set](https://developer.wordpress.org/cli/commands/config/set/)). On Pantheon, above the `require_once` of
  `wp-config-pantheon.php`.
- Backup: `wp-config.php`. Also note whether the constant existed before: `wp config get DISABLE_WP_CRON --type=constant`.
- Check: `wp eval 'var_export( defined( "DISABLE_WP_CRON" ) && DISABLE_WP_CRON );'` prints `true`; after the next
  page views, the access log shows no new `wp-cron.php` requests from the `WordPress/` client.
- Undo: `wp config delete DISABLE_WP_CRON --type=constant` when it did not exist before
  ([config delete](https://developer.wordpress.org/cli/commands/config/delete/)), otherwise restore the file. Undo this
  before removing the crontab line, so the site is never without a runner.

## Install the crontab line

- Change: write the current crontab plus the new line to a file, show it to the owner, then `crontab <file>`.
- Backup: the site user's crontab.
- Check: `crontab -l` shows the line once; within two intervals the runner log has `run` lines with `exit=0`
  (`node scripts/cron-run-log.mjs <log>`).
- Undo: `crontab ~/backups/crontab.<date>`, then delete the runner script. If there was no crontab before, install the
  empty backup file. Never `crontab -r`.

## A systemd timer instead of crontab

- Change: the two unit files in [hosting-variants.md](hosting-variants.md#systemd-timers-instead-of-crontab), then
  `systemctl daemon-reload` and `systemctl enable --now <name>.timer` (root)
  ([systemctl](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html#enable%20UNIT%E2%80%A6)).
- Backup: none, the files are new.
- Check: `systemctl list-timers <name>.timer` shows the next run; the runner log fills.
- Undo: `systemctl disable --now <name>.timer`, delete both unit files, `systemctl daemon-reload`.

## A host's own scheduler

- Change: the owner switches it in the host's panel (WP Engine Alternate Cron, Plesk WP Toolkit "Take over
  wp-cron.php"), following [hosting-variants.md](hosting-variants.md). Remove any job of your own that does the same.
- Backup: a screenshot or note of the panel setting and the site user's crontab.
- Check: as for the crontab line, using the access log when the host requests `wp-cron.php` over HTTP.
- Undo: switch it back in the panel.

## Remove ALTERNATE_WP_CRON or a changed WP_CRON_LOCK_TIMEOUT

- Change: `wp config delete ALTERNATE_WP_CRON --type=constant`, or `wp config delete WP_CRON_LOCK_TIMEOUT --type=constant`
  to return to the 60-second default.
- Backup: `wp-config.php`, and the current value from `wp config get <NAME> --type=constant`.
- Check: the state report lists the constant as not defined.
- Undo: `wp config set <NAME> <old value> --raw --type=constant`, or restore the file.

## Queue settings, the async runner and the default runner

- Change: the must-use plugin in [tuning-and-cleanup.md](tuning-and-cleanup.md#filters-their-defaults-and-when-to-change-them),
  one filter at a time.
- Backup: none if the file is new; otherwise a copy of the file.
- Check: the state report shows the new values and the file as their owner; completions per hour and run durations
  over the next day, compared with before.
- Undo: delete the file, or restore the copy.

## Add the dedicated queue run

- Change: the second command in the runner script
  ([tuning-and-cleanup.md](tuning-and-cleanup.md#a-dedicated-wp-cli-queue-run)).
- Backup: a copy of the script.
- Check: `queue` lines with `exit=0` in the runner log; runs by "WP CLI" in the SQL report; the past-due count falls.
- Undo: restore the copy.

## Run what is due, once, by hand

After the runner is fixed, the owner may want the backlog cleared at once instead of over the next runs.

- Change: `wp cron event run --due-now`, or for the queue `wp action-scheduler run --batch-size=100 --batches=10`.
  This does the site's normal work sooner: emails, webhooks, renewals, API calls. Never run one hook by name on
  production to test it (`wp cron event run <hook>` runs every scheduled event of that hook,
  [Cron_Event_Command.php L511-L521](https://github.com/wp-cli/cron-command/blob/v2.3.2/src/Cron_Event_Command.php#L511-L521)).
- Backup: none possible; the work cannot be taken back. The approval must say so.
- Check: late events and past-due actions fall in the reports; no fatal errors in the PHP error log.
- Undo: none.

## Delete old Action Scheduler history

- Change: `wp action-scheduler clean` with `--status` and, always, `--before`
  ([tuning-and-cleanup.md](tuning-and-cleanup.md#cleaning-up-a-backlog)).
- Backup: both Action Scheduler tables, right before, at a quiet hour.
- Check: counts by status and log rows in the SQL report; pending actions unchanged.
- Undo: import the export. That also removes every action scheduled after the backup, which is why the backup is taken
  right before and the import is only for a mistake found at once.

## Cancel duplicate actions

- Change: after the code that creates them is fixed, `wp action-scheduler action list --hook=<hook> --status=pending --per_page=0 --format=ids`,
  keep the earliest per argument set, and cancel the others by ID with `wp action-scheduler action cancel` or delete
  them with `wp action-scheduler action delete <id>...` ([action-scheduler-wp-cli.md](action-scheduler-wp-cli.md)).
- Backup: both Action Scheduler tables.
- Check: the duplicates block of the SQL report is empty for that hook; one pending action per argument set remains.
- Undo: re-create an action with `wp action-scheduler action create <hook> <date> --args='<json>' --group=<group>` from
  the saved details, or import the export right after the change.

## Remove duplicate or orphaned WP-Cron events

- Change: `wp cron event unschedule <hook>` removes every event of a hook
  ([cron event unschedule](https://developer.wordpress.org/cli/commands/cron/event/unschedule/)); with cron-command
  2.3.5 or later, `wp cron event delete <hook> --match-args='<json>'` removes one argument set
  ([v3.0.0 L416-L504](https://github.com/wp-cli/cron-command/blob/v3.0.0/src/Cron_Event_Command.php#L416-L504)). Only
  for hooks the state report shows as duplicated or without a callback, and only after checking that the plugin
  behind them is really gone or fixed; an active plugin usually schedules its event again.
- Backup: the `cron` option, and the list of affected events with `wp cron event list --fields=hook,next_run_gmt,recurrence,args --format=json`.
- Check: `wp cron event list` shows the hook once (or not at all); the plugin's feature still works.
- Undo: `wp cron event schedule <hook> <next-run> [<recurrence>] --0=<first arg>` per event from the saved list
  ([cron event schedule](https://developer.wordpress.org/cli/commands/cron/event/schedule/)).
- Never `wp cron event delete --all` or `--due-now` on production.

## Update Action Scheduler (through the plugin that bundles it)

- Change: update WooCommerce or the plugin that carries the newer copy, after a staging run that times the schema
  update ([tuning-and-cleanup.md](tuning-and-cleanup.md#before-updating-to-action-scheduler-420)).
- Backup: a full database export and the plugin's current version number.
- Check: `wp action-scheduler version` shows the new version; `wp action-scheduler status` works; the queue moves.
- Undo: reinstall the previous plugin version (`wp plugin install <slug> --version=<old> --force`,
  [plugin install](https://developer.wordpress.org/cli/commands/plugin/install/)) and, if the schema changed, restore
  the database export taken right before.
