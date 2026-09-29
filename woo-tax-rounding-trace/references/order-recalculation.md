# How an order recalculates (calculate_totals, calculate_taxes, update_taxes)

Read this when the helper names stage 6 or 7, when the order was placed through block checkout, the REST API or the
admin screen, or before anyone presses "Recalculate". Code links point at the WooCommerce 11.1.2 tag. The helper
implements this in `orderRecalc()`.

## When it runs

| Trigger | What runs | Source |
| --- | --- | --- |
| Admin order screen, "Recalculate" | Saves the posted item fields, then `calculate_taxes()` with the address from the form, then `calculate_totals( false )`. It writes to the order | [TaxesController.php L32-L55](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Orders/TaxesController.php#L32-L55); [meta-boxes-order.js L863-L873](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/client/legacy/js/admin/meta-boxes-order.js#L863-L873) |
| Block checkout (Store API) | Line, shipping, fee, coupon and tax lines copied from the cart with the classic checkout functions, then `calculate_totals()`, so the stored totals come from this algorithm and not from the cart's | [OrderController.php L71-L93, L831-L863](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/OrderController.php#L71-L93); [Checkout.php L808](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php#L808) |
| Classic checkout | Not run: the cart's figures are copied ([cart-totals.md](cart-totals.md#what-checkout-copies-into-the-order)) | [class-wc-checkout.php L534-L548](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L534-L548) |
| REST API | On create, always; on update, when the request carries billing, shipping, line, shipping, fee or coupon lines | [v2 controller L826-L833](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-orders-v2-controller.php#L826-L833); [v3 controller L281-L285](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version3/class-wc-rest-orders-controller.php#L281-L285) |
| Coupon applied to an existing order | `recalculate_coupons()` spreads the coupons with `WC_Discounts` over the order lines, then `calculate_totals( true )` | [abstract-wc-order.php L1791-L1845](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L1791-L1845) |
| Refund | `calculate_totals( false )` on the refund object, whose total is then set to the refund amount | [wc-order-functions.php L657-L659](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-functions.php#L657-L659) |

The order's `created_via` says which path created it: `checkout` for classic checkout, `store-api` for block checkout
([class-wc-checkout.php L451](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L451);
[OrderController.php L56](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/OrderController.php#L56)).
`export-order.php` prints it, and the helper compares the stored figures with the path that made them.

## Step by step

1. `calculate_totals( $and_taxes = true )` sums shipping lines (each rounded to price decimals), caps a negative fee so
   the total cannot go below zero, then calls `calculate_taxes()` when `$and_taxes` is true
   ([L2383-L2417](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L2383-L2417)).
2. `calculate_taxes()` takes the tax location from the order's addresses (`woocommerce_tax_based_on`; billing when there
   is no shipping country; the shop base address for local pickup), picks the shipping tax class (for `inherit`, the
   first class found on the items in class order), skips VAT-exempt orders, and asks each line to recalculate
   ([L2127-L2176, L2215-L2251](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L2215-L2251)).
3. Each product and fee line: `WC_Tax::calc_tax( line total, rates, false )` and the same for the subtotal, always with
   the exclusive formula on the stored net amount, in currency units
   ([class-wc-order-item.php L282-L309](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-order-item.php#L282-L309)).
   A negative fee spreads its tax over the order's tax classes in proportion to their cost
   ([class-wc-order-item-fee.php L90-L130](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-order-item-fee.php#L90-L130)).
4. Each shipping line: `WC_Tax::calc_tax( cost, shipping rates, false )`
   ([class-wc-order-item-shipping.php L45-L60](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-order-item-shipping.php#L45-L60)).
   It calls `calc_tax()`, not `calc_shipping_tax()`, so a callback on `woocommerce_shipping_prices_include_tax` plays no
   part here.
5. `update_taxes()`: per rate, the sum over product and fee lines of `round_line_tax( $tax, false )` (per-line setting:
   price decimals, tax rounding mode) and over shipping lines of `wc_round_tax_total()` (per-line setting only); tax
   lines are updated, removed or added to match; `cart_tax` and `shipping_tax` are set to the sums
   ([L2273-L2346](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L2273-L2346)).
6. Back in `calculate_totals()`: `discount_total` is the rounded difference of the lines' subtotals and totals,
   `discount_tax` the rounded difference of their unrounded taxes, and
   `total = NumberUtil::round( lines total + fees + shipping + cart_tax + shipping_tax, price decimals )`, where the lines
   total is the sum of `round_item_subtotal()` of each line's stored net
   ([L2354-L2381, L2419-L2447](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L2419-L2447)).

## Where it differs from the cart

| | Cart (`WC_Cart_Totals`) | Order (`calculate_totals()`) |
| --- | --- | --- |
| Tax base with prices entered with tax | Gross price, inclusive formula | Stored net line total, exclusive formula |
| Units while calculating | Cents (`WC_Tax::round()` keeps 6 places of a cent) | Currency (6 places of the currency unit) |
| Line tax rounding (per-line setting) | Each rate to a whole cent, tax rounding mode | Each rate to price decimals, tax rounding mode |
| Shipping tax rounding (per-line setting) | `round_item_subtotal()`: half up | `wc_round_tax_total()`: tax rounding mode (half down with prices entered with tax) |
| Total tax | Item tax plus separately rounded shipping and fee tax, then `wc_round_tax_total()` | `cart_tax + shipping_tax` rounded half up |
| Discount | `WC_Discounts` on the cart lines | Subtotal minus total of the stored lines |
| Tax location | The customer's session address | The order's addresses and `woocommerce_tax_based_on` |

Sources: [class-wc-cart-totals.php](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php)
and the order lines cited above. Most of the time the two paths agree to the cent, because the stored net is the gross
minus the unrounded tax. They part ways on half-way values: example 4 in [worked-examples.md](worked-examples.md) is a
shipping tax of exactly 0.275 that the cart rounds to 0.28 and a recalculation to 0.27.

## Consequences for the trace

- A recalculation uses the settings in force when it runs. After a change of `woocommerce_tax_round_at_subtotal`, an
  old order recalculates under the new setting (example 3).
- Coupons applied to an order spread the discount over lines whose price, with prices entered with tax, is the stored
  subtotal plus the stored (rounded) subtotal tax
  ([class-wc-discounts.php L102-L127](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-discounts.php#L102-L127)),
  and take the discount's tax off with the inclusive formula
  ([abstract-wc-order.php L1883-L1903](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L1883-L1903)).
- Pressing "Recalculate" on a paid order changes stored totals without changing what the gateway captured. Run it on a
  staging copy first ([changes-and-rollback.md](changes-and-rollback.md)).
