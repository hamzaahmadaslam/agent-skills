# Changes, each with a backup, a check and an undo

Everything in this skill up to step 6 reads. Every step below changes something. Before each one: state the step, its
backup, its check and its undo to the owner, and wait for approval of that step. Rehearse it on a staging copy first,
with the gateway in test mode. Change one thing at a time and re-run the export and `tax-trace.mjs` after it.

Which rounding a jurisdiction requires (per line or per invoice total) is a question for the owner and their accountant;
this skill shows what WooCommerce does, not what the law asks.

## Backups used below

| Backup | Command | Restore | Source |
| --- | --- | --- | --- |
| The order as stored | `bash scripts/export-order.sh <id> --path=... > order-<id>-before.json` | Not a restore: the record of the values before the change | [helper-script.md](helper-script.md) |
| One option | `wp option get <name> --format=json > <name>.json` | `wp option update <name> --format=json < <name>.json` | [option get](https://developer.wordpress.org/cli/commands/option/get/); [option update](https://developer.wordpress.org/cli/commands/option/update/) |
| Full database | `wp db export /path/outside/webroot/<name>.sql --single-transaction` | `wp db import <file>`, on staging; on a live store it would roll back every order since | [db export](https://developer.wordpress.org/cli/commands/db/export/); [db import](https://developer.wordpress.org/cli/commands/db/import/) |
| A file | `cp <file> <file>.bak-<date>` | copy it back | |

Database exports hold customer data: write them outside the web root, keep them out of chats and tickets, and delete them
after the retention period the owner sets. A backup counts only after one test restore on staging.

## A refund that the form makes one cent too high

- Change (per refund, owner's action in the order screen): enter the refund quantities, then correct one tax field by
  the cent so the fields add up to the remaining total (or to the intended partial amount), and check the amount box
  before pressing the refund button ([refunds.md](refunds.md)).
- Backup: the before export.
- Check: the refund record's `amount` equals the intended amount, the order's remaining refundable total is as expected,
  and the gateway's dashboard shows the same refund.
- Undo: none from WooCommerce once the gateway has refunded; a mistaken extra cent is settled with the customer.

## The tax rounding setting (store-wide)

- Change: WooCommerce > Settings > Tax > Rounding (`woocommerce_tax_round_at_subtotal`).
- Backup: the option.
- Check on staging: place the carts that showed the gap (and a few ordinary ones) with the gateway in test mode, export
  each order, run the helper; compare cart page, stored order, emails, REST sums, refund form and gateway amount. Note
  which totals move by a cent compared with the current setting (the helper's "other setting" sections show this before
  anything is changed).
- Undo: set the option back.
- What it does not do: fix past orders. It changes how every later cart, checkout, order edit, "Recalculate" and refund
  form rounds, including edits to old orders ([order-recalculation.md](order-recalculation.md)).

## Price decimals that do not match the currency

- Change: WooCommerce > Settings > General > Number of decimals (`woocommerce_price_num_decimals`) to the currency's
  minor unit, for example 0 for JPY ([gateways-and-currency.md](gateways-and-currency.md)).
- Backup: the option. Check that no plugin filters `wc_get_price_decimals` (`export-order.php` prints the value after
  filters beside the option).
- Check on staging: product prices display as intended, a test order's total in minor units equals the gateway amount.
- Undo: set the option back.

## A plugin or theme callback that changes tax arithmetic

- Change: the plugin's own setting, or removing a snippet, for a callback listed under `hooks` in the export
  (`woocommerce_calc_tax`, `woocommerce_tax_round`, `wc_round_tax_total`, `wc_get_price_decimals` and the others in
  [settings-and-constants.md](settings-and-constants.md#filters-that-change-the-arithmetic)).
- Backup: the plugin's settings (its option) or a copy of the file with the snippet.
- Check on staging: the helper's result for a test order now matches the stored figures and the other views.
- Undo: restore the option or the file.

## A system that reads orders (ERP, accounting, invoices)

- Change (in that system, by its owner): take the order-level `total`, `total_tax`, `cart_tax` and `shipping_tax` as the
  figures to post, and treat line amounts as a breakdown that may be a cent apart
  ([rest-emails-display.md](rest-emails-display.md)).
- Backup and undo: that system's own.
- Check: the orders from the trace post with the same totals as WooCommerce's order screen.

## Editing or recalculating a paid order

Not recommended, and never to "see what happens": "Recalculate" and the items box's "Save" both rewrite the stored taxes
and totals (`wc_save_order_items()` ends with `update_taxes()` and `calculate_totals( false )`,
[wc-admin-functions.php L305-L496](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/admin/wc-admin-functions.php#L305-L496);
[TaxesController.php L32-L55](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Orders/TaxesController.php#L32-L55)).

If the owner decides an order must be edited:

- Backup: the before export, and a full database backup taken right before.
- Rehearse on staging with the same order; run the helper on the staging result and show the owner the before and after
  values, including the cent that will move against the amount the gateway captured.
- Check after the edit on production: a new export and helper run; the order's totals, tax lines and remaining
  refundable amount are the rehearsed ones.
- Undo: no exact undo on a live store. Restoring the database backup would also undo every order placed since; the
  before export is the record for putting values back by hand, which itself runs the same recalculation.

## Updating WooCommerce for an upstream fix

- A WooCommerce update is a change of its own: full database backup, staging first with the orders from the trace, then
  the helper on new test orders. Read the release's changelog for tax and rounding entries
  ([releases](https://github.com/woocommerce/woocommerce/releases)) and check that
  the skill's references still describe the code ([version-notes.md](version-notes.md)).
