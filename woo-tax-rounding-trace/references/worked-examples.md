# Worked examples (synthetic orders)

Four synthetic orders, not from any store. Each input is in `scripts/examples/<name>.json` and the helper's full output
is in `scripts/examples/<name>.expected.txt`; every number below comes from that output. Rerun one with:

```sh
node scripts/tax-trace.mjs scripts/examples/inclusive-coupon-refund.json
```

"Cents" means minor units (price decimals 2). Rounding modes: half up and half down as in PHP, "JS" as `Math.round()`
([rounding-functions.md](rounding-functions.md)). Every order below was placed through classic checkout.

## 1. Prices entered with tax, a percent coupon, and the refund form

`inclusive-coupon-refund`: 20% rate, prices entered with tax, per-line rounding, 10 units at 11.90 with a 25% coupon.

Cart, per line (store setting), in cents:

| Step | Arithmetic | Result |
| --- | --- | --- |
| Line price | 119.00 x 100 | 11900 |
| Coupon | 25% of 11900 | 2975, leaving 8925 |
| Tax in 8925 at 20% | 8925 x 20 / 120 | 1487.5 |
| Line tax | 1487.5 to a whole cent, half down (prices entered with tax) | 1487 |
| Net | 8925 - 1487.5 (unrounded tax) | 7437.5 |
| Items total | 7437.5 to a whole cent, half up | 7438 |
| Total | 7438 + 1487 | 8925, so 89.25 |

Checkout stores `_line_total` 74.375, `_line_tax_data` total 14.875, `_line_tax` 14.87, order `total` 89.25 and
`total_tax` 14.87. The REST API shows the line as 74.38 (half up) plus 14.87, which adds up to 89.25.

The refund form, full quantity: line total 74.375 becomes 74.38 and tax 14.875 becomes 14.88 (JS, half up), so the
amount is 89.26. The remaining refundable total is 89.25, and `refund_line_items()` refuses 89.26 with "Invalid refund
amount". Helper verdict: first divergence at stage 10 (refund form); stages 0 to 6 all match under the store setting.

The same cart rounded at subtotal (the helper's "other setting") keeps the total at 89.25, but the cart shows total tax
14.87 (`wc_round_tax_total()`, half down) while checkout would store `total_tax` 14.88 (`NumberUtil::round()`, half up):
a cart and order that disagree on the tax row, not on the total. Its refund form adds 74.375 + 14.875 = 89.25 before
rounding, so a full refund goes through.

Change that aligns them for one refund: type 89.25 as the amount and 14.87 in the tax field (the stored rounded tax),
then check the refund record. Pattern reported upstream: issue #64668 ([evidence.md](evidence.md)).

## 2. Prices without tax, rounding at subtotal, taxed shipping

`exclusive-subtotal-shipping`: 12% rate on a product at 27.38 and on shipping at 5.63, prices entered without tax,
rounding at subtotal, itemized tax display excluding tax.

| Step | Arithmetic | Result |
| --- | --- | --- |
| Product tax | 2738 x 12% | 328.56 cents, kept unrounded |
| Shipping tax | 5.63 x 12% | 0.6756, 67.56 cents, kept unrounded |
| Cart total | 2738 + 563 + 328.56 + 67.56 = 3697.12, to a whole cent | 3697, so 36.97 |
| Cart total tax | 3.2856 + shipping tax rounded alone (0.68) = 3.9656, then half up to 2 places | 3.97 |
| Cart tax row | (3.9612 - 0.6756) = 3.2856 to 3.29, plus 0.68 | 3.97 |

The checkout page shows 27.38 + 5.63 + tax 3.97 = 36.98 against a total of 36.97. The stored order has `cart_tax`
3.2856, `shipping_tax` 0.6756, `total_tax` round(3.9612) = 3.96 and `total` 36.97; the order emails (tax row 3.96) add
up. The REST API shows `tax_lines` 3.29 + 0.68 = 3.97 against `total_tax` 3.96, and the line amounts add up to 36.98
against `total` 36.97: the shape of issue #25720.

Helper verdict: first divergence at stage 0 (cart page total tax 3.97 against the stored 3.96), then stage 8 (REST
sums). Rounding per line (the other setting) gives 36.98 and 3.97 everywhere: 329 + 68 cents of tax.

Changes that align them: per line rounding (a setting change that also moves some totals by a cent; owner decision), or
making the reading system use the order-level `total` and `total_tax` rather than summing lines.

## 3. A compound rate, and a rounding setting changed after the order

`compound-setting-changed`: 5% rate plus an 8% compound rate, prices without tax, 3 units for 14.97 and one at 7.45.
The order was placed while the store rounded per line; the store now rounds at subtotal (the setting in the input).

| Line | Rate 5% | Compound 8% on price plus the 5% |
| --- | --- | --- |
| 14.97 | 74.85 cents | (1497 + 74.85) x 8% = 125.748 cents |
| 7.45 | 37.25 cents | (745 + 37.25) x 8% = 62.58 cents |

Per line (when the order was placed): 74.85 to 75, 125.748 to 126, 37.25 to 37, 62.58 to 63, all half up; tax 301,
total 2242 + 301 = 2543, stored `total` 25.43, tax lines 1.12 and 1.89. At subtotal (now): 112.1 + 188.328 = 300.428
cents of tax, total 2542.428 to 2542, so 25.42.

Helper verdict: under the store setting 9 of 22 checkout values differ; under the other setting none do. So the order
was placed under the other setting. "Recalculate" today would store 25.42, the gateway captured 2543 minor units, and a
full refund from the refund form today adds up to 25.42.

Change: none to the store. Leave the paid order's stored totals as they are; if the order must be edited, expect the
recalculation to move it by this cent and settle it against the captured amount.

## 4. Prices entered with tax, shipping tax on a half cent

`inclusive-shipping-half-cent`: 12.5% rate on a product at 45.00 entered with tax and on shipping at 2.20 (shipping costs
are entered without tax), per-line rounding.

| Step | Arithmetic | Result |
| --- | --- | --- |
| Product tax | 4500 x 12.5 / 112.5 | 500 cents, net 4000 |
| Shipping tax | 2.20 x 12.5% | 0.275, 27.5 cents |
| Cart: shipping tax per line | `round_item_subtotal()`, half up | 28 cents |
| Cart total | 4000 + 220 + 500 + 28 | 4748, so 47.48 |
| Shipping line `total_tax` at checkout | `set_taxes()`: `wc_round_tax_total( 0.275 )`, half down | 0.27 |
| Order `shipping_tax` and tax line | copied from the cart | 0.28 |

The stored order disagrees with itself: the shipping line says 0.27, the order and its tax line 0.28. The REST API line
amounts add up to 45.00 + 2.20 + 0.27 = 47.47 against `total` 47.48. "Recalculate" rounds the shipping tax with
`wc_round_tax_total()` and would store 47.47; the gateway captured 4748. Placed through block checkout, the same cart
would have been stored at 47.47 (the helper's "block checkout stores" line) after the checkout page showed 47.48.

Helper verdict: first divergence at stage 5 (stored shipping tax 0.28 against the shipping line's 0.27), then stage 7
(recalculation 47.47) and stage 8 (REST line sum 47.47). With rounding at subtotal the shipping tax stays 0.275, the order
stores `shipping_tax` 0.275 and every path gives 47.48.

Change: do not recalculate paid orders on a live store; report the rounding-mode mismatch between
`round_item_subtotal()` and `wc_round_tax_total()` for shipping upstream with the helper output; a switch to rounding at
subtotal is a store-wide decision for the owner, tested on staging first ([changes-and-rollback.md](changes-and-rollback.md)).
