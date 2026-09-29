# Reported problems with held stock

The reports below show where stores lose sales or oversell around stock holds. Their states were read on 2026-09-29;
re-check them in each quarterly review, because a merged fix changes what the procedure should recommend.

| Report | State on 2026-09-29 | What it says | What it means here |
| --- | --- | --- | --- |
| [Issue 67354](https://github.com/woocommerce/woocommerce/issues/67354), "A shopper is blocked by their own stock reservation", opened 2026-08-03 against 11.0.0-rc.3 | Closed 2026-09-22. Part fixed by [PR 67471](https://github.com/woocommerce/woocommerce/pull/67471) (merged to trunk 2026-08-14, milestone 11.2.0). A wider fix, PR 67751, was merged and then reverted by [PR 67931](https://github.com/woocommerce/woocommerce/pull/67931) on 2026-08-21 | A shopper who leaves a redirecting payment and comes back gets "not enough in stock (0 available)" for a product only they hold, for the whole hold time. Two causes: the `isset()` check on `order_awaiting_payment`, and holds of an earlier unpaid order of the same session | Report the shopper's own older unpaid orders as holds, and recommend cancelling them through WooCommerce, or a shorter hold time, as an owner decision. [availability.md](availability.md) |
| [PR 68963](https://github.com/woocommerce/woocommerce/pull/68963), "Add opt-in exclusion for shoppers' stale stock holds" | Open, not merged; created 2026-09-22 | Adds a filter, off by default, that stops counting a shopper's own stale holds; the description accepts a risk of overselling for stores that turn it on | Not in 11.1.2. If a later release ships it, the store's filter setting becomes part of step 0 |
| [Issue 65313](https://github.com/woocommerce/woocommerce/issues/65313), "Stock reservation blocks draft order addition and status transitions" | Closed 2026-06-02 by [PR 65325](https://github.com/woocommerce/woocommerce/pull/65325), shipped in 11.0.0 | The reservation statement's `FOR UPDATE` lock spread through the join to the orders table, so creating draft orders and changing order statuses waited behind reservations of the same product, on HPOS and posts storage | On stores older than 11.0.0, lock waits at busy moments are expected; the timing side belongs to the `woo-checkout-performance-audit` skill |
| [PR 67446](https://github.com/woocommerce/woocommerce/pull/67446), "Store API: keep a fully reserved stock level as a quantity limit" | Open, not merged; created 2026-08-06 | `array_filter()` in `QuantityLimits` drops a remaining stock of 0, so the Store API reports a product as purchasable while add-to-cart rejects it | Explains a block-theme product that offers "add to cart" and then refuses it while every unit is held. [availability.md](availability.md) |
| [Support thread "Stock Hold Issues Make Woocommerce unusable"](https://wordpress.org/support/topic/stock-hold-issues-make-woocommerce-unusable/), 2024 | Marked resolved on the forum | A store with a short hold time saw products unavailable to other shoppers and pending orders that were never cancelled; the store later found failing loopback and REST requests in Site Health | Two of this skill's checks: holds that count against other shoppers, and a cancel event that does not run. [orders-and-cancellation.md](orders-and-cancellation.md) |

The states and dates come from the GitHub pages linked above (issue and pull request pages, their timelines and
merge dates).

## What the public skill collections cover

When this skill was written (2026-09-29), the only other material found in public Agent Skills collections was one
paragraph in the `wc-order-lifecycle-and-items` skill of
[Lonsdale201/wp-agent-skills](https://github.com/Lonsdale201/wp-agent-skills), next to a short list of the reduce and
restore hooks. The paragraph tells extension developers to prefer `wc_reserve_stock_for_order()` over calling
`ReserveStock` directly. It does not cover the reservation table, expiry, the cancel event, reconciliation or storage
modes.
