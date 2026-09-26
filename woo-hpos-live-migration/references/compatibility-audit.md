# Compatibility audit

Goal: a list of every component that reads or writes orders, with a decision for each, before any setting changes. Code
links point at the WooCommerce 11.1.2 tag.

## What WooCommerce checks, and what it does not

- The HPOS feature id is `custom_order_tables`, and its definition sets `default_plugin_compatibility` to incompatible
  ([CustomOrdersTableController.php L610-L628](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/CustomOrdersTableController.php#L610-L628)).
  A checked plugin (see which ones below) that declares nothing therefore counts as incompatible.
- Plugins are sorted into compatible, incompatible and uncertain (declared nothing)
  ([FeaturesController.php L1189-L1211](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L1189-L1211)).
  For HPOS, uncertain is merged into incompatible
  ([PluginUtil.php L295-L310](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Utilities/PluginUtil.php#L295-L310)).
  The filter `woocommerce_plugins_are_incompatible_with_feature_by_default` (9.2.0) can flip that default
  ([FeaturesController.php L900-L921](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L900-L921));
  using it to get past the check hides the problem instead of fixing it.
- A plugin that declares nothing is counted only when it is "WooCommerce-aware": its header has a non-empty
  `WC tested up to`
  ([PluginUtil.php L144-L148](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Utilities/PluginUtil.php#L144-L148)).
  A declaration counts from any active plugin, aware or not, so a plugin without that header that declares itself
  incompatible still blocks the switch
  ([FeaturesController.php L1189-L1211](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L1189-L1211)).
  The recipe book says the same: WooCommerce shows compatibility information only for extensions that declare
  `WC tested up to` ([recipe book](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/recipe-book/)).
- The list comes from `get_plugins()` ([PluginUtil.php L97-L124](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Utilities/PluginUtil.php#L97-L124)),
  which reads `wp-content/plugins` and its first-level folders only
  ([get_plugins](https://developer.wordpress.org/reference/functions/get_plugins/)). Must-use plugins and drop-ins come
  from other functions ([get_mu_plugins](https://developer.wordpress.org/reference/functions/get_mu_plugins/),
  [get_dropins](https://developer.wordpress.org/reference/functions/get_dropins/)).
- Never checked, so audit them by hand or with `scripts/scan-code.sh`:
  - the active theme and its parent theme;
  - must-use plugins and drop-ins;
  - plugins without a `WC tested up to` header that declare nothing (site-specific plugins often lack both);
  - PHP stored in the database by snippet plugins (not files, so a file scan misses it; export the snippets first);
  - systems outside WordPress that read the database directly, such as data warehouses, shipping, accounting or ERP
    connectors. The large-store guide asks you to confirm they do not read the posts tables before moving on
    ([guide](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/guide-large-store/)).
- A declaration is recorded as the plugin states it
  ([FeaturesController.php L1011-L1089](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L1011-L1089)).
  WooCommerce does not test the claim, so declared-compatible plugins still go through the staging tests.

## Where WooCommerce shows the result

- Settings screen: a warning that reads "N Incompatible plugin(s) detected (names)" plus a "View and manage" link to
  `wp-admin/plugins.php?plugin_status=incompatible_with_feature&feature_id=custom_order_tables`
  ([PluginUtil.php L219-L293](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Utilities/PluginUtil.php#L219-L293);
  [HPOS overview](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/)).
- Other admin screens: an error notice when an active plugin is incompatible with an enabled feature
  ([FeaturesController.php L1750-L1797](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L1750-L1797)).
- CLI: `wp wc hpos compatibility-info --include-inactive --display-filenames` (9.2.0 and later) prints the three lists;
  inactive plugins always land in "uncertain"
  ([CLIRunner.php L1232-L1287](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L1232-L1287)).
- `wp wc hpos enable` fails with "[Failed] Some installed plugins are incompatible" while any active plugin is
  incompatible or uncertain, unless `--ignore-plugin-compatibility` is passed
  ([CLIRunner.php L779-L788](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Database/Migrations/CustomOrderTable/CLIRunner.php#L779-L788)).
- When the WooCommerce Legacy REST API plugin is active, the settings screen adds a warning that the Legacy REST API is
  not compatible with HPOS ([PluginUtil.php L225-L248](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Utilities/PluginUtil.php#L225-L248)).
  Since 8.9.0 that plugin alone does not block enabling HPOS ([PR 46634](https://github.com/woocommerce/woocommerce/pull/46634)),
  so find out what still calls the legacy API before the switch.

## How a declaration works

The recipe book's snippet, placed in the main plugin file
([recipe book](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/recipe-book/)):

```php
add_action( 'before_woocommerce_init', function() {
	if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
	}
} );
```

- Third argument `false` declares incompatibility.
- The call must run inside a `before_woocommerce_init` handler; outside it WooCommerce raises `wc_doing_it_wrong`
  and ignores the declaration
  ([FeaturesUtil.php L75-L94](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Utilities/FeaturesUtil.php#L75-L94);
  [FeaturesController.php L1011-L1030](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L1011-L1030)).
- The second argument must identify the plugin: `__FILE__` from the main file, or `'my-plugin/my-plugin.php'` from
  elsewhere. A file that matches no plugin is logged as "FeaturesController: Invalid plugin file ..." and ignored
  ([FeaturesController.php L1057-L1063](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L1057-L1063)).
  A declaration in the wrong place leaves the plugin "uncertain", which blocks the switch.
- Declaring the same plugin both compatible and incompatible throws an exception
  ([FeaturesController.php L1073-L1075](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L1073-L1075)).

## Code patterns to search for

The recipe book gives two regular expressions and warns that most matches are false positives
([recipe book](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/recipe-book/)).
`scripts/scan-code.sh` runs both.

Direct database and WordPress API access:

```text
wpdb|get_post|get_post_field|get_post_status|get_post_type|get_post_type_object|get_posts|metadata_exists|get_post_meta|get_metadata|get_metadata_raw|get_metadata_default|get_metadata_by_mid|wp_insert_post|add_metadata|add_post_meta|wp_update_post|update_post_meta|update_metadata|update_metadata_by_mid|delete_metadata|delete_post_meta|delete_metadata_by_mid|delete_post_meta_by_key|wp_delete_post|wp_trash_post|wp_untrash_post|wp_transition_post_status|clean_post_cache|update_post_caches|update_postmeta_cache|post_exists|wp_count_post|shop_order
```

Order admin screen hooks:

```text
post_updated_messages|do_meta_boxes|enter_title_here|edit_form_before_permalink|edit_form_after_title|edit_form_after_editor|submitpage_box|submitpost_box|edit_form_advanced|dbx_post_sidebar|manage_shop_order_posts_columns|manage_shop_order_posts_custom_column
```

Why the direct calls matter: reading the posts tables directly "may mean reading an outdated order, and directly writing
to these tables may mean updating an order that will not be read" ([recipe book](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/recipe-book/)).

Replacements from the recipe book:

| Instead of | Use |
| --- | --- |
| `get_post( $id )` for an order | `wc_get_order( $id )` |
| `get_post_meta` / `update_post_meta` / `add_post_meta` / `delete_post_meta` on an order | `$order->get_meta()`, `update_meta_data()`, `add_meta_data()`, `delete_meta_data()`, then `$order->save()` |
| `'shop_order' === get_post_type( $id )` | `OrderUtil::get_order_type( $id )` or `OrderUtil::is_order( $id, wc_get_order_types() )` |
| SQL that must know the storage | branch on `OrderUtil::custom_orders_table_usage_is_enabled()` |
| Meta boxes on `'shop_order'` | the screen from `wc_get_page_screen_id( 'shop-order' )`, and accept a `WP_Post` or a `WC_Order` in the callback |
| `WP_Query` / `get_posts` for orders | `wc_get_orders()` (HPOS query arguments: [order querying APIs](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/wc-order-query-improvements/)) |

`OrderUtil` lives in [OrderUtil.php](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Utilities/OrderUtil.php#L39-L141).
The admin hook names that change are in [after-cutover.md](after-cutover.md).

## Order types owned by extensions

- Only registered order types are migrated and verified
  ([wc-order-functions.php L280-L286](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-functions.php#L280-L286)).
  Keep extensions that register order types active through the whole migration; WooCommerce's merchant guide names
  Woo Subscriptions and WooCommerce Bookings as examples and gives a recovery path if they were inactive: switch back to
  posts storage, let the sync finish, then switch to HPOS again
  ([merchant guide](https://woocommerce.com/document/high-performance-order-storage/)).
- List the registered types with a read-only call: `wp eval 'echo implode( ",", wc_get_order_types( "cot-migration" ) );'`.

## Staging tests

The large-store guide's minimum test set: checkout with every payment method, refunds for those orders, subscription
purchases and renewals when Subscriptions is installed, and the site's own critical flows; run them with sync on, then
again with sync off ([guide](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/guide-large-store/)).
Code that reads `wp_posts` keeps working while compatibility mode is on, because every HPOS save also writes the post
record ([OrdersTableDataStore.php L3154-L3157](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3154-L3157)).
The sync-off pass is the one that finds it.

## Output of the audit

One row per component:

| Component | Type (plugin, theme, mu-plugin, snippet, external) | WooCommerce's verdict | Code findings | Decision (update, replace, fix and declare, remove, accept) | Owner |
| --- | --- | --- | --- | --- | --- |

Do not move to the change steps while any row lacks a decision.
