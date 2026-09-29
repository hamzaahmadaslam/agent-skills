# When `_stock` goes down and when it comes back

Read this for step 4 of the procedure, and before any correction of `_stock`. A reservation never changes `_stock`;
only reduction, restore, refund restock, admin edits and direct stock updates do. Code links point at the
WooCommerce 11.1.2 tag unless a line says otherwise.

## Where stock lives

- A product's stock is the post meta `_stock` in `{prefix}postmeta`, next to `_manage_stock`, `_stock_status` and
  `_backorders`, in both order storage modes: HPOS moves orders, not products
  ([class-wc-product-data-store-cpt.php L47-L50, L461-L479](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L461-L479)).
- `{prefix}wc_product_meta_lookup` keeps a copy in `stock_quantity` and `stock_status` for queries
  ([class-wc-install.php L1985-L2009](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L1985-L2009)).
- `update_product_stock()` changes `_stock` with one `UPDATE` (`set`, or `meta_value + n` / `meta_value - n`), clears
  the post meta cache and refreshes the lookup row
  ([L1783-L1836](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L1783-L1836)).
  `wc_update_product_stock()` wraps it, fires `woocommerce_product_before_set_stock` or
  `woocommerce_variation_before_set_stock` before and `woocommerce_product_set_stock` or
  `woocommerce_variation_set_stock` after, and saves the product so the stock status follows
  ([wc-stock-functions.php L30-L81](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L30-L81)).

A raw `UPDATE` of `_stock` in SQL skips the lookup table, the caches, the stock status and every hook that
inventory, feed and ERP plugins listen to. Corrections in this skill go through `wc_update_product_stock()` or the
product edit screen.

## Reduction

`wc_maybe_reduce_stock_levels()` runs on `woocommerce_payment_complete`, `woocommerce_order_status_completed`,
`woocommerce_order_status_processing` and `woocommerce_order_status_on-hold`
([wc-stock-functions.php L104-L127](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L104-L127)):

1. It reads the order's "stock reduced" flag and passes its opposite through the filter
   `woocommerce_payment_complete_reduce_order_stock`; it stops when the result is false.
2. It calls `wc_reduce_stock_levels()`.
3. It sets the order's flag to true, whatever step 2 did.

`wc_reduce_stock_levels()`
([L170-L239](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L170-L239)):

- returns at once when "Manage stock" (`woocommerce_manage_stock`) is not `yes` or the filter
  `woocommerce_can_reduce_order_stock` returns false;
- for each line item that has no `_reduced_stock` meta and whose product manages stock, decreases stock by the item
  quantity (after `woocommerce_order_item_quantity`), writes that quantity to the item meta `_reduced_stock`, and fires
  `woocommerce_reduce_order_item_stock`;
- adds the order note "Stock levels reduced:" with from and to values, and fires `woocommerce_reduce_order_stock`.

The same status hooks release the order's reservation rows at priority 11, after the reduction
([L492-L497](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L492-L497)).
So the normal path moves the units from "held" to "deducted" in one status change.

## Restore

`wc_maybe_increase_stock_levels()` runs on `woocommerce_order_status_cancelled`, `woocommerce_order_status_pending`
and, since 11.0.0, `woocommerce_order_status_failed`
([L136-L162](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L136-L162);
[PR 66256](https://github.com/woocommerce/woocommerce/pull/66256)). It acts only when the order's flag is true, calls
`wc_increase_stock_levels()`, then sets the flag to false.

`wc_increase_stock_levels()`
([L351-L412](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L351-L412))
returns at once when "Manage stock" is off or `woocommerce_can_restore_order_stock` returns false; otherwise, for each
line item with `_reduced_stock`, it adds that amount back, deletes the item meta, fires
`woocommerce_restore_order_item_stock`, and notes "Stock levels increased:".

`refunded` is not among the restore hooks. A refund puts units back only when "Restock refunded items" is ticked:
`wc_create_refund()` has `restock_items` false by default, and the admin refund request passes the checkbox
([wc-order-functions.php L559-L567, L687-L688](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-functions.php#L559-L567);
[class-wc-ajax.php L2427, L2473](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-ajax.php#L2427)).
`wc_restock_refunded_items()` then increases stock by the refunded quantity, lowers `_reduced_stock` by the same
amount and adds it to `_restock_refunded_items`
([L815-L869](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-functions.php#L815-L869)).

Editing line item quantities on an order in the admin adjusts stock by the difference between the new quantity and
`_reduced_stock` plus `_restock_refunded_items`, and restores the full `_reduced_stock` when an item is removed
(filter `woocommerce_prevent_adjust_line_item_product_stock`)
([wc-admin-functions.php L232-L275](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/wc-admin-functions.php#L232-L275)).

## The two records of a reduction

| Record | HPOS | Posts storage | Source |
| --- | --- | --- | --- |
| Order flag "stock reduced" | `{prefix}wc_order_operational_data.order_stock_reduced` (tinyint) | `{prefix}postmeta` meta `_order_stock_reduced` (`yes` or `no`) | [OrdersTableDataStore.php L520-L523, L1004-L1022, L3511-L3532](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L3511-L3532); [class-wc-order-data-store-cpt.php L862-L889](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-order-data-store-cpt.php#L862-L889) |
| Units deducted per line item | `{prefix}woocommerce_order_itemmeta` meta `_reduced_stock` (and `_restock_refunded_items` after a restocked refund) | same tables | [wc-stock-functions.php L190-L216](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L190-L216); [class-wc-install.php L1859-L1875](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L1859-L1875) |

The line item's product and variation are in the item meta `_product_id` and `_variation_id`, the quantity in `_qty`
([class-wc-order-item-product-data-store.php L25, L61-L63](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-order-item-product-data-store.php#L61-L63)).
Order items live in the same two tables under HPOS and posts storage.

The flag and the item meta can disagree, and the item meta is the one that tells what `_stock` holds:

- The flag is set to true even when `wc_reduce_stock_levels()` returned early (stock management off at that moment,
  a filter said no) or skipped items (product not managing stock then). Such an order says "reduced" with no
  `_reduced_stock` on its items.
- The flag is set to false after a restore even when the restore returned early, leaving `_reduced_stock` on the
  items: units still deducted on an order that no longer claims them.
- The item meta is what the restore reads, and what the admin quantity edit reads.

So the reconciliation SQL reads `_reduced_stock`, and reports the flag only as a hint.

## What each order status means for `_stock`, normal path

| Status | `_reduced_stock` on items | Reservation rows |
| --- | --- | --- |
| checkout-draft, pending | none (unless the order went back to pending from a reduced state and the restore was blocked) | live until `expires` |
| on-hold, processing, completed | present for items that manage stock | deleted |
| cancelled | removed by the restore | deleted |
| failed (11.0.0 and later) | removed by the restore when it had been reduced | may remain, not counted |
| refunded | present, minus restocked refund quantities | deleted earlier |

An order in on-hold, processing or completed without `_reduced_stock` on a stock-managed item never took its units
off `_stock`. An order in draft, pending, cancelled or failed with `_reduced_stock` still has units taken off. Both are
the rows step 4 of the procedure lists.
