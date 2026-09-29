# How WooCommerce reserves stock at checkout

Read this before step 1 of the procedure, and whenever a shopper sees fewer units than the product page shows. Code
links point at the WooCommerce 11.1.2 tag unless a line says otherwise.

## The table

`{prefix}wc_reserved_stock` has one row per order and product
([class-wc-install.php L2017-L2025](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-install.php#L2017-L2025)):

| Column | Type | Meaning |
| --- | --- | --- |
| `order_id` | bigint | The order holding the units |
| `product_id` | bigint | The product whose stock is held: the product that manages the stock, so a parent product when its variations take stock from it |
| `stock_quantity` | double | Units held |
| `timestamp` | datetime | When the hold was written |
| `expires` | datetime | When the hold stops counting |

- Primary key `(order_id, product_id)` and, since 10.8.0, the index `product_id_expires (product_id, expires)` (same
  lines; [PR 63864](https://github.com/woocommerce/woocommerce/pull/63864)).
- WooCommerce registers the table as `$wpdb->wc_reserved_stock`
  ([class-woocommerce.php L588-L600](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-woocommerce.php#L588-L600)).
- Reservation works only when the option `woocommerce_schema_version` is 430 or higher, the schema that added the
  table in 4.3.0 ([ReserveStock.php L30-L33](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php#L30-L33);
  [4.3.0 changelog entry, #26395](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt)).
- The product ID in a row is `get_stock_managed_by_id()`
  ([ReserveStock.php L126-L138](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php#L126-L138)).
  A variation manages its own stock when its `manage_stock` is on; when it is off and the parent's is on, the parent
  holds the stock and the row carries the parent's ID
  ([class-wc-product-variation.php L87-L89, L322-L330](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-product-variation.php#L322-L330)).

## When a row is written

| Checkout | Moment | Source |
| --- | --- | --- |
| Classic (`[woocommerce_checkout]`) | `wc_reserve_stock_for_order()` runs on `woocommerce_checkout_order_created`, fired at the end of `WC_Checkout::create_order()` | [wc-stock-functions.php L446-L465](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L446-L465); [class-wc-checkout.php L510](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L510) |
| Block checkout (Store API) | During the place-order POST, after the order is validated and coupons are held, before the status becomes `pending` | [Checkout.php L620-L647, L669-L671](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php#L620-L647) |
| Agentic Checkout API (experimental feature `agentic_checkout`, off by default) | When a checkout session completes, before the status becomes `pending` | [CheckoutSessionsComplete.php L297-L305](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Agentic/CheckoutSessionsComplete.php#L297-L305); [FeaturesController.php L625-L636](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Features/FeaturesController.php#L625-L636) |

Since 9.2.0 the Store API holds stock only on the place-order POST, not for every draft order or on other requests
([Checkout.php L630-L636](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php#L630-L636);
[PR 49446](https://github.com/woocommerce/woocommerce/pull/49446)). Adding to the cart writes nothing to the table.

What `wc_reserve_stock_for_order()` does
([wc-stock-functions.php L446-L465](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L446-L465);
[ReserveStock.php L73-L183](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php#L73-L183)):

1. It stops when the filter `woocommerce_hold_stock_for_checkout` returns false; the default is the store's "Manage
   stock" setting (`woocommerce_manage_stock`).
2. It passes the minutes from `woocommerce_hold_stock_minutes` (read with a default of 60) through the filter
   `woocommerce_order_hold_stock_minutes` (since 8.8.0). Zero minutes means no hold at all, so a blank "Hold stock"
   setting writes no rows.
3. For each line item with a quantity: a product that is out of stock stops checkout with "is out of stock and cannot
   be purchased"; a product that does not manage stock or allows backorders is skipped; quantities of the same stock
   owner are added up, after the filter `woocommerce_order_item_quantity`.
4. It writes the rows in product ID order (to avoid deadlocks between two orders with the same products), one
   statement per product.
5. If any product cannot be held, it deletes every row of the order and stops checkout with "Not enough units of %s
   are available in stock".
6. On success it adds the order note "Stock hold of N minutes applied to:" with up to five items. The note is the
   easiest trace of a hold on one order.

## The statement that writes a row

([ReserveStock.php L215-L260](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php#L215-L260))

- `INSERT ... SELECT ... WHERE (current _stock FOR UPDATE) - (live holds of other orders LOCK IN SHARE MODE) >= quantity`,
  so a row is written only when enough units are free at that moment, and `ON DUPLICATE KEY UPDATE` refreshes
  `expires` and `stock_quantity` when the same order tries again.
- `timestamp` is `NOW()` and `expires` is `NOW() + INTERVAL <minutes> MINUTE`: both come from the database clock.
- The code comment says the locking needs InnoDB tables. The statement is retried up to three times when it fails,
  for lock wait timeouts and deadlocks under load.
- `_stock` is read from `{prefix}postmeta` (meta key `_stock`) for the stock owner
  ([class-wc-product-data-store-cpt.php L2566-L2576](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L2566-L2576)).
- 11.0.0 changed the locks so a reservation no longer blocks order status updates
  ([PR 65325](https://github.com/woocommerce/woocommerce/pull/65325), fixing
  [issue 65313](https://github.com/woocommerce/woocommerce/issues/65313)).

## Which rows count

`get_query_for_reserved_stock()`
([ReserveStock.php L269-L306](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php#L269-L306))
sums `stock_quantity` for one product where all of these hold:

- the row's order has status `wc-checkout-draft` or `wc-pending`, read from `{prefix}wc_orders.status` when HPOS is
  the authoritative order storage and from `{prefix}posts.post_status` otherwise;
- `expires > NOW()`;
- the order is not the one being checked (one excluded order ID).

The filter `woocommerce_query_for_reserved_stock` can replace the query; a store with a callback on it may count
holds differently, so list its callbacks before trusting the SQL in this skill.

Consequences for reconciliation:

| Row | Counts against availability? | Why |
| --- | --- | --- |
| Draft or pending order, `expires` in the future | Yes | Both conditions hold |
| Draft or pending order, `expires` passed | No | Expired, even though the row stays and the order may still be pending |
| Order now processing, completed, on-hold or cancelled | No, and normally already deleted | Those status hooks delete the order's rows |
| Order now failed | No | Status not in the list; no hook deletes the row |
| Order deleted (for example a draft removed by the daily cleanup) | No | The join finds no status; nothing deletes the row |

Only matching rows affect shoppers. Expired rows, rows of failed orders and rows of deleted orders do not change
availability; they only take up space.

## When rows are deleted

`wc_release_stock_for_order()` deletes every row of one order
([wc-stock-functions.php L473-L497](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L473-L497);
[ReserveStock.php L190-L203](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php#L190-L203)).
It runs on:

- `woocommerce_checkout_order_exception` (classic checkout failed after the order was created);
- `woocommerce_payment_complete`, priority 11;
- `woocommerce_order_status_cancelled`, `_completed`, `_processing` and `_on-hold`, priority 11;
- a Store API place-order request that ends in an error
  ([Checkout.php L177-L184](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php#L177-L184));
- removing an item from the cart through the Store API while the session has a draft order
  ([CartRemoveItem.php L100-L108](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/CartRemoveItem.php#L100-L108)).

Nothing in WooCommerce 11.1.2 deletes rows because they expired: the only delete in `ReserveStock` is by order ID.
Rows of failed orders, of orders that stay pending, and of orders deleted outright stay in the table. The table also
does not shrink when the draft order cleanup deletes drafts (see
[orders-and-cancellation.md](orders-and-cancellation.md)).

## The clock

`expires` is written and compared with the database's `NOW()` (ReserveStock.php L226 and L287, links above). Compare
it with `NOW()` in the same database session, never with a PHP time, the site's time zone or `UTC_TIMESTAMP()`. The
SQL in `scripts/` does this and prints `NOW()`, `UTC_TIMESTAMP()` and the session time zone so a reader can see the
offset.
