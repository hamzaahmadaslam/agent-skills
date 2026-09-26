# How HPOS storage and sync work

Read this before changing any setting, and when the sync looks stuck or the counts do not add up. Code links point at the
WooCommerce 11.1.2 tag.

## Settings, options and tables

- The switch lives in WooCommerce > Settings > Advanced > Features. "Order data storage" offers "WordPress posts storage
  (legacy)" and "High-performance order storage (recommended)"; the checkbox below it reads "Enable compatibility mode
  (Synchronize orders between High-performance order storage and WordPress posts storage)."
  ([CustomOrdersTableController.php L672-L685, L781-L790](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/CustomOrdersTableController.php#L672-L790))
- Options behind them:

  | Option | Meaning | Source |
  | --- | --- | --- |
  | `woocommerce_custom_orders_table_enabled` | `yes`: HPOS tables are authoritative | [CustomOrdersTableController.php L37](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/CustomOrdersTableController.php#L37) |
  | `woocommerce_custom_orders_table_data_sync_enabled` | `yes`: compatibility mode (sync) is on | [DataSynchronizer.php L25](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L25) |
  | `woocommerce_custom_orders_table_created` | `yes`/`no` cache of "the HPOS tables exist" | [DataSynchronizer.php L32, L162-L188](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L162-L188) |
  | `woocommerce_custom_orders_table_background_sync_mode` | `interval`, `continuous` or `off` | [DataSynchronizer.php L43-L47](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L43-L47) |
  | `woocommerce_custom_orders_table_background_sync_interval` | Seconds between interval checks, default 3600 | [DataSynchronizer.php L338-L350](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L338-L350) |

- HPOS uses four tables: `{prefix}wc_orders`, `{prefix}wc_order_addresses`, `{prefix}wc_order_operational_data` and
  `{prefix}wc_orders_meta` ([OrdersTableDataStore.php L192-L229](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L192-L229),
  schema at [L3447](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3447)).
  Refunds are rows in `wc_orders` with type `shop_order_refund`. Order items stay in `woocommerce_order_items` and
  `woocommerce_order_itemmeta`, and order notes stay in `comments`, under both storages
  ([schema post](https://developer.woocommerce.com/2022/09/15/high-performance-order-storage-database-schema/)).
  Backups must include those shared tables.
- `wc_orders.status` holds the same `wc-` prefixed value as `post_status`
  ([OrdersTableDataStore.php L2569](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L2569)),
  so status counts compare directly.
- The tables and options are per site: table names use `$wpdb->prefix`, which differs per site on multisite
  ([OrdersTableDataStore.php L192-L229](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L192-L229)).

## Authoritative and backup

- The authoritative tables are read and written; the backup tables receive copies when sync runs. Switching the
  authoritative side is not allowed while orders are pending sync
  ([HPOS overview](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/)).
- The guard is a `pre_update_option` handler that throws "The authoritative table for orders storage can't be changed
  while there are orders out of sync"
  ([CustomOrdersTableController.php L475-L504](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/CustomOrdersTableController.php#L475-L504)).
  The filter `wc_allow_changing_orders_storage_while_sync_is_pending` removes the guard; its docblock says it is for
  development only and that order data corruption or loss can happen
  ([L798-L811](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/CustomOrdersTableController.php#L798-L811)).
- The settings screen disables the HPOS choice while an active plugin counts as incompatible, and disables both choices
  while orders are pending sync ([L655-L670](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/CustomOrdersTableController.php#L655-L670)).
- Changing either option flushes WooCommerce's order cache
  ([L475-L490](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/CustomOrdersTableController.php#L475-L490)).

## The four states

| Storage | Compatibility mode | Writes | Deletes | Source |
| --- | --- | --- | --- | --- |
| Posts | Off | Posts tables only | Recorded as `_deleted_from` = `posts_table` in `wc_orders_meta` if an HPOS copy exists | [DataSynchronizer.php L999-L1039](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L999-L1039) |
| Posts | On | Each new order, update, refund and refund update is copied to HPOS at once (`woocommerce_new_order`, `woocommerce_update_order`, `woocommerce_refund_created`, `woocommerce_update_order_refund`) | HPOS copy deleted at once | [DataSynchronizer.php L102-L108, L1050-L1054](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L102-L108) |
| HPOS | On | Each create and update also writes the post record; new orders get a full backup post of the order's own type | Post deleted with the order | [OrdersTableDataStore.php L2344-L2364, L3006-L3028, L3154-L3157, L2650-L2657](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3154-L3157) |
| HPOS | Off | New orders get a `shop_order_placehold` draft post that reserves the ID; nothing else is written to posts | Placeholder deleted at once; a full post gets a `_deleted_from` = `orders_table` record for the next sync | [OrdersTableDataStore.php L2344-L2364, L2708-L2740](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L2708-L2740), [DataSynchronizer.php L26-L30](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L26-L30) |

- The overview page calls the deletion key `deleted_from`; the code constant is `_deleted_from`
  ([DataSynchronizer.php L28](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L28)).
  Query for the code value.
- While HPOS is authoritative, WooCommerce blocks deletion of an order's backup post if the order still exists in HPOS
  (since 8.8.0) ([DataSynchronizer.php L967-L987](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L967-L987)).

## Sync on read

- `woocommerce_hpos_enable_sync_on_read` is consulted only while compatibility mode is on. When it returns true, reading
  an HPOS order also loads the post copy and, if the post is as new or newer, copies the post data into HPOS
  ([OrdersTableDataStore.php L1364-L1381, L1577-L1597](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L1364-L1381)).
- Default: on (when compatibility mode is on) through 10.6.x
  ([10.6.0 tag L1365-L1379](https://github.com/woocommerce/woocommerce/blob/10.6.0/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L1365-L1379));
  off from 10.7.0, with an admin notice for sites running HPOS plus compatibility mode
  ([PR 63175](https://github.com/woocommerce/woocommerce/pull/63175)). The docblock says sync-on-read "can be dangerous
  when HPOS is authoritative and running correctly, as it allows the posts data store to override HPOS data"
  ([L1368-L1380](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L1368-L1380)).
- Effect on 10.7.0 and later: a direct write to `wp_posts` or `wp_postmeta` for an order is not copied into HPOS, even
  with compatibility mode on. PR 63175's test shows it: `wp post update <id> --post_status=wc-on-hold` leaves
  `wc_get_order( <id> )->get_status()` at `processing` until the filter returns true.
- The large-store guide's step "switch off sync on read" (`add_filter( 'woocommerce_hpos_enable_sync_on_read',
  '__return_false' );`) is therefore the default on current releases
  ([guide](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/guide-large-store/)).

## What "Unsynced orders" counts

`wp wc hpos status`, `count_unmigrated`, `enable` and `disable` use one query
([DataSynchronizer.php L527-L623](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L527-L623)):

- Posts authoritative: order posts (not `auto-draft`) with no `wc_orders` row, plus orders whose `wc_orders.date_updated_gmt`
  is older than `post_modified_gmt`, plus `_deleted_from` = `posts_table` records.
- HPOS authoritative: `wc_orders` rows (not `auto-draft`) whose post is missing or is a placeholder, plus orders whose
  `date_updated_gmt` is newer than `post_modified_gmt`, plus `_deleted_from` = `orders_table` records.
- Only registered order types count, excluding placeholders
  ([wc-order-functions.php L280-L286](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-functions.php#L280-L286)).
- The count compares existence and modified dates, not field values. Two copies with equal dates and different data count
  as in sync; `verify_data` and `diff` find those (see [verification.md](verification.md)).

## Background sync

- Turning compatibility mode on creates missing HPOS tables, cancels any queued legacy cleanup, and queues the order
  synchronizer as a batch processor; turning it off removes it from the queue
  ([DataSynchronizer.php L264-L299](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L264-L299)).
- The batch processing controller runs through Action Scheduler
  ([BatchProcessingController.php](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/BatchProcessing/BatchProcessingController.php)):

  | Item | Value | Line |
  | --- | --- | --- |
  | Watchdog hook | `wc_schedule_pending_batch_processes` | [L36](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/BatchProcessing/BatchProcessingController.php#L36) |
  | Batch hook (argument: processor class) | `wc_run_batch_process` | [L44](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/BatchProcessing/BatchProcessingController.php#L44) |
  | Queue option | `wc_pending_batch_processes` | [L46](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/BatchProcessing/BatchProcessingController.php#L46) |
  | Action group | `wc_batch_processes` (watchdog) | [L47](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/BatchProcessing/BatchProcessingController.php#L47) |
  | Watchdog delay | 1 hour, filter `woocommerce_batch_processor_watchdog_delay_seconds` | [L364-L380](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/BatchProcessing/BatchProcessingController.php#L364-L380) |
  | Retry after a failed batch | 1 minute | [L556](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/BatchProcessing/BatchProcessingController.php#L556) |
  | Give up | after 5 consecutive failures (filter `wc_batch_processing_max_attempts`), logging "Batch processor Order synchronizer appears to be failing consistently" | [L52, L821](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/BatchProcessing/BatchProcessingController.php#L821) |
  | Error log | source `batch-processing`, message "Error processing batch for Order synchronizer: ...", with first and last order ID | [L743-L776](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/BatchProcessing/BatchProcessingController.php#L743-L776) |
  | State option | `wc_batch_<class>_<md5>` holding `total_time_spent`, `current_batch_size`, `last_error`, `recent_failures` | [L479-L536](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/BatchProcessing/BatchProcessingController.php#L479-L536) |

- Batch size: 250 orders while posts are authoritative, 26 while HPOS is authoritative (the code comment: "Back-filling is
  slower than migration"), filter `woocommerce_orders_cot_and_posts_sync_step_size`
  ([DataSynchronizer.php L932-L947](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L932-L947)).
  The enable page says 25 at a time and names the watchdog `wc_schedule_pending_batch_process`
  ([enable HPOS](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/enable-hpos/));
  the code values above are what runs.
- Background sync modes: `interval` (the default while compatibility mode is on) schedules the recurring action
  `woocommerce_custom_orders_table_background_sync`, which queues the synchronizer when anything is pending; `continuous`
  queues it at the end of every request; `off` is the default while compatibility mode is off
  ([DataSynchronizer.php L102-L127, L235-L239, L384-L441](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L384-L441)).
  With compatibility mode off and a background mode set, the settings screen shows "Background sync is enabled."
  ([CustomOrdersTableController.php L718-L720](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/CustomOrdersTableController.php#L718-L720)).
- When orders are pending, the Features screen offers "Sync orders now", shows "Currently syncing orders... N pending"
  while it runs, and offers "Stop sync" when compatibility mode is off
  ([L702-L773](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/CustomOrdersTableController.php#L702-L773));
  added in 8.3.0 ([PR 39952](https://github.com/woocommerce/woocommerce/pull/39952)).
- Action Scheduler is started by WP-Cron and by the `shutdown` hook on admin requests
  ([Action Scheduler FAQ](https://actionscheduler.org/faq/)). On a site with WP-Cron disabled and no system cron, the
  background sync only advances on admin page loads. `wp wc hpos sync` does not depend on either.
- Action Scheduler tables: `{prefix}actionscheduler_actions` (`hook`, `status`, `scheduled_date_gmt`,
  `last_attempt_gmt`, `group_id`), `{prefix}actionscheduler_groups`, `{prefix}actionscheduler_logs` (`action_id`,
  `message`, `log_date_gmt`); statuses `pending`, `in-progress`, `complete`, `failed`, `canceled`
  ([StoreSchema](https://github.com/woocommerce/action-scheduler/blob/trunk/classes/schema/ActionScheduler_StoreSchema.php),
  [LoggerSchema](https://github.com/woocommerce/action-scheduler/blob/trunk/classes/schema/ActionScheduler_LoggerSchema.php),
  [ActionScheduler_Store.php](https://github.com/woocommerce/action-scheduler/blob/trunk/classes/abstracts/ActionScheduler_Store.php)).
- WooCommerce logs: WooCommerce > Status > Logs, filterable by source; file logs go to `wc-logs` in the uploads
  directory by default ([logging](https://developer.woocommerce.com/docs/best-practices/data-management/logging/)).

## Order types

- Sync, pending counts and verification cover `wc_get_order_types( 'cot-migration' )`: every registered order type except
  `shop_order_placehold` ([wc-order-functions.php L280-L286](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-functions.php#L280-L286)).
  An extension registers its own types, so an inactive extension's orders are left out. WooCommerce's merchant guide
  says to keep extensions that use custom order types (it names Woo Subscriptions and WooCommerce Bookings) active when
  enabling HPOS ([merchant guide](https://woocommerce.com/document/high-performance-order-storage/)).

## Ignored properties

- Sync and verification skip `_paid_date`, `_completed_date` and the order edit-lock meta; the filter
  `woocommerce_hpos_sync_ignored_order_props` (8.6.0) adds keys
  ([DataSynchronizer.php L352-L377](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L352-L377)).

## Tools on WooCommerce > Status > Tools

- "Clean up order data from legacy tables" runs the cleanup in the background, 25 orders per batch, and is available only
  when HPOS is authoritative, compatibility mode is off and no sync is queued
  ([LegacyDataCleanup.php L28, L166-L168, L200-L241](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/LegacyDataCleanup.php#L200-L241)).
- "Delete the custom orders tables" drops the HPOS tables; it is enabled only when posts are authoritative, compatibility
  mode is off and no sync is queued
  ([CustomOrdersTableController.php L300-L339](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/CustomOrdersTableController.php#L300-L339)).
  It is the "abandon HPOS" button, not part of a migration.
