# Evidence that one-cent gaps happen, and related work

Read this to explain to an owner why a cent can move between the cart, the order, the API, a refund and the gateway,
and to point them at the public reports. States and dates were checked on 2026-09-29.

## Public reports

| Report | What it shows | State |
| --- | --- | --- |
| [woocommerce#58938](https://github.com/woocommerce/woocommerce/issues/58938), "Store API Cart Totals Incorrect Due to Tax Rounding" | WooCommerce 9.9.4, INR with 2 decimals, per-line rounding, a product at 480 whose line subtotal and subtotal tax add up to 48000 minor units (so the price includes tax), two 9% tax lines and a discount of 5000 minor units including tax: the Store API cart returns `total_price` 43001 where 43000 was expected | Open, opened 2025-06-17 |
| [woocommerce#64668](https://github.com/woocommerce/woocommerce/issues/64668), "Refund amount can exceed original order total due to per-line tax rounding accumulation" | Prices with 20% tax, 23.90 x 10 with a 25% coupon: order total 179.25, full refund calculated as 179.26, which the gateway refused | Open, opened 2026-05-06; pull request [#65732](https://github.com/woocommerce/woocommerce/pull/65732) open |
| [woocommerce#25720](https://github.com/woocommerce/woocommerce/issues/25720), "Order tax totals don't match with REST API order totals when Round tax at subtotal level option is set" | WooCommerce 3.9.2, prices without tax, rounding at subtotal, 12% on a 35.71 product and 3.13 shipping: the site shows 4.66 of tax, the REST API 4.67 | Closed as completed |
| [WordPress.org support: "Order Total Calculation off by 1 penny"](https://wordpress.org/support/topic/order-total-calculation-off-by-1-penny/) | Rounding at subtotal, 2 decimals: items 49.98, fees 35.00, shipping 8.35 and tax 5.12 add up to 98.45, the order total says 98.46; several plugins (donations, shipping, invoicing, payments) were active | Marked resolved after the owner recreated the order and got the right total; no cause found |

WooCommerce's own documentation says the same in general terms: per-line rounding rounds each line's tax before adding,
subtotal rounding rounds once, and totals off by 0.01 can occur with tax-inclusive prices and multiple quantities
([troubleshooting core taxes](https://woocommerce.com/document/troubleshooting-core-taxes/)); mixed entry and display
settings can cause off-by-one rounding ([setting up taxes](https://woocommerce.com/document/setting-up-taxes-in-woocommerce/)).

## The helper against a public report

Run on the inputs read from #58938 (480 entered with tax, two 9% rates at different priorities since WooCommerce applies
one rate per priority, a line discount of 50 including tax, per-line rounding, 2 decimals), `scripts/tax-trace.mjs` gives Store API values `total_items` 40678,
`total_price` 43001 and `total_tax` 6560, the figures in that report's API response. That is a check of the cart replay
against WooCommerce's own output, not a claim about that store: the report was made on 9.9.4, and the helper models
11.1.2. The mechanism in the helper's output: the line's net (364.40678) and each rate's tax (32.79661) are rounded
separately (364.41, 32.80, 32.80), and 364.41 + 65.60 = 430.01.

The pattern in #64668 is example 1 in [worked-examples.md](worked-examples.md) (with different, synthetic numbers), the
pattern in #25720 is example 2, and the support thread fits the example 2 mechanism too (rows rounded on their own, total
rounded once from unrounded parts), though the thread does not give enough to confirm it.

## Related skills and how this one differs

- WooCommerce publishes an agent plugin repository on GitHub, under [github.com/woocommerce](https://github.com/woocommerce),
  whose skills include `tax-reconciliation` (read at commit 9c3cab5, dated 2026-08-24; skills.sh lists it as
  `tax-reconciliation` from that repository).
  It produces a store-wide readout for a period from Analytics: collected tax on paid orders, shipping tax, refunded tax,
  on-hold tax, per-rate rows, and checks that those figures add up, using aggregated data and no customer details. It
  does not rebuild one order's arithmetic. This skill starts where a reconciliation finds a one-cent gap: one order, the
  step where the cent appears, and the change that would remove it. The different name keeps the two apart.
- [navarroido/Woocommerce-skill](https://github.com/navarroido/Woocommerce-skill) has `woo-tax-liability-summary`
  (sums `tax_lines` across completed orders through the REST API) and `woo-tax-rate-audit` (lists rates by class and
  country, flags gaps and duplicates). Neither recalculates an order.
- On 2026-09-29 the skills.sh search for "woocommerce tax" listed `tax-reconciliation` as its only result about WooCommerce
  tax, and the SkillsMP search for "woocommerce tax rounding" returned no results.
