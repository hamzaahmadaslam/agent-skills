# What changed by release

Read the store's WooCommerce version first (the report prints it) and apply the rows at or below it. Dates and entries
come from the [changelog at the 11.1.2 tag](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt) and
the [releases page](https://github.com/woocommerce/woocommerce/releases); each row links the pull request or the code.

## WooCommerce

| Release | Change that matters for held and reduced stock | Source |
| --- | --- | --- |
| 4.3.0 (2020-07-08) | `wc_reserved_stock` table and reservation at checkout, to stop orders arriving at the same moment from overselling; needs schema version 430 | [PR 26395](https://github.com/woocommerce/woocommerce/pull/26395); [ReserveStock.php L30-L33](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php#L30-L33) |
| 4.5.0 | Filters `woocommerce_query_for_reserved_stock` and `woocommerce_order_item_quantity` in the reservation code | docblocks in [ReserveStock.php L128-L136, L296-L305](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php#L296-L305) |
| 5.1.0 | Filter `woocommerce_cancel_unpaid_orders_interval_minutes` | docblock in [wc-order-functions.php L1104-L1111](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-functions.php#L1104-L1111) |
| 8.5.0 (2024-01-09) | The classic cart check also counts Store API holds and excludes the session's Store API draft order | [PR 42796](https://github.com/woocommerce/woocommerce/pull/42796) |
| 8.8.0 (2024-04-10) | Filter `woocommerce_order_hold_stock_minutes` (return 0 to skip the hold for an order) | [PR 45246](https://github.com/woocommerce/woocommerce/pull/45246) |
| 9.2.0 (2024-08-20) | Block checkout and Store API hold stock only when the shopper places the order | [PR 49446](https://github.com/woocommerce/woocommerce/pull/49446) |
| 10.1.0 (2025-08-12) | WooCommerce cron jobs, unpaid order clean-up included, move to Action Scheduler | [PR 59325](https://github.com/woocommerce/woocommerce/pull/59325) |
| 10.1.2 (2025-08-27), 10.2.0 (2025-09-17) | `woocommerce_cancel_unpaid_orders` no longer queued as unique inside the function, so it recurs after each run | [PR 60626](https://github.com/woocommerce/woocommerce/pull/60626), [PR 60625](https://github.com/woocommerce/woocommerce/pull/60625) |
| 10.6.0 (2026-03-10) | Unpaid block checkout orders (`created_via` `store-api`) are auto-cancelled too | [PR 58262](https://github.com/woocommerce/woocommerce/pull/58262); [wc-order-functions.php L1143-L1151](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-functions.php#L1143-L1151) |
| 10.7.0 | Filter `woocommerce_delete_expired_draft_orders_batch_size` for the daily draft clean-up | docblock in [DraftOrders.php L181-L190](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Blocks/Domain/Services/DraftOrders.php#L181-L190) |
| 10.8.0 (2026-05-26) | Index `product_id_expires` on `wc_reserved_stock` | [PR 63864](https://github.com/woocommerce/woocommerce/pull/63864) |
| 10.9.0 (2026-06-23) | Reservation made more efficient and reliable; block checkout creates the draft order at place-order time instead of on page views | [PR 64475](https://github.com/woocommerce/woocommerce/pull/64475), [PR 64155](https://github.com/woocommerce/woocommerce/pull/64155) |
| 11.0.0 (2026-08-04) | Reservation SQL no longer blocks order status updates; the hold setting applies only to core checkout reservations; stock reduced by an on-hold order is restored when it fails | [PR 65325](https://github.com/woocommerce/woocommerce/pull/65325), [PR 66048](https://github.com/woocommerce/woocommerce/pull/66048), [PR 66256](https://github.com/woocommerce/woocommerce/pull/66256) |
| 11.1.2 (2026-09-22) | Current release when this skill was verified; requires WordPress 7.0 and PHP 7.4, tested up to WordPress 7.1 | [release](https://github.com/woocommerce/woocommerce/releases/tag/11.1.2); [readme.txt L4-L6](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/readme.txt#L4-L6) |
| 11.2.0 (milestone, not released on 2026-09-29) | Classic cart check stops skipping the Store API draft order when `order_awaiting_payment` is `false` | [PR 67471](https://github.com/woocommerce/woocommerce/pull/67471) |

Open on 2026-09-29, not in any release: [PR 68963](https://github.com/woocommerce/woocommerce/pull/68963) (opt-in
exclusion of a shopper's own stale holds) and [PR 67446](https://github.com/woocommerce/woocommerce/pull/67446)
(Store API keeps a fully held product's limit at 0). See [known-issues.md](known-issues.md).

## WordPress

The skill uses no WordPress behaviour that changed recently. WordPress 7.1.2 was the current release on 2026-09-29
([release archive](https://wordpress.org/download/releases/)); the posts table columns it reads are in
[schema.php L159-L189](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-admin/includes/schema.php#L159-L189).

## What this means for the procedure

- Before 11.0.0, expect lock waits between reservations and order status changes at busy moments; the timing belongs
  to the `woo-checkout-performance-audit` skill.
- Before 10.9.0, count `wc-checkout-draft` orders separately: block checkout created them on page views, and their
  holds (before 9.2.0) or their rows could pile up.
- Before 10.6.0, block checkout's pending orders are never auto-cancelled. Their holds expire after the hold time, but
  the orders stay pending until someone cancels them, and a late payment on one reduces stock that other shoppers may
  already have bought.
- Before 10.1.0, the cancel event is a WP-Cron event: check it with `wp cron event list` instead of Action Scheduler.
- Before 11.0.0, a failed order that had reduced stock (an on-hold payment that failed later) keeps its units
  deducted: step 4 of the procedure finds them.
- Before 10.8.0 there is no `product_id_expires` index; the SQL in `scripts/` still works, only slower on a big table.
