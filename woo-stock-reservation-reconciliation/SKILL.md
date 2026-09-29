---
name: woo-stock-reservation-reconciliation
description: "Explain why a WooCommerce store holds units back and reconcile stock without overselling. Covers the wc_reserved_stock table (which checkouts write rows, expiry, which rows still count, why old rows stay), checkout-draft and pending orders, the Hold stock (minutes) setting and the woocommerce_cancel_unpaid_orders action (what it cancels, what it skips), _stock against what shoppers can buy, when stock is reduced and restored (wc_maybe_reduce_stock_levels, the order flag and the _reduced_stock item meta, cancel, failed, refund restock), and HPOS against posts storage. Read-only report first (WP-CLI and SELECT queries for both storages, a ledger per product, a comparison with the owner's shelf count), then each correction as its own owner-approved step with a backup, a check and an undo. Use when the product page says in stock but checkout says not enough, when a shopper is blocked by their own unpaid order, when unpaid orders never cancel, when _stock drifts from the shelf, or after an oversell."
license: MIT
compatibility: "Needs shell access with WP-CLI to the store or a staging copy, the mysql client that wp db query uses, and Node.js 20 or later for the count comparison. Written against WooCommerce 11.1.2 (Action Scheduler 4.0.0) and WordPress 7.1.2; references/version-notes.md lists what differs on older releases."
metadata:
  author: Hamza Ahmad Aslam
  version: "1.0.0"
  last_verified: "2026-09-29"
---

# WooCommerce stock reservation reconciliation

This skill explains where a store's units are at any moment (on the shelf, held by an unpaid checkout, taken off by a
paid order) and brings `_stock` back in line with reality without selling units twice. It reads first: a report of
the reservation table, the unpaid orders, the cancel action and every order whose line items disagree with its status,
then a ledger per product that can be compared with the owner's shelf count. Each correction it proposes is a separate
step with a backup, a check and an undo, and waits for the owner's approval. It does not change WooCommerce code or
install plugins.

It is written for coding agents that support the Agent Skills format, and a person can follow it the same way. Facts
are sourced in `references/`, next to each fact, from the WooCommerce 11.1.2 source, Action Scheduler 4.0.0, WordPress
7.1.2 and the WP-CLI and MySQL documentation.

## When to use

- The product page shows "5 in stock" and the cart or checkout says "we do not have enough ... in stock (0 available)".
- A shopper who left a payment page cannot buy the item they held themselves.
- Pending payment orders pile up and are never cancelled, or held units never come back.
- `_stock` in WooCommerce differs from what is on the shelf, or two customers bought the last unit.
- After changing the "Hold stock (minutes)" setting, a payment gateway, the order storage (HPOS) or an inventory sync.

Related skills in this collection: `woo-checkout-performance-audit` (slow checkouts and lock waits, the
`wc_reserved_stock` index), `woo-hpos-live-migration` (moving orders between storages),
`wp-cron-action-scheduler-health` (the queue that runs the cancel action) and `wp-slow-query-investigation` (one slow
query).

## Safety rules

1. Read-only by default. Before any change, state the step, its backup, its check and its undo, and wait for the
   owner's approval of that step. One approval covers one step.
2. Never delete a reservation row whose order is still draft or pending and whose hold has not expired. It is a live
   hold: deleting it lets another shopper buy the same unit. Free such units by cancelling the order through
   WooCommerce, with approval.
3. Never write `_stock` with SQL. Corrections go through the product edit screen or `wc_update_product_stock()`, one
   product per step, with the old value recorded first
   ([changes-and-rollback.md](references/changes-and-rollback.md)).
4. The shelf count and the list of statuses that mean "not shipped yet" are the owner's. The helpers compute
   differences; they never decide a stock level.
5. Order data is personal data. The scripts print IDs, statuses, dates and numbers, never names, emails or addresses.
   Keep reports, ledgers and database exports out of chats, tickets and repositories, and delete them after the work.
6. Run the scanning SQL on a replica or staging copy, or at a quiet hour. Run every change at a quiet hour, since
   orders placed during a correction change the numbers under it.
7. Multisite: every site has its own tables and options. Pass `--url=<site>` to every WP-CLI command.
8. Staging first for anything that can be tried there. A backup counts after one test restore on staging.

## Where units go

| Area | How it shows | First check | Read |
| --- | --- | --- | --- |
| Reservation rows | Page says in stock, checkout says not enough | Rows by order status, live holds per product | `references/how-reservations-work.md` |
| Storefront against buyable | Different numbers on the page and in the cart | Live holds per product against `_stock` | `references/availability.md` |
| Unpaid orders and the cancel action | Pending orders never cancelled; holds last longer than the setting | Hold minutes in effect, cancel action next run and failures, orders past the hold time | `references/orders-and-cancellation.md` |
| Reduction and restore | `_stock` too high (oversell) or too low (lost sales) | `_reduced_stock` on unpaid, cancelled or failed orders; paid orders without it | `references/stock-reduction-and-restore.md` |
| Order storage | SQL returns nothing, or stale data | `woocommerce_custom_orders_table_enabled` | `references/storage-hpos-and-posts.md` |
| Known bugs and open fixes | A shopper blocked by their own hold; Store API offers a fully held product | Version and the two open pull requests | `references/known-issues.md`, `references/version-notes.md` |

## Procedure

### 0. Record the setup (read-only)

```sh
bash scripts/reservation-readonly-report.sh --path=/path/to/wordpress   # add --url=<site> on multisite
```

The report prints versions, "Manage stock", "Hold stock (minutes)" and the stock display format, which order storage
is authoritative and whether compatibility mode is on, the next run and failed runs of
`woocommerce_cancel_unpaid_orders`, the callbacks on the filters that change holds, reductions and restores, and the
SELECT blocks of `scripts/reservation-checks.sql` for the matching storage. `RESERVATION_REPORT_SKIP_SCANS=1` skips
the blocks that read many rows; `RESERVATION_REPORT_SKIP_SQL=1` skips all SQL. One block can run alone through
`wp db query` after filling in `{prefix}`.

Then read `references/version-notes.md` for the store's version: auto-cancellation of block checkout orders (10.6.0),
draft orders only at place-order time (10.9.0), the lock change (11.0.0) and the restore on failed orders (11.0.0)
change what the report means.

A callback on `woocommerce_query_for_reserved_stock`, `woocommerce_hold_stock_for_checkout`,
`woocommerce_order_hold_stock_minutes` or `woocommerce_cancel_unpaid_order` changes the rules this skill describes.
Name the plugin that adds it and read its code before trusting the SQL.

### 1. Read the reservation table (read-only)

From the report: the database clock, rows in total, expired rows, rows by order status, and rows that no longer count.
Only rows of draft or pending orders with `expires > NOW()` hold units. Expired rows, rows of failed orders and rows
of deleted orders stay in the table because WooCommerce deletes rows only by order, on a status change or a checkout
error; they take space and change nothing for shoppers. Compare `expires` with the database's `NOW()` only, never
with the site's clock. Details: `references/how-reservations-work.md`.

### 2. Compare what the page shows with what shoppers can buy (read-only)

The product page shows `_stock`. The cart, checkout and order-pay checks, and the Store API limits, use `_stock` minus
the live holds of other orders. From the "Live holds per product" block, note every product whose live holds reach
`_stock` while its status is still `instock`, and the orders holding it. The "same billing email" block finds a shopper
held back by their own older unpaid orders (issue 67354; the classic cart check excludes only one of the shopper's
orders, and in 11.1.2 it can exclude none). Details: `references/availability.md`.

### 3. Check the unpaid orders and the cancel action (read-only)

- The hold minutes in effect: blank means no holds and no cancel action at all.
- The cancel action: a next run within the hold minutes, no failures, recent completed runs. Missing or late runs mean
  the Action Scheduler queue does not run; hand that to the `wp-cron-action-scheduler-health` skill.
- "Unpaid orders past the hold time": pending orders from `checkout` or `store-api` should be close to zero on a
  working queue. Drafts are never cancelled by this action (the daily draft clean-up deletes them after a day), and
  orders from other sources are left alone by design. The age counts from the order's last change, not its creation.
- On-hold orders by age: they are never auto-cancelled, and they already took their units off `_stock` (bank transfer
  orders start on-hold). Old ones are the owner's to chase or cancel.

Details: `references/orders-and-cancellation.md`.

### 4. Check the deducted units against order status (read-only)

The item meta `_reduced_stock` records what each line item took off `_stock`; the order-level flag is a hint only,
because WooCommerce sets it even when nothing was reduced and clears it even when nothing was restored.

- "Units still deducted by draft, pending, cancelled or failed orders": units taken off `_stock` for orders that should
  not hold them. `_stock` is too low by that amount, unless the owner already corrected it by hand.
- "Paid orders ... never deducted": processing, completed or on-hold orders with stock-managed items and no
  `_reduced_stock`. `_stock` is too high by that amount: the oversell risk. Find the cause first (stock management
  switched off at the time, a filter, an import).
- The flag block shows how far the two records disagree; use it to explain, not to fix.

Details: `references/stock-reduction-and-restore.md`.

### 5. Compare with a shelf count (read-only; the count is the owner's)

When the owner has counted the shelf, run the ledger right after the count, at a quiet hour:

```sh
sed 's/{prefix}/wp_/g' scripts/stock-ledger-hpos.sql | wp db query > ledger.tsv     # posts storage: stock-ledger-posts.sql
node scripts/reconcile-counts.mjs --ledger=ledger.tsv --counts=counts.csv
```

Replace `wp_` with the store's prefix. The count file is CSV with `product_id` or `sku` and `counted`, one line per
product or variation that manages its own stock. The helper works out the expected `_stock` as the counted units minus
the units of orders that took stock but have not shipped (processing and on-hold by default; the owner sets the list
with `--unshipped`), prints each difference, and lists count lines that match nothing. A positive difference means
`_stock` is higher than the shelf supports; a negative one means lost sales. Reservations never changed `_stock` and
are not part of the expected value. `examples/` has a synthetic ledger, count file and the output they produce.

### 6. Decide with the owner

Put each finding in front of the owner with its number, its cause and the change that would fix it. Typical
decisions:

- cancel named unpaid orders that hold units and will not be paid;
- catch up the cancel action once, after the queue works again;
- a different hold time (longer protects slow payers, shorter frees units and cancels sooner);
- give back units still deducted by cancelled or failed orders, or deduct units a paid order never took;
- set `_stock` to the counted value for the products the owner accepts;
- remove rows that no longer count, as housekeeping only.

Leave alone: live holds of orders that may still be paid, and old orders the owner chooses not to touch (one `_stock`
correction can cover them instead).

### 7. Make one change (change)

Take the step from `references/changes-and-rollback.md`, which gives each change its backup, its check and its undo:
cancel chosen unpaid orders, run the cancellation now, change the hold time, remove rows that no longer count, set
`_stock` to a counted value, give back units of unpaid or cancelled orders, deduct units a paid order never took. State
all four parts and wait for approval. One change per approval.

### 8. Re-run and report

Re-run the report (and the ledger when stock was set) after each change and fill in the "after" column. A change whose
check fails is undone with its undo before anything else happens.

## Reference files

| File | Read it when |
| --- | --- |
| `references/how-reservations-work.md` | Step 1: the table, when rows are written and deleted, which rows count, the clock |
| `references/availability.md` | Step 2: the page against the cart, whose holds are excluded, the Store API limit |
| `references/orders-and-cancellation.md` | Step 3: order statuses, the hold setting, the cancel action, draft clean-up |
| `references/stock-reduction-and-restore.md` | Step 4, and before any `_stock` correction |
| `references/storage-hpos-and-posts.md` | Before any SQL: which tables, placeholders, output format |
| `references/known-issues.md` | A report matches a known bug; the open pull requests |
| `references/changes-and-rollback.md` | Step 7: every change with its backup, check and undo |
| `references/version-notes.md` | Step 0, and any store older than WooCommerce 11.1.2 |
| `scripts/reservation-readonly-report.sh` | Step 0 and after each change (read-only) |
| `scripts/reservation-checks.sql` | The SELECT blocks the report runs; usable alone with `{prefix}` filled in |
| `scripts/stock-ledger-hpos.sql`, `scripts/stock-ledger-posts.sql` | Step 5: one row per stock-managed product (read-only) |
| `scripts/reconcile-counts.mjs` | Step 5: ledger against the owner's count (read-only, local files) |
| `examples/ledger.tsv`, `examples/counts.csv`, `examples/reconcile-output.txt` | Synthetic input for the helper and the output it gives |

## Report format

End every session with this report, filled in from command output, never from memory:

```text
Stock reservation report: <site> (<date, UTC>)
Environment: WooCommerce <v>, WordPress <v>; orders <HPOS|posts>, compatibility mode <on|off>;
             Manage stock <yes|no>; Hold stock <minutes|blank>; cancel action next run <time|none>
Database clock: NOW() <value>, UTC <value>

| Metric                                                   | Before | After | Source                          |
| -------------------------------------------------------- | ------ | ----- | ------------------------------- |
| Reservation rows / not expired / not counting            |        |       | reservation-checks.sql          |
| Products with live holds / fully held while instock      |        |       | Live holds per product          |
| Products held by 2+ unpaid orders of one billing email   |        |       | same billing email block        |
| Pending orders past the hold time (would cancel / not)   |        |       | Unpaid orders past the hold time|
| Cancel action failures / last completed run              |        |       | wp action-scheduler             |
| On-hold orders over 7 days / units they deducted         |        |       | On-hold orders by age           |
| Units still deducted by unpaid, cancelled, failed orders |        |       | Units still deducted block      |
| Paid orders (90 days) with items never deducted / units  |        |       | Paid orders block               |
| Counted products: matching / differing / unmatched       |        |       | reconcile-counts.mjs            |

Findings (largest effect on buyable units first):
- <finding>: <number and where it was read> -> <cause> (<reference file or source>)
Changes made: <change> | backup <file or record, restore tested yes/no> | check <result> | undo <tested yes/no>
Not changed, owner decision needed: <item, trade-off>
Next step: <step, its backup, its check, its undo> (needs approval: yes/no)
Files to delete after the work: <reports, ledger.tsv, counts, exports>
```
