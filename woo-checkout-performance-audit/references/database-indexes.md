# Tables and indexes on the checkout path

Read this for step 9 of the procedure. WooCommerce links point at the 11.1.2 tag, WordPress links at 7.1.2, Action
Scheduler links at 4.0.0. A single slow query found here is investigated with the `wp-slow-query-investigation` skill
in this collection; this file lists what the checkout path expects to find.

## Order storage

- High-Performance Order Storage (HPOS) keeps orders in dedicated tables with their own indexes, which WooCommerce
  describes as fewer reads and writes on fewer busy tables
  ([HPOS overview](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/)).
- On posts storage, order data lives in `{prefix}posts` and `{prefix}postmeta`, and `postmeta` has only two secondary
  indexes, `post_id` and `meta_key(191)`, nothing on `meta_value`
  ([schema.php L150-L158](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L150-L158)).
  Moving a live store to HPOS is covered by the [woo-hpos-live-migration](../../woo-hpos-live-migration/SKILL.md) skill.
- With HPOS authoritative and compatibility mode still on, every order save also writes the posts copy
  ([OrdersTableDataStore.php L3124-L3157](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3124-L3157)).
  Turning it off is step 8 of that migration skill, not a quick setting change.

## Indexes WooCommerce 11.1.2 defines

`(n)` is a prefix length that WooCommerce derives from the server's maximum index length
([OrdersTableDataStore.php L3458-L3459](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3458-L3459)).

| Table | Indexes | Source |
| --- | --- | --- |
| `wc_orders` | `PRIMARY (id)`, `status`, `date_created (date_created_gmt)`, `customer_id_billing_email (customer_id, billing_email(n))`, `customer_id_status`, `billing_email(n)`, `transaction_id(20)`, `type_status_date (type, status, date_created_gmt)`, `parent_order_id`, `date_updated (date_updated_gmt)` | [L3462-L3489](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3462-L3489) |
| `wc_order_addresses` | `order_id`, unique `address_type_order_id (address_type, order_id)`, `email(n)`, `phone` | [L3491-L3509](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3491-L3509) |
| `wc_order_operational_data` | unique `order_id`, `order_key` | [L3511-L3531](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3511-L3531) |
| `wc_orders_meta` | `meta_key_value (meta_key(50), meta_value(20))`, `order_id_meta_key_meta_value (order_id, meta_key(100), meta_value(n))` | [L3533-L3539](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3533-L3539) |
| `woocommerce_sessions` | `PRIMARY (session_id)`, `session_expiry`, unique `session_key` | [class-wc-install.php L1807-L1815](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L1807-L1815) |
| `woocommerce_order_items`, `woocommerce_order_itemmeta` | `order_id`; `order_item_id`, `meta_key(32)` | [class-wc-install.php L1859-L1875](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L1859-L1875) |
| `wc_reserved_stock` | `PRIMARY (order_id, product_id)`, `product_id_expires (product_id, expires)` | [class-wc-install.php L2017-L2025](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L2017-L2025) |
| `actionscheduler_actions` | `hook_status_scheduled_date_gmt`, `status_scheduled_date_gmt`, `scheduled_date_gmt`, `args`, `group_id`, `last_attempt_gmt`, `claim_id_status_priority_scheduled_date_gmt`, `status_last_attempt_gmt`, `status_claim_id` | [ActionScheduler_StoreSchema.php L60-L86](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/schema/ActionScheduler_StoreSchema.php#L60-L86) |
| `actionscheduler_logs` | `action_id`, `log_date_gmt` | [ActionScheduler_LoggerSchema.php L51-L59](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/schema/ActionScheduler_LoggerSchema.php#L51-L59) |
| `options` | unique `option_name`, `autoload` | [schema.php L141-L149](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L141-L149) |

Release notes for these indexes:

- `woocommerce_sessions.session_expiry` arrived in 10.3.0 with the batched cleanup, which deletes in `session_expiry`
  order ([PR 60711](https://github.com/woocommerce/woocommerce/pull/60711);
  [10.2.0 schema without it](https://github.com/woocommerce/woocommerce/blob/10.2.0/plugins/woocommerce/includes/class-wc-install.php)).
- `wc_reserved_stock.product_id_expires` arrived in 10.8.0 for stock reservation during sales peaks
  ([PR 63864](https://github.com/woocommerce/woocommerce/pull/63864);
  [10.7.0 schema without it](https://github.com/woocommerce/woocommerce/blob/10.7.0/plugins/woocommerce/includes/class-wc-install.php)).
- `wc_orders_meta.meta_key_value` was `(meta_key(100), meta_value(82))` before 10.8.0; the 10.8.0 update routine
  reshapes it to `(meta_key(50), meta_value(20))`, prefixes that WooCommerce's docblock says keep full selectivity for
  its queries while saving space
  ([wc-update-functions.php L3466-L3528](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-update-functions.php#L3466-L3528)).
  A missing index is the problem, not the older shape.

## How indexes get added, and why one can be missing

- Each WooCommerce install or update runs `create_tables()`, which passes the whole schema to `dbDelta()`
  ([class-wc-install.php L640-L714, L1689-L1755](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L1689-L1755)).
  `dbDelta()` creates tables and brings existing ones to the given structure
  ([dbDelta](https://developer.wordpress.org/reference/functions/dbdelta/)).
- The HPOS tables are part of that schema only while HPOS or its sync is on, or on a new store
  ([class-wc-install.php L1786-L1790](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L1786-L1790)).
- WooCommerce > Status > Tools > "Verify base database tables" runs `create_tables()` again
  ([tools controller L238-L246, L682-L697](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-system-status-tools-v2-controller.php#L682-L697);
  [class-wc-install.php L805-L822](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L805-L822)).
- An update that did not finish, or a database user without `ALTER` rights, can leave an index missing. The report's
  index block shows what exists.

## Storage engine

Stock reservation holds row locks (`FOR UPDATE`, `LOCK IN SHARE MODE`) and WooCommerce's comment states it needs
InnoDB; it retries up to three times on lock errors
([ReserveStock.php L215-L260](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php#L215-L260)).
The report lists each table's engine. MySQL locks MyISAM tables as a whole, so only one session at a time can update
one, while InnoDB locks rows ([MySQL 8.4 internal locking](https://dev.mysql.com/doc/refman/8.4/en/internal-locking.html)).
A MyISAM table on the checkout path makes concurrent checkouts wait for each other.

## Checking (read-only)

- The table block reads `information_schema.TABLES`. For InnoDB, `TABLE_ROWS` is an estimate that can differ from the
  actual count by 40 to 50 percent, and `DATA_LENGTH` and `INDEX_LENGTH` are allocated sizes
  ([MySQL 8.4 TABLES](https://dev.mysql.com/doc/refman/8.4/en/information-schema-tables-table.html)).
- The index block reads `information_schema.STATISTICS`, one row per indexed column with its position and prefix length
  ([MySQL 8.4 STATISTICS](https://dev.mysql.com/doc/refman/8.4/en/information-schema-statistics-table.html)).
  Compare the output with the table above.
- Query Monitor flags queries slower than `QM_DB_EXPENSIVE` (0.05 seconds by default)
  ([configuration constants](https://querymonitor.com/help/configuration-constants/)). Copy such a query from a
  checkout request, run `EXPLAIN` on it on staging, and check which index it uses.

## Rows that pile up on the checkout path

| Rows | Where | Why they grow | Source |
| --- | --- | --- | --- |
| `wc-checkout-draft` orders | `wc_orders` or `posts` | Before 10.9.0 block checkout page views and form changes created drafts, left behind when the shopper did not buy; a daily action deletes drafts unchanged for a day, 20 per batch | [PR 64155](https://github.com/woocommerce/woocommerce/pull/64155); [DraftOrders.php L179-L216](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Blocks/Domain/Services/DraftOrders.php#L179-L216) |
| `_debug_log_source`, `_debug_log_source_pending_deletion` meta | order meta | Place-order step logger, cleared by a batch processor | [wc-order-step-logger-functions.php L70-L108](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-step-logger-functions.php#L70-L108) |
| `place-order-debug-*` log entries | `woocommerce_log` when the log handler is the database, files otherwise | Same logger | same |
| Reserved stock | `wc_reserved_stock` | Released on payment, on a checkout exception and when the order becomes processing, on-hold, completed or cancelled; the reservation query ignores expired rows | [wc-stock-functions.php L446-L497](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L446-L497); [ReserveStock.php L269-L306](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php#L269-L306) |
| Sessions | `woocommerce_sessions` | See [sessions.md](sessions.md) | |
| Action logs | `actionscheduler_logs` | See [action-scheduler.md](action-scheduler.md) | |
