---
name: woo-checkout-performance-audit
description: "Audit the performance of a live WooCommerce checkout, block or classic, with read-only measurements first and a backup, a check and an undo for every change. Covers measuring (browser Network and Performance panels, HAR files, access-log percentiles, Query Monitor panels and headers, Server-Timing), the woocommerce_sessions table and its cleanup, when wc-cart-fragments still loads, Action Scheduler queue health and the work a checkout puts in it, payment gateway scripts and API time inside the place-order request, live shipping rates, page and object caching (and why cart, checkout and my-account are never page cached), transients, callbacks that plugins hook into order creation, and HPOS and core table indexes. Ends with a report of measured before and after numbers. Use when checkout, totals updates or place-order are slow, when the sessions or Action Scheduler tables keep growing, when wc-ajax or admin-ajax traffic is high, or before and after any checkout change."
license: MIT
compatibility: "Needs shell access with WP-CLI to the store or a staging copy for the read-only report, a Chromium-based browser for the browser measurements, and Node.js 20 or later for the HAR and access-log summaries. Written against WooCommerce 11.1.2, WordPress 7.1.2 and Action Scheduler 4.0.0; references/version-notes.md lists what differs on older releases."
metadata:
  author: Hamza Ahmad Aslam
  version: "1.0.0"
  last_verified: "2026-09-26"
---

# WooCommerce checkout performance audit

This skill finds where a live checkout spends its time, from the shopper's browser to the database, and proves every
fix with before and after numbers taken the same way. It measures and reads by default. Each change it proposes comes
with a backup, a check and an undo, and waits for the owner's approval. It does not rewrite plugins or tune the server:
it names what is slow, shows the evidence, and says what would change it.

It is written for coding agents that support the Agent Skills format, and a person can follow it the same way. Facts
are sourced in `references/`, next to each fact, from WooCommerce 11.1.2, WordPress 7.1.2, Action Scheduler 4.0.0,
Query Monitor 4.0.7 and the vendors' documentation.

## When to use

- Shoppers wait on the checkout page, on totals updates while they type, or after "Place order".
- Checkout slows down under load (sales, campaigns) while other pages stay fast.
- `{prefix}woocommerce_sessions`, `{prefix}actionscheduler_actions` or `{prefix}actionscheduler_logs` keep growing.
- Access logs show many `?wc-ajax=get_refreshed_fragments`, `?wc-ajax=update_order_review` or `admin-ajax.php` hits.
- WooCommerce shows "past-due actions", or order emails and webhooks arrive late.
- A checkout change (plugin, gateway, cache, host, WooCommerce update) needs numbers before and after.

Related skills in this collection, for work outside this audit: `woo-hpos-live-migration` (moving orders to HPOS),
`wp-slow-query-investigation` (one slow SQL query), `wp-cron-action-scheduler-health` (running the queue from a
server cron), `wp-autoload-audit` (autoloaded options) and `wp-cwv-field-triage` (storefront Core Web Vitals).

## Safety rules

1. Read-only by default. Before any change, state the step, its backup, its check and its undo, and wait for the
   owner's approval of that step. One approval covers one step.
2. Do not place orders on production to measure. Time "Place order" on a staging copy with the gateway in test mode,
   or read the times of orders customers placed from the access log. A production test order is the owner's to place.
3. Checkout traffic is personal data. Use a synthetic test customer. Export HAR files with "Export HAR (sanitized)",
   read logs where they are, and keep HAR files, traces, logs and database exports out of chats, tickets and
   repositories; delete them once the report is written. The helper scripts print aggregates only.
4. Change one thing at a time. Re-measure with the same method, page, cart, throttling and cache state.
5. Back up before each change. A backup counts after one test restore on staging.
6. Never on production: the "Clear customer sessions" tool (it empties every cart and flushes the whole object
   cache), `wp cache flush` at trading hours, `TRUNCATE` on sessions or Action Scheduler tables, turning off HPOS
   compatibility mode outside the HPOS runbook, and any cache rule that serves cart, checkout or my-account pages,
   `?wc-ajax=` or Store API responses from cache.
7. Staging first for anything that installs code (Query Monitor, Performance Lab, a temporary mu-plugin). On
   production only with approval, and removed when the audit ends.
8. Multisite: every site has its own tables and options. Pass `--url=<site>` to every WP-CLI command.

## Where checkout time goes

| Area | How it shows | First check | Read |
| --- | --- | --- | --- |
| Server time of checkout requests | Slow checkout page, slow `update_order_review` or Store API `batch`, slow place-order | Access-log percentiles, browser wait times, Query Monitor | `references/measuring.md`, `references/checkout-requests.md` |
| Sessions | Large sessions table, slow session writes, cleanup behind | SQL session blocks | `references/sessions.md` |
| Cart fragments | `get_refreshed_fragments` on many page views | HAR per page type, access log | `references/cart-fragments.md` |
| Action Scheduler | Past-due actions, big tables, runners busy all day | `wp action-scheduler status`, SQL blocks | `references/action-scheduler.md` |
| Gateways and shipping | Heavy third-party scripts, slow place-order, slow totals | HAR hosts, HTTP call times | `references/gateways-and-shipping.md` |
| Caching and transients | Cached checkout, no object cache, expired or autoloaded transients | Response headers, state report, SQL | `references/caching-and-transients.md` |
| Order creation hooks | Slow place-order with a fast gateway | Hook callbacks in the state report, Query Monitor | `references/order-hooks.md` |
| Tables and indexes | Slow queries on orders, sessions or the queue | SQL index and size blocks | `references/database-indexes.md` |

## Procedure

### 0. Record the setup (read-only)

```sh
bash scripts/checkout-readonly-report.sh --path=/path/to/wordpress   # add --url=<site> on multisite
```

The report prints versions, block or classic checkout and the page paths, HPOS state, object cache, autoload size,
debug and cron constants, the settings and features that change checkout time, enabled gateways and shipping methods,
webhooks by topic, every non-core callback on the checkout and order hooks, WP-Cron events, Action Scheduler status,
plugins and themes, then the SELECT blocks in `scripts/checkout-checks.sql`. On a big store run it on a replica or
staging copy, or at a quiet hour; `CHECKOUT_REPORT_SKIP_SQL=1` skips the SQL. Parts can run alone:
`wp eval-file scripts/checkout-state.php`, or one SQL block through `wp db query` after filling in `{prefix}` and
`{base_prefix}`.

Then read `references/version-notes.md`. Several behaviours in this skill arrived in 10.1.0 to 11.0.1 (session
cleanup in Action Scheduler, the `session_expiry` index, draft orders only at place-order time, the step logger
filter). On an older store, a WooCommerce update may be the first recommendation, as a change of its own.

### 1. Measure the browser side (read-only)

Follow the test conditions in `references/measuring.md`: same cart, synthetic customer, logged out, fixed throttling,
five runs, median and slowest.

- Name every request with `references/checkout-requests.md`. Classic checkout sends `?wc-ajax=update_order_review` on
  load and on address and shipping changes, and `?wc-ajax=checkout` to place the order. Block checkout renders the
  cart into the page, sends Store API `batch` calls on address changes, and `POST /wc/store/v1/checkout` to place the
  order.
- Record the checkout page's "Waiting (TTFB)", each totals update, and the place-order request (staging).
- Export a sanitized HAR and run `node scripts/har-summary.mjs checkout.har`: per-request wait and total, per-endpoint
  medians, and first-party and third-party hosts with their kilobytes.
- Record the Performance panel's Interactions track while typing the address, changing shipping and choosing a
  payment method; note interactions over 200 ms and the scripts behind them.
- Repeat one page view per page type (home, category, product, cart) for cart fragments and gateway scripts.

### 2. Measure the server side (read-only; installing Query Monitor is a change)

- Access log, live traffic: `node scripts/access-log-timings.mjs <logs> --time-field=last --unit=s` gives count, 5xx,
  p50, p75, p95 and maximum per checkout endpoint. If the log has no request time, write that down as a
  recommendation for the host; the audit does not change server configuration.
- Query Monitor on staging (or on production with approval): Timeline, Queries by Component, HTTP API Calls, the
  object cache note and Scripts on the checkout page; `X-QM-overview-time-taken` on `?wc-ajax=` and REST responses
  when present; `?_envelope` with a REST nonce on a Store API request for its queries and HTTP calls (a cart GET
  anywhere, a place-order POST only on staging).
- Optional on staging: Server-Timing from Performance Lab for the checkout page (`references/measuring.md`).

Write every number with its method, date, conditions and run count. These are the "before" values.

### 3. Sessions

From the report: rows, expired rows, guest and customer rows, size, expiry days, the `session_expiry` index, and the
runs of `woocommerce_cleanup_sessions`. Many expired rows mean the cleanup is not running (go to step 5); expiry
dates far out mean a filter extends the lifetime; guest rows far above the shopper count point at bots adding to
cart. Details and causes: `references/sessions.md`.

### 4. Cart fragments

Count `get_refreshed_fragments` per page view in the HAR and in the access log, and find what enqueues
`wc-cart-fragments` (the Cart widget, a theme such as Storefront, a plugin). Since 7.8.0 WooCommerce does not load it
everywhere by itself. Options and caveats: `references/cart-fragments.md`.

### 5. Action Scheduler

From the report: counts by status, past-due over 1 hour and 1 day, pending by hook, failures in 7 days, completions
per hour, open claims, log rows, and whether WP-Cron or a system cron starts the queue. Map the checkout's own actions
(webhooks, deferred emails, Analytics imports, session and draft cleanups, unpaid order cancellation) and their
backlog. Reading the results: `references/action-scheduler.md`.

### 6. Payment gateways and shipping rates

- Scripts: per payment host, requests, kilobytes, time and unused share (Coverage), on checkout and on product and
  cart pages.
- API time: the place-order time on staging with the store's gateway in test mode against a method without an API;
  on staging, the temporary HTTP timing mu-plugin logs each outbound call with its duration.
- Shipping: the second totals update with an unchanged address should be faster than the first. "Enable debug mode"
  in shipping settings bypasses the rate cache.

Details: `references/gateways-and-shipping.md`.

### 7. Page cache, object cache, transients

- Compare the page paths in the report with the page cache's exclusions. Check the checkout document's
  `Cache-Control` and any cache-hit header, and run the two-profile cart test.
- Object cache: in use or not, drop-in name, autoload rows and bytes against Site Health's thresholds; on a
  multi-server store, whether every server shares it.
- Transients: rows, expired rows, autoloaded rows and the largest ones.

Details: `references/caching-and-transients.md`.

### 8. Order creation hooks

List the non-core callbacks on the totals, place-order, per-save and status hooks from the report, then confirm on a
live request with Query Monitor's Hooks & Actions and HTTP API Calls panels. Look for outside API calls in the
request, heavy work on hooks that run on every order save, emails sent in the request, and webhooks forced to deliver
synchronously. A checkout saves the order several times, and the place-order step logger adds saves of its own.
Details: `references/order-hooks.md` and `references/checkout-requests.md`.

### 9. Tables and indexes

From the report: sizes and engines, and the indexes on the checkout tables compared with the table in
`references/database-indexes.md`. Note whether orders are on HPOS, whether compatibility mode still writes both
copies, draft orders, debug markers, reserved stock and log rows. A slow query from Query Monitor goes to `EXPLAIN` on
staging.

### 10. Make one change (change)

Pick the finding with the largest measured cost and the smallest risk. Take the step from
`references/changes-and-rollback.md`, which gives each change its backup, check and undo: installing Query Monitor,
the temporary HTTP timing, removing expired sessions, session lifetime, the empty-session feature, cart fragments,
Analytics import mode, deferred emails, shipping debug mode, page cache rules, HPOS Data Caching, expired transients,
a missing index, the step logger filter, and Action Scheduler history. State all four parts and wait for approval.

### 11. Re-measure and report

Repeat the exact measurements of steps 1 and 2 that the change should affect, under the same conditions, and fill in
the "after" column. A change that does not move its number is reverted with its undo, unless it fixed something else
worth keeping, which the report then says.

## Reference files

| File | Read it when |
| --- | --- |
| `references/measuring.md` | Steps 1, 2 and 11: methods, thresholds, test conditions, what the tools show |
| `references/checkout-requests.md` | Naming requests; what each checkout request runs; the place-order steps and step logger |
| `references/sessions.md` | Step 3, or a large sessions table |
| `references/cart-fragments.md` | Step 4, or many `get_refreshed_fragments` requests |
| `references/action-scheduler.md` | Step 5, past-due actions, late emails or webhooks |
| `references/gateways-and-shipping.md` | Step 6, heavy payment scripts, slow place-order or totals |
| `references/caching-and-transients.md` | Step 7, cache rules, object cache, transients |
| `references/order-hooks.md` | Step 8, slow place-order with a fast gateway |
| `references/database-indexes.md` | Step 9, slow queries, missing indexes, rows piling up |
| `references/changes-and-rollback.md` | Step 10: every change with its backup, check and undo |
| `references/version-notes.md` | Step 0, and any store older than WooCommerce 11.1.2 |
| `scripts/checkout-readonly-report.sh` | Step 0 and after each change (read-only) |
| `scripts/checkout-state.php` | Settings, features, gateways, shipping methods and hook callbacks (read-only, `wp eval-file`) |
| `scripts/checkout-checks.sql` | The SELECT blocks the report runs; usable alone with the placeholders filled in |
| `scripts/har-summary.mjs` | Step 1: summary of a sanitized HAR file (read-only, local file) |
| `scripts/access-log-timings.mjs` | Step 2: percentiles per checkout endpoint from access logs (read-only, local files) |
| `scripts/classify-request.mjs` | Shared by the two Node helpers: names requests without query strings or IDs |

## Report format

End every session with this report, filled in from measurements and command output, never from memory:

```text
Checkout performance report: <site> (<date, UTC>)
Environment: WooCommerce <v>, WordPress <v>, PHP <v>, Action Scheduler <v>; checkout <block|classic>;
             orders <HPOS|posts>, compatibility mode <on|off>; object cache <type|none>; page cache <layer>
Test conditions: <browser, throttling, cart, test customer, logged out, cache warm|cold, runs per number>
Live traffic window: <log period, lines read>

| Metric                                         | Before | After | Method                             |
| ---------------------------------------------- | ------ | ----- | ---------------------------------- |
| Checkout page TTFB, median / slowest (ms)      |        |       | DevTools Waiting (TTFB), 5 runs    |
| Totals update server wait, median (ms)         |        |       | har-summary: update_order_review or store-api batch |
| Place order, staging, median (ms)              |        |       | har-summary: wc-ajax checkout or store-api checkout |
| Place order p50 / p95, live (ms)               |        |       | access-log-timings                 |
| Slowest checkout interaction (ms)              |        |       | Performance panel, Interactions    |
| Third-party requests / KB on checkout          |        |       | har-summary hosts                  |
| get_refreshed_fragments per page view          |        |       | har-summary, per page type         |
| Queries / query time, checkout page            |        |       | Query Monitor                      |
| Sessions rows / expired / MB                   |        |       | checkout-checks.sql                |
| Actions pending / past-due 1 day / failed 7 d  |        |       | checkout-checks.sql                |
| Autoloaded rows / KB; transients expired       |        |       | checkout-checks.sql                |

Findings (largest measured cost first):
- <finding>: <number and where it was measured> -> <cause> (<reference file or source>)
Changes made: <change> | backup <file or id, restore tested yes/no> | check <result> | undo <tested yes/no>
Not changed, owner decision needed: <item, trade-off>
Recommendations for the host or developers: <item, evidence>
Next step: <step, its backup, its check, its undo> (needs approval: yes/no)
Files to delete after the audit: <HAR files, exports, temporary mu-plugins, logs>
```
