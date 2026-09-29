---
name: woo-scheduled-sale-state-audit
description: "Find why a WooCommerce scheduled sale starts, ends or shows at the wrong time, or why the stored _price disagrees with the sale window, with a read-only audit first and a backup, a check and an undo for every fix. Covers the _regular_price, _sale_price, _price and _sale_price_dates_from/_to meta (UTC timestamps) against the site timezone, the per-product Action Scheduler events wc_product_start_scheduled_sale and wc_product_end_scheduled_sale, the daily woocommerce_scheduled_sales safety net and its known faults in 10.5.0 to 11.1.x, variable products (variation prices, the parent's _price rows, the wc_var_prices transient), the wc_product_meta_lookup price columns, object and page caches, and a stalled WP-Cron or Action Scheduler queue. Use when a sale did not start or end, started at the wrong hour or a day off, shows a struck-through price equal to the price, sorts or filters at the old price, when a variable product's range is wrong, or when the daily sales action runs long or fails."
license: MIT
compatibility: "Needs shell access with WP-CLI to the store or a staging copy, the mysql client that `wp db query` uses (MySQL 5.7+ or MariaDB 10.2+), and Node.js 20 or later for the per-product explainer. Written against WooCommerce 11.1.2 (Action Scheduler 4.0.0) and WordPress 7.1.2; references/version-notes.md lists what differs from 10.1.0 on."
metadata:
  author: Hamza Ahmad Aslam
  version: "1.0.0"
  last_verified: "2026-09-29"
---

# WooCommerce scheduled sale state audit

This skill finds why a scheduled sale shows, charges or lists the wrong price at a given moment, product by product,
and fixes the stored state through WooCommerce's own code. It reads and compares by default. Each fix it proposes
comes with a backup, a check and an undo, and waits for the owner's approval. It does not change prices or dates the
owner set: it shows which stored value disagrees with the sale window, why, and which WooCommerce function puts it
right.

It is written for coding agents that support the Agent Skills format, and a person can follow it the same way. Facts
are sourced in `references/`, next to each fact, from the WooCommerce 11.1.2 source, the Action Scheduler 4.0.0
source, the WordPress 7.1.2 source, WP-CLI documentation, and the WooCommerce issues and pull requests that changed
this code in 2026.

## When to use

- A scheduled sale did not start or did not end, or started or ended at the wrong hour or a day off.
- The product page shows the regular price struck through next to the same price, or a sale price with no strike.
- Shop sorting, the price filter or an "On sale" list uses the old price while the product page is right.
- A variable product's "From" price, range or sale badge is wrong.
- The daily `woocommerce_scheduled_sales` action runs for a long time, fails or times out, or product webhooks and
  feed updates fire every night for products nobody changed.
- A feed, ERP or marketplace receives a different price or sale date than the store shows.

Related skills in this collection, for work outside this audit: `wp-cron-action-scheduler-health` (making the
WP-Cron and Action Scheduler runner reliable), `woo-checkout-performance-audit` (checkout speed, including Action
Scheduler load) and `wp-slow-query-investigation` (one slow SQL query).

## Safety rules

1. Read-only by default. Before any change, state the step, its backup, its check and its undo, and wait for the
   owner's approval of that step. One approval covers one step; a batch of products is one step only when the owner
   approved the list.
2. Never write `_price` or other product meta with SQL. Fix through WooCommerce functions, which keep the lookup
   table, transients, object cache and events in step (`references/fixes-and-rollback.md`).
3. Never run the daily action or `wc_scheduled_sales()` by hand on WooCommerce 10.5.0 to 11.1.x to catch up: it
   saves every product with a completed sale twice and fires the sale hooks for each (issue 66720).
4. Never change the site timezone, sale dates or prices to "fix" a timing report. Those are the owner's decisions;
   the audit shows the stored instants in UTC and in site time.
5. Fix one product first, check it, then the rest in batches of at most 50. Every save fires
   `woocommerce_update_product`, so webhooks and sync plugins receive an update per product; tell the owner first.
6. Back up before each change (B1 to B4 in `references/fixes-and-rollback.md`). Keep backups outside the web root
   and delete them when the owner accepts the fix.
7. Staging first when the store has one. Loading WordPress with WP-CLI runs the site's code; the report script turns
   off the WP-Cron spawn for its own calls.
8. Multisite: every site has its own tables, timezone and queue. Pass `--url=<site>` to every WP-CLI command.
9. Examples in this skill are synthetic. Do not paste real product data into tickets or chats; the report holds IDs,
   prices and dates only.

## Where a sale's state can go wrong

| Area | How it shows | First check | Read |
| --- | --- | --- | --- |
| Stored meta and the sale rules | `_price` differs from what `is_on_sale()` implies now | SQL "Stored _price disagrees", `explain-sale-state.mjs` | `references/sale-data-model.md` |
| Timezone and date shape | Boundaries at the wrong hour or a day off | Site-clock times in `explain-sale-state.mjs`, SQL end-time block | `references/timezones-and-dates.md` |
| Per-product events | Event pending after its time, missing, duplicated | SQL event blocks | `references/scheduled-events.md` |
| Daily safety net | Long or failing daily run; completed sales reprocessed; action at an odd time | SQL daily blocks, the action's log | `references/scheduled-events.md`, `references/timezones-and-dates.md` |
| Variable products | Parent range, badge or sorting wrong | SQL variable parents block | `references/variable-products.md` |
| Lookup table, transients, caches | Lists, sorting or pages wrong while the meta is right | SQL lookup block, headers | `references/caches-and-lookup.md` |
| Queue runner | Everything late, many pending actions | SQL queue line, `wp action-scheduler` | `references/runner-health.md` |

## Procedure

### 0. Record the setup (read-only)

```sh
bash scripts/sale-readonly-report.sh --path=/path/to/wordpress            # add --url=<site> on multisite
SALE_AUDIT_PRODUCTS=101,102 bash scripts/sale-readonly-report.sh --path=/path/to/wordpress
```

The report prints WordPress, WooCommerce and Action Scheduler versions, `timezone_string`, `gmt_offset` and the site
time now, the WP-Cron constants and runner event, the pending daily action and the count of pending per-product
events, the object cache type, for listed products their five meta values, dates in site time and UTC,
`is_on_sale()` and the view price, then every SELECT block in `scripts/sale-state-checks.sql` at the audit time.
`SALE_AUDIT_AT=<unix>` audits another moment (for example the minute after a boundary); `SALE_AUDIT_SKIP_SQL=1`
skips the SQL. On a big store run it on a replica or staging copy, or at a quiet hour.

Then read `references/version-notes.md` and note which rows apply to the store's WooCommerce version. The procedure
differs before 10.5.0 (no per-product events), before 10.8.0 (no lookup refresh in the handlers, no events for direct
meta writes), before 11.1.0 (the page and cart show the stale price) and before 11.2.0 (the daily churn).

### 1. Pin down the claim (read-only)

Ask for, or find: which products, what the owner expected (price and time, in which timezone), what they saw, where
(product page, category page, cart, feed, API) and when. Convert the expected time to UTC with the site timezone from
step 0. A report of "an hour early" is often a device in another zone, or a fixed UTC offset across a daylight saving
change (`references/timezones-and-dates.md`).

### 2. Compare the stored state with the rules (read-only)

- Read the SQL "Sale data" summary and "Stored _price disagrees" blocks.
- Export the rows and explain them per product:

  ```sh
  SALE_AUDIT_BLOCK=Export bash scripts/sale-readonly-report.sh --path=/path/to/wordpress > sale-rows.tsv
  node scripts/explain-sale-state.mjs sale-rows.tsv --tz=<timezone_string or +HH:MM> --only=problems
  ```

  The helper prints each product's window in site time and UTC, the price WooCommerce expects at the audit time, the
  stored `_price`, a verdict, and notes for the known shapes. `examples/` holds synthetic input and its output.
- Match what you find to the owner's symptom with `references/diagnosis.md`.

### 3. Events for the affected products (read-only)

From the SQL event blocks: are the products' `wc_product_*_scheduled_sale` events pending after their time, complete,
failed, duplicated, or missing for a future boundary? Read the log of a failed one with
`wp action-scheduler action logs <id>`. What each state means: `references/scheduled-events.md`.

### 4. The daily safety net (read-only)

From the SQL daily blocks: how many products each daily query selects now, how many of the "starting" rows are
completed sales (the issue 66720 note), empty or `0` sale prices with a start date (issue 67995), the daily action's
local time of day, its recent statuses and its last attempt. A large selection on 10.5.0 to 11.1.x explains nightly
product updates and long or failing runs. Details: `references/scheduled-events.md`.

### 5. The queue (read-only)

The one-line queue check and the runner event from step 0. Pending actions more than an hour late, or no completion
for hours, mean sales wait for the runner: hand the runner to the `wp-cron-action-scheduler-health` skill, and read
`references/runner-health.md` for what a stalled or failing queue does to sales, including a recurring action that
stops recurring after five failures.

### 6. Variable products, lookup table and caches (read-only)

- Variable parents block: variation `_price` against the parent's rows and the lookup range
  (`references/variable-products.md`).
- Lookup block: rows whose `min_price`, `max_price` or `onsale` disagree with `_price`
  (`references/caches-and-lookup.md`).
- Object cache type from step 0, and whether anything writes product meta by SQL.
- Page cache: request an affected product and category page twice and read `Age` and cache-status headers; check
  which hooks the cache purges on.

### 7. Write the findings and the fix plan

Per product or per group: the finding, the evidence (block and row, or helper verdict), the cause, and the fix from
`references/fixes-and-rollback.md` (F1 to F11) with its backup, check and undo. Order: queue first (if stalled), then
`_price` (F1, F2), then variable parents (F3), then lookup rows (F4), then transients and page cache (F5, F6), then
missing events (F8), then data shapes the owner decides (F10), then the daily action time (F9) and the WooCommerce
update (F11) as separate changes.

### 8. Make one change (change)

State the step's backup, check and undo and wait for approval. Fix one product, run its check, then the approved
batch. The fix commands call WooCommerce's own functions: the per-product sale handlers (10.5.0 and later),
`WC_Product_Variable::sync()`, `refresh_product_lookup_table()` (10.8.0 and later), `wc_delete_product_transients()`
and `wc_maybe_schedule_product_sale_events()` (10.5.0 and later).

### 9. Re-check and report

Run the report again with the same `SALE_AUDIT_AT` and a second time with the current time, and the explainer on a new
export. Every fixed product should read `OK`, its lookup row should match, and its events should be pending for its
future boundaries. A fix that did not change its check is undone with its undo and reported.

## Reference files

| File | Read it when |
| --- | --- |
| `references/sale-data-model.md` | Always first: the meta keys, when `_price` is written, `is_on_sale()`, how dates reach the meta, who reads what |
| `references/timezones-and-dates.md` | Wrong hour, a day off, a timezone change, the daily action's time of day, REST dates |
| `references/scheduled-events.md` | Steps 3 and 4: per-product events, the handlers, the daily queries and their known faults |
| `references/variable-products.md` | Variable product range, badge or sorting wrong |
| `references/caches-and-lookup.md` | Step 6: lookup table, reconciler, transients, object cache, page caches |
| `references/runner-health.md` | Step 5: what a stalled or failing queue does to sales |
| `references/diagnosis.md` | Step 2: symptom to cause; how to read every SQL block and verdict |
| `references/fixes-and-rollback.md` | Steps 7 and 8: every fix with its backup, check and undo |
| `references/version-notes.md` | Step 0, and any store older than WooCommerce 11.1.2; the 2026 regressions and what is still open |
| `scripts/sale-readonly-report.sh` | Step 0 and step 9 (read-only) |
| `scripts/sale-state-checks.sql` | The SELECT blocks the report runs; usable alone with `{prefix}` and `{now}` filled in |
| `scripts/explain-sale-state.mjs` | Step 2: per-product explanation of exported rows (read-only, local file) |
| `examples/synthetic-sale-rows.tsv` | Synthetic input for the explainer; `examples/synthetic-sale-rows-explained.txt` is its output with `--tz=America/New_York --at=2026-11-15T12:00:00Z` |

The SQL placeholders: `{prefix}` is the site's table prefix from `wp db prefix` (per site on multisite), and `{now}`
is the audit time in Unix seconds (`date -u +%s`). The report script fills both, checks that the prefix holds only
letters, digits and underscores and that the time is a plain number, and runs one block at a time through
`wp db query`.

## Report format

End every session with this report, filled in from command output and the helper, never from memory:

```text
Scheduled sale state report: <site> (<date, UTC>)
Environment: WooCommerce <v>, WordPress <v>, Action Scheduler <v>; timezone <timezone_string | fixed offset>;
             object cache <type|none>; page cache <layer>; WP-Cron <page views | server cron | disabled>
Audit time: <UTC> = <site time>; products named by the owner: <ids or "none">

| Check                                              | Before | After | Source                                   |
| -------------------------------------------------- | ------ | ----- | ---------------------------------------- |
| Products and variations with sale data             |        |       | SQL summary                              |
| Stored _price disagrees with the window            |        |       | SQL block / explainer verdicts           |
| Per-product events pending past their time          |        |       | SQL events pending after their time      |
| Future boundaries with no pending event            |        |       | SQL future boundaries                    |
| Daily query rows: starting / of which completed    |        |       | SQL daily starting query and counts      |
| Daily query rows: ending                           |        |       | SQL daily ending query                   |
| Empty or 0 sale price with a start date            |        |       | SQL block                                |
| Lookup rows disagreeing with _price                |        |       | SQL lookup block                         |
| Variable parents out of step                       |        |       | SQL variable parents block               |
| Daily action: local time / last status             |        |       | SQL daily action rows                    |
| Pending actions over 1 hour late (all hooks)       |        |       | SQL queue line                           |

Findings (most shoppers affected first):
- <product ids or group>: <what is shown or charged, where> -> <cause> (<block or verdict>; <reference file>)
Changes made: <F-step> on <ids> | backup <file, tested yes/no> | check <result> | undo <tested yes/no>
Not changed, owner decision needed: <item, trade-off>
For the host, developers or vendors: <runner, cache purge hooks, integrations reading _price or REST dates>
Next step: <step, its backup, its check, its undo> (needs approval: yes/no)
Files to delete after the audit: <exports, backups>
```
