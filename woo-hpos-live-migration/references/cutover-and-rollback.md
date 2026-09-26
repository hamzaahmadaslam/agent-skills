# Cut-over, soak, cleanup and rollback

Code links point at the WooCommerce 11.1.2 tag. Every step below that changes data names its backup and its check.

## Backups

- Take a full database backup before each change step. With InnoDB tables, a consistent dump that does not block the
  store: `wp db export /path/outside/webroot/hpos-<step>-<date>.sql --single-transaction`. `wp db export` passes extra
  flags to mysqldump ([db export](https://developer.wordpress.org/cli/commands/db/export/)); `--single-transaction` dumps the state at the
  start of the transaction without blocking the application, and no connection should run `ALTER TABLE`,
  `CREATE TABLE`, `DROP TABLE`, `RENAME TABLE` or `TRUNCATE TABLE` while it runs
  ([mariadb-dump](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump/)).
  So finish the backup before turning on compatibility mode, which may create tables
  ([DataSynchronizer.php L287-L290](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L287-L290)).
- A host snapshot or a physical backup tool is fine instead of a dump. Whatever the tool, restore it once on staging and
  count orders before relying on it.
- The backup must hold the posts tables, the four HPOS tables, and the tables both storages share: order items, order
  item meta and comments (order notes)
  ([schema post](https://developer.woocommerce.com/2022/09/15/high-performance-order-storage-database-schema/)).
  A full dump covers all of them.
- Quick checkpoint of the HPOS tables only (not a substitute for the full backup):
  `wp db export /path/outside/webroot/hpos-tables.sql --tables=<prefix>wc_orders,<prefix>wc_order_addresses,<prefix>wc_order_operational_data,<prefix>wc_orders_meta`
  ([db export](https://developer.wordpress.org/cli/commands/db/export/)).
- Save the state next to each backup: the output of `wp wc hpos status` and of
  `wp option get woocommerce_custom_orders_table_enabled` and
  `wp option get woocommerce_custom_orders_table_data_sync_enabled`.
- Dumps hold customer personal data. Keep them out of the web root and delete them when the retention period ends.
- Restoring a full backup on a live store throws away every order and order change made after the backup. The sync-based
  rollback below keeps them, so treat a restore as the last resort, and plan to re-enter or reconcile the orders placed
  after the backup if you use it.

## Change steps at a glance

| Step | Backup first | Command | Check after | Undo |
| --- | --- | --- | --- | --- |
| Compatibility mode on (posts stay authoritative) | Full | `wp wc hpos compatibility-mode enable` (9.1.0+) or the checkbox | `status`: HPOS no, compatibility yes; unsynced count falls; a new order shows no `diff` | `wp wc hpos compatibility-mode disable` |
| Backfill the backlog | The previous full backup covers it: while posts are authoritative, sync writes only the HPOS tables ([DataSynchronizer.php L766-L799](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L766-L799)) | `wp wc hpos sync` | `Unsynced orders: 0`; no `batch-processing` errors | Stop the job; HPOS rows are unused while posts are authoritative |
| Switch to HPOS | Full, taken just before | `wp wc hpos enable` | `status`: HPOS yes, compatibility yes, unsynced 0; flow tests; new order has a full post | `wp wc hpos disable` |
| Compatibility mode off | Full | `wp wc hpos compatibility-mode disable` | `status`: compatibility no; new orders get placeholder posts; flow tests | `wp wc hpos compatibility-mode enable`, then wait for `Unsynced orders: 0` (back to the soak state) |
| Cleanup (optional) | Full, kept for the retention period | `wp wc hpos cleanup <range>` | `Orders subject to cleanup` falls to 0; flow tests | Rollback path C, or a restore |

## The switch to HPOS

- Timing: pick a quiet period and plan to be online afterwards. The large-store guide says switching to HPOS and
  reverting to posts are both hot migrations that need no planned downtime
  ([guide](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/guide-large-store/)).
- Pre-flight: `wp wc hpos status` shows `Unsynced orders: 0`; the verification gate in [verification.md](verification.md#gates)
  passed; the audit has a decision for every component; the full backup finished.
- Command: `wp wc hpos enable`. It prints "Running pre-enable checks..." and, when they pass, "Success: HPOS enabled.";
  a failed check prints a `[Failed]` line and "HPOS pre-checks failed, please see the errors above"
  ([CLIRunner.php L758-L844](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L758-L844)).
  Do not add `--ignore-plugin-compatibility`. Leave compatibility mode on.
- The settings screen does the same switch (select "High-performance order storage (recommended)" and save), but from
  9.9.0 to 11.0.x its "in sync" check could miss orders changed after a full sync
  ([PR 67838](https://github.com/woocommerce/woocommerce/pull/67838)); the CLI uses the full count.
- Checks right after:
  - `wp wc hpos status`: `HPOS enabled?: yes`, `Compatibility mode enabled?: yes`, `Unsynced orders: 0`.
  - The order list opens at `wp-admin/admin.php?page=wc-orders`
    ([PageController.php L490-L499](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/Orders/PageController.php#L490-L499)).
  - Place orders with every payment method, refund one, and run the site's own critical flows; open a few real orders as
    they arrive and watch support channels ([guide](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/guide-large-store/)).
  - For a new order, the post record is a full copy of the order's type while compatibility mode is on
    ([OrdersTableDataStore.php L2344-L2364](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L2344-L2364)):
    `wp db query "SELECT ID, post_type, post_status FROM <prefix>posts WHERE ID = <id>"` shows `shop_order`, and
    `wp wc hpos diff <id>` shows no differences.
  - WooCommerce > Status > Logs, source `batch-processing`, and the PHP error log.

## The soak period (compatibility mode on)

- Do not turn sync off right after the switch: while it is on, reverting to posts is immediate
  ([guide](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/guide-large-store/);
  [enable HPOS](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/enable-hpos/)).
  WooCommerce's own high-volume migration turned sync-on-read off after 6 hours and sync off after 1 week
  ([guide](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/guide-large-store/)).
  Choose a period that covers the store's weekly peak, subscription renewals and scheduled exports.
- On 10.7.0 and later the sync-on-read step is already done: the filter defaults to false
  ([PR 63175](https://github.com/woocommerce/woocommerce/pull/63175)). On older releases, the guide's snippet
  `add_filter( 'woocommerce_hpos_enable_sync_on_read', '__return_false' );` does it.
- Cost: every order save writes both storages while sync is on
  ([OrdersTableDataStore.php L3154-L3157](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3154-L3157)).
- Daily: `wp wc hpos status` (unsynced should stay at 0; a rising number means post backfills are failing), the logs,
  support channels, and the list in [after-cutover.md](after-cutover.md).

## Turning compatibility mode off

- Backup, then `wp wc hpos compatibility-mode disable` (or clear the checkbox and save).
- From now on, new orders get only a `shop_order_placehold` draft in `wp_posts`, and the posts copy of existing orders
  stops updating ([OrdersTableDataStore.php L2344-L2364](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L2344-L2364)).
  Check with `wp db query "SELECT post_type, post_status FROM <prefix>posts WHERE ID = <new order id>"`.
- Run the flow tests again. This is when code that reads `wp_posts` for orders starts returning placeholders or old data.
- Keeping a fast fallback: WooCommerce's high-volume store still runs `wp wc hpos sync` from time to time so it can fall
  back to posts quickly ([guide](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/guide-large-store/)).
  With HPOS authoritative, that command writes only the posts side
  ([DataSynchronizer.php L766-L799](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L766-L799)).

## Cleanup of legacy data (optional, destructive)

- Only when nobody expects to go back to posts storage soon. Cleanup keeps rollback possible, but a rollback then
  rebuilds every order's post data.
- Requires HPOS authoritative and compatibility mode off
  ([CLIRunner.php L948-L950](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L948-L950)).
- Per order it deletes all post meta, then converts the post into a `shop_order_placehold` draft, or deletes the post if
  the order is not in HPOS
  ([LegacyDataHandler.php L156-L199](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/LegacyDataHandler.php#L156-L199)).
  Placeholders stay so storages can still be switched
  ([CLI tools page](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/cli-tools/)).
- Size it first: `wp wc hpos status` prints `Orders subject to cleanup: N`.
- Run in ranges so each run is small and resumable: `wp wc hpos cleanup 1-50000`, then the next range; or
  `wp wc hpos cleanup all --batch-size=200`
  ([CLIRunner.php L909-L946](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L909-L946)).
  The background alternative is WooCommerce > Status > Tools > "Clean up order data from legacy tables", 25 orders per
  batch ([LegacyDataCleanup.php L28, L200-L241](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/LegacyDataCleanup.php#L200-L241)).
- "Data in posts table appears to be more recent than in HPOS tables" means the order was skipped. Run
  `wp wc hpos diff <id>`; if the post side is right, `wp wc hpos backfill <id> --from=posts --to=hpos`; if HPOS is right,
  `wp wc hpos cleanup <id> --force` ([LegacyDataHandler.php L173-L176](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/LegacyDataHandler.php#L173-L176)).
- Check after: `Orders subject to cleanup: 0`, the post meta row count for orders dropped, flow tests pass.

## Rolling back to posts storage

Pick the path that matches the current state (`wp wc hpos status`). Each path starts with a full backup, because HPOS
holds the newest data.

### A. Compatibility mode still on

1. Full backup.
2. `wp wc hpos status` must show `Unsynced orders: 0`; if not, run `wp wc hpos sync` and check again.
3. `wp wc hpos disable`. It refuses while orders are pending sync
   ([CLIRunner.php L865-L907](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L865-L907)).
   Leave out `--with-sync` if you plan to retry: compatibility mode then keeps the HPOS tables current.
4. Check: `HPOS enabled?: no`; the newest orders show the right status and totals (`wp wc hpos diff` on them); a test
   checkout works; the order list is back at `edit.php?post_type=shop_order`.

### B. Compatibility mode off

1. Full backup.
2. `wp wc hpos compatibility-mode enable`. Background batches start backfilling posts from HPOS (26 orders per batch,
   [DataSynchronizer.php L932-L947](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L932-L947));
   `wp wc hpos sync` is faster.
3. Wait for `Unsynced orders: 0`, then `diff` the orders created while sync was off.
4. `wp wc hpos disable`, then the checks from path A.

The large-store guide describes the same thing: after sync is off you can still revert, once the posts table has been
backfilled ([guide](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/guide-large-store/)).
The merchant guide gives the same order of steps in the settings screen: enable compatibility mode, wait for the sync,
select "WordPress posts storage (legacy)", save between changes
([merchant guide](https://woocommerce.com/document/high-performance-order-storage/)).

### C. After cleanup

Same as B. Every cleaned order has a placeholder post, which the pending count treats as missing
([DataSynchronizer.php L564-L575](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L564-L575)),
so the backfill rebuilds the post data of every order. Budget time like the original migration.

### D. Restore a backup

Only when data is damaged in a way the paths above cannot fix. Orders placed after the backup are lost from the
database and must be reconciled from payment gateway and email records.
