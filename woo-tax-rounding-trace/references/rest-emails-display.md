# What the REST API, the emails and the order pages show

Read this when the stored order is right but a system reading it (an ERP, an accounting sync, an invoice plugin) or a
customer email shows a different figure (helper stages 8 and 9). Code links point at the WooCommerce 11.1.2 tag.

## REST API (wc/v2 and wc/v3 orders)

- Every amount is passed through `wc_format_decimal( $value, dp )`, where `dp` is a request parameter that defaults to
  the store's price decimals ([v2 controller L2171-L2177](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-orders-v2-controller.php#L2171-L2177);
  [L563-L565](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-orders-v2-controller.php#L563-L565)).
  With a `dp` value that is `number_format()`, half up ([rounding-functions.md](rounding-functions.md)).
- Order level: `discount_total`, `discount_tax`, `shipping_total`, `shipping_tax`, `cart_tax`, `total`, `total_tax`
  ([L374-L456](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-orders-v2-controller.php#L374-L456)).
- Line level: `subtotal`, `subtotal_tax`, `total`, `total_tax`, `tax_total`, `shipping_tax_total`, `discount`,
  `discount_tax`, and each rate in `taxes[]` (`total`, `subtotal`), each rounded on its own; product lines also get
  `price`, which is the line total divided by the quantity with no rounding
  ([L217-L265](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-orders-v2-controller.php#L217-L265)).
- The wc/v3 orders controller extends the v2 one and keeps this formatting
  ([class-wc-rest-orders-controller.php L27](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version3/class-wc-rest-orders-controller.php#L27)).
  WC-CLI's `wp wc` commands are built from the v2 routes, and the orders command is `wp wc shop_order`
  ([class-wc-cli-runner.php L51, L72, L122](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/cli/class-wc-cli-runner.php#L51-L122);
  the schema title is the post type, [v2 controller L1214](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-orders-v2-controller.php#L1214)).
  It needs `--user` with an account allowed to read orders
  ([class-wc-cli-rest-command.php L354-L358](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/cli/class-wc-cli-rest-command.php#L354-L358)).

What this means for a trace:

- A system that adds up line `total` and `total_tax` values, or `tax_lines` `tax_total` and `shipping_tax_total`, adds
  numbers that were each rounded on their own. With unrounded stored lines (rounding at subtotal, or any half-way tax)
  that sum can miss the order `total` or `total_tax` by a cent (examples 2 and 4 in
  [worked-examples.md](worked-examples.md)). Issue [#25720](https://github.com/woocommerce/woocommerce/issues/25720)
  (WooCommerce 3.9.2, closed) reported the same shape: rounding at subtotal, a 12% rate on a product and on shipping, the
  site showing 4.66 of tax and the REST API 4.67.
- To see the unrounded stored values, read the order with a larger `dp` in the REST request (for example `?dp=6`), or use
  `scripts/export-order.php`, which reads the stored strings.
- The fix for a reading system is to take the order-level `total` and `total_tax` (or `cart_tax` and `shipping_tax`) as
  the source of truth and to treat line amounts as a breakdown that may not add up to the cent.

## Order emails, the order-received page and My account

All of them build their totals with `get_order_item_totals()` and `woocommerce_tax_display_cart`
([abstract-wc-order.php L2844-L2856](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L2844-L2856)):

| Row | Excluding tax (`excl`) | Including tax (`incl`) | Source |
| --- | --- | --- | --- |
| Line amount | Line subtotal rounded to price decimals | Line subtotal plus line subtotal tax, rounded | [L2481-L2495, L2578-L2598](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L2578-L2598) |
| Subtotal | Sum of `round_item_subtotal()` of line subtotals | The same plus `wc_round_tax_total()` of the lines' subtotal taxes | [L2615-L2656](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L2615-L2656) |
| Discount | `discount_total` | `discount_total + discount_tax` | [L755-L762, L2743-L2751](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L2743-L2751) |
| Shipping | `shipping_total` | `shipping_total + shipping_tax` | [L2664-L2697](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L2664-L2697) |
| Fees | Fee total | Fee total plus fee tax | [L2778-L2793](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L2778-L2793) |
| Tax | One row per rate code (tax line `tax_total + shipping_tax_total`) or one `total_tax` row | No tax rows | [L781-L806, L2802-L2821](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L2802-L2821) |
| Total | `total` | `total` | [L2830-L2836](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-order.php#L2830-L2836) |

Every value is printed with `wc_price()`, half up to price decimals. The total row always shows the stored `total`, so a
customer can see rows that add up to one cent more or less than the total; the helper's "Emails" line adds up the rows
for the store's display setting and compares them with the total.

## Cart, checkout and the Store API

The cart and checkout pages show the cart's own figures, before any order exists; see
[cart-totals.md](cart-totals.md#what-the-cart-and-checkout-page-show). The block cart and checkout read them from the
Store API in minor units.
