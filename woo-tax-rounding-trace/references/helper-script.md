# The helper scripts

Read this for steps 1 to 4 of the procedure. All three scripts are read-only: they change no settings, orders or tables
and make no network requests of their own.

| Script | Runs where | What it does |
| --- | --- | --- |
| `scripts/export-order.sh` | Where WP-CLI reaches the site (staging or production) | Prints the tax options with `wp option get` and, with `WOO_TAX_TRACE_USER` set, the order's totals from `wp wc shop_order get`, both on standard error; runs `export-order.php` and prints its JSON on standard output |
| `scripts/export-order.php` | `wp eval-file export-order.php <order id>` | Prints one order as the JSON input below: settings after filters, rates from the order's tax lines, stored line and order values, refunds, and the non-WooCommerce callbacks on the hooks that change tax arithmetic. No names, addresses, emails, notes or product names |
| `scripts/tax-trace.mjs` | Any machine with Node.js 20 or later | Reads that JSON and prints the step-by-step rebuild and the comparison. `--json` prints the same data as JSON |

`wp eval-file` passes the arguments after the file name to it as `$args`
([eval-file](https://developer.wordpress.org/cli/commands/eval-file/)). `export-order.sh` loads WordPress with WP-Cron
spawning switched off and without WP-CLI's update check, the same guard the `woo-checkout-performance-audit` skill uses.

## Input format

The values below show the format; they are taken from different examples and do not form one consistent order.

```json
{
  "currency": "GBP",
  "settings": {
    "woocommerce_prices_include_tax": "yes",
    "woocommerce_tax_round_at_subtotal": "no",
    "woocommerce_price_num_decimals": 2,
    "woocommerce_tax_display_cart": "incl",
    "woocommerce_tax_total_display": "itemized",
    "checkout": "classic"
  },
  "rates": { "1": { "rate": "20.0000", "compound": "no", "priority": 1 }, "5": { "rate": "12.5000", "compound": "no", "priority": 1 } },
  "items": [
    {
      "id": 101, "qty": 10, "tax_rate_ids": [1],
      "entered_line_price": "119.00", "entered_line_discount": "29.75",
      "stored": { "subtotal": "99.166667", "subtotal_tax": "19.83", "total": "74.375", "total_tax": "14.87",
                  "taxes": { "total": { "1": "14.875" }, "subtotal": { "1": "19.833333" } } }
    }
  ],
  "shipping": [ { "id": 402, "cost": "2.20", "tax_rate_ids": [5], "stored": { "total": "2.20", "total_tax": "0.27", "taxes": { "total": { "5": "0.275" } } } } ],
  "fees": [ { "id": 501, "amount": "1.50", "taxable": true, "stored": { "total": "1.50", "total_tax": "0.30", "taxes": { "total": { "1": "0.3" } } } } ],
  "order": { "stored": { "total": "89.25", "cart_tax": "14.87", "shipping_tax": "0", "total_tax": "14.87",
                         "discount_total": "24.791667", "discount_tax": "4.958333", "shipping_total": "0", "total_refunded": "0" } },
  "tax_lines": [ { "rate_id": 1, "tax_amount": "14.87", "shipping_tax_amount": "0" } ],
  "observed": { "gateway_amount_minor": 8925 }
}
```

| Field | Meaning | Default when missing |
| --- | --- | --- |
| `settings.woocommerce_prices_include_tax` | The order's own value (`export-order.php` takes it from the order) | `no` |
| `settings.woocommerce_tax_round_at_subtotal` | The setting to test as "store setting"; the other one runs too | `no` |
| `settings.woocommerce_price_num_decimals` | Price decimals after filters | 2 |
| `settings.rounding_precision` | `wc_get_rounding_precision()` | decimals + 2, at least 6 |
| `settings.tax_rounding_mode` | `HALF_UP` or `HALF_DOWN` (from `wc_get_tax_rounding_mode()`) | half down with prices entered with tax, else half up |
| `settings.checkout` or `settings.created_via` | `classic` (`checkout`), `block` (`store-api`), `other` (admin, REST): which path made the stored figures | `classic` |
| `rates.<id>` | `rate` in percent, `compound`, `priority` (rates sort by priority, then ID) | a missing `rate` is an error |
| `items[].tax_rate_ids`, `shipping[].tax_rate_ids`, `fees[].tax_rate_ids` | Rates on the line | the keys of the line's stored `taxes` |
| `items[].entered_line_price` | Price x quantity as entered (gross with prices entered with tax) | stored subtotal (plus subtotal taxes when prices include tax), rounded to decimals + 2 |
| `items[].entered_line_discount` | The line's share of all coupons, same basis as the price | entered price minus the stored total (plus its taxes when prices include tax) |
| `items[].refund_qty` | Quantity to put in the refund form | the full quantity |
| `shipping[].cost` | The rate's cost before WooCommerce rounded it, when known | the stored cost |
| `observed` | Values seen elsewhere: `cart_total`, `cart_total_tax`, `store_api_total_price_minor`, `rest_total`, `rest_total_tax`, `email_total`, `gateway_amount_minor`, `refund_amount` | none |

Amounts can be JSON strings or numbers; strings keep every digit. `export-order.php` output has extra fields (refunds,
coupons, hooks, the current rate beside the recorded one); the helper ignores what it does not use.

## What it prints

1. The settings it used, including the tax rounding mode and the checkout path.
2. For each rounding setting (the store's first): the cart replay line by line in cents, the cart total and tax rows,
   the Store API values in minor units, what classic checkout stores, what block checkout stores, and what
   `calculate_totals()` gives on the stored lines.
3. Views of the stored order: the REST API (and whether its lines add up), the email rows, the refund form, the gateway
   amount in minor units and the PayPal Standard line-item check.
4. The comparison, stage by stage, with `ok` or the difference, then how many checkout values differ under each rounding
   setting and the first divergence.
5. Every exact half-way value met, with the step, the mode and the result.

| Stage | Compares | A difference means |
| --- | --- | --- |
| 0 cart page | Stored total and total tax against the cart replay | The shopper saw another figure at checkout ([cart-totals.md](cart-totals.md)) |
| 1, 2 line tax | Each rate's unrounded tax, then the rounded line tax | Different rates, location, entered price, or a filter on the tax calculation |
| 3 line net | `_line_total`, `_line_subtotal` | Different price, coupon spread, or price adjustment for the location |
| 4 tax lines | `tax_amount`, `shipping_tax_amount` per rate | Rounding of item, fee or shipping tax per rate |
| 5 stored sums | Order `cart_tax` and `shipping_tax` against the lines' own stored taxes | The order disagrees with itself ([order-storage.md](order-storage.md)) |
| 5, 6 order totals | Stored order totals against the checkout path | Setting changed since, a plugin changed totals, or the order was edited |
| 7 recalculation | Stored figures against `calculate_totals()` today | "Recalculate" would change the order ([order-recalculation.md](order-recalculation.md)) |
| 8 REST API | Order totals against the sums of its rounded lines | A reading system that adds lines will be off ([rest-emails-display.md](rest-emails-display.md)) |
| 9 emails | Total row against the other rows | The customer sees rows that do not add up |
| 10 refund form | Full refund against the remaining total (only when the order has no shipping or fee lines) | Refund blocked or short ([refunds.md](refunds.md)) |
| 11 observed | Values from `observed` against the computed view | That system converts or rounds on its own ([gateways-and-currency.md](gateways-and-currency.md)) |

When the other rounding setting reproduces the stored checkout values and the store setting does not, the setting
changed after the order (example 3 in [worked-examples.md](worked-examples.md)).

## Arithmetic

The helper uses exact rational numbers on JavaScript `BigInt`, not floating point, and rounds only where WooCommerce
rounds, with the mode WooCommerce uses there, including the `normalize()` pass inside every `NumberUtil::round()`
([rounding-functions.md](rounding-functions.md)). PHP computes in floating point, so where the exact value is a half, PHP
can land on either side of it; those are the values listed under "Half-way values". Confirm any that decide the result
on a staging copy, by placing the same cart there.

## Limits

- Coupons are not re-spread: each line's discount comes from the input or the stored values.
- Negative fees (spread over tax classes) are refused with an error.
- Tax-inclusive price adjustments for customers outside the base location and VAT exemption are not recomputed; the
  derived entered price already carries their effect when it comes from the stored lines.
- Filters that change tax arithmetic are not modelled. `export-order.php` lists them under `hooks`; with any callback
  there, treat the helper's result as what WooCommerce alone would do.
- The refund form model fills product lines only; shipping and fee refunds are typed by hand in WooCommerce too.
- The gateway line assumes a two-decimal conversion (`round( total x 100 )`); apply other gateways' rules by hand.

## Checking the scripts

```sh
node --check scripts/tax-trace.mjs
bash -n scripts/export-order.sh
php -l scripts/export-order.php
for f in scripts/examples/*.json; do node scripts/tax-trace.mjs "$f" | diff - "${f%.json}.expected.txt"; done
```

A change to `tax-trace.mjs` that alters an example's output on purpose regenerates that `.expected.txt` file in the same
commit, and [worked-examples.md](worked-examples.md) is checked against it.
