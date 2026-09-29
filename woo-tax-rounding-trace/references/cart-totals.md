# How the cart computes totals (WC_Cart_Totals)

Read this when the helper script names stage 0 (cart page), 1 to 3 (line values) or 4 to 6 (what checkout stores), or
when the cart, checkout page or Store API shows a different figure from the order. Code links point at the
WooCommerce 11.1.2 tag. `scripts/tax-trace.mjs` implements the steps below in `cartReplay()`.

## Units and order of work

- The class works in "cents": every amount is multiplied by 10 to the price decimals with `wc_add_number_precision()`
  and kept unrounded beyond that; the file's rounding guide says stored values stay unrounded so taxes can be
  recalculated later, and totals are rounded if settings allow
  ([class-wc-cart-totals.php L1-L13](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L1-L13)).
- Order of work: item totals (items, subtotals, coupons, line taxes), shipping, fees, then the grand total
  ([L146-L151](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L146-L151)).
- Tax is calculated only when taxes are enabled and the customer is not VAT exempt
  ([L127-L139](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L127-L139)).

## Step by step

| Step | What happens | Source |
| --- | --- | --- |
| Line price | `price x quantity`, into cents (rounded to rounding precision minus price decimals places, half up) | [L222-L238](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L222-L238) |
| Subtotal taxes | `WC_Tax::calc_tax( price, rates, prices_include_tax )`, each rate rounded by `WC_Tax::round()`; with prices entered with tax the net subtotal is the price minus the unrounded taxes. Line subtotal tax is the sum of `round_line_tax()` of each rate | [L717-L765](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L717-L765) |
| Price adjustments | With prices entered with tax: a VAT-exempt customer gets the base taxes removed; a customer whose rates differ from the base rates gets the base tax swapped for their own (filter `woocommerce_adjust_non_base_location_prices`, default true) | [L421-L469, L720-L731](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L421-L469) |
| Coupons | `WC_Discounts` spreads each coupon over the lines in cents (next section); the discount's own tax is computed per coupon and line with `calc_tax()` | [L773-L829](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L773-L829) |
| Line total and tax | Discounted price, `calc_tax()` again; line tax is the sum of `round_line_tax()` of each rate; with prices entered with tax the net total is the discounted price minus the unrounded taxes | [L653-L691](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L653-L691) |
| Items total | Sum of `round_item_subtotal()` of each line's net total (per-line setting: each net rounded to a whole cent, half up) | [L693-L700](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L693-L700) |
| Shipping | The rate's taxes come from the shipping method, calculated on the unrounded cost in currency units; the cost is then rounded to price decimals. The cart converts the taxes to cents and applies `round_item_subtotal()` (half up, not the tax rounding mode) | [L336-L354](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L336-L354); [abstract-wc-shipping-method.php L315-L343](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-shipping-method.php#L315-L343) |
| Fees | Positive taxable fee: `calc_tax()` on the fee in cents, exclusive. Negative fee: tax spread over the tax classes of items, fees and shipping in proportion to their totals, so it works as a discount; a negative fee cannot take the total below zero | [L274-L329](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L274-L329) |
| Grand total | `NumberUtil::round( items total + fees + shipping + sum of rounded taxes of every line, 0 )`, in cents, half up | [L870-L871](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L870-L871) |
| Total tax | Item taxes (as rounded per line, or unrounded at subtotal) plus shipping and fee taxes rounded on their own to price decimals, then `WC_Cart::set_total_tax()`, which applies `wc_round_tax_total()` (tax rounding mode) | [L872-L875](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L872-L875); [class-wc-cart.php L579-L582](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart.php#L579-L582) |
| Filters | `woocommerce_calculate_totals` (action) and `woocommerce_calculated_total` can change the total last; it is floored at zero | [L877-L883](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L877-L883) |

So with rounding at subtotal the grand total is rounded once, from unrounded line nets and taxes, while the total tax
row adds shipping and fee tax that was already rounded on its own. Example 2 in
[worked-examples.md](worked-examples.md) shows a checkout page whose rows (27.38 + 5.63 + 3.97) add up to one cent more
than its total (36.97).

## The two tax formulas

- Exclusive: each non-compound rate is `price x rate / 100`; each compound rate is `(price + the taxes so far) x rate /
  100`, in rate order ([class-wc-tax.php L181-L230](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-tax.php#L181-L230)).
- Inclusive: compound rates are taken out first, working backwards, then the regular rates share what is left in
  proportion to their rates ([class-wc-tax.php L128-L172](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-tax.php#L128-L172)).
- Both round every rate's amount with `WC_Tax::round()` (6 places with 2 price decimals); in the cart that is 6 places of
  a cent, in an order recalculation 6 places of the currency unit. The source comment calls it 4DP; the code uses
  `wc_get_rounding_precision()`.
- Rates are matched one per priority, and the order within a priority follows `sort_rates_callback()`
  ([class-wc-tax.php L305-L357](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-tax.php#L305-L357));
  WooCommerce's guide says it uses only the first matching rate at each priority and that a compound rate applies on top
  of all prior taxes ([setting up taxes](https://woocommerce.com/document/setting-up-taxes-in-woocommerce/)).

## How coupons are spread over lines (WC_Discounts)

| Coupon type | Spread | Source |
| --- | --- | --- |
| Any | Lines are sorted by unit price, highest first, before coupons apply | [class-wc-discounts.php L61-L65, L294-L301](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-discounts.php#L294-L301) |
| Percent | Each line: `floor( price x percent / 100 )` in cents, then `wc_round_discount()`; the cart-wide discount is computed once, and any cents still missing are handed out one cent at a time, line by line in the sorted order | [L362-L417, L564-L592](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-discounts.php#L362-L417) |
| Fixed cart | The amount divided by the item count, rounded down to a cent, applied per item as a fixed product discount; the rest goes round again, then one cent at a time | [L479-L509](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-discounts.php#L479-L509) |
| Fixed product | Amount times quantity per line, capped at the line's remaining price | [L428-L468](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-discounts.php#L428-L468) |
| Several coupons | Sorted by type (fixed product, percent, fixed cart), then usage limit, amount and ID (filter `woocommerce_coupon_sort`); with "Calculate coupon discounts sequentially" (`woocommerce_calc_discounts_sequentially`, default `no`) each coupon applies to the already discounted price | [class-wc-cart-totals.php L362-L412](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L362-L412); [class-wc-settings-general.php L304-L312](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/settings/class-wc-settings-general.php#L304-L312) |

With prices entered with tax, the discount is taken off the gross price and the tax is then worked back from the
discounted gross, so the discount's tax share lands in `discount_tax`
([L788-L821](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L788-L821)).
The helper script does not re-run the spread: it takes each line's discount from the input, or derives it from the
stored subtotal and total ([helper-script.md](helper-script.md)).

## What the cart and checkout page show

- Tax rows come from `WC_Cart::get_tax_totals()`: per rate, item and fee taxes are rounded with `wc_round_tax_total()`,
  shipping tax is rounded on its own with `NumberUtil::round()` and added back, then the sum is rounded again
  ([class-wc-cart.php L990-L1028](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart.php#L990-L1028)).
- The grand total is stored with `wc_format_decimal( $value, price decimals )`
  ([class-wc-cart.php L568-L570](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart.php#L568-L570)).
- Store API (block cart and checkout): `total_items` is the cart subtotal, `total_price` the cart total, `total_tax` the
  cart total tax, and `tax_lines` the rows above (only with itemized tax display), each in minor units rounded half up
  ([CartSchema.php L392-L433](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Schemas/V1/CartSchema.php#L392-L433)).
  Issue [#58938](https://github.com/woocommerce/woocommerce/issues/58938) (open) reports a Store API cart `total_price`
  one minor unit above the expected total with per-line rounding and two 9% rates on a tax-inclusive price.

## What checkout copies into the order

Classic checkout copies the cart's figures into the order; it does not recalculate
([class-wc-checkout.php L534-L548](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L534-L548)):

- order `shipping_total`, `discount_total`, `discount_tax`, `shipping_tax`, `total` from the cart; `cart_tax` is the
  cart's item tax plus fee tax;
- each product line gets the cart line's `line_subtotal`, `line_total`, their taxes and `line_tax_data`
  ([L555-L603](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L555-L603)),
  and the item's `set_taxes()` then recomputes the line tax from `line_tax_data` in currency units
  ([order-storage.md](order-storage.md));
- fee lines get the fee's total, tax and tax data ([L611-L639](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L611-L639));
- shipping lines get the rate's cost and its unrounded taxes ([L648-L682](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L648-L682));
- one tax line per rate, with the cart's item and fee tax for that rate and the cart's shipping tax for that rate
  ([L690-L730](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L690-L730));
- one coupon line per coupon with its discount and discount tax ([L738-L762](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L738-L762)).

The helper script's "checkout stores" line prints these values for both rounding settings.
