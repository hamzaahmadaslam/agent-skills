# From the symptom to the cause

Read this at step 2 of the procedure, after the report has run. Each row names the first check and the file that
explains the result. The sources for each cause are in the linked reference file.

## Symptoms the owner reports

| Symptom | Most likely causes, in order | First check |
| --- | --- | --- |
| Sale did not start (regular price still shown) | Per-product event pending (queue stalled); no event (older dates); empty or `0` sale price; sale price not below regular; page cache | SQL "Stored _price disagrees" and "still pending after their time"; `explain-sale-state.mjs` |
| Sale did not end (sale price still charged) | Event pending; no event; the daily run timed out between its loops (10.5.0 to 11.1.x); page cache | Same, plus the daily action's rows and log |
| Sale started or ended at the wrong hour | Site timezone changed after the dates were set; fixed UTC offset in a region with daylight saving time; dates from the API or an importer; the owner reading another zone | `explain-sale-state.mjs` site-clock times; [timezones-and-dates.md](timezones-and-dates.md) |
| Sale ended a day early | CSV import with a date-only end value (00:00 site time) | `explain-sale-state.mjs` note "Ends at 00:00:00" |
| Sale started and ended up to a day late | No per-product event (dates older than 10.5.0, or direct writes before 10.8.0), so only the daily action applies it, at its own time of day | SQL "Future sale boundaries with no pending event"; the daily action's `local_time_of_day` |
| Sale started immediately or never ends | Bulk Edit changed a price and cleared both dates | Dates missing on a product that had them; [scheduled-events.md](scheduled-events.md#when-the-handlers-write-something-wrong-or-nothing-at-all) |
| Regular price struck through next to the same price | `is_on_sale()` true, `_price` still regular (before 11.1.0 on the page; on 11.1.x in feeds and lists) | SQL "Stored _price disagrees", finding "stored regular price, window open" |
| Product page right, shop sorting or price filter wrong | Lookup row stale | SQL "Lookup table disagrees" |
| Product page right, "On sale" block or shortcode wrong | Lookup `onsale` stale, or `wc_products_onsale` transient | Same; [caches-and-lookup.md](caches-and-lookup.md) |
| Variable product "From" price or badge wrong | Variation `_price` stale; parent rows not synced; `wc_var_prices_` transient; page cache | SQL variable parents block; [variable-products.md](variable-products.md) |
| Right after a save or for logged-in users, wrong for visitors | Page cache | `Age` and cache headers; [caches-and-lookup.md](caches-and-lookup.md#page-caches) |
| Right in WordPress, wrong in a feed, ERP or marketplace | The integration reads `_price` or a non-GMT REST date as UTC | Stored `_price`; the REST date fields in [timezones-and-dates.md](timezones-and-dates.md#rest-api-dates) |
| Many product webhooks or feed updates every night | Daily churn of completed sales (10.5.0 to 11.1.x), or the empty sale price shape | SQL "Count of rows each daily query returns" |
| The daily action fails or times out | Large daily selection (churn plus backlog); memory | Its log (`wp action-scheduler action logs <id>`); [runner-health.md](runner-health.md) |

## Reading the SQL blocks

| Block | A result means | Next |
| --- | --- | --- |
| Sale data summary | `price_disagrees` above 0 needs the listing below; `start_in_future` and `end_in_past` size the other checks | Stored `_price` block |
| Stored `_price` disagrees | Each row is a product whose shown, charged or listed price is wrong now, depending on version ([caches-and-lookup.md](caches-and-lookup.md#the-price-reconciler-1110-and-later)) | Its events, then F1 or F2 |
| Export | Input for `explain-sale-state.mjs`, tab-separated because the mysql client prints tab-separated results when its output is not a terminal ([MySQL manual](https://dev.mysql.com/doc/refman/8.4/en/mysql.html)); at most 2,000 rows | Run the helper with the site timezone |
| Daily starting query | Rows with the note are completed sales the daily run reprocesses (10.5.0 to 11.1.x); rows without the note are sales that have not started in `_price` | Rows without the note: F1 or F2 |
| Daily ending query | Sales that ended in time but kept the sale price | F1 or F2 |
| Counts of the daily queries | The number of products each daily run loads and saves | Hundreds or thousands on 11.1.x: plan the 11.2.0 update, watch the daily action's run time |
| Empty or zero sale price with a start date | The issue 67995 shape: reprocessed daily, never settles | F10 with the owner |
| Dates not digits, or end before start | Written by code or an importer; WooCommerce CRUD stores digits | F10 with the owner |
| End dates by UTC time of day | One dominant time is the editor's 23:59:59 site time; others show other writers or a timezone change | `explain-sale-state.mjs` per product |
| Lookup table disagrees | Sorting, filtering and "on sale" lists are wrong for these products | Fix `_price` first if it is wrong, then F4 |
| Variable parents | Parent range or rows differ from the variations, or the lookup range from the parent | F2 for variations, then F3, then F4 and F5 |
| Price transients | Only a count; with a persistent object cache these rows are leftovers | [variable-products.md](variable-products.md#the-price-transient) |
| Events by hook and status | Many `failed` rows: read one log; many `pending` in the past: the queue | [runner-health.md](runner-health.md) |
| Events pending after their time | The queue has not reached them; `claim_id` above 0 means a runner holds them now | Fix the runner, or F1 for a few |
| Duplicate pending events | The issue 63517 shape; harmless | F7 (no change) |
| Future boundaries with no pending event | These products change only with the daily action | F8 |
| Daily action rows | `local_time_of_day` far from 00:00:00, `failed` rows, or no `pending` row | F9, [runner-health.md](runner-health.md) |
| Queue health | Pending actions over an hour late, or no completion for hours | `wp-cron-action-scheduler-health` skill |

## Reading `explain-sale-state.mjs`

| Verdict | Meaning |
| --- | --- |
| `OK` | Stored `_price` equals what `is_on_sale()` implies at the audit time |
| `STALE_REGULAR_PRICE` | Window open, regular price stored: the start was not applied |
| `STALE_SALE_PRICE` | Window closed, sale price stored: the end was not applied, or a start was applied early |
| `CUSTOM_PRICE` | Stored price matches neither; a plugin may set it on purpose. Find the writer before changing it |
| `NO_STORED_PRICE` | No `_price`; the product has no price for sorting and filtering |
| `BAD_DATES` | A date is not a Unix timestamp |
| `DERIVED` | Variable or grouped parent; read the variable parents block |

Notes under a row point to known shapes (issues 66720 and 67995), to boundaries at unusual site-clock times, and to
the time left until the next boundary. A note on an `OK` row can still matter: a completed sale on 11.1.x is `OK`
and is reprocessed every night.
