# What the storefront shows and what a shopper can buy

Read this for step 2 of the procedure, and whenever a shopper reports "the page says in stock but checkout says not
enough". Code links point at the WooCommerce 11.1.2 tag unless a line says otherwise.

## Two numbers

| Where | Number used | Source |
| --- | --- | --- |
| Product page stock text ("5 in stock", "Only 2 left in stock", per the "Stock display format" option `woocommerce_stock_format`) | `get_stock_quantity()`, that is `_stock`, with no reservations taken off | [wc-formatting-functions.php L1322-L1344](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-formatting-functions.php#L1322-L1344) |
| Cart and classic checkout check | `_stock` compared with live holds of other orders plus the quantity in this cart | [class-wc-cart.php L881-L920](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart.php#L881-L920) |
| Order-pay page (classic and Store API) | same comparison, excluding the order being paid | [class-wc-shortcode-checkout.php L159-L171](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/shortcodes/class-wc-shortcode-checkout.php#L159-L171); [OrderController.php L783-L800](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/OrderController.php#L783-L800) |
| Store API cart quantity limits and remaining stock | `_stock` minus live holds, excluding the session's draft order | [QuantityLimits.php L206-L231](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/QuantityLimits.php#L206-L231); [CartController.php L1103-L1107](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/CartController.php#L1103-L1107) |
| The reservation itself at place order | `_stock` locked, minus live holds of other orders, must cover the quantity | [ReserveStock.php L215-L260](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php#L215-L260) |

"Available to shoppers" in this skill means `_stock` minus the live holds of every order: the number a new shopper can
buy. The product page shows `_stock`. The difference is the sum of live holds, and it is what shoppers run into.

The cart check fails when `_stock < held + required` (filter `woocommerce_cart_item_required_stock_is_not_enough`) and
tells the shopper "Sorry, we do not have enough "%1$s" in stock to fulfill your order (%2$s available)", where the
second value is `_stock` minus the holds of other orders (class-wc-cart.php L913-L917). Only products that manage
stock and do not allow backorders are checked (L897-L899).

## Whose holds are excluded

The helpers that count holds (`wc_get_held_stock_quantity()`, `ReserveStock::get_reserved_stock()`) exclude one order
ID ([wc-stock-functions.php L422-L436](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L422-L436);
[ReserveStock.php L52-L63](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php#L52-L63)).
The classic cart check picks it like this in 11.1.2
([class-wc-cart.php L884](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart.php#L884)):

```php
$current_session_order_id = isset( WC()->session->order_awaiting_payment ) ? absint( WC()->session->order_awaiting_payment ) : absint( WC()->session->get( 'store_api_draft_order', 0 ) );
```

- A shopper with two unpaid orders holding the same product (for example after changing the cart, or after leaving a
  redirect gateway and starting again) has one of them counted against them. With low stock they can be told
  "0 available" by their own hold, until it expires or the order is cancelled.
- When the session holds `order_awaiting_payment` as `false` (the customer cancel link sets it so,
  [class-wc-form-handler.php L887-L889](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-form-handler.php#L887-L889)),
  `isset()` is still true, `absint( false )` is 0, and the `store_api_draft_order` fallback is skipped. This is the
  first cause in [issue 67354](https://github.com/woocommerce/woocommerce/issues/67354); the fix,
  [PR 67471](https://github.com/woocommerce/woocommerce/pull/67471), merged to trunk on 2026-08-14 with the 11.2.0
  milestone, so 11.1.2 still has it.
- An opt-in filter that would stop counting a shopper's own stale holds is proposed in
  [PR 68963](https://github.com/woocommerce/woocommerce/pull/68963) (open on 2026-09-29), after an earlier version
  (PR 67751) was merged and reverted on 2026-08-21 ([PR 67931](https://github.com/woocommerce/woocommerce/pull/67931)).

## Store API and a fully held product

`QuantityLimits` builds the purchase limit with `min( array_filter( $limits ) )`
([QuantityLimits.php L206-L211](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/QuantityLimits.php#L206-L211)).
`array_filter()` without a callback drops a remaining stock of 0, so when every unit is held the product still reports
a purchasable quantity while adding it to the cart fails.
[PR 67446](https://github.com/woocommerce/woocommerce/pull/67446) (open on 2026-09-29) proposes keeping the 0.

## What this means for the reconciliation

- The storefront can be right about `_stock` and wrong about what is buyable at the same moment. The report lists, per
  product, `_stock`, live holds and available-to-shoppers, and flags products whose live holds are at or above
  `_stock` while the product is still "in stock".
- Units held by a shopper's own old orders are real holds in the data. The fix is to let them expire or cancel the old
  unpaid orders through WooCommerce (a status change), never to delete their rows while the order is still unpaid and
  the hold still counts.
- A support reply about "cart holds stock" can be checked against this: adding to the cart writes nothing to
  `wc_reserved_stock` (see [how-reservations-work.md](how-reservations-work.md)). In the
  [support thread "Stock Hold Issues Make Woocommerce unusable"](https://wordpress.org/support/topic/stock-hold-issues-make-woocommerce-unusable/)
  (2024, before the 9.2.0 and 10.9.0 changes to draft orders) the store saw holds applied during cart updates and
  pending orders that were never cancelled.
