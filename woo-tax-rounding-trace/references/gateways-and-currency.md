# What the payment gateway receives, and currency decimals

Read this when the amount charged or refunded at the gateway differs from the order total (helper line "Gateway"), or
when the store's price decimals differ from the currency's. WooCommerce links point at the 11.1.2 tag.

## Where the amount comes from

- A gateway charges in its own `process_payment()` and refunds in `process_refund( order ID, amount, reason )`; the
  refund amount is the refund record's amount ([wc-order-functions.php L772-L806](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-functions.php#L772-L806)).
- The base class helper `get_order_total()` returns the order total on the order-pay page and the cart total otherwise
  ([abstract-wc-payment-gateway.php L320-L338](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/abstracts/abstract-wc-payment-gateway.php#L320-L338)).
  Gateways that send the order total send the stored `total`; with classic checkout that is the cart's total, with block
  checkout the recalculated one ([order-recalculation.md](order-recalculation.md#when-it-runs)).
- Each gateway plugin decides whether it sends one total or line items, and how it converts to its API's units. Read
  that gateway's code or documentation; the two below are examples, not a rule for others.

## Minor units

Card processors usually take whole minor units. Stripe's API expects `amount` in the currency's minor unit (1099 for
10.99 USD), zero-decimal currencies such as JPY without multiplication, and has special cases for ISK, HUF, TWD and UGX
([Stripe currencies](https://docs.stripe.com/currencies)).

WooCommerce Stripe Gateway 11.0.0 (the current release on WordPress.org on 2026-09-29) converts with `WC_Stripe_Helper::get_stripe_amount()`
([class-wc-stripe-helper.php L169-L186](https://github.com/woocommerce/woocommerce-gateway-stripe/blob/11.0.0/includes/class-wc-stripe-helper.php#L169-L186)):

| Currency group | Conversion |
| --- | --- |
| Zero-decimal (its list includes JPY, KRW, VND; [class-wc-stripe-currency-code.php L164-L180](https://github.com/woocommerce/woocommerce-gateway-stripe/blob/11.0.0/includes/constants/class-wc-stripe-currency-code.php#L164-L180)) | `absint( $total )` |
| Three-decimal (BHD, JOD, KWD, OMR, TND; [L187-L193](https://github.com/woocommerce/woocommerce-gateway-stripe/blob/11.0.0/includes/constants/class-wc-stripe-currency-code.php#L187-L193)) | total times 1000, formatted to price decimals, then the last digit rounded down |
| Others | `absint( round( wc_format_decimal( $total * 100, price decimals ) ) )` |

It sends `$order->get_total()` for payments and the refund amount for refunds
([abstract-wc-stripe-payment-gateway.php L498, L1308-L1310](https://github.com/woocommerce/woocommerce-gateway-stripe/blob/11.0.0/includes/abstracts/abstract-wc-stripe-payment-gateway.php#L1308-L1310)).
`absint()` is `abs( (int) $value )` ([WordPress 7.1.2 functions.php L1468-L1470](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/functions.php#L1468-L1470)),
and a float cast to int is rounded towards zero ([PHP integers](https://www.php.net/manual/en/language.types.integer.php)).
So a zero-decimal currency on a store set to 2 price decimals is charged the total with its decimals cut off: set the
store's price decimals to the currency's minor unit.

The helper script prints the order total and the refund amount in minor units rounded half up
(`round( total x 10 to the price decimals )`), which matches the two-decimal branch above for totals stored to price
decimals. Compare it with the amount in the gateway's dashboard; for other gateways, apply that gateway's conversion by
hand.

## PayPal Standard (bundled with WooCommerce)

`WC_Gateway_Paypal_Request` ([class-wc-gateway-paypal-request.php](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/gateways/paypal/includes/class-wc-gateway-paypal-request.php)):

- Sends the whole order as one line when taxes are on and prices are entered with tax, or when its line items do not add
  up to the order total ([L302-L322](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/gateways/paypal/includes/class-wc-gateway-paypal-request.php#L302-L322)).
- The check: each product line's per-unit subtotal (`get_item_subtotal()`, rounded to price decimals) formatted to 2
  places and multiplied by the quantity, plus fees, plus the order's total tax, plus the rounded shipping, minus the
  rounded discount, formatted to 2 places, must equal the order total formatted to 2 places
  ([L547-L567](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/gateways/paypal/includes/class-wc-gateway-paypal-request.php#L547-L567)).
- Itemised requests carry per-unit amounts, `tax_cart` and `discount_amount_cart`
  ([L433-L456, L574-L593](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/gateways/paypal/includes/class-wc-gateway-paypal-request.php#L433-L456)).
- Amounts use 2 decimals, or 0 for HUF, JPY and TWD ([L649-L689](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/gateways/paypal/includes/class-wc-gateway-paypal-request.php#L649-L689)).

The helper prints whether this check passes, as an example of a line-item submission meeting a rounded total.

## Price decimals and the currency

- `woocommerce_price_num_decimals` is a store setting, separate from the currency; the Store API reports
  `wc_get_price_decimals()` as `currency_minor_unit`
  ([CurrencyFormatter.php L45](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Formatters/CurrencyFormatter.php#L45)).
- The rounding precision is price decimals plus 2, at least 6 ([settings-and-constants.md](settings-and-constants.md)):
  with 0 decimals the cart's "cents" are whole units; with 3 decimals they are thousandths.
- A multi-currency plugin can filter `wc_get_price_decimals` per request; `export-order.php` prints the value after
  filters, and the order's `currency` field says which currency it was placed in.
