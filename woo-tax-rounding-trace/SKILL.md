---
name: woo-tax-rounding-trace
description: "Rebuild one WooCommerce order's tax to the cent and find the step where a one-cent (or few-cent) gap between the cart, the stored order, the REST API, order emails, a refund and the payment gateway comes from. Covers the settings that decide rounding (prices entered with tax, rounding per line or at subtotal, tax display, price decimals, WC_ROUNDING_PRECISION), how WC_Cart_Totals and WC_Order::calculate_totals() compute differently, compound and shipping tax, coupons spread across lines, fees, the stored item tax meta (_line_tax_data, taxes) and tables, partial and per-line refunds, gateway amounts in minor units, and currency decimals. Read-only: exports one order, recomputes it under both rounding settings with a helper script, names the first step that diverges, and proposes one change for the owner to approve and test on staging. Use when an order total, tax row, refund or charged amount is off by a cent or a few."
license: MIT
compatibility: "Needs WP-CLI read access to the store or a staging copy (wp option get, wp eval-file, and wp wc with --user for the optional REST view) and Node.js 20 or later for the helper script, which makes no network requests. Written against WooCommerce 11.1.2 and WordPress 7.1.2; references/version-notes.md says how to compare other releases."
metadata:
  author: Hamza Ahmad Aslam
  version: "1.0.0"
  last_verified: "2026-09-29"
---

# WooCommerce order tax rounding trace

This skill takes one order whose numbers disagree by a cent or a few and finds the step where they part. It exports the
stored order read-only, rebuilds WooCommerce's cart arithmetic and its order arithmetic with exact numbers under both
rounding settings, compares every stored value and every place the order is shown (checkout page, REST API, emails,
refund form, gateway), and names the first step that diverges with the WooCommerce function behind it. It changes
nothing. A change it proposes comes with a backup, a check and an undo, is rehearsed on staging, and waits for the
owner's approval.

It is written for coding agents that support the Agent Skills format, and a person can follow it the same way. Facts are
sourced in `references/`, next to each fact, mostly from the WooCommerce 11.1.2 source code.

## When to use

- An order's total, tax row or a line differs by a cent (or a few) between the checkout page, the admin order screen,
  the customer's email, the REST API, or an accounting or ERP system reading the store.
- A full refund is refused ("Invalid refund amount") or the gateway rejects it, or refunded tax is a cent off.
- The amount the gateway captured or refunded differs from the order total or the refund.
- "Recalculate" changed the total of a paid order, or an order edit moved it by a cent.
- The block checkout page showed one total and the stored order has another.
- After a change to prices entered with tax, the rounding setting, price decimals or a tax plugin.

Not for store-wide tax totals over a period, wrong tax rates (a wrong rate is a setup problem, not rounding), or advice
on what tax law requires.

Related work: WooCommerce's own `tax-reconciliation` skill, in the agent plugin repository WooCommerce publishes on
GitHub, reconciles tax store-wide from Analytics (paid, refunded, on-hold, per rate) and does not rebuild one order's
arithmetic; this skill traces one order to the cent, which is why the names differ
([references/evidence.md](references/evidence.md)). In this collection,
`woo-checkout-performance-audit` covers slow checkouts and `woo-hpos-live-migration` moving orders to HPOS.

## Safety rules

1. Read-only by default. Before any change, state the step, its backup, its check and its undo, and wait for the
   owner's approval of that step. One approval covers one step.
2. Never press "Recalculate" or save the items box of a live paid order to see what happens: both rewrite stored taxes
   and totals, and there is no exact undo ([references/order-recalculation.md](references/order-recalculation.md)).
3. No test orders or refunds on production. Reproduce carts, orders and refunds on a staging copy with the gateway in
   test mode.
4. Never edit order totals or item meta in the database by hand. Corrections go through WooCommerce, after a staging
   rehearsal, with the owner's approval.
5. The export holds no names, addresses or emails, but it is store data: keep exports, screenshots and gateway reports
   out of chats, tickets and repositories, and delete them when the report is written.
6. A settings change (rounding, prices entered with tax, decimals) is store-wide and does not fix past orders. Treat it
   as its own change with a staging test.
7. This skill explains WooCommerce's arithmetic. Which rounding a jurisdiction requires is for the owner and their
   accountant.
8. Multisite: pass `--url=<site>` to every WP-CLI command.

## Where a cent can come from

| Area | How it shows | First check | Read |
| --- | --- | --- | --- |
| Settings and constants | Gap after a settings change; tax of exactly half a cent | `settings` block of the export | `references/settings-and-constants.md` |
| Rounding functions | Half-way values rounded one way in one place and the other way elsewhere | Helper's "Half-way values" | `references/rounding-functions.md` |
| Cart arithmetic and the checkout copy | Checkout page rows do not add up to its total; Store API total differs | Helper stage 0 | `references/cart-totals.md` |
| Order recalculation | Block checkout, REST-created or edited orders; "Recalculate" moves the total | Helper stages 6 and 7 | `references/order-recalculation.md` |
| Stored lines against order totals | Line taxes do not add up to the order's tax | Helper stage 5, stored sums | `references/order-storage.md` |
| REST API and emails | An integration that adds lines is a cent off; email rows do not add up | Helper stages 8 and 9 | `references/rest-emails-display.md` |
| Refunds | Refund form above the order total; refunded tax differs | Helper stage 10 | `references/refunds.md` |
| Gateway and currency | Charged amount differs; zero-decimal currency on a two-decimal store | Helper gateway line, stage 11 | `references/gateways-and-currency.md` |
| Plugins and filters | Neither rounding setting reproduces the stored figures | `hooks` block of the export | `references/settings-and-constants.md` |

## Procedure

### 0. Record the setup (read-only)

- WooCommerce, WordPress and PHP versions, the order ID, and how the order was created (`created_via`: `checkout` for
  classic checkout, `store-api` for block checkout, others for admin or REST).
- Ask the owner whether prices entered with tax, the rounding setting, price decimals or tax plugins changed since the
  order was placed, and which figures disagree where (for example "email 47.48, ERP 47.47").
- On a store older or newer than 11.1.2, read `references/version-notes.md` first.

### 1. Export the order (read-only)

```sh
bash scripts/export-order.sh <order id> --path=/path/to/wordpress > order-<id>.json          # add --url=<site> on multisite
WOO_TAX_TRACE_USER=<admin login> bash scripts/export-order.sh <order id> --path=/path/to/wordpress > order-<id>.json
```

Standard output is the helper's JSON (settings after filters, rates recorded on the order's tax lines, stored line and
order values, refunds, and non-WooCommerce callbacks on the hooks that change tax arithmetic). Standard error shows the
raw tax options and, with `WOO_TAX_TRACE_USER`, the REST view of the totals. On a large store run it against staging or
a replica. Without WP-CLI's `eval-file`, use the SELECTs in `references/order-storage.md` and fill in the JSON by hand
(`references/helper-script.md` gives the format).

### 2. Collect what each place showed (read-only)

Write each figure into `observed` in the JSON: the checkout page total or Store API `total_price`, the email total, the
REST `total` and `total_tax` the integration read, the refund amount the form offered, and the gateway's captured amount
in minor units from its dashboard. Record where and when each was seen.

### 3. Run the helper

```sh
node scripts/tax-trace.mjs order-<id>.json          # add --json for machine-readable output
```

It prints the cart replay, what classic and block checkout would store, a recalculation, the REST, email, refund-form and
gateway views, and a stage-by-stage comparison against the stored figures, for the store's rounding setting and the other
one ([references/helper-script.md](references/helper-script.md)).

### 4. Name the first divergence

Read the comparison from stage 0 down and take the first row that is not `ok`:

- Stages 0 to 6 all `ok`: the order is what WooCommerce computes; the gap is in a view (stages 7 to 11).
- Only stage 0 differs on a block checkout order: the checkout page showed the cart's figure and the order stored the
  recalculated one ([references/order-recalculation.md](references/order-recalculation.md#when-it-runs)).
- The other rounding setting reproduces stages 0 to 6 and the store setting does not: the setting changed after the
  order (example 3 in `references/worked-examples.md`).
- Neither setting reproduces them: look at `hooks` in the export (a filter changes the arithmetic), order notes and
  edits, and whether the entered prices and discounts in the input are right (the helper derives them from stored lines
  when they are missing).
- A row whose inputs appear under "Half-way values": PHP computes in floating point, so confirm that step on staging.

### 5. Rebuild that step by hand

Write out the arithmetic of the named step to the cent, with the function and source line for each rounding, the way
`references/worked-examples.md` does: the value before rounding, the rounding function, its precision and mode, and the
result. Use `references/rounding-functions.md` for the functions and the reference file for the stage from the table
above. The rebuilt figure must equal the helper's; if it does not, the input is wrong, not the arithmetic.

### 6. Decide the cause and the change

| First divergence | Usual cause | Change to propose (all in `references/changes-and-rollback.md`) |
| --- | --- | --- |
| Stage 0, cart page | Cart rounds rows and total at different points; block checkout stores a recalculated total | None to the order; explain; a rounding setting change only as a store-wide decision |
| Stages 1 to 6 under both settings | A callback on a tax filter, a manual edit, or wrong input | The plugin's setting or snippet, after a staging test |
| Stages 1 to 6 under the store setting only | Rounding setting changed after the order | Leave the paid order as it is |
| Stage 5, stored sums | Shipping or fee tax rounded half up in the cart and in the tax rounding mode on the line | Do not recalculate; report upstream with the helper output |
| Stage 7 | "Recalculate" would change the order | Do not recalculate the paid order |
| Stage 8 | A reading system adds rounded lines | Read order-level totals in that system |
| Stage 10 | Refund form rounds each field half up | Correct one field of that refund |
| Stage 11 or the gateway line | Gateway conversion or price decimals that differ from the currency | Price decimals setting, or the gateway's own setting |

### 7. Propose one change (change)

Take the change from `references/changes-and-rollback.md` with its backup, check and undo, rehearse it on staging, state
all four parts, and wait for approval. After it, export again and re-run the helper; the stage that diverged should now
read `ok`, and no other stage should change unless the change was meant to.

### 8. Report

Fill in the report below from the export and the helper output, never from memory.

## Reference files

| File | Read it when |
| --- | --- |
| `references/settings-and-constants.md` | Step 0: options, constants, filters that decide rounding |
| `references/rounding-functions.md` | Step 5: each rounding function, mode and precision |
| `references/cart-totals.md` | Stage 0 to 6 with classic checkout; the cart page and Store API; coupons spread over lines |
| `references/order-recalculation.md` | Stages 6 and 7; block checkout, REST or admin orders; before any "Recalculate" |
| `references/order-storage.md` | Step 1; the meta keys, tables and SQL for one order |
| `references/rest-emails-display.md` | Stages 8 and 9; integrations and customer emails |
| `references/refunds.md` | Stage 10; the refund form, the refund record, the gateway refund |
| `references/gateways-and-currency.md` | Stage 11; minor units, PayPal Standard's line check, price decimals |
| `references/worked-examples.md` | Four synthetic orders traced to the cent |
| `references/helper-script.md` | Steps 1 to 4: input format, stages, arithmetic, limits |
| `references/changes-and-rollback.md` | Step 7: every change with its backup, check and undo |
| `references/evidence.md` | Public reports of the gap, and related skills |
| `references/version-notes.md` | Step 0 on any release other than 11.1.2 |
| `scripts/export-order.sh` | Step 1 (read-only WP-CLI wrapper) |
| `scripts/export-order.php` | Step 1 (read-only, `wp eval-file`): the order as the helper's JSON |
| `scripts/tax-trace.mjs` | Step 3 (read-only, local file): rebuild and comparison |
| `scripts/examples/` | Synthetic inputs and the output each produces |

## Report format

```text
Tax rounding trace: order <id> on <site> (<date, UTC>)
Environment: WooCommerce <v>, WordPress <v>, PHP <v>; created via <checkout|store-api|admin|rest-api>
Settings: prices entered with tax <yes|no> (order) ; rounding <per line|at subtotal> (now; changed since the order: <yes|no|unknown>);
          price decimals <n> ; rounding precision <n> ; tax rounding mode <half up|half down> ; display in cart <incl|excl>
Rates on the order: <id: percent, compound yes/no, priority> ...
Filters with non-WooCommerce callbacks: <hook: plugin or file> | none

Figures that disagree (as reported and as observed):
- <place>: <amount> (<how and when seen>)

Helper result: <n> of <m> checkout values differ under the store setting, <n> under the other setting
First divergence: stage <n>, <value>: stored <x>, computed <y>
Step rebuilt by hand:
  <value before rounding> -> <function, precision, mode> -> <result>   (<source link>)
Half-way values that decide the result: <list | none> (confirmed on staging: <yes|no>)

Cause: <one sentence, naming the function or setting>
Change proposed: <change> | backup <file or id, restore tested yes/no> | check <result> | undo <how>   (needs approval: yes)
Changes made: <none | change, approved by, date, check result>
Not changed, owner decision needed: <item, trade-off>
Upstream: <issue or pull request link, or "none found">
Files to delete after the trace: <exports, screenshots, gateway reports>
```
