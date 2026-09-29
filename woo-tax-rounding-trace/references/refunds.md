# Refunds: the form, the refund record and the gateway

Read this when a refund amount is a cent above or below what the owner expects, when WooCommerce or the gateway refuses
a full refund, or when refunded tax does not match the order's tax (helper stage 10). Code links point at the
WooCommerce 11.1.2 tag.

## The admin refund form (JavaScript)

- Each order line's edit fields carry the stored, unrounded values: `data-total` is the line total and `data-total_tax`
  each rate's amount from the line's tax data
  ([html-order-item.php L159, L169-L175, L202, L207](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/meta-boxes/views/html-order-item.php#L159-L207)).
- Typing a refund quantity fills the line's refund total with `data-total / quantity x refund quantity` and each rate's
  refund tax with `data-total_tax / quantity x refund quantity`, both rounded to `rounding_precision` (6 places with 2
  price decimals) ([meta-boxes-order.js L1117-L1158](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/client/legacy/js/admin/meta-boxes-order.js#L1117-L1158)).
  Shipping and fee rows have no quantity; their refund fields are typed by hand.
- The refund amount is the sum of every refund field: with the per-line setting each field is first rounded to price
  decimals; with rounding at subtotal only the sum is rounded
  ([L1077-L1101](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/client/legacy/js/admin/meta-boxes-order.js#L1077-L1101)).
  Rounding is `accounting.toFixed()`, which is `Math.round()`: half up for positive amounts
  ([rounding-functions.md](rounding-functions.md#rounding-outside-php)).
- The page passes the setting, the price decimals and the rounding precision to the script
  ([class-wc-admin-assets.php L674, L692, L697](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/class-wc-admin-assets.php#L674-L697)).

So with prices entered with tax and per-line rounding, a line whose tax is exactly x.xx5 was stored with the tax rounded
down (half down) and its net rounded up (half up), while the refund form rounds both up: a full refund comes out one cent
above the order total (example 1 in [worked-examples.md](worked-examples.md): order 89.25, form 89.26).

## The server side

| Step | What happens | Source |
| --- | --- | --- |
| `WC_AJAX::refund_line_items()` | Formats the amount to price decimals; refuses it with "Invalid refund amount" when it is above the order total minus what was already refunded, or negative; also refuses when the already-refunded amount in the form is stale | [class-wc-ajax.php L2410-L2441](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-ajax.php#L2410-L2441) |
| Line data | Quantities, line totals and per-rate taxes from the form, each through `wc_format_decimal()` | [L2443-L2463](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-ajax.php#L2443-L2463) |
| `wc_create_refund()` | Checks the amount against the remaining refundable total again; adds one negative line per refunded line, with the refund tax as both total and subtotal tax | [wc-order-functions.php L559-L655](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-functions.php#L559-L655) |
| Refund taxes and total | `update_taxes()` on the refund (per-line setting: each negative line tax rounded on its own in the tax rounding mode), `calculate_totals( false )`, then the refund total is set to minus the amount typed, whatever the lines add up to | [L657-L659](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-functions.php#L657-L659) |
| Gateway | With "Refund via gateway", `wc_refund_payment()` calls the gateway's `process_refund( order ID, amount, reason )` with the refund amount; on failure the refund record is deleted | [L674-L684, L772-L806](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-functions.php#L772-L806) |

Reports of refunded tax per line round the sum of a line's refunded taxes with `wc_round_tax_total()`
([class-wc-order.php L2454-L2467](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-order.php#L2454-L2467));
the remaining refundable amount is the order total minus refunds, to price decimals
([L2493-L2495](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-order.php#L2493-L2495)).

## What goes wrong, and how it shows

| Symptom | Cause in the arithmetic | Check |
| --- | --- | --- |
| Full refund refused, or the form total is a cent above the order total | Form rounds each field half up; the stored order rounded tax half down or rounded at a different point | Helper stage 10; the half-way values list |
| Refund accepted, but refunded tax differs from the amount's tax share by a cent | The refund total is the amount typed; the refund's tax lines are rounded per line on their own | Compare the refund's `total_tax` in the export with the tax fields typed |
| Partial refunds of one line add up to a cent more or less than the line | Each partial refund is `unit x quantity` rounded on its own | Add up the refund lines for that `refunded_item_id` in the export |
| Gateway refunds a different amount from the refund record | The gateway converts the amount to its own units; see [gateways-and-currency.md](gateways-and-currency.md) | The gateway's dashboard against the refund's `amount` |

Issue [#64668](https://github.com/woocommerce/woocommerce/issues/64668) (opened 2026-05-06, open on 2026-09-29) reports
the first row: prices with 20% tax, a product at 23.90, a 25% coupon, 10 items, an order total of 179.25 and a full
refund calculated at 179.26, which the gateway then refused. Pull request
[#65732](https://github.com/woocommerce/woocommerce/pull/65732), open on 2026-09-29, proposes that `refund_line_items()`
cap an amount that exceeds the remaining total by up to 0.05. Neither is part of 11.1.2.

## Working around it for one refund (owner's action)

Enter the refund amount as the remaining total (or the intended partial amount) and correct one tax field by the cent so
the fields add up to it, then check the refund record's `amount`, `total_tax` and the gateway's refunded amount. This
changes nothing in the store's code or settings. [changes-and-rollback.md](changes-and-rollback.md) lists it with its
check.
