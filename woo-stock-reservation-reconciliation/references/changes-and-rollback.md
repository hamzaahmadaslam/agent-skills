# Changes, each with a backup, a check and an undo

Every step here changes the store. None of them is in `scripts/`. Before each one: state the step, its backup, its
check and its undo to the owner, and wait for approval of that step. One approval covers one step. Work on staging
first where the step can be tried there, then on production at a quiet hour. Re-run the read-only report after each
step. Code links point at the WooCommerce 11.1.2 tag.

## Backups used below

| Backup | Command | Restore | Source |
| --- | --- | --- | --- |
| Full database | `wp db export /path/outside/webroot/<name>.sql --single-transaction` | `wp db import <file>`, on staging, never over a live store | [db export](https://developer.wordpress.org/cli/commands/db/export/) (extra flags go to `mysqldump`); [db import](https://developer.wordpress.org/cli/commands/db/import/) |
| One table | `wp db export /path/outside/webroot/<name>.sql --tables=<prefix>wc_reserved_stock --single-transaction` | `wp db import <file>` drops the table and writes the saved copy back: `mysqldump` adds `DROP TABLE` by default through `--opt` | same; [mysqldump](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html) |
| One option | `wp option get <name> --format=json > <name>.json` | the settings screen, with the saved value | [option get](https://developer.wordpress.org/cli/commands/option/get/) |
| Values before a stock change | the ledger rows of the products involved, saved as a file (`scripts/stock-ledger-*.sql`), plus the order notes the change writes | set each value back with change 5 | this file |

Never export `postmeta` with a `--where` filter as a backup of a few `_stock` values: the dump starts with
`DROP TABLE`, and importing it would replace the whole table with those few rows. Record the values instead.

Exports hold customer data: write them outside the web root, keep them out of chats and tickets, and delete them after
the retention period the owner sets.

## 1. Cancel chosen unpaid orders

Use when the report lists pending or draft orders that hold units and that the owner confirms will not be paid (for
example a shopper's older duplicate orders).

- Change: in WooCommerce > Orders, open each order and set the status to Cancelled, or
  `wp eval '$o = wc_get_order( 123 ); $o->update_status( "cancelled", "Stock reconciliation: unpaid order cancelled with owner approval." );'`
  per order ID the owner approved.
- What it does: `woocommerce_order_status_cancelled` deletes the order's reservation rows and restores stock only
  where the order had reduced it
  ([wc-stock-functions.php L156, L494](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L156)).
  A pending, on-hold or processing order moving to cancelled triggers the "Cancelled order" email, when that email is
  enabled
  ([class-wc-email-cancelled-order.php L44-L46](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/emails/class-wc-email-cancelled-order.php#L44-L46));
  tell the owner who receives it.
- Backup: the report rows for those orders (ID, status, holds, `_reduced_stock` items). Take a full backup when more
  than a handful of orders are involved.
- Check: the orders show "Cancelled" with the note; their rows are gone from `wc_reserved_stock`; the product's live
  holds fell by the held quantity; `_stock` changed only for orders that had `_reduced_stock`.
- Undo: set the status back to Pending payment. The reservation is not written again (only checkout writes holds), and
  a restore is reversed only by the next paid status change. Say this before approval.

Never delete the order or its reservation rows while it is still pending: the hold still counts, and deleting the row
only hides it from the stock check.

## 2. Run the unpaid-order cancellation now

Use when the cancel action is missing, failing or late and pending orders are past the hold time. Fix the queue itself
with the `wp-cron-action-scheduler-health` skill; this step only catches up.

- First, read-only: the SQL block "Pending orders past the hold time" lists what would be cancelled (created via
  `checkout` or `store-api`, unchanged for longer than the hold minutes).
- Change: `wp eval 'wc_cancel_unpaid_orders();'`. It removes and reschedules the action, then cancels every matching
  order ([wc-order-functions.php L1089-L1157](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-functions.php#L1089-L1157)).
- Backup: full database, and the list from the read-only block.
- Check: the listed orders are cancelled with "Unpaid order cancelled - time limit reached."; `wp action-scheduler
  action next woocommerce_cancel_unpaid_orders` shows one next run.
- Undo: as in change 1, per order.

## 3. Change the hold time

Owner decision: a longer hold protects shoppers who pay slowly on an outside payment page; a shorter one frees units
sooner and cancels unpaid orders sooner. The same value drives both
([orders-and-cancellation.md](orders-and-cancellation.md)).

- Change: WooCommerce > Settings > Products > Inventory > "Hold stock (minutes)". Use the screen, not
  `wp option update`: saving on the screen reschedules the cancel action
  ([wc-formatting-functions.php L1241-L1270](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-formatting-functions.php#L1241-L1270)).
- Backup: `wp option get woocommerce_hold_stock_minutes --format=json`.
- Check: the next cancel run is the new number of minutes ahead; the next order's note reads "Stock hold of <new>
  minutes"; its rows' `expires` minus `timestamp` equals the new value.
- Undo: enter the old value on the same screen. Rows written in between keep the expiry they were written with.

Leaving the field blank turns off both holds and the cancel event. Treat that as its own decision, with the trade-off
written down: nothing stops two shoppers paying for the last unit at the same time.

## 4. Remove reservation rows that no longer count

Housekeeping only: these rows do not change what shoppers can buy
([how-reservations-work.md](how-reservations-work.md#which-rows-count)). Do it when the table is large enough to
matter to the owner, not to fix availability.

- Backup: one-table export of `<prefix>wc_reserved_stock`, taken right before.
- Before and after, save the output of the SQL block "Live holds per product". The step is correct only if the two
  outputs are identical.
- Change (HPOS), with the prefix filled in:

  ```sql
  DELETE rs FROM wp_wc_reserved_stock rs
  LEFT JOIN wp_wc_orders o ON o.id = rs.order_id
  WHERE rs.expires <= NOW()
     OR o.id IS NULL
     OR o.status NOT IN ('wc-checkout-draft', 'wc-pending');
  ```

  Posts storage:

  ```sql
  DELETE rs FROM wp_wc_reserved_stock rs
  LEFT JOIN wp_posts p ON p.ID = rs.order_id
  WHERE rs.expires <= NOW()
     OR p.ID IS NULL
     OR p.post_status NOT IN ('wc-checkout-draft', 'wc-pending');
  ```

  `wp_` stands for the store's prefix. Run it with `wp db query` on the store's database. Both statements delete
  exactly the rows the SELECT block "Reservation rows that do not count" counts, and no row that the reservation
  query counts ([ReserveStock.php L269-L306](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Checkout/Helpers/ReserveStock.php#L269-L306)).
- Check: the "Live holds per product" totals are the same before and after, apart from holds that expired or were
  written between the two runs (a quiet hour keeps those near zero); the row count dropped by the number "Reservation
  rows that do not count" showed.
- Undo: importing the export restores the table, and also removes every hold written since the export. Undo right
  away or not at all, and never while checkouts are running.

## 5. Set a product's `_stock` to a counted value

Use after the owner has counted the shelf and `scripts/reconcile-counts.mjs` shows a difference the owner accepts.
The number to set is the owner's, not the helper's.

- Preferred: the product's edit screen, Inventory tab, "Stock quantity" (for a variation, its own row). The screen
  refuses to save when the stock changed since the page was opened ("The stock has not been updated because the value
  has changed since editing.")
  ([class-wc-meta-box-product-data.php L344-L350](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/meta-boxes/class-wc-meta-box-product-data.php#L344-L350)).
- WP-CLI, one product per command: `wp eval 'wc_update_product_stock( 123, 7, "set" );'` sets `_stock`, refreshes the
  lookup table, saves the product and fires the stock hooks
  ([wc-stock-functions.php L30-L81](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L30-L81)).
  A "set" overwrites any order that reduced stock between the count and the command: run it at a quiet hour, right
  after reading the ledger again.
- Never `UPDATE postmeta` directly ([stock-reduction-and-restore.md](stock-reduction-and-restore.md#where-stock-lives)).
- Backup: the product's ledger row saved before the change (`_stock`, live holds, open reductions).
- Check: the ledger row shows the new `_stock`; `wc_product_meta_lookup.stock_quantity` matches; the stock status on
  the product page is right; available-to-shoppers equals the new `_stock` minus live holds. Stock plugins and feeds
  react to the stock hooks: tell the owner which are active.
- Undo: set the saved value the same way.

## 6. Give back units still deducted by an unpaid or cancelled order

Use when step 4 of the procedure finds `_reduced_stock` on items of a cancelled, failed, pending or draft order.

- Change: `wp eval 'wc_increase_stock_levels( 123 );'` for the approved order. It adds back each item's
  `_reduced_stock`, deletes that meta and writes "Stock levels increased:"
  ([wc-stock-functions.php L351-L412](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L351-L412)).
  It does nothing while "Manage stock" is off or `woocommerce_can_restore_order_stock` returns false, which may be
  why the units were not given back in the first place: check the callbacks on that filter first.
- Backup: the order's item rows with `_reduced_stock`, and the ledger rows of their products.
- Check: the note lists each product with from and to values; the items no longer have `_reduced_stock`; each product's
  `_stock` rose by the item's amount.
- Undo: `wp eval 'wc_reduce_stock_levels( 123 );'` deducts again every stock-managed item without `_reduced_stock`
  ([L170-L239](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L170-L239)).
  Compare its note with the saved rows.

## 7. Deduct units a paid order never took

Use when step 4 finds a processing, completed or on-hold order whose stock-managed items have no `_reduced_stock`.
First find out why (stock management was off when it was paid, a filter, an import); the owner may prefer to leave
old orders alone and correct `_stock` once with change 5.

- Change: `wp eval 'wc_reduce_stock_levels( 123 );'`. Only items without `_reduced_stock` whose product manages stock
  are reduced, so running it twice does not deduct twice
  ([L170-L239](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-stock-functions.php#L170-L239)).
- Backup: the order's item rows and the ledger rows of their products.
- Check: the "Stock levels reduced:" note; `_reduced_stock` on the items; `_stock` fell by the quantities. A product that
  reaches zero can go out of stock and send the store's low or no stock email.
- Undo: for each item the note lists, set the product's `_stock` back with change 5 and remove the item's meta with
  `wp eval 'wc_delete_order_item_meta( <item_id>, "_reduced_stock" );'`
  ([wc-order-item-functions.php L146-L153](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-order-item-functions.php#L146-L153)).
  `wc_increase_stock_levels()` is not the undo here: it would also give back items the order had reduced before.
