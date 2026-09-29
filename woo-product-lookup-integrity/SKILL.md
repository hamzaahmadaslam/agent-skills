---
name: woo-product-lookup-integrity
description: "Prove row by row whether WooCommerce's product lookup tables match the products they are built from. Compares each row of wc_product_meta_lookup (SKU, prices, on-sale flag, stock, ratings, sales, tax) with post meta, and each row of wc_product_attributes_lookup (the table behind attribute filters) with term relationships, _product_attributes and variation values, then sorts mismatches into classes: missing rows, rows of deleted or trashed products, stale values, wrong or deleted terms, stale stock flags, and an empty _price no regeneration fixes. Read-only SQL, a WP-CLI report, a per-product diff built with WooCommerce's own rules, and a before and after comparison. Covers the Status > Tools regenerations, wp wc palt, wp wc tool run, the Action Scheduler jobs, direct and scheduled updates and the optimized path, each write with a backup, a check and an undo. Use when attribute or price filters or sorting show wrong products, after imports or direct database edits, and around any regeneration."
license: MIT
compatibility: "Needs WP-CLI access to the store or a staging copy, the mysql or mariadb client that wp db query uses, MySQL 8.x or MariaDB 10.6 or later, and Node.js 20 or later for the report summary. Written against WooCommerce 11.1.2 with products stored as posts, WordPress 7.1.2 and Action Scheduler 4.0.0; references/version-notes.md lists what differs on other releases."
metadata:
  author: Hamza Ahmad Aslam
  version: "1.0.0"
  last_verified: "2026-09-29"
---

# WooCommerce product lookup table integrity

WooCommerce keeps two copies of product data for fast queries: `{prefix}wc_product_meta_lookup` for prices, stock,
SKU and ratings, and `{prefix}wc_product_attributes_lookup` for attribute filters. When a copy drifts from the
products, shoppers see wrong prices in filters, products missing from attribute filters, or terms they cannot buy.
Row counts and a regeneration are the usual answer; this skill checks each row against the post meta, terms and
variations it was built from, names the class of every mismatch, and proves a repair worked by running the same checks
again.

It reads by default. Every write it proposes (a regeneration, a row refresh, a price rebuild, a delete of orphan rows,
a setting) comes with a backup, a check and an undo, and waits for the owner's approval. It does not edit plugins or
themes: when code writes product data around WooCommerce, it names the evidence and leaves the fix to that code's
developer.

It is written for coding agents that support the Agent Skills format, and a person can follow it the same way. Facts
are sourced in `references/`, next to each fact, from the WooCommerce 11.1.2 source, WordPress 7.1.2, Action
Scheduler 4.0.0, the WP-CLI and MySQL documentation, and the WooCommerce issues that report these faults.

## When to use

- Attribute filters (layered navigation, the product filter blocks) miss products, show wrong counts, or offer terms
  that lead to nothing.
- Price filters, price sorting or popularity sorting place products wrong; a product shows no price or no Add to cart
  button although its regular price is set.
- After a product import, a migration, a bulk edit with SQL or a plugin that writes post meta directly.
- `wp wc palt info` shows fewer products than the catalog has, or the table is empty.
- Before and after any regeneration of either table, to prove what it changed.

Related skills in this collection: `wp-slow-query-investigation` sizes these tables and fixes slow queries on them
(this skill checks correctness only), and `wp-cron-action-scheduler-health` fixes a queue that does not run, which
leaves regenerations and scheduled lookup updates waiting.

## Safety rules

1. Read-only by default. The helpers in `scripts/`, `SELECT` statements and WP-CLI read commands need no approval.
   Everything else needs the owner's approval for that step, with its backup, check and undo stated first
   (`references/changes-and-rollback.md`). One approval covers one step.
2. Staging first. Restore a recent production copy, run the report, repair there, verify, and only then repeat the
   approved step on production at a quiet hour.
3. Back up before each write: a one-table export of the lookup table it touches, plus any option or post meta it
   changes. A backup counts once it has been restored on staging.
4. Never run a full regeneration while another is in progress, and never delete WooCommerce's progress options by
   hand to "unstick" one; use `wp wc palt abort_regeneration` and `resume_regeneration`.
5. Do not judge rows while a regeneration runs or lookup updates wait in Action Scheduler. Check the report's options
   and queue blocks first.
6. No customer data is involved: the checks read catalog tables. Keep reports and exports off shared drives anyway
   and delete them when the owner's retention period ends. Examples in this skill are synthetic.
7. Multisite: every site has its own tables. Pass `--url=<site>` to every WP-CLI command.

## What gets checked

| Table | What goes wrong | First check | Read |
| --- | --- | --- | --- |
| Both | Work in flight: regeneration running or aborted, lookup updates queued or failed | Report: options, Action Scheduler and log blocks | `references/regeneration.md` |
| `wc_product_meta_lookup` | Missing rows, orphan rows, stale values per column, empty `_price` | `meta.*` Detail blocks | `references/meta-lookup-rules.md` |
| `wc_product_attributes_lookup` | Products or variations missing from filters, rows for lost or deleted terms, wrong parent, stale `in_stock`, orphan rows | `attr.*` Detail blocks | `references/attributes-lookup-rules.md` |
| One product | Exact expected rows against the table, path differences | `scripts/lookup-product-diff.php` | `references/mismatch-classes.md` |
| Structure | Missing primary key, repeated rows, unexpected indexes | Index and "repeating the same key" blocks | `references/lookup-tables.md` |

## Procedure

### 0. Record the setup and take the "before" report (read-only)

```sh
bash scripts/lookup-readonly-report.sh --path=/path/to/wordpress > lookup-report-before.txt   # add --url=<site> on multisite
node scripts/summarise-lookup-report.mjs lookup-report-before.txt
```

The report prints versions, `wp wc palt info`, pending and failed lookup actions, then every block of
`scripts/lookup-checks.sql`: settings, queue, log, sizes, indexes, table contents, and one full count plus up to 200
listed rows (`LOOKUP_DETAIL_LIMIT`) per mismatch class. Blocks marked "(scan)" read whole tables: on a big store run
the report on a replica or staging copy, or at a quiet hour. Then read `references/version-notes.md`: several checks
depend on the release (for example `global_unique_id` from 9.2.0, disabled variations from 11.3.0).

### 1. Rule out work in flight (read-only)

- `woocommerce_product_lookup_table_is_generating` set, or pending actions in the group
  `wc_update_product_lookup_tables`: a meta regeneration is running.
- `woocommerce_attribute_lookup_regeneration_in_progress` or `_regeneration_aborted` set: an attributes regeneration
  runs or stopped halfway, and table usage is off.
- Pending or failed `woocommerce_run_product_attribute_lookup_update_callback` actions: those products' rows wait for
  the queue. Failed ones and `palt-updates` log entries point to the products to look at first.

If a regeneration is running, wait for it and take the report again. If the queue is not moving, stop here and hand
the queue to the `wp-cron-action-scheduler-health` skill: every repair below depends on it, except the WP-CLI runs.

### 2. Read the meta lookup classes

From the report and the summary: `meta.missing_row`, `meta.orphan_row`, `meta.stale_value` (with the stale column
counts) and `meta.no_price`. `references/meta-lookup-rules.md` gives each column's rule for the save path and for the
regeneration, which differ for prices, `onsale`, `stock_quantity` and `rating_count`; the checks accept either rule
where the two differ. For `meta.no_price`, separate simple products and variations with a regular price (issue 68605,
a fault) from variable products without published variations (expected).

### 3. Read the attributes lookup classes

`attr.missing_product_rows`, `attr.missing_term_row`, `attr.missing_variation_rows`, `attr.stale_term`,
`attr.variation_term_mismatch`, `attr.stale_stock`, `attr.orphan_row`, `attr.structure_mismatch` and
`attr.deleted_term`, then the information block. `references/attributes-lookup-rules.md` explains which products
WooCommerce writes rows for, how the object path and the optimized path differ (`onbackorder` stock, draft
variations, values outside the parent's terms), and which events never touch the table (term deletes, direct meta
writes, status changes outside WooCommerce's save). Note whether "Optimized updates" is on: issue 68112 makes that
path drop a product's rows silently when its read fails.

### 4. Confirm on single products (read-only)

Pick two or three products from each class with rows, and a few from the busiest parents in the summary:

```sh
wp eval-file scripts/lookup-product-diff.php 123 456 789
```

It rebuilds the rows WooCommerce 11.1.2 would write, through its own product objects, and prints missing, extra and
different rows, path notes, and queued actions for those products. A class whose samples all turn out to be path
differences or queued work is not a fault; say so in the report.

### 5. Find the cause before the repair

A repair that does not remove the cause lasts until the next import. For each class with confirmed rows, write down
the likely cause from `references/mismatch-classes.md` and the evidence for it: a plugin or import that writes post
meta or terms directly (compare the products' modified dates with the import log or the plugin's schedule), deleted
terms, an aborted regeneration, a stalled queue, "Optimized updates" with failed actions or `palt-updates` errors.
When the cause is code outside WooCommerce, name it for its developer; this skill does not change it.

### 6. Propose the repairs (owner decision)

From `references/changes-and-rollback.md`, smallest first:

| Situation | Repair |
| --- | --- |
| A few products | Regenerate those products' attribute rows; refresh their meta rows |
| `meta.no_price` on simple products or variations | Rebuild `_price` with WooCommerce's save rule, then refresh the row |
| Many products, or classes across the catalog | Full regeneration of the affected table, `--disable-db-optimization` for the attributes table unless the owner chooses the optimized path |
| Only orphan rows | Delete them with a backup, or let a full attributes regeneration remove them |
| Queued updates waiting | Run the queue for that hook, or repair the runner first |
| Table usage off after a clean check | Turn it on |

State for each: what it changes, how long the table is incomplete (a full attributes regeneration switches filters to
taxonomy queries until it ends), its backup, its check and its undo. Wait for approval of each step.

### 7. Make one approved change

Staging first. Take the backup, make the change, and wait until the report shows no regeneration in progress and no
pending lookup actions.

### 8. Verify with the same checks

```sh
bash scripts/lookup-readonly-report.sh --path=/path/to/wordpress > lookup-report-after.txt
node scripts/summarise-lookup-report.mjs lookup-report-before.txt lookup-report-after.txt
```

Use the same `LOOKUP_DETAIL_LIMIT` for both runs. Every class the change targeted should fall to zero or to the
expected remainder the procedure predicted (for example `meta.no_price` for variable products without published
variations). Re-run `lookup-product-diff.php` on the sampled products. A class that did not move has a cause the
change does not reach: go back to step 5. A change that made any class grow is undone with its undo.

### 9. Repeat on production and report

Repeat each approved step on production with its own backup and the same verification, then write the report below.

## Reference files

| File | Read it when |
| --- | --- |
| `references/lookup-tables.md` | First: which lookup tables exist, their columns and indexes, what reads them, the settings |
| `references/meta-lookup-rules.md` | Step 2: how each meta column is written by a save and by a regeneration |
| `references/attributes-lookup-rules.md` | Step 3: which rows the attributes table should hold, the two write paths, known faults |
| `references/mismatch-classes.md` | Steps 2 to 5: each class, its causes and its repair |
| `references/regeneration.md` | Step 6: the tools, WP-CLI commands and Action Scheduler jobs, and what each does not fix |
| `references/changes-and-rollback.md` | Steps 6 and 7: every write with its backup, check and undo |
| `references/version-notes.md` | Step 0, and any store not on WooCommerce 11.1.2 |
| `scripts/lookup-readonly-report.sh` | Steps 0 and 8: the report (read-only) |
| `scripts/lookup-checks.sql` | The SELECT blocks the report runs; usable alone with `{prefix}` and `{limit}` filled in |
| `scripts/summarise-lookup-report.mjs` | Steps 0 and 8: summary per class, and the before and after comparison (read-only, local files) |
| `scripts/lookup-product-diff.php` | Step 4 and after single-product repairs: expected against actual rows (read-only, `wp eval-file`) |

## Report format

End every session with this report, filled in from the report files and command output, never from memory:

```text
Lookup table integrity report: <site> (<date, UTC>)
Environment: WooCommerce <v>, WordPress <v>, Action Scheduler <v>, database <MySQL|MariaDB v>; products <n>,
             variations <n>; attribute table usage <on|off>, direct updates <on|off>, optimized updates <on|off>
Work in flight at start: <none | regeneration running | aborted | n queued or failed lookup actions>

| Class                          | Before | After | Cause (evidence)                   | Repair (step)            |
| ------------------------------ | ------ | ----- | ---------------------------------- | ------------------------ |
| meta.missing_row               |        |       |                                    |                          |
| meta.stale_value (columns)     |        |       |                                    |                          |
| meta.no_price                  |        |       |                                    |                          |
| meta.orphan_row                |        |       |                                    |                          |
| attr.missing_product_rows      |        |       |                                    |                          |
| attr.missing_term_row          |        |       |                                    |                          |
| attr.missing_variation_rows    |        |       |                                    |                          |
| attr.stale_term                |        |       |                                    |                          |
| attr.variation_term_mismatch   |        |       |                                    |                          |
| attr.stale_stock               |        |       |                                    |                          |
| attr.orphan_row                |        |       |                                    |                          |
| attr.structure_mismatch        |        |       |                                    |                          |
| attr.deleted_term              |        |       |                                    |                          |

Information counts (not mismatches): <hidden products' rows, onbackorder rows, private and draft variation rows>
Sampled products (lookup-product-diff.php): <ids, result per class>
Changes made: <step> | backup <file, restore tested yes/no> | check <result> | undo <tested yes/no>
Not changed, owner decision needed: <item, trade-off>
Causes outside WooCommerce, for their developers: <plugin, import or process, evidence>
Next step: <step, its backup, its check, its undo> (needs approval: yes/no)
Files to delete after the work: <report files, table exports>
```
