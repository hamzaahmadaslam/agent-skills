# Variable products: variations, the parent's price rows and the price transient

Read this when a variable product shows the wrong "From" price, range or sale badge, or sorts and filters at the
wrong price. Code links point at the WooCommerce 11.1.2 tag.

## Where the sale lives

- A scheduled sale on a variable product is set per variation: each `product_variation` post has its own
  `_regular_price`, `_sale_price`, date keys and `_price`
  ([class-wc-product-variation-data-store-cpt.php L370-L371](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variation-data-store-cpt.php#L370-L371)).
  The editor saves variation dates with the same `00:00:00` and `23:59:59` shape as simple products
  ([class-wc-meta-box-product-data.php L553-L570](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/meta-boxes/class-wc-meta-box-product-data.php#L553-L570)).
- The parent has no sale dates of its own. The per-product handlers skip variable and grouped products
  ([wc-product-functions.php L702-L705](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L702-L705)).

## Four places a variation's price shows up

| Place | Built from | Refreshed when | Source |
| --- | --- | --- | --- |
| The variation's `price` prop (what the cart charges for that variation) | Re-derived from `is_on_sale( 'edit' )` on every read | Every read | [class-wc-product-variation-data-store-cpt.php L421-L425](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variation-data-store-cpt.php#L421-L425) |
| The variation's `_price` meta | Written by the scheduled-sale handlers and by CRUD saves | A handler run or a price or date change | [scheduled-events.md](scheduled-events.md#what-wc_apply_sale_state_for_product-writes) |
| The parent's `_price` rows | One row per distinct `_price` of its visible variations, sorted | `WC_Product_Variable::sync()` | [sync_price L921-L955](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variable-data-store-cpt.php#L921-L955) |
| The `wc_var_prices_<parent id>` transient (the "From" price, range and badge) | Each visible variation's `price`, `regular_price` and `sale_price`, after filters | When it is missing or deleted | [read_price_data L334-L575](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variable-data-store-cpt.php#L334-L575) |

- `sync_price()` reads the variations' `_price` meta with SQL, deletes the parent's `_price`, `_sale_price` and
  `_regular_price`, adds one `_price` row per distinct non-empty value, and refreshes the parent's lookup row
  ([L921-L955](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variable-data-store-cpt.php#L921-L955)).
  So the parent's rows are only as fresh as the variations' `_price` meta.
- `WC_Product_Variable::sync()` runs `sync_price()`, the stock status and attribute syncs, fires
  `woocommerce_variable_product_sync_data`, and saves the parent
  ([class-wc-product-variable.php L710-L724](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-product-variable.php#L710-L724)).
  The sale handlers call it for the parent after writing a variation
  ([wc-product-functions.php L678-L684](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L678-L684)).
- "Visible" variations are published ones, minus out-of-stock ones when "Hide out of stock items" is on
  (`woocommerce_hide_out_of_stock_items`), and the filter `woocommerce_variable_children_args` can change the query
  ([read_children L171-L229](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variable-data-store-cpt.php#L171-L229)).
  The SQL block for variable parents counts published variations only, so a row-count difference on a store that
  hides out-of-stock items is expected; a range difference is not.

## The price transient

- Name `wc_var_prices_<parent id>`, kept for 30 days, stored as JSON with one entry per price hash
  ([L352-L360, L552](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variable-data-store-cpt.php#L352-L360)).
- While building it, a variation whose sale price is not its current price is recorded with its regular price as the
  sale price ([L455-L458](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variable-data-store-cpt.php#L455-L458)).
  The parent's `is_on_sale()` is true when, in that array, the sale prices differ from the regular prices and equal
  the active prices ([class-wc-product-variable.php L606-L611](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-product-variable.php#L606-L611)).
  A transient built before a variation's sale started keeps showing no badge and the old "From" price until it is
  deleted.
- The hash covers the filters on the variation prices and the tax display, not the time
  ([get_price_hash L647-L722](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-variable-data-store-cpt.php#L647-L722)).
  The 11.1.0 price reconciler says in its own docblock that the variable parent's aggregate display is not covered,
  because it is served from this transient
  ([ScheduledSalePriceReconciler.php L41-L50](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/ScheduledSalePriceReconciler.php#L41-L50)).
- It is deleted by `wc_delete_product_transients()` for the parent or any of its variations
  ([ProductUtil.php L88-L126](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Utilities/ProductUtil.php#L88-L126)),
  which the sale handlers call ([L676](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L676)).
- With a persistent object cache, transients live in the object cache, not in the options table, so the SQL block
  that counts `wc_var_prices_` rows sees only leftovers from before the object cache
  ([WordPress option.php L1541-L1570](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/option.php#L1541-L1570)).

## Reading the checks for a variable product

| Finding | Likely cause | Next |
| --- | --- | --- |
| A variation's `_price` disagrees with its window | The variation's event did not run, or has none | [runner-health.md](runner-health.md); the per-variation fix in [fixes-and-rollback.md](fixes-and-rollback.md) |
| Variations agree, the parent's range differs | `sync()` did not run after the variations changed | Parent re-sync in [fixes-and-rollback.md](fixes-and-rollback.md) |
| Parent rows agree, the lookup range differs | Lookup row not refreshed | Lookup refresh in [fixes-and-rollback.md](fixes-and-rollback.md) |
| Everything agrees in the database, the page shows the old "From" price or badge | Transient or page cache | [caches-and-lookup.md](caches-and-lookup.md) |
| Variation page price correct, cart correct, category page range wrong | Parent rows, lookup or transient; the variation itself re-derives its price | The three rows above |
