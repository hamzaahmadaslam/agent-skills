# Draft and pending orders, the hold stock setting and the cancel event

Read this for step 3 of the procedure, and whenever unpaid orders pile up or held units never come back. Code links
point at the WooCommerce 11.1.2 tag unless a line says otherwise.

## Order statuses that matter here

| Status (stored value) | Where it comes from | Holds reserved units? | Source |
| --- | --- | --- | --- |
| `wc-checkout-draft` ("Draft") | Block checkout creates the order in this status | Yes, while its row has not expired | [DraftOrders.php L17-L18, L98-L101](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Blocks/Domain/Services/DraftOrders.php#L98-L101); [OrderController.php L42-L60](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/OrderController.php#L42-L60) |
| `wc-pending` ("Pending payment") | Classic checkout creates orders as pending; block checkout sets pending during place order | Yes, while its row has not expired | [Checkout.php L669-L671](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php#L669-L671) |
| `wc-on-hold` | For example the bank transfer (BACS) gateway, which puts a new order on hold by default (filter `woocommerce_bacs_process_payment_order_status`) | No: the hold is released and `_stock` is reduced instead | [class-wc-gateway-bacs.php L393-L411](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/gateways/bacs/class-wc-gateway-bacs.php#L393-L411) |
| `wc-failed` | A declined or failed payment | No (status not counted) | [ReserveStock.php L272-L279](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php#L272-L279) |

The status values are in [OrderInternalStatus.php](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Enums/OrderInternalStatus.php).

- Block checkout orders have `created_via` `store-api`
  ([OrderController.php L54-L56](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/OrderController.php#L54-L56));
  classic checkout orders have `checkout`
  ([class-wc-checkout.php L451](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L451)).
- Since 10.9.0 block checkout creates the draft order only when the shopper places the order, not on page views and
  form changes ([PR 64155](https://github.com/woocommerce/woocommerce/pull/64155);
  [Checkout.php L213-L228](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Routes/V1/Checkout.php#L213-L228)).

## Orders the shopper's session reuses

- Classic checkout stores the order ID in the session key `order_awaiting_payment` before payment
  ([class-wc-checkout.php L1148-L1149](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L1148-L1149))
  and reuses that order on the next attempt when it is pending or failed and its cart hash still matches; otherwise it
  creates a new order
  ([L402-L428](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-checkout.php#L402-L428)).
- The Store API keeps its order ID in the session key `store_api_draft_order`
  ([DraftOrderTrait.php L19, L31](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/StoreApi/Utilities/DraftOrderTrait.php#L19-L31)).
- A changed cart therefore creates a second unpaid order. The first one keeps its hold until it expires or the order
  is cancelled, and the stock checks exclude only one order of the shopper (see
  [availability.md](availability.md)).

## The "Hold stock (minutes)" setting

WooCommerce > Settings > Products > Inventory, option `woocommerce_hold_stock_minutes`, default `60`, not autoloaded.
The help text: "Hold stock (for unpaid orders) for x minutes. When this limit is reached, the pending order will be
cancelled. Leave blank to disable."
([class-wc-settings-products.php L261-L274](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/settings/class-wc-settings-products.php#L261-L274))

The one value controls two things:

1. How long a reservation row counts (`expires`), as described in
   [how-reservations-work.md](how-reservations-work.md).
2. How often, and after how long, unpaid orders are cancelled (below).

Saving the setting on the settings screen runs `wc_format_option_hold_stock_minutes()`: a blank or zero value is
stored as an empty string, every scheduled `woocommerce_cancel_unpaid_orders` action is removed, and when the value is
not empty a new one is scheduled that many minutes ahead (filter
`woocommerce_cancel_unpaid_orders_interval_minutes`)
([wc-formatting-functions.php L1241-L1270](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-formatting-functions.php#L1241-L1270)).
Changing the option any other way (for example `wp option update`) skips this rescheduling.

With the setting blank, checkout writes no reservation rows (zero minutes, see how-reservations-work.md) and no
cancel action is scheduled.

## The cancel event

`wc_cancel_unpaid_orders()`, hooked to `woocommerce_cancel_unpaid_orders`
([wc-order-functions.php L1089-L1157](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-functions.php#L1089-L1157)):

1. Reads `woocommerce_hold_stock_minutes` (default `'60'`), removes every scheduled copy of the action from Action
   Scheduler and WP-Cron.
2. Stops without rescheduling when the value is below 1 or "Manage stock" is off.
3. Schedules its next run in Action Scheduler, group `woocommerce`, the interval from the filter above (WP-Cron when
   Action Scheduler is missing).
4. Asks the order data store for unpaid orders last changed before now minus the hold minutes, and cancels each one
   whose `created_via` is `checkout` or `store-api` (filter `woocommerce_cancel_unpaid_order`) with the note "Unpaid
   order cancelled - time limit reached."

What "unpaid orders" means in each storage:

| Storage | Query | Source |
| --- | --- | --- |
| HPOS | `wc_orders.status = 'wc-pending'` and `date_updated_gmt` before the cut-off (the local timestamp is converted to GMT first) | [OrdersTableDataStore.php L1184-L1215](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/DataStores/Orders/OrdersTableDataStore.php#L1184-L1215) |
| Posts | `posts.post_status = 'wc-pending'` and `post_modified` before the cut-off | [class-wc-order-data-store-cpt.php L552-L569](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-order-data-store-cpt.php#L552-L569) |

What follows from the code:

- Only `pending` orders are cancelled. Draft orders are not; on-hold orders are not.
- The age is measured from the order's last change, not its creation. An order that a plugin or gateway keeps saving
  is never old enough.
- Orders created by an admin, the REST API or other plugins are left alone unless a callback on
  `woocommerce_cancel_unpaid_order` says otherwise.
- The action runs every N minutes and cancels orders unchanged for N minutes, so on a queue that runs on time an
  abandoned pending order is cancelled between N and about 2N minutes after its last change.
- Before 10.6.0 block checkout orders (`store-api`) were not auto-cancelled at all: the docblock records that
  `store-api` was added to the list in 10.6.0 (L1143-L1151;
  [PR 58262](https://github.com/woocommerce/woocommerce/pull/58262)).
- Cancelling fires `woocommerce_order_status_cancelled`, which releases the order's rows and restores stock only
  where the order had reduced it (see [stock-reduction-and-restore.md](stock-reduction-and-restore.md)).

## How the action is kept scheduled

- `register_recurring_actions()`, run on `action_scheduler_ensure_recurring_actions`, schedules a unique
  `woocommerce_cancel_unpaid_orders` action when the hold setting is not empty
  ([class-woocommerce.php L360, L1726-L1758](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-woocommerce.php#L1726-L1758)).
- 10.1.0 moved WooCommerce's cron jobs, unpaid order clean-up included, to Action Scheduler
  ([PR 59325](https://github.com/woocommerce/woocommerce/pull/59325)); 10.1.2 and 10.2.0 stopped the event being
  queued as unique inside the function so it recurs after each run
  ([PR 60626](https://github.com/woocommerce/woocommerce/pull/60626), [PR 60625](https://github.com/woocommerce/woocommerce/pull/60625)).
- The action runs only when the Action Scheduler queue runs. A stalled queue means pending orders are never cancelled
  and their holds, once expired, stop counting while the orders stay pending. The `wp-cron-action-scheduler-health`
  skill in this collection covers the queue.

Read-only checks (Action Scheduler 4.0.0 WP-CLI,
[Action_Command.php L178-L320](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action_Command.php#L178-L320)):

- `wp action-scheduler action next woocommerce_cancel_unpaid_orders` prints the next scheduled run.
- `wp action-scheduler action list --hook=woocommerce_cancel_unpaid_orders --status=failed --per_page=0 --format=count`
  counts failed runs. Keep `--per_page=0`: the query's `per_page` defaults to 5, so without it a count never exceeds 5
  ([ActionScheduler_DBStore.php L435-L452](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/data-stores/ActionScheduler_DBStore.php#L435-L452)).
- WooCommerce 11.1.2 bundles Action Scheduler 4.0.0
  ([composer.json](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/composer.json)).

## Draft order clean-up

`woocommerce_cleanup_draft_orders` runs daily from midnight and deletes (permanently, `delete( true )`) `shop_order`
drafts not modified for a day, 20 per batch (filter `woocommerce_delete_expired_draft_orders_batch_size`, since
10.7.0), queueing another batch when a batch was full
([DraftOrders.php L20, L79-L87, L179-L216](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Blocks/Domain/Services/DraftOrders.php#L179-L216)).
The reservation rows of those orders are not deleted with them; they no longer count (no status to match) and stay in
the table.
