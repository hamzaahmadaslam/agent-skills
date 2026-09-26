# What to watch after the switch

Most breakage shows up in two waves: right after HPOS becomes authoritative, and again when compatibility mode is turned
off. Check each area below at both points. Code links point at the WooCommerce 11.1.2 tag.

## Order search in the admin

- The HPOS order list has a search dropdown with "Order ID", "Customer Email", "Customers", "Products" and "All"; the
  last choice is remembered per user (user setting `wc-search-filter-hpos-admin`)
  ([ListTable.php L1821-L1851](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/Orders/ListTable.php#L1821-L1851);
  added in 8.6.0 and 8.9.0: [PR 43865](https://github.com/woocommerce/woocommerce/pull/43865),
  [PR 45954](https://github.com/woocommerce/woocommerce/pull/45954)). With "Order ID" selected, a search for a name adds
  no condition at all, so the unfiltered list comes back and search looks broken
  ([OrdersTableSearchQuery.php L249-L268](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableSearchQuery.php#L249-L268);
  empty conditions are skipped in [OrdersTableQuery.php L837-L842](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableQuery.php#L837-L842)).
- "All" searches order ID, transaction ID, customer email, customers and products
  ([OrdersTableSearchQuery.php L65-L79](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableSearchQuery.php#L65-L79)).
  "Customer Email" matches the start of `billing_email` only (`LIKE 'term%'`)
  ([L284-L289](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableSearchQuery.php#L284-L289)).
- Extra searchable meta keys: posts storage reads `woocommerce_shop_order_search_fields`; HPOS reads
  `woocommerce_order_table_search_query_meta_keys` (default `_billing_address_index`, `_shipping_address_index`)
  ([L429-L458](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableSearchQuery.php#L429-L458)).
  Code that hooks only the first filter stops adding its fields after the switch.
- Custom search options: `woocommerce_hpos_admin_search_filters` adds the dropdown entry and
  `woocommerce_hpos_generate_where_for_search_filter` supplies its SQL (8.9.0)
  ([L316-L333](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableSearchQuery.php#L316-L333)).
- Optional later: "HPOS Full text search indexes" is an experimental feature in 11.1.2 (option
  `woocommerce_hpos_fts_index_enabled`) that works only with HPOS
  ([FeaturesController.php L388-L399](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L388-L399);
  [merchant guide](https://woocommerce.com/document/high-performance-order-storage/)). Treat it as its own change.
- Test: the searches staff run most (order number, email, customer name, product, transaction ID), with each dropdown
  choice, and compare with results from before the switch.

## Reports and Analytics

- Legacy reports (the WooCommerce > Reports tabs: sales by date, product and category, coupon usage, customers, taxes
  by date and by code; and the REST endpoints `reports/sales` and `reports/top_sellers`, which use the same report
  code) built their SQL on `wp_posts` and `wp_postmeta` through 11.0.x ([class-wc-admin-report.php @ 11.0.0 L169](https://github.com/woocommerce/woocommerce/blob/11.0.0/plugins/woocommerce/includes/admin/reports/class-wc-admin-report.php#L169)).
  With HPOS authoritative and sync off, orders that exist only in HPOS were missing, and a fresh HPOS store saw zeros
  ([PR 65493](https://github.com/woocommerce/woocommerce/pull/65493)). From 11.1.0 these reports read the HPOS tables
  when HPOS is on ([class-wc-admin-report.php @ 11.1.2 L128-L129](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/reports/class-wc-admin-report.php#L128-L129)).
  On 11.0.x or older, expect legacy report totals to drift once compatibility mode is off; update WooCommerce first.
- From 11.1.0, code hooked to the `woocommerce_reports_*` query filters sees HPOS identifiers (`orders.id` instead of
  `posts.ID`, `date_created_gmt` instead of `posts.post_date`) when HPOS is on
  ([PR 65493](https://github.com/woocommerce/woocommerce/pull/65493)). Check any custom report code.
- `reports/orders/totals` was made HPOS compatible in 8.9.0 ([PR 46715](https://github.com/woocommerce/woocommerce/pull/46715)).
- WooCommerce Analytics reads its lookup tables (`wc_order_stats` and related). Its importer selects orders from the
  HPOS table when HPOS is on and from the posts table otherwise
  ([OrdersScheduler.php L210-L216](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/Schedulers/OrdersScheduler.php#L210-L216)).
  Gaps can be filled with Analytics > Settings > "Import historical data"
  ([Analytics docs](https://woocommerce.com/document/woocommerce-analytics/)).
- Test: order count and revenue for one fixed past week and for yesterday, in legacy reports and in Analytics, before the
  switch, after it, and after sync is off.

## Custom queries on `wp_posts` and `wp_postmeta`

What such code sees in each state:

| State | Reads of `wp_posts` / `wp_postmeta` for orders | Direct writes to them | Source |
| --- | --- | --- | --- |
| HPOS on, sync on | Current, because each HPOS save also writes the post | Not copied into HPOS on 10.7.0 and later | [OrdersTableDataStore.php L3154-L3157](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3154-L3157), [PR 63175](https://github.com/woocommerce/woocommerce/pull/63175) |
| HPOS on, sync off | New orders are `shop_order_placehold` drafts with no meta; older orders show their last synced values | Ignored by WooCommerce | [OrdersTableDataStore.php L2344-L2364](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L2344-L2364) |
| After cleanup | Every order is a placeholder with no meta | Ignored | [LegacyDataHandler.php L156-L199](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/LegacyDataHandler.php#L156-L199) |

- Typical offenders: `WP_Query` or `get_posts` with `'post_type' => 'shop_order'`, `get_post_meta( $order_id, ... )`,
  `$wpdb` joins on `postmeta` for order data, and scheduled exports, feeds and external systems that read the tables
  directly ([recipe book](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/recipe-book/);
  [large-store guide](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/guide-large-store/)).
- Fix with `wc_get_orders()`, the order object's meta methods and `OrderUtil`, as listed in
  [compatibility-audit.md](compatibility-audit.md#code-patterns-to-search-for).

## Admin screens, URLs and hooks

- Order list: `wp-admin/admin.php?page=wc-orders`; other order types: `admin.php?page=wc-orders--<type>`; edit screen:
  `admin.php?page=wc-orders&action=edit&id=<id>`
  ([PageController.php L430-L499](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/Orders/PageController.php#L430-L499)).
  Old `edit.php`, `post.php` and `post-new.php` order URLs redirect there
  ([PostsRedirectionController.php L25-L60](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/Orders/PostsRedirectionController.php#L25-L60)),
  and `get_edit_post_link()` on a placeholder returns the HPOS edit URL (9.0.0)
  ([CustomOrdersTableController.php L813-L831](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/CustomOrdersTableController.php#L813-L831)).
  Bookmarks keep working; hard-coded links in emails or other systems deserve a check.
- Screen ID: `woocommerce_page_wc-orders` (or `admin_page_wc-orders` for users who cannot see the WooCommerce menu;
  other order types add `--<type>`), returned by `wc_get_page_screen_id( 'shop-order' )`
  ([wc-admin-functions.php L76-L89](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/wc-admin-functions.php#L76-L89)).
- Hooks that change:

  | Posts storage | HPOS | Source |
  | --- | --- | --- |
  | `manage_edit-shop_order_columns` ([manage_{$screen->id}_columns](https://developer.wordpress.org/reference/hooks/manage_screen-id_columns/)) | `manage_woocommerce_page_wc-orders_columns` | [ListTable.php L112](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/Orders/ListTable.php#L112) |
  | `manage_shop_order_posts_custom_column` with a post ID ([reference](https://developer.wordpress.org/reference/hooks/manage_post-post_type_posts_custom_column/)) | `manage_woocommerce_page_wc-orders_custom_column` or `woocommerce_shop_order_list_table_custom_column`, both with a `WC_Order` | [ListTable.php L195, L205](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/Orders/ListTable.php#L195-L205) |
  | `restrict_manage_posts` ([reference](https://developer.wordpress.org/reference/hooks/restrict_manage_posts/)) | `woocommerce_order_list_table_restrict_manage_orders` | [ListTable.php L795](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/Orders/ListTable.php#L795) |
  | `bulk_actions-edit-shop_order` ([bulk_actions-{$screen}](https://developer.wordpress.org/reference/hooks/bulk_actions-this-screen-id/)) | `bulk_actions-woocommerce_page_wc-orders` (the HPOS list extends `WP_List_Table`) | [ListTable.php L17, L323](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/Orders/ListTable.php#L17) |
  | `handle_bulk_actions-edit-shop_order` ([reference](https://developer.wordpress.org/reference/hooks/handle_bulk_actions-screen/)) | `handle_bulk_actions-woocommerce_page_wc-orders` | [ListTable.php L1504](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/Orders/ListTable.php#L1504) |
  | Query changes through `pre_get_posts` or `request` | `woocommerce_order_list_table_prepare_items_query_args` | [ListTable.php L424](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Admin/Orders/ListTable.php#L424) |
  | Meta boxes added for `shop_order` | Meta boxes added for `wc_get_page_screen_id( 'shop-order' )` | [recipe book](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/recipe-book/) |

## Capability checks

- Before 10.7.0, with HPOS on and sync off, `current_user_can( 'edit_post', $order_id )` and the `read_post` and
  `delete_post` checks resolved against the placeholder post and could fail for roles such as Shop Manager. 10.7.0 maps
  them to the order type's capabilities
  ([HposOrderCapabilityHelper.php L17-L32](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/HposOrderCapabilityHelper.php#L17-L32);
  [CustomOrdersTableController.php L193-L222](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/CustomOrdersTableController.php#L193-L222)).
  11.0.0 also gives placeholder posts the order capabilities ([PR 58432](https://github.com/woocommerce/woocommerce/pull/58432)).
- Test: log in as Shop Manager and any custom role, open, edit and refund an order created after sync was turned off.

## Logs to read

- WooCommerce > Status > Logs, source `batch-processing`: sync batch errors and "appears to be failing consistently"
  ([BatchProcessingController.php L743-L776, L821](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/BatchProcessing/BatchProcessingController.php#L743-L776);
  [logging](https://developer.woocommerce.com/docs/best-practices/data-management/logging/)).
- The PHP error log, for fatal errors and notices from code that expects a `WP_Post` where it now gets a `WC_Order`
  (meta box callbacks, list columns).
- The slow query log, for custom SQL that still joins `postmeta` for order data.

## Optional features once the store is stable

- "HPOS Data Caching" (not experimental in 11.1.2, option `woocommerce_hpos_datastore_caching_enabled`) caches order data
  in the datastore; WooCommerce describes it as recommended for stores using object caching
  ([FeaturesController.php L400-L412](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L400-L412);
  out of the experimental phase in 10.4.0, [PR 61521](https://github.com/woocommerce/woocommerce/pull/61521)).
- Full text search indexes, above.

Each is a separate change with its own backup and test pass, after the migration has settled.
