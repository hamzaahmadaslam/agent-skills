# HPOS WP-CLI commands

Checked against `CLIRunner.php` at the WooCommerce 11.1.2 tag (the current release on 2026-09-26) and the official
command reference. Links to code point at that tag, so line numbers stay valid.

- Code: [CLIRunner.php @ 11.1.2](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php)
- Reference page: [wc hpos](https://developer.woocommerce.com/docs/wc-cli/wc-cli-commands/wc-hpos/)
- Usage guide with sample output: [HPOS CLI tools](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/cli-tools/)

## Command list

| Command | What it does | Writes? | First release with this name |
| --- | --- | --- | --- |
| `wp wc hpos status` | Prints `HPOS enabled?`, `Compatibility mode enabled?`, `Unsynced orders` and `Orders subject to cleanup` ([L1032-L1061](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L1032-L1061)) | No | 8.6.0 ([8.6.0 tag](https://github.com/woocommerce/woocommerce/blob/8.6.0/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L68)) |
| `wp wc hpos count_unmigrated` | Prints `There are N orders to be synced.` ([L122-L161](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L122-L161)) | No | 8.9.0 (`wp wc cot count_unmigrated` before) |
| `wp wc hpos compatibility-info [--include-inactive] [--display-filenames]` | Lists WooCommerce-aware plugins as compatible, incompatible or uncertain for HPOS ([L1232-L1287](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L1232-L1287)) | No | 9.2.0 (docblock says 9.1.0, but the [9.1.0 tag](https://github.com/woocommerce/woocommerce/blob/9.1.0/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L61-L83) does not register it; the [9.2.0 tag](https://github.com/woocommerce/woocommerce/blob/9.2.0/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php) does) |
| `wp wc hpos verify_data` | Compares each order in the posts tables with its HPOS copy ([L305-L576](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L305-L576)) | No, unless `--re-migrate` | 8.9.0 (`wp wc cot verify_cot_data` before) |
| `wp wc hpos diff <order_id> [--format=table\|csv\|json\|yaml]` | Shows the properties and meta that differ for one order ([L1063-L1141](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L1063-L1141)) | No | 8.6.0 ([changelog, PR 43173](https://github.com/woocommerce/woocommerce/pull/43173)) |
| `wp wc hpos sync [--batch-size=500]` | Copies pending orders from the authoritative storage to the other one ([L163-L276](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L163-L276)) | Yes, the backup side | 8.9.0 (`wp wc cot sync` before) |
| `wp wc hpos compatibility-mode enable` / `disable` | Turns compatibility mode (data sync) on or off ([L1330-L1383](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L1330-L1383)) | Yes: one option, plus the HPOS tables when enabling and they are missing | 9.1.0 ([PR 48117](https://github.com/woocommerce/woocommerce/pull/48117)) |
| `wp wc hpos enable [--with-sync] [--for-new-shop] [--ignore-plugin-compatibility]` | Makes HPOS authoritative after pre-checks ([L728-L844](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L728-L844)) | Yes | 8.9.0 (`wp wc cot enable` from 8.2.0, [PR 39865](https://github.com/woocommerce/woocommerce/pull/39865)) |
| `wp wc hpos disable [--with-sync]` | Makes posts authoritative after a pending-sync check ([L846-L907](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L846-L907)) | Yes | 8.9.0 (`wp wc cot disable` before) |
| `wp wc hpos backfill <order_id> --from=<posts\|hpos> --to=<posts\|hpos> [--meta_keys=<keys>] [--props=<props>]` | Copies one order, or chosen meta keys or properties, between storages regardless of settings ([L1143-L1230](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L1143-L1230)) | Yes, the `--to` side | 8.7.0 ([PR 44281](https://github.com/woocommerce/woocommerce/pull/44281)); partial copies 8.8.0 ([PR 45171](https://github.com/woocommerce/woocommerce/pull/45171)) |
| `wp wc hpos cleanup <all\|id\|range>... [--batch-size=500] [--force]` | Deletes legacy post meta for migrated orders ([L909-L1030](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L909-L1030)) | Yes, destructive | 8.5.0 ([PR 42848](https://github.com/woocommerce/woocommerce/pull/42848)) |

The five older commands are registered under `wc hpos` and, with a deprecation warning, under `wc cot`. The warning
text says the `wc cot` names are deprecated since 8.9.0
([L61-L85](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L61-L85)).
`wp wc cot migrate` is registered but only prints a deprecation message
([L278-L303](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L278-L303)).

## Name traps

- `verify_cot_data` exists only as the deprecated `wp wc cot verify_cot_data`. Under `wc hpos` the name is
  `verify_data`: the loop renames `verify_cot_data` to `verify_data` when it registers the `wc hpos` alias
  ([L62-L66](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L62-L66)).
  The method docblock example (`wp wc hpos verify_cot_data`, [L346](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L346))
  and the large-store guide ([guide](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/guide-large-store/))
  both write `wp wc hpos verify_cot_data`, which is not a registered command. Use `wp wc hpos verify_data`.
- `backfill` needs both `--from` and `--to`; the code rejects a missing or invalid datastore
  ([L1189-L1198](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L1189-L1198)).
  The CLI tools page shows one example without them; that example does not match the code.
- `compatibility-info` and `compatibility-mode` are missing from the table on the CLI tools page but are on the
  [command reference](https://developer.woocommerce.com/docs/wc-cli/wc-cli-commands/wc-hpos/).

## Behavior worth knowing before running anything

- `status`, `count_unmigrated`, `enable` and `disable` all use the full pending count
  (`get_current_orders_pending_sync_count()`, directly or through `get_total_pending_count()`)
  ([DataSynchronizer.php L482-L494, L890-L892](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L482-L494)).
  The settings screen uses the cheaper `has_orders_pending_sync()`, which returned a false "in sync" after a full sync
  from 9.9.0 until 11.1.0 ([PR 67838](https://github.com/woocommerce/woocommerce/pull/67838), bug introduced by
  [PR 56186](https://github.com/woocommerce/woocommerce/pull/56186), milestone 9.9.0). Gate storage switches on the CLI
  count.
- `sync` creates the HPOS tables if they are missing, then processes batches until nothing is pending
  ([L182-L252](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L182-L252)).
  Direction follows the current setting: posts to HPOS while posts are authoritative, HPOS to posts after the switch
  ([DataSynchronizer.php L766-L799](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L766-L799)).
  WooCommerce's large-store guide says stopping the sync job and resuming it later is safe
  ([guide](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/guide-large-store/)).
- `verify_data` walks order IDs from the posts table in batches (`--batch-size`, default 500), limited by
  `--start-from` and `--end-at`, and by `--order-types` (default: all registered order types except placeholders)
  ([L305-L433](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L305-L433)).
  It ends with `WP_CLI::error` (non-zero exit) when it finds differences
  ([L545-L575](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L545-L575)).
  The comparison queries are SELECTs ([MetaToCustomTableMigrator.php](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/MetaToCustomTableMigrator.php)).
- `verify_data --re-migrate` copies posts data over HPOS for every order that fails. The option text says to use it only
  if the site has never run with HPOS authoritative, or after checking each reported error, "otherwise, you risk stale
  data overwriting the more recent data"
  ([L339-L341](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L339-L341)).
- `enable` refuses when an active plugin is considered incompatible, when the HPOS tables are missing on an existing
  shop, or when any order is pending sync. `--with-sync` also turns on compatibility mode.
  `--ignore-plugin-compatibility` skips only the plugin check
  ([L758-L844](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L758-L844)).
- `disable` refuses while any order is pending sync; `--with-sync` also turns compatibility mode off
  ([L865-L907](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L865-L907)).
- `cleanup` runs only when HPOS is authoritative and compatibility mode is off
  ([L948-L950](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L948-L950)).
  For each order it deletes every post meta row, then turns the post into a `shop_order_placehold` draft, or deletes the
  post when the order is not in HPOS. It refuses an order whose post looks newer than the HPOS record unless `--force`
  is passed, and the error tells you to compare with `wp wc hpos diff <id>` and fix with
  `wp wc hpos backfill <id> --from=posts --to=hpos`
  ([LegacyDataHandler.php L156-L199](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/LegacyDataHandler.php#L156-L199)).
- `diff` reads both copies with sync-on-read forced off, so running it does not change the order
  ([LegacyDataHandler.php L328-L337](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/LegacyDataHandler.php#L328-L337)).
- `backfill` with `--meta_keys` rejects WooCommerce internal meta keys and asks for `--props` instead
  ([LegacyDataHandler.php L518-L575](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/LegacyDataHandler.php#L518-L575)).
- Side effect of the read commands: anything that checks whether the HPOS tables exist rewrites the flag option
  `woocommerce_custom_orders_table_created` (`yes` or `no`)
  ([DataSynchronizer.php L162-L188](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L162-L188)).
  No order data changes.

## Other read commands the skill uses

| Command | Purpose | Source |
| --- | --- | --- |
| `wp option get woocommerce_custom_orders_table_enabled` | `yes` when HPOS is authoritative | [CustomOrdersTableController.php L37](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/CustomOrdersTableController.php#L37) |
| `wp option get woocommerce_custom_orders_table_data_sync_enabled` | `yes` when compatibility mode is on | [DataSynchronizer.php L25](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L25) |
| `wp option get wc_pending_batch_processes --format=json` | Batch processors queued (the order synchronizer shows as `...\DataSynchronizer`) | [BatchProcessingController.php L46](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/BatchProcessing/BatchProcessingController.php#L46) |
| `wp action-scheduler action list --hook=wc_run_batch_process --status=pending --per_page=-1 --format=count` | Queued sync batches; filters go to `as_get_scheduled_actions()`. Without `--per_page=-1` the query stops at 5 results, so a count would never exceed 5 | [Action_Command.php](https://github.com/woocommerce/action-scheduler/blob/trunk/classes/WP_CLI/Action_Command.php), [ActionScheduler_DBStore.php (default `per_page` 5, no LIMIT when not above 0)](https://github.com/woocommerce/action-scheduler/blob/trunk/classes/data-stores/ActionScheduler_DBStore.php) |
| `wp plugin list --skip-update-check` | All plugins, including `must-use` and `dropin` status values, without an update check over the network | [plugin list](https://developer.wordpress.org/cli/commands/plugin/list/) |
| `wp db query < file.sql` | Runs SQL from a file; `--skip-column-names` drops headers; `--url` has no effect, so use the per-site table prefix on multisite | [db query](https://developer.wordpress.org/cli/commands/db/query/) |
| `wp db prefix` | Table prefix of the current site (honors `--url` on multisite) | [db prefix](https://developer.wordpress.org/cli/commands/db/prefix/) |

## Backup commands

- `wp db export <file> [--tables=<list>] [--<field>=<value>]`: `--tables` limits the dump to named tables and any other
  `--field=value` is passed to mysqldump ([db export](https://developer.wordpress.org/cli/commands/db/export/)).
- `--single-transaction` makes the dump a consistent snapshot of InnoDB tables without blocking the application. While
  it runs, no other connection should run `ALTER TABLE`, `CREATE TABLE`, `DROP TABLE`, `RENAME TABLE` or
  `TRUNCATE TABLE` ([mariadb-dump](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump/);
  the same page notes the client was previously called `mysqldump` and still answers to that name). Turning on
  compatibility mode can create the HPOS tables, so take the backup before that step, not during it.
