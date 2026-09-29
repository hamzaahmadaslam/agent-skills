# Fixes, each with a backup, a check and an undo

Every step here changes the store. Before each one, state the step, its backup, its check and its undo to the owner and
wait for approval of that step. Run it on a staging copy first when the store has one, then on production at a quiet
hour. Fix one product first, check it, then the rest in batches of at most 50 IDs. WooCommerce links point at the
11.1.2 tag.

## Rules for every fix

- Write through WooCommerce, never with SQL on `postmeta`. WooCommerce's own code keeps `_price`, the lookup row, the
  transients, the object cache and the per-product events in step; an SQL `UPDATE` does none of that
  ([caches-and-lookup.md](caches-and-lookup.md)).
- Do not run the daily action or `wc_scheduled_sales()` by hand to catch up on 10.5.0 to 11.1.x. It saves every
  product with a completed sale twice and fires the sale hooks for each of them
  ([issue 66720](https://github.com/woocommerce/woocommerce/issues/66720)). Fix the listed products one by one.
- Every save fires `woocommerce_update_product`
  ([class-wc-product-data-store-cpt.php L398](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L398)),
  which product webhooks and sync plugins listen to. Tell the owner before a batch: feeds and ERPs receive an update
  per product.
- Multisite: pass `--url=<site>` to every command.

## Backups used below

| Backup | Command | Restore | Source |
| --- | --- | --- | --- |
| B1: sale meta of one product or variation | `wp post meta list <id> --keys=_regular_price,_sale_price,_price,_sale_price_dates_from,_sale_price_dates_to --format=json > sale-backup-<id>.json` | `wp post meta update <id> <key> '<value>'` for each key that changed; `wp post meta delete <id> <key>` for a key that did not exist | [post meta list](https://developer.wordpress.org/cli/commands/post/meta/list/), [post meta update](https://developer.wordpress.org/cli/commands/post/meta/update/), [post meta delete](https://developer.wordpress.org/cli/commands/post/meta/delete/) |
| B2: the same rows as SQL, for the record | `wp db export sale-backup-<date>.sql --tables=<prefix>postmeta --no-create-info=true --where="post_id IN (<ids>) AND meta_key IN ('_price','_regular_price','_sale_price','_sale_price_dates_from','_sale_price_dates_to')"` | Read it to restore single values with B1's commands; importing it over live rows fails on their primary keys | [db export](https://developer.wordpress.org/cli/commands/db/export/) (`--where` is passed to mysqldump) |
| B3: lookup rows | `wp db query "SELECT * FROM <prefix>wc_product_meta_lookup WHERE product_id IN (<ids>)" > lookup-before.tsv` | The table is derived from meta: restore the meta, then refresh the row (F4) | [db query](https://developer.wordpress.org/cli/commands/db/query/) |
| B4: the product's pending sale events | `wp action-scheduler action list --group=woocommerce-sales --status=pending --args='{"product_id":<id>}' --per_page=0 --fields=id,hook,status,scheduled_date --format=csv > events-before-<id>.csv` | Recreate with F8 | [List_Command.php L12-L26](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action/List_Command.php#L12-L26) |

Keep backups outside the web root and delete them when the owner says the fix is accepted. They hold prices and
product IDs, no customer data.

## F1: run the product's own overdue event

When the SQL block "still pending after their time" lists the product's event, run that action. It is the work the
queue would have done.

- Backup: B1, B3.
- Command: `wp action-scheduler action run <action_id>`
  ([Action_Command.php L326-L353](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action_Command.php#L326-L353)).
- Check: the SQL block "Stored _price disagrees" no longer lists the product; `explain-sale-state.mjs` gives `OK`;
  the action's status is `complete`; the lookup row matches `_price`.
- Undo: restore `_price` from B1, then F4 and F5 for the product. That puts back the wrong price, so it is only for
  a fix that went wrong in another way.
- If many events are overdue, the queue is the problem: fix the runner first (`wp-cron-action-scheduler-health`),
  and the events then run by themselves.

## F2: apply the start or end with WooCommerce's handler (10.5.0 and later)

For a simple or external product or a variation whose `_price` disagrees and that has no pending event, call the
handler the event would call. It re-checks the dates and prices and does nothing when the product is not due
([scheduled-events.md](scheduled-events.md#what-the-per-product-handlers-do)).

- Backup: B1 (for a variation, B1 of the parent too), B3.
- Command, window open but regular price stored:
  `wp eval 'wc_handle_product_start_scheduled_sale( <id> );'`
- Command, window closed but sale price stored:
  `wp eval 'wc_handle_product_end_scheduled_sale( <id> );'`
  ([wc-product-functions.php L687-L765](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L687-L765))
- The handler also refreshes the lookup row (10.8.0 and later), deletes the product's transients, and for a variation
  re-syncs the parent ([L633-L685](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L633-L685)).
- Check: as F1. For a variation, also the variable parents block.
- Undo: as F1.
- The start handler does nothing for a sale price of `0` or empty. Those are data problems (F10), not a stale price.
- Before 10.5.0 these functions do not exist. There the daily action is the only mechanism; fix the data shape so it
  selects the product, or update WooCommerce as its own change.

## F3: re-sync a variable parent

When the variations agree with their windows and the parent's `_price` rows or range do not.

- Backup: B1 of the parent (its `_price` rows), B3.
- Command: `wp eval 'WC_Product_Variable::sync( <parent_id> );'`
  ([class-wc-product-variable.php L710-L724](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-product-variable.php#L710-L724)).
  It rebuilds the parent's `_price` rows from its visible variations, refreshes its lookup row, syncs stock status and
  attributes, and saves the parent ([variable-products.md](variable-products.md)).
- Check: the variable parents block no longer lists it; F5 for the parent, then the "From" price on the product page.
- Undo: the parent's rows are derived from the variations. Restore the variations (B1 each) and run the same command.

## F4: refresh one lookup row (10.8.0 and later)

When `_price` is right and the lookup row is not.

- Backup: B3.
- Command: `wp eval 'WC_Data_Store::load( "product" )->refresh_product_lookup_table( <id> );'`
  ([class-wc-product-data-store-cpt.php L953-L955](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L953-L955);
  called the same way at [wc-product-functions.php L669-L674](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L669-L674)).
- Check: the lookup block no longer lists the product; price sorting and the price filter place it correctly.
- Undo: none needed; the row is recomputed from meta.
- Many rows: WooCommerce > Status > Tools > "Product lookup tables" regenerates the table in the background from
  `_price` ([caches-and-lookup.md](caches-and-lookup.md#the-product-lookup-table)). Fix `_price` first, and run it at
  a quiet hour; while it runs, the tool says product display, sorting and reports may not be accurate
  ([tools controller L257-L260](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/rest-api/Controllers/Version2/class-wc-rest-system-status-tools-v2-controller.php#L257-L260)).

## F5: delete one product's transients

When the database is right and a variable product's range or badge, or an "on sale" list, is not.

- Backup: none; these are caches.
- Command: `wp eval 'wc_delete_product_transients( <id> );'`, with the parent's ID for a variable product
  ([wc-product-functions.php L130-L138](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L130-L138);
  [ProductUtil.php L35-L126](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/src/Internal/Utilities/ProductUtil.php#L35-L126)).
  It also deletes `wc_products_onsale` and the other fixed-name product transients.
- Check: the product page and the category page after the page cache is purged (F6).
- Undo: none; WooCommerce rebuilds them on the next read.

## F6: purge the page cache for the product

- Backup: none.
- Command: the cache's own purge for the product URL and the shop and category pages that list it (plugin, host panel
  or CDN).
- Check: `Age` and cache-status headers on the next two requests ([caches-and-lookup.md](caches-and-lookup.md#page-caches)).
- Undo: none.
- If boundaries keep leaving stale pages, the cache does not purge on `woocommerce_update_product` or
  `clean_post_cache`. That is a recommendation for the owner or the cache vendor, not a change this skill makes.

## F7: duplicate pending events

Duplicates are harmless: the handlers re-check the product when they fire, and the second one does nothing
([PR 65709](https://github.com/woocommerce/woocommerce/pull/65709)). No change. Record the count; if it grows on
11.0.0 or later, report it upstream with the SQL output.

## F8: schedule missing events for future boundaries (10.5.0 and later)

When the SQL block "Future sale boundaries with no pending event" lists a product (dates written before 10.5.0, or
directly before 10.8.0).

- Backup: B4.
- Command: `wp eval 'wc_maybe_schedule_product_sale_events( <id> );'`. It unschedules the product's pending start and
  end events and schedules one per future date
  ([wc-product-functions.php L767-L795](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L767-L795)).
  It changes no prices.
- Check: the block no longer lists the product; B4's command now shows the events at the boundary times.
- Undo: `wp action-scheduler action cancel wc_product_start_scheduled_sale --group=woocommerce-sales --args='{"product_id":<id>}' --all`
  and the same for `wc_product_end_scheduled_sale`
  ([Action_Command.php L13-L40](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/WP_CLI/Action_Command.php#L13-L40)).
  The product then relies on the daily action again, as before.

## F9: the daily action at the wrong time of day

- Default: no change. Since 10.5.0 the per-product events carry the exact times; the daily time matters only for
  products F8 has not covered.
- If the owner wants it moved: backup the output of
  `wp action-scheduler action list --hook=woocommerce_scheduled_sales --status=pending --per_page=0 --fields=id,scheduled_date --format=csv`;
  then `wp action-scheduler action cancel woocommerce_scheduled_sales --group=woocommerce`. WooCommerce schedules it
  again for the next midnight site time the next time `action_scheduler_ensure_recurring_actions` runs, which Action
  Scheduler triggers daily at 3 am site time ([runner-health.md](runner-health.md#a-recurring-action-that-stops-recurring)).
- Check: within a day, one pending `woocommerce_scheduled_sales` action at 00:00 site time (the SQL block prints
  `local_time_of_day`; sites with a fractional UTC offset get the fraction dropped,
  [timezones-and-dates.md](timezones-and-dates.md#when-the-daily-safety-net-runs)).
- Undo: none needed, since WooCommerce recreates it. For the day in between there is no safety net run.
- On 10.5.0 to 11.1.x each daily run also carries the churn of issue 66720; moving it does not change that.

## F10: fix a product's sale data (owner decides the values)

For the shapes in the SQL blocks "Empty or zero sale price with a sale start date", "Sale dates stored in a form other
than digits, or an end before the start", and "sale price not below regular".

- Backup: B1.
- Preferred: the owner corrects the product in the product editor, which runs the full save and the checks.
- Command, for leftover dates on a product the owner confirms has no sale:
  `wp eval '$p = wc_get_product( <id> ); $p->set_date_on_sale_from( "" ); $p->set_date_on_sale_to( "" ); $p->save();'`.
  CRUD deletes the date meta, recomputes `_price`, and the meta hooks unschedule the product's events
  ([sale-data-model.md](sale-data-model.md#when-a-crud-save-writes-_price)).
- Check: the block no longer lists the product; `explain-sale-state.mjs` gives `OK` without the issue note.
- Undo: `wp post meta update <id> _sale_price_dates_from <value from B1>` (and `_to`), which also reschedules events
  for future dates (10.8.0 and later).

## F11: update WooCommerce (its own change)

- The fix for the daily churn (issue 66720) is merged for 11.2.0, which was in beta (11.2.0-beta.2) on 2026-09-29, and the batching of the daily run (PR 68016) is milestoned for
  11.3.0 ([version-notes.md](version-notes.md)). Updating is a change of its own: staging first, a full backup, the
  store's own test pass, then this audit's SQL again to confirm the daily "starting" list no longer holds completed
  sales.
