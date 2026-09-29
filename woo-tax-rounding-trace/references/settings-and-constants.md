# Settings and constants that decide rounding

Read this for step 0 of the procedure. Code links point at the WooCommerce 11.1.2 tag. `scripts/export-order.php` prints
every value below as the site sees it, after filters.

## Tax options

All are in WooCommerce > Settings > Tax unless the row says otherwise. Defaults come from the settings definitions
([settings-tax.php L23-L125](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/settings/views/settings-tax.php#L23-L125)).

| Option | Values (default first) | What it changes in the arithmetic |
| --- | --- | --- |
| `woocommerce_calc_taxes` (Settings > General) | `no`, `yes` | Taxes are calculated at all ([class-wc-settings-general.php L285-L290](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/settings/class-wc-settings-general.php#L285-L290)) |
| `woocommerce_prices_include_tax` | `no`, `yes` | Whether catalogue prices are gross. Also sets the tax rounding mode (next section). Each order records the value in force when it was created (`get_prices_include_tax()`, [abstract-wc-order.php L606](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L606)) |
| `woocommerce_tax_round_at_subtotal` | `no`, `yes` | "Round tax at subtotal level, instead of rounding per line". Read at run time by the cart, the order item setters, `update_taxes()` and the refund form; an order does not record which value was in force at checkout |
| `woocommerce_tax_based_on` | `shipping`, `billing`, `base` | Which address picks the rates; with no shipping country, billing is used; local pickup uses the shop base address ([abstract-wc-order.php L2127-L2176](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L2127-L2176)) |
| `woocommerce_shipping_tax_class` | `inherit`, a class slug | The class used for shipping tax; `inherit` takes it from the items ([abstract-wc-order.php L2215-L2251](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L2215-L2251); [class-wc-tax.php L584-L642](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-tax.php#L584-L642)) |
| `woocommerce_tax_display_shop` | `excl`, `incl` | Catalogue display only ([wc-product-functions.php L1696-L1727](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L1696-L1727)) |
| `woocommerce_tax_display_cart` | `excl`, `incl` | Cart, checkout, order pages and emails: which rows appear and whether line amounts include tax ([abstract-wc-order.php L2578-L2856](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L2578-L2856)) |
| `woocommerce_tax_total_display` | `itemized`, `single` | One tax row per rate code or one total row |
| `woocommerce_price_num_decimals` (Settings > General) | `2` | Price decimals; read through `wc_get_price_decimals()` ([class-wc-settings-general.php L376-L382](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/settings/class-wc-settings-general.php#L376-L382)) |

The two display values are `incl` and `excl`
([TaxDisplayMode.php L20-L27](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Enums/TaxDisplayMode.php#L20-L27)).
The display settings change what is shown, never what is stored. WooCommerce's setup guide warns that off-by-one
rounding can follow when the display settings do not all match the way prices are entered
([setting up taxes](https://woocommerce.com/document/setting-up-taxes-in-woocommerce/)), and its troubleshooting page
says that mixed settings make WooCommerce reverse-calculate prices, which can cause rounding differences, and that
totals off by 0.01 can occur with tax-inclusive prices and multiple quantities
([troubleshooting core taxes](https://woocommerce.com/document/troubleshooting-core-taxes/)).

## Constants and functions

| Name | Value in 11.1.2 | Source |
| --- | --- | --- |
| `WC_ROUNDING_PRECISION` | `6`, defined only if not already defined | [class-woocommerce.php L543](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-woocommerce.php#L543) |
| `WC_DISCOUNT_ROUNDING_MODE` | `2` (`PHP_ROUND_HALF_DOWN`), used by `wc_round_discount()` | [class-woocommerce.php L544](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-woocommerce.php#L544); [wc-core-functions.php L2469-L2471](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-core-functions.php#L2469-L2471) |
| `WC_TAX_ROUNDING_MODE` | `2` (half down) when `woocommerce_prices_include_tax` is `yes`, else `1` (half up) | [class-woocommerce.php L545](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-woocommerce.php#L545) |
| `wc_get_tax_rounding_mode()` | The constant as an integer; the value `'auto'` also picks half down or half up from the option | [wc-core-functions.php L1867-L1875](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-core-functions.php#L1867-L1875) |
| `wc_get_price_decimals()` | `woocommerce_price_num_decimals` through the filter `wc_get_price_decimals` | [wc-formatting-functions.php L567-L569](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-formatting-functions.php#L567-L569) |
| `wc_get_rounding_precision()` | Price decimals plus 2, never below `WC_ROUNDING_PRECISION`, then the filter `woocommerce_internal_rounding_precision` (since 8.8.0; its docblock warns that lowering it can cause off-by-one rounding) | [wc-core-functions.php L1884-L1899](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-core-functions.php#L1884-L1899) |

The PHP constants are `PHP_ROUND_HALF_UP` = 1, `PHP_ROUND_HALF_DOWN` = 2, `PHP_ROUND_HALF_EVEN` = 3 and
`PHP_ROUND_HALF_ODD` = 4 ([php-src php_math_round_mode.h L21-L35](https://github.com/php/php-src/blob/php-8.4.1/ext/standard/php_math_round_mode.h#L21-L35)).
Half up rounds a half away from zero and half down towards zero
([PHP round()](https://www.php.net/manual/en/function.round.php)).

So with 2 price decimals the internal precision is 6 places, and a store that enters prices with tax rounds half-way tax
amounts down while every other rounding in the chain stays half up. That split is behind examples 1 and 4 in
[worked-examples.md](worked-examples.md).

## Filters that change the arithmetic

Any callback on these changes the numbers, so list them before trusting a hand calculation (`export-order.php` prints the
non-WooCommerce callbacks on each):

| Filter or action | Where it runs | Source |
| --- | --- | --- |
| `woocommerce_calc_tax`, `woocommerce_price_inc_tax_amount`, `woocommerce_price_ex_tax_amount`, `woocommerce_tax_round` | Every tax calculation | [class-wc-tax.php L70-L227](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-tax.php#L70-L227) |
| `woocommerce_calc_shipping_tax`, `woocommerce_shipping_prices_include_tax` (since 10.6.0) | Shipping rate tax | [class-wc-tax.php L86-L101](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-tax.php#L86-L101) |
| `wc_round_tax_total` | Every tax rounding to cents | [wc-formatting-functions.php L235-L240](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-formatting-functions.php#L235-L240) |
| `woocommerce_adjust_non_base_location_prices` | Tax-inclusive prices for customers outside the base location | [class-wc-cart-totals.php L455-L469, L720](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L455-L469) |
| `woocommerce_cart_totals_get_item_tax_rates`, `woocommerce_calculate_item_totals_taxes`, `woocommerce_get_discounted_price`, `woocommerce_cart_totals_get_fees_from_cart_taxes`, `woocommerce_calculated_total`, action `woocommerce_calculate_totals` | Cart totals | [class-wc-cart-totals.php L319, L490-L499, L662-L678, L878-L883](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-cart-totals.php#L653-L701) |
| `woocommerce_order_get_tax_location`, `woocommerce_order_is_vat_exempt`, actions `woocommerce_order_before_calculate_totals`, `woocommerce_order_after_calculate_totals` | Order recalculation | [abstract-wc-order.php L2175, L2231, L2384, L2442](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L2383-L2447) |

## Reading them (read-only)

```sh
wp option get woocommerce_prices_include_tax
wp option get woocommerce_tax_round_at_subtotal
wp option get woocommerce_price_num_decimals
wp eval 'echo wc_get_price_decimals(), " ", wc_get_rounding_precision(), " ", WC_ROUNDING_PRECISION, " ", wc_get_tax_rounding_mode(), "\n";'
```

`wp option get` prints an option's value ([option get](https://developer.wordpress.org/cli/commands/option/get/)).
`scripts/export-order.sh` runs the first group and `export-order.php` prints the second group in its `settings` block.

Ask the owner whether `woocommerce_tax_round_at_subtotal` or `woocommerce_prices_include_tax` changed since the order was
placed. The order keeps its own `prices_include_tax`, but not the rounding setting; the helper script shows which setting
reproduces the stored figures (example 3 in [worked-examples.md](worked-examples.md)).
