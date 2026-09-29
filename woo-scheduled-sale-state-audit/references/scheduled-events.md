# What starts and ends a scheduled sale

Read this for steps 3 to 5 of the procedure. WooCommerce links point at the 11.1.2 tag, Action Scheduler links at
the 4.0.0 tag (bundled with WooCommerce 11.1.2,
[composer.json](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/composer.json)).
Older behaviour is in [version-notes.md](version-notes.md).

## Two mechanisms since 10.5.0

| Mechanism | Hook | Group | When | Source |
| --- | --- | --- | --- | --- |
| Per-product event at the sale start | `wc_product_start_scheduled_sale`, args `{"product_id":<id>}` | `woocommerce-sales` | Once, at the exact `_sale_price_dates_from` timestamp | [wc-product-functions.php L578-L631](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L578-L631) |
| Per-product event at the sale end | `wc_product_end_scheduled_sale`, args `{"product_id":<id>}` | `woocommerce-sales` | Once, at the exact `_sale_price_dates_to` timestamp | same |
| Daily safety net | `woocommerce_scheduled_sales`, callback `wc_scheduled_sales()` | `woocommerce` | Every 24 hours, first at midnight site time ([timezones-and-dates.md](timezones-and-dates.md#when-the-daily-safety-net-runs)) | [L831-L905](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L831-L905); [class-woocommerce.php L1726-L1744](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-woocommerce.php#L1726-L1744) |

Both are Action Scheduler actions: they run only when the queue runs
([runner-health.md](runner-health.md)). The per-product events arrived with
[PR 62115](https://github.com/woocommerce/woocommerce/pull/62115) in 10.5.0
([changelog](https://github.com/woocommerce/woocommerce/blob/11.1.2/changelog.txt#L1163)); the docblock of
`wc_scheduled_sales()` calls the daily action a safety net for products the events missed and for products created
before the events existed ([L831-L850](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L831-L850)).

## How per-product events get scheduled

- `wc_maybe_schedule_sale_events_on_meta_change()` runs on `added_post_meta`, `updated_post_meta` and
  `deleted_post_meta` for the two date keys on `product` and `product_variation` posts
  ([L797-L829](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L797-L829)).
  Since 10.8.0 this covers CRUD saves, importers and direct `update_post_meta()` calls alike
  ([PR 64140](https://github.com/woocommerce/woocommerce/pull/64140)); in 10.5.0 to 10.7.x only CRUD saves scheduled
  them (same PR).
- It calls `wc_maybe_schedule_product_sale_events()`, which first unschedules every pending start and end event of the
  product, then schedules new ones when a date is set
  ([L767-L795](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L767-L795)).
- `wc_schedule_product_sale_events()` skips a date that is not in the future and skips scheduling when an identical
  pending action (same hook, args, group and timestamp) exists
  ([L578-L631](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L578-L631)).
  That duplicate check arrived in 11.0.0 ([PR 65709](https://github.com/woocommerce/woocommerce/pull/65709)).
- Scheduling does not look at the sale price, the product status or the product type; the handlers check those when
  they fire.
- Nothing else schedules them. A product whose date meta was written before 10.5.0 (or, before 10.8.0, written
  directly) and not written since has no events and depends on the daily action. PR 65797 proposed a backfill and was
  closed without merging ([PR 65797](https://github.com/woocommerce/woocommerce/pull/65797)).
- A meta write that leaves the value unchanged does not fire `updated_post_meta`: WordPress returns early when the
  single stored value is identical, and fires the action only when the database update changed a row
  ([meta.php L255-L263, L324-L329](https://github.com/WordPress/wordpress-develop/blob/7.1.2/src/wp-includes/meta.php#L255-L263)).
  Saving an unchanged product does not reschedule anything; changing a date does.

## What the per-product handlers do

`wc_handle_product_start_scheduled_sale( $product_id )`
([L687-L730](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L687-L730)):

1. Returns for a missing product and for variable and grouped products.
2. Returns when the sale price is empty (or `0`, which PHP treats as empty in that test).
3. Returns when the start is still in the future or the end has passed.
4. Returns when `_price` already equals the sale price.
5. Calls `wc_apply_sale_state_for_product( $product, 'start' )`.

`wc_handle_product_end_scheduled_sale( $product_id )`
([L732-L765](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L732-L765)):
returns for a missing, variable or grouped product, when the end is still in the future, or when `_price` already
equals the regular price; otherwise it calls `wc_apply_sale_state_for_product( $product, 'end' )`.

Action Scheduler passes the args array's values to the hook, so the handler receives the product ID as an integer
([ActionScheduler_Action.php L73-L87](https://github.com/woocommerce/action-scheduler/blob/4.0.0/classes/actions/ActionScheduler_Action.php#L73-L87)).
Because both handlers re-check the dates and prices, calling one for a product that is not due changes nothing. The
fix procedure relies on that ([fixes-and-rollback.md](fixes-and-rollback.md)).

## What `wc_apply_sale_state_for_product()` writes

([L633-L685](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L633-L685))

- `start`: when the sale price is truthy, sets the `price` prop, saves the product, and writes `_price` = sale price
  with `update_post_meta()`. The code comment explains the direct write: `_price` is not in the data store's
  meta-to-prop map, so a save that changes only `price` does not write it.
- `end`: sets the `price` prop to the regular price, saves, and writes `_price` = regular price.
- Both: refresh the product's `wc_product_meta_lookup` row (10.8.0 and later), delete the product's transients, and
  for a variation run `WC_Product_Variable::sync()` on the parent.
- Neither clears `_sale_price` or the dates. Since 10.5.0 the dates stay after a sale ends, on purpose, for stores that
  must show them ([issue 62130](https://github.com/woocommerce/woocommerce/issues/62130),
  [PR 62115](https://github.com/woocommerce/woocommerce/pull/62115)). Before 10.5.0 the daily run cleared the start
  date when a sale started and the sale price and both dates when it ended
  ([10.4.3 wc-product-functions.php](https://github.com/woocommerce/woocommerce/blob/10.4.3/plugins/woocommerce/includes/wc-product-functions.php)).

The save goes through the data store's `update()`. When only prices change it does not call `wp_update_post()`, so
`save_post` does not fire; it updates `post_modified` directly, calls `clean_post_cache()`, and fires
`woocommerce_update_product`
([class-wc-product-data-store-cpt.php L323-L398](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L323-L398)).
That matters for page caches ([caches-and-lookup.md](caches-and-lookup.md#page-caches)).

## What the daily safety net selects

`wc_scheduled_sales()` runs two queries and loops over each list
([L851-L904](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L851-L904)):

| Query | Selects a product when | Then | Source |
| --- | --- | --- | --- |
| `get_starting_sales()` | `_sale_price_dates_from` > 0 and < now, and `_price` != `_sale_price` | `wc_apply_sale_state_for_product( 'start' )` | [class-wc-product-data-store-cpt.php L1406-L1424](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L1406-L1424) |
| `get_ending_sales()` | `_sale_price_dates_to` > 0 and < now, and `_price` != `_regular_price` | `wc_apply_sale_state_for_product( 'end' )` | [L1432-L1450](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L1432-L1450) |

- Around each loop it fires `wc_before_products_starting_sales`, `wc_after_products_starting_sales`,
  `wc_before_products_ending_sales` and `wc_after_products_ending_sales` with the product IDs, and deletes the
  `wc_products_onsale` transient; the docblock notes these hooks fire only when the daily run finds products
  ([L845-L848](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/wc-product-functions.php#L845-L848)).
- The "now" in both queries is `time()` bound with `%s`, so the database compares the timestamps as strings
  ([PR 67958](https://github.com/woocommerce/woocommerce/pull/67958) describes this as deliberate). The SQL copies in
  `scripts/sale-state-checks.sql` keep that.
- Neither query checks the product type, so variable parents never match (they have no date meta) and variations do.

### The known faults of the daily queries in 11.1.2

1. **A completed sale is selected every day** ([issue 66720](https://github.com/woocommerce/woocommerce/issues/66720)).
   `get_starting_sales()` has no condition on the end date. Since 10.5.0 a sale that ended keeps its dates and sale
   price, so it matches "starting" (`_price` = regular != sale), the start loop writes the sale price, and the end
   loop, which runs next, writes the regular price back. Each daily run saves each such product twice, fires the four
   hooks with its ID, and leaves `_price` at the expired sale price between the two loops. The fix,
   [PR 67958](https://github.com/woocommerce/woocommerce/pull/67958), adds the missing end-date condition; it is
   milestoned 11.2.0 and present in the
   [11.2.0-beta.2 tag](https://github.com/woocommerce/woocommerce/blob/11.2.0-beta.2/plugins/woocommerce/includes/data-stores/class-wc-product-data-store-cpt.php#L1457-L1485),
   not in 11.1.2. A store owner in the issue reports 6,000 such products and a daily action that times out part way,
   leaving products at the sale price
   ([comment](https://github.com/woocommerce/woocommerce/issues/66720#issuecomment-5391885620)).
2. **An empty or `0` sale price with a start date is selected every day**
   ([issue 67995](https://github.com/woocommerce/woocommerce/issues/67995), open). The query matches `_price` != `''`,
   the start handler writes nothing for a falsy sale price, and the product matches again the next day. Each run with
   a match also deletes `wc_products_onsale` for the whole store.
3. **The daily run loads every selected product before saving any**, which can exhaust memory on a large backlog;
   [PR 68016](https://github.com/woocommerce/woocommerce/pull/68016) processes them in groups of 50 and is milestoned
   11.3.0.

The SQL blocks "Daily safety net, starting query" and "Count of rows each daily query returns" show how many products
each fault touches on the store.

## When the handlers write something wrong or nothing at all

| Cause | Effect | Evidence |
| --- | --- | --- |
| Queue not running | Events stay pending past their time; `_price` stays as it was | [runner-health.md](runner-health.md); SQL "still pending after their time" |
| No event for the product (dates older than 10.5.0, or direct writes before 10.8.0) | Only the daily action changes `_price`, up to a day late | SQL "Future sale boundaries with no pending event" |
| Sale price empty or `0` | Start handler writes nothing | SQL "Empty or zero sale price" |
| Sale price not below the regular price | `is_on_sale()` is false; a CRUD save that changes a price empties the sale price | [sale-data-model.md](sale-data-model.md#when-a-crud-save-writes-_price) |
| A plugin changes `_price` or filters `woocommerce_product_get_price` | Stored price matches neither price | `explain-sale-state.mjs` verdict `CUSTOM_PRICE`; list the callbacks on that filter |
| Bulk Edit changed a price | Both dates cleared, so the sale starts now and never ends | [issue 66696](https://github.com/woocommerce/woocommerce/issues/66696) and the note in [version-notes.md](version-notes.md) |
