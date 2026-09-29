# HPOS and posts storage: which tables to read

Read this before running any SQL from `scripts/`. Every order query in this skill has an HPOS version and a posts
version; run the one that matches the store's authoritative storage. Code links point at the WooCommerce 11.1.2 tag,
WordPress links at 7.1.2.

## Which storage is authoritative

| Option | Meaning | Source |
| --- | --- | --- |
| `woocommerce_custom_orders_table_enabled` = `yes` | HPOS tables are authoritative | [CustomOrdersTableController.php L37, L230-L232](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/CustomOrdersTableController.php#L230-L232) |
| `woocommerce_custom_orders_table_data_sync_enabled` = `yes` | Compatibility mode: the other storage is kept in sync | [DataSynchronizer.php L25](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/DataSynchronizer.php#L25) |

`OrderUtil::custom_orders_table_usage_is_enabled()` returns the first option, and it is what the reservation query
uses to pick its join ([OrderUtil.php L39-L41](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Utilities/OrderUtil.php#L39-L41);
[ReserveStock.php L272-L279](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php#L272-L279)).
With compatibility mode on, the copy in the other storage can lag behind; read the authoritative one. Moving a store
between the two is the `woo-hpos-live-migration` skill in this collection.

## Where each fact lives

| Fact | HPOS | Posts storage |
| --- | --- | --- |
| Order status | `{prefix}wc_orders.status` (`wc-pending`, `wc-checkout-draft`, ...) | `{prefix}posts.post_status` where `post_type = 'shop_order'` |
| Order type | `{prefix}wc_orders.type` (`shop_order`) | `{prefix}posts.post_type` |
| Created | `wc_orders.date_created_gmt` | `posts.post_date_gmt` |
| Last changed (the cancel event's clock) | `wc_orders.date_updated_gmt` | `posts.post_modified` (site time), `post_modified_gmt` |
| Created via (`checkout`, `store-api`, ...) | `{prefix}wc_order_operational_data.created_via` | `{prefix}postmeta` `_created_via` |
| Stock reduced flag | `wc_order_operational_data.order_stock_reduced` (1 or 0) | `postmeta` `_order_stock_reduced` (`yes` or `no`) |
| Line items and `_reduced_stock` | `{prefix}woocommerce_order_items`, `{prefix}woocommerce_order_itemmeta` | the same two tables |
| Reservation rows | `{prefix}wc_reserved_stock` | the same table |
| Product `_stock`, `_manage_stock` (`yes` or `no`) | `{prefix}postmeta` on the product or variation post | the same |

Sources: the HPOS schema
([OrdersTableDataStore.php L3462-L3532](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3462-L3532)),
its list of internal meta keys, which HPOS keeps in columns instead of meta (`_created_via` and `_order_stock_reduced`
among them, [L61-L114](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L61-L114)),
the posts data store
([class-wc-order-data-store-cpt.php L72, L83, L264, L862-L889](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-order-data-store-cpt.php#L862-L889)),
the product data store, which saves `manage_stock` as `yes` or `no`
([class-wc-product-data-store-cpt.php L757-L759](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L757-L759)),
WordPress's posts table
([schema.php L159-L189](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L159-L189)),
the order item tables and the reservation table
([class-wc-install.php L1859-L1875, L2017-L2025](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L2017-L2025)).

## Placeholders in the SQL files

- `{prefix}` is the site's table prefix: `wp db prefix` prints it, per site on multisite with `--url=<site>`. The
  report script fills it in and checks it holds only letters, digits and underscores.
- Blocks marked `(HPOS)` read `wc_orders` and `wc_order_operational_data`. WooCommerce includes those tables in its
  schema only while HPOS or compatibility mode is on, or for a new store
  ([class-wc-install.php L1786-L1790](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L1786-L1790)),
  so they can be missing. Blocks marked `(posts)` read `posts` and `postmeta`. On an HPOS store without
  compatibility mode the posts blocks return nothing useful, and on a posts store the HPOS blocks fail or return
  stale rows. The report script runs only the set that matches the authoritative storage.

## Reading the output

`wp db query` sends the SQL to the `mysql` client, reading it from STDIN when no query is passed
([wp db query](https://developer.wordpress.org/cli/commands/db/query/)). When the client runs non-interactively its
result is tab-separated ([MySQL 8.4 mysql client](https://dev.mysql.com/doc/refman/8.4/en/mysql.html)), with a header
row unless `--skip-column-names` is passed. `scripts/reconcile-counts.mjs` reads that tab-separated form.
