# The rounding functions, one by one

Read this for step 5 of the procedure, when a step has to be rebuilt by hand. Each function below is what the cart,
the order, the REST API, the emails or the refund form call at the step the helper script names. Code links point at
the WooCommerce 11.1.2 tag.

## PHP behaviour underneath

- `round( $num, $precision, $mode )`: half up rounds a half away from zero (1.5 to 2, -1.5 to -2), half down towards
  zero (1.5 to 1), half even to the even neighbour, half odd to the odd one
  ([PHP round()](https://www.php.net/manual/en/function.round.php)). The constants are 1 to 4 in that order
  ([php-src L21-L35](https://github.com/php/php-src/blob/php-8.4.1/ext/standard/php_math_round_mode.h#L21-L35)).
- `number_format()` rounds half up ([PHP number_format()](https://www.php.net/manual/en/function.number-format.php)).
- PHP floats are IEEE 754 doubles; values such as 0.1 have no exact binary form, and the manual says never to trust a
  float result to the last digit ([PHP floats](https://www.php.net/manual/en/language.types.float.php)). A value that
  is exactly half a cent on paper can sit a hair above or below the half in PHP. The helper script uses exact
  arithmetic and lists every exact half-way value it meets, so those are the cases to confirm on staging.

## WooCommerce helpers

| Function | What it does | Source |
| --- | --- | --- |
| `NumberUtil::round( $val, $precision = 0, $mode = PHP_ROUND_HALF_UP )` | Calls `normalize()` first, which rounds any float to `WC_ROUNDING_PRECISION` (6) places, half up; then `round()` with the given precision and mode. Every WooCommerce rounding below goes through it, so each is two roundings | [NumberUtil.php L23-L56](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Utilities/NumberUtil.php#L23-L56) |
| `wc_round_tax_total( $value, $precision = null )` | `NumberUtil::round()` to price decimals (or the precision given) with `wc_get_tax_rounding_mode()`, then the filter `wc_round_tax_total` | [wc-formatting-functions.php L235-L240](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-formatting-functions.php#L235-L240) |
| `wc_add_number_precision( $value, $round = true )` | Multiplies by 10 to the price decimals ("cents"), then rounds to `wc_get_rounding_precision()` minus price decimals places (with `$round`) or to `wc_get_rounding_precision()` places (without) | [wc-core-functions.php L1910-L1920](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-core-functions.php#L1910-L1920) |
| `wc_remove_number_precision( $value )` | Divides by 10 to the price decimals, no rounding | [wc-core-functions.php L1929-L1936](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-core-functions.php#L1929-L1936) |
| `wc_format_decimal( $number, $dp = false, $trim_zeros = false )` | With `$dp` given: `number_format()` to that many places (half up). With `$dp = false` and a float: `sprintf` with `wc_get_rounding_precision()` places, trailing zeros trimmed. With `$dp = false` and a string: no rounding at all | [wc-formatting-functions.php L289-L322](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-formatting-functions.php#L289-L322) |
| `wc_price( $price )` | `number_format()` to price decimals (half up) for display | [wc-formatting-functions.php L596-L640](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-formatting-functions.php#L596-L640) |
| `WC_Tax::round( $in )` | `NumberUtil::round()` to `wc_get_rounding_precision()` places, then the filter `woocommerce_tax_round`; applied to every tax amount `calc_inclusive_tax()` and `calc_exclusive_tax()` return | [class-wc-tax.php L117-L119, L169, L227](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-tax.php#L117-L119) |
| `round_item_subtotal( $value )` | Per-line setting: `NumberUtil::round( $value )` to a whole number (the value is in cents), half up. Subtotal setting: unchanged | [trait-wc-item-totals.php L59-L64](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/traits/trait-wc-item-totals.php#L59-L64) |
| `round_line_tax( $value, $in_cents = true )` | Per-line setting: `wc_round_tax_total()` to 0 places (cents) or to price decimals (`$in_cents = false`), in the tax rounding mode. Subtotal setting: unchanged | [trait-wc-item-totals.php L84-L89](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/traits/trait-wc-item-totals.php#L84-L89) |
| `get_rounded_items_total( $values )` | Sum of `round_item_subtotal()` of each value | [trait-wc-item-totals.php L43-L50](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/traits/trait-wc-item-totals.php#L43-L50) |
| `wc_round_discount( $value, $precision )` | `NumberUtil::round()` with `WC_DISCOUNT_ROUNDING_MODE` (half down) | [wc-core-functions.php L2469-L2471](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-core-functions.php#L2469-L2471) |

The trait `WC_Item_Totals` is shared by `WC_Cart_Totals` and the order classes; its file comment says the plan is to move
more shared calculation logic there over time
([trait-wc-item-totals.php L15-L22](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/traits/trait-wc-item-totals.php#L15-L22)).
Only these helpers are shared in 11.1.2; the rest of the arithmetic is written twice, once in the cart and once in the
order ([cart-totals.md](cart-totals.md), [order-recalculation.md](order-recalculation.md)).

## Rounding outside PHP

| Where | Rule | Source |
| --- | --- | --- |
| Admin refund form (JavaScript) | `accounting.toFixed()` multiplies by 10 to the precision, `Math.round()`s and divides; `Math.round()` sends a half towards positive infinity, which for positive amounts is half up | [accounting.js L216-L222](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/client/legacy/js/accounting/accounting.js#L216-L222); [MDN Math.round()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/round) |
| Store API money values | Value times 10 to the price decimals, `round()` to a whole number, half up by default, returned as a string of minor units | [MoneyFormatter.php L17-L52](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Formatters/MoneyFormatter.php#L17-L52); [AbstractSchema.php L396-L404](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Schemas/V1/AbstractSchema.php#L396-L404) |

## The three rounding modes in one order

With prices entered with tax, one order passes through three rules: tax amounts to cents in half down
(`wc_round_tax_total()`), line nets and grand totals in half up (`NumberUtil::round()`, `number_format()`), and the refund
form in `Math.round()`. A tax of exactly x.xx5 therefore rounds down in the stored order and up in the refund form. With
prices entered without tax all three round a half up, so the half-way cases that remain come from rounding at different
points (per line, per rate, at the total), not from the mode.
