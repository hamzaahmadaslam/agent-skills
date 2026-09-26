# Action Scheduler WP-CLI commands

Read this before running any `wp action-scheduler` command. Action Scheduler registers the commands itself when WP-CLI
loads WordPress ([ActionScheduler.php L243-L251](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler.php#L243-L251));
`wp action-scheduler <command> --help` lists the options of the copy that is active. The documented set is on
[actionscheduler.org/wp-cli](https://actionscheduler.org/wp-cli/). The status, source and action commands arrived in
3.9.1 ([changelog](https://github.com/woocommerce/action-scheduler/blob/4.2.0/changelog.txt)). Pass `--url=<site>` on
multisite. Code links point at 4.0.0 unless they say otherwise.

## Read-only commands

| Command | What it prints | Source |
| --- | --- | --- |
| `wp action-scheduler status` | Data store class, runner class (with "(disabled)" when the default runner is not hooked to `action_scheduler_run_queue`), active version, and for each status the count and the oldest and newest scheduled date | [System_Command L61-L88](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/System_Command.php#L61-L88) |
| `wp action-scheduler version [--all]` | The active version, or every registered copy | [L102-L129](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/System_Command.php#L102-L129) |
| `wp action-scheduler source [--all] [--fullpath]` | Which plugin's copy is loaded | [L149-L194](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/System_Command.php#L149-L194) |
| `wp action-scheduler runner`, `wp action-scheduler data-store` | Runner and store class names. The code names the second command `data-store`; the documentation page writes `datastore` | [L30-L52](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/System_Command.php#L30-L52) |
| `wp action-scheduler action list` | Actions matching the filters below | [List_Command](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action/List_Command.php) |
| `wp action-scheduler action get <id>` | One action; `--fields` and `--format` as usual | [Action_Command L175-L211](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action_Command.php#L175-L211) |
| `wp action-scheduler action logs <id>` | The action's log entries (runs `action get <id> --field=log_entries`) | [L273-L288](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action_Command.php#L273-L288) |
| `wp action-scheduler action next <hook> [--args=<json>] [--group=<group>] [--raw]` | The next pending action of a hook | [L290-L321](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action_Command.php#L290-L321) |

`action list` details:

- It passes its options to `as_get_scheduled_actions()`: `hook`, `args` (JSON), `date`, `date_compare`, `modified`,
  `modified_compare`, `group`, `status`, `claimed`, `per_page`, `offset`, `orderby`, `order`
  ([List_Command L12-L26, L84-L98](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action/List_Command.php#L12-L98)).
- `per_page` defaults to 5, and only a value above 0 limits the query
  ([DBStore L436-L452, L617-L621](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L436-L452)).
  `--format=count` counts the rows returned, so without `--per_page=0` it never says more than 5. Always pass
  `--per_page=0` with `--format=count` or `--format=ids`, or count with `scripts/cron-checks.sql` instead.
- The table, CSV, JSON and YAML formats load every listed action and all its log entries
  ([L100-L127](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action/List_Command.php#L100-L127)).
  Keep them to a few rows with `--per_page`.
- Arguments and log entries can hold customer data (email addresses, order numbers, exception messages). Print them
  only for the few actions under investigation, and keep them out of the report.

Examples:

```sh
wp action-scheduler status
wp action-scheduler version --all
wp action-scheduler source --all
wp action-scheduler action list --status=failed --per_page=0 --format=count
wp action-scheduler action list --hook=woocommerce_cleanup_sessions --status=pending --per_page=5 --fields=id,status,scheduled_date
wp action-scheduler action logs 12345
```

## Commands that change the site

Each needs the owner's approval and the backup and undo in [changes-and-rollback.md](changes-and-rollback.md).

| Command | What it does | Source |
| --- | --- | --- |
| `wp action-scheduler run` | Runs due actions now, with their side effects: emails, webhooks, payment renewals, API calls | [Scheduler_command L38-L128](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/ActionScheduler_WPCLI_Scheduler_command.php#L38-L128) |
| `wp action-scheduler action run <id>...` | Runs the given actions if they are pending; others are counted as ignored | [Run_Command L53-L106](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action/Run_Command.php#L53-L106) |
| `wp action-scheduler action cancel <hook> [--args=<json>] [--group=<group>]` | Cancels the earliest pending action that matches (`as_unschedule_action()`); cancelling the pending instance of a recurring action ends the series | [Cancel_Command](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action/Cancel_Command.php); [functions.php L251-L303](https://github.com/woocommerce/action-scheduler/blob/4.0.0/functions.php#L251-L303) |
| `wp action-scheduler action cancel <hook> --all` | Cancels every pending action of the hook; with `--group` or `--args` it matches those as well (`as_unschedule_all_actions()`) | [functions.php L305-L329](https://github.com/woocommerce/action-scheduler/blob/4.0.0/functions.php#L305-L329) |
| `wp action-scheduler action delete <id>...` | Deletes actions and, through `action_scheduler_deleted_action`, their log rows | [Delete_Command](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action/Delete_Command.php) |
| `wp action-scheduler action create <hook> <start> [--args=<json>] [--group=<group>] [--interval=<seconds>] [--cron=<expression>]` | Creates an action; `<start>` is a timestamp or date string such as `now`, or `async` | [Action_Command L42-L92](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action_Command.php#L42-L92); [Create_Command](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action/Create_Command.php) |
| `wp action-scheduler action generate` | Creates many test actions. Never on production | [Action_Command L124-L173](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action_Command.php#L124-L173) |
| `wp action-scheduler clean` | Deletes old actions and their logs | [Clean_Command](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/ActionScheduler_WPCLI_Clean_Command.php) |
| `wp action-scheduler fix-schema` | Runs `dbDelta()` on the tables again, which can alter large tables | [Scheduler_command L8-L36](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/ActionScheduler_WPCLI_Scheduler_command.php#L8-L36) |
| `wp action-scheduler migrate` | Only while a migration from the pre-3.0 post storage is unfinished | [WP-CLI](https://actionscheduler.org/wp-cli/) |

Prefer action IDs for single changes: list the IDs, check them, then act on those IDs, then list again.

## wp action-scheduler run

| Option | Default | Source |
| --- | --- | --- |
| `--batch-size=<n>` | 100 | [Scheduler_command L43-L44, L78](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/ActionScheduler_WPCLI_Scheduler_command.php#L76-L90) |
| `--batches=<n>` | 0, which means "until all actions are complete" | same |
| `--cleanup-batch-size=<n>` | The batch size | same |
| `--hooks=<a,b>` | All hooks | same |
| `--group=<slug>` | All groups | same |
| `--exclude-groups=<a,b>` | None; ignored when `--group` is given | same |
| `--free-memory-on=<n>` | 50 actions | same |
| `--pause=<seconds>` | 0 | same |
| `--force` | Off; on, it runs past the concurrency limit | same |

- Before claiming, it releases stale claims and fails stuck actions, then checks the concurrency limit and stops with
  "There are too many concurrent batches." when another runner holds a claim
  ([WPCLI_QueueRunner L71-L101](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/ActionScheduler_WPCLI_QueueRunner.php#L71-L101)).
  In a cron log, that line means another runner was busy, or a claim less than 5 minutes old was left behind.
- It has no time limit of its own: each batch runs to the end
  ([L131-L153](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/ActionScheduler_WPCLI_QueueRunner.php#L131-L153)).
  From a cron job, bound it with `--batches` and `timeout`.
- Actions run with the context "WP CLI", which the logs and `scripts/cron-checks.sql` show.
- `--force` and extra parallel runners raise the load on PHP and the database; the scaling guide warns that raising
  concurrency "can substantially increase server load and take down a site" ([Scaling](https://actionscheduler.org/perf/)).
- The WP-CLI page recommends WP-CLI over the WP-Cron runner for long-running tasks, large queues and sites with heavy
  WP-Cron use ([WP-CLI](https://actionscheduler.org/wp-cli/)).

## wp action-scheduler clean

| Option | Default | Source |
| --- | --- | --- |
| `--batch-size=<n>` | 20 per status | [Clean_Command L12-L40](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/ActionScheduler_WPCLI_Clean_Command.php#L12-L40) |
| `--batches=<n>` | 0, which means until nothing is left to delete | same |
| `--status=<a,b>` | `complete` and `canceled` | same |
| `--before=<date>` | 4.1.0 and later: `31 days ago`. **4.0.0: empty, which becomes now** | [4.0.0 L39](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/ActionScheduler_WPCLI_Clean_Command.php#L39); [4.2.0 L39](https://github.com/woocommerce/action-scheduler/blob/4.2.0/classes/WP_CLI/ActionScheduler_WPCLI_Clean_Command.php#L39) |
| `--pause=<seconds>` | 0 | same |

- In 4.0.0, the version WooCommerce 11.1.2 bundles, an empty `--before` goes to `as_get_datetime_object('')`, which
  builds a date from the empty string, that is now
  ([functions.php L489-L498](https://github.com/woocommerce/action-scheduler/blob/4.0.0/functions.php#L489-L498)).
  `wp action-scheduler clean` without `--before` then deletes every complete and cancelled action, not only those
  older than 31 days. 4.1.0 corrected the default
  ([changelog](https://github.com/woocommerce/action-scheduler/blob/4.2.0/changelog.txt)). Always pass `--before`.
- The date compared is `last_attempt_gmt`, when the action last ran or was claimed
  ([QueueCleaner L231-L243](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/ActionScheduler_QueueCleaner.php#L231-L243);
  [DBStore L557-L562](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L557-L562)),
  although the option's help text says "scheduled date".
- The scaling guide's example for old failed actions:
  `wp action-scheduler clean --status=failed --batch-size=50 --before='90 days ago' --pause=2`
  ([Scaling](https://actionscheduler.org/perf/)).

## Repeating a failed action

`action run` ignores actions that are not pending, and failed actions are not retried
([Abstract_QueueRunner L92-L96](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/abstracts/ActionScheduler_Abstract_QueueRunner.php#L63-L128)).
To repeat one, read its hook, arguments and group with `action get <id> --fields=hook,args,group`, fix the cause first,
then create a new action with the same values (`action create <hook> now --args='<json>' --group=<group>`). That runs
the work again, with its side effects, so it needs the owner's approval, and for payments or emails the plugin
vendor's own retry tool is safer when one exists.
