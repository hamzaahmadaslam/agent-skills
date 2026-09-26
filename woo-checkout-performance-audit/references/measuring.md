# Measuring checkout performance

Read this for steps 1, 2 and 11 of the procedure. Every number in the report comes from one of the methods below, and
the before and after numbers of a change come from the same method under the same conditions.

## Reference thresholds

| Metric | Good | Poor | Source |
| --- | --- | --- | --- |
| Time to First Byte of a page | 0.8 s or less | over 1.8 s | [web.dev TTFB](https://web.dev/articles/ttfb) |
| Interaction to Next Paint | 200 ms or less | over 500 ms | [web.dev INP](https://web.dev/articles/inp) |

Both are field thresholds at the 75th percentile of page loads. Lab runs on one machine do not produce field values;
use them to compare before and after. There is no published threshold for Ajax and Store API calls: report their
times as measured, next to the page TTFB.

## Test conditions to hold constant

- The same page, the same cart (for example one simple and one variable product), the same synthetic test customer
  and address, the same payment method, the same shipping method.
- The same browser profile without extensions, logged out the way shoppers arrive (log in only to read Query Monitor),
  and the same network and CPU throttling in DevTools
  ([network throttling](https://developer.chrome.com/docs/devtools/network/reference);
  [CPU throttling](https://developer.chrome.com/docs/devtools/performance/reference)).
- At least five runs per measurement; report the median and the slowest. Record the time of day, and whether the page
  cache and object cache were warm.
- Place-order runs on staging with the gateway in test mode. On production, read place-order times from the access
  log of orders customers placed.

## Browser: Network panel and HAR files

- The Timing tab splits a request into queueing, stalled, DNS, initial connection, request sent, "Waiting (TTFB)"
  (one round trip plus the server's time to prepare the response) and content download
  ([network reference](https://developer.chrome.com/docs/devtools/network/reference)).
- Useful filters: `domain:`, `method:`, `larger-than:`, `has-response-header:` and the "3rd-party requests" checkbox
  (same page).
- Export with "Export HAR (sanitized)": the default export leaves out `Cookie`, `Set-Cookie` and `Authorization`
  headers; the export with sensitive data must be switched on in settings first (same page). Use the sanitized export
  only. Request bodies of form posts can still hold the test customer's address, which is one more reason to use
  synthetic data. Delete HAR files when the report is written.
- In a HAR file, `timings.wait` is the time spent waiting for the server and `time` is the sum of all timings
  ([HAR 1.2 spec](https://w3c.github.io/web-performance/specs/HAR/Overview.html)).
- `node scripts/har-summary.mjs checkout.har` names each checkout request (see
  [checkout-requests.md](checkout-requests.md)), prints its status, wait and total time, size, and any `Server-Timing`
  or Query Monitor timing header, then totals per host with first-party and third-party split. It prints no cookies,
  bodies or query strings, and warns when the file holds cookies or request bodies. When the state report shows other
  page paths than `/checkout/`, `/cart/` and `/my-account/`, pass them with `--checkout-path`, `--cart-path` and
  `--account-path` (the access-log helper takes the same options).

## Browser: Performance panel

- Record while entering the address, changing the shipping method and placing the order. The Interactions track shows
  input delay, processing time and presentation delay for each interaction and marks interactions over 200 ms
  ([performance reference](https://developer.chrome.com/docs/devtools/performance/reference)).
- The panel's insights include a third-party summary (same page). The Coverage panel shows the unused share of each
  script ([Coverage](https://developer.chrome.com/docs/devtools/coverage)).
- Leave the Screenshots option off, or use test data only: screenshots capture the form.

## Browser: Resource Timing in the console

`performance.getEntriesByType('resource')` lists every request of the page; `responseStart - requestStart` is the time
from sending the request to the first byte, and cross-origin requests hide their detail unless the server sends
`Timing-Allow-Origin` ([web.dev navigation and resource timing](https://web.dev/articles/navigation-and-resource-timing)).
`serverTiming` holds any `Server-Timing` values ([web.dev optimize TTFB](https://web.dev/articles/optimize-ttfb)).
Paste this into the console on the checkout page after the actions to measure; it prints paths without query strings:

```js
console.table(
  performance.getEntriesByType('resource')
    .filter((e) => /wc-ajax=|\/wc\/store\/v1\/|rest_route=%2Fwc%2Fstore|admin-ajax\.php/.test(e.name))
    .map((e) => {
      const u = new URL(e.name);
      const ajax = u.searchParams.get('wc-ajax');
      const route = u.searchParams.get('rest_route');
      return {
        request: u.pathname + (ajax ? '?wc-ajax=' + ajax : '') + (route ? '?rest_route=' + route : ''),
        start_ms: Math.round(e.startTime),
        wait_ms: Math.round(e.responseStart - e.requestStart),
        total_ms: Math.round(e.duration),
        server_timing: e.serverTiming.map((s) => s.name + '=' + Math.round(s.duration)).join(' '),
      };
    })
);
```

## Server: access logs (live traffic, read-only)

- nginx `$request_time`: seconds with millisecond resolution, from the first byte read from the client to the log
  write after the last byte sent ([ngx_http_log_module](https://nginx.org/en/docs/http/ngx_http_log_module.html)).
  `$upstream_response_time`: time receiving the response from the upstream, such as PHP-FPM
  ([ngx_http_upstream_module](https://nginx.org/en/docs/http/ngx_http_upstream_module.html)).
- Apache `%D`: time to serve the request in microseconds; `%{ms}T` in milliseconds from 2.4.13
  ([mod_log_config](https://httpd.apache.org/docs/2.4/mod/mod_log_config.html)).
- nginx's predefined `combined` format has no request time (same nginx page). If the store's format lacks one, note
  it in the report as a recommendation for the host; the audit does not change server configuration.
- `node scripts/access-log-timings.mjs <log files> --time-field=last --unit=s` groups requests by checkout endpoint and
  prints count, 5xx count, p50, p75, p95 and maximum. It reads plain and `.gz` files, and prints no IP addresses,
  user agents or URLs. Use `--time-regex` when the time is not the last field, and `--since` to limit the period.
- Log files are personal data (IP addresses). Read them where they are; do not copy them off the server.

## Server: Query Monitor

- The admin toolbar shows page generation time, peak memory, database query time and query count; the panels to start
  with are Timeline, Queries by Component, HTTP API Calls, the object cache note in Overview, and Scripts
  ([how to use Query Monitor](https://querymonitor.com/docs/how-to-use)).
- Ajax: responses to jQuery Ajax requests carry Query Monitor data in their headers
  ([Query Monitor](https://wordpress.org/plugins/query-monitor/)), named `X-QM-overview-time-taken`,
  `X-QM-overview-memory` and so on ([Headers.php L13-L33](https://github.com/johnbillion/query-monitor/blob/4.0.7/output/Headers.php#L13-L33);
  [overview.php](https://github.com/johnbillion/query-monitor/blob/4.0.7/output/headers/overview.php)). Query Monitor
  treats a request as Ajax when `DOING_AJAX` is set
  ([Util.php L474-L479](https://github.com/johnbillion/query-monitor/blob/4.0.7/classes/Util.php#L474-L479)), which
  WooCommerce sets for `?wc-ajax=` requests during `init`
  ([class-wc-ajax.php L75-L89](https://github.com/woocommerce/woocommerce/blob/11.1.2/plugins/woocommerce/includes/class-wc-ajax.php#L75-L89)).
  If those headers are absent on `?wc-ajax=` responses, use the access log instead.
- REST: authenticated REST responses carry the overview and PHP error headers, and `?_envelope` adds a `qm` object
  with queries, duplicate queries, HTTP calls, object cache stats and updated transients. Authenticated means a user
  allowed to see Query Monitor, usually an administrator's session plus a `_wpnonce` parameter whose value
  `wp-admin/admin-ajax.php?action=rest-nonce` returns
  ([REST requests](https://querymonitor.com/wordpress-debugging/rest-api-requests/)). Store API requests are REST
  requests; add `_envelope` to a cart GET anywhere, and to a place-order POST only on staging.
- To see Query Monitor while logged out, on the path a guest takes, set its authentication cookie from its Settings
  panel ([Query Monitor](https://wordpress.org/plugins/query-monitor/)).
- Installing it is a change. On activation it symlinks `wp-content/db.php` when no such file exists (unless
  `QM_DB_SYMLINK` is false or file changes are disallowed) and removes it on deactivation
  ([Activation.php L31-L68](https://github.com/johnbillion/query-monitor/blob/4.0.7/classes/Activation.php#L31-L68)).
  It stores nothing and sends nothing to third parties (plugin page, privacy statement). Staging first; on production
  only with approval, deactivated and deleted afterwards.

## Server: Server-Timing

- A `Server-Timing` response header carries named durations that DevTools shows in the Network and Performance panels
  ([web.dev optimize TTFB](https://web.dev/articles/optimize-ttfb)).
- The Performance Lab plugin from the WordPress Performance Team sends `wp-before-template` to logged-in users, plus
  `wp-before-template-db-queries` when `SAVEQUERIES` is on, and `wp-template` and `wp-total` when its output
  buffering option is on
  ([defaults.php L29-L60, L144-L190](https://github.com/WordPress/performance/blob/2026-08-25/plugins/performance-lab/includes/server-timing/defaults.php#L144-L190);
  [class-perflab-server-timing.php L151-L176, L295-L323](https://github.com/WordPress/performance/blob/2026-08-25/plugins/performance-lab/includes/server-timing/class-perflab-server-timing.php#L151-L176)).
  It sends the header at `template_include` or from an output buffer
  ([L245-L285](https://github.com/WordPress/performance/blob/2026-08-25/plugins/performance-lab/includes/server-timing/class-perflab-server-timing.php#L245-L285)),
  so it covers page loads such as the checkout page, not Store API requests.
- `SAVEQUERIES` stores every query with its time and caller and costs performance itself
  ([debugging in WordPress](https://developer.wordpress.org/advanced-administration/debug/debug-wordpress/)). Use it
  on staging only.

## Recording a measurement

For every number, write down: what (metric and request), where (page, request name), how (tool and setting), when
(date and time, UTC), conditions (throttling, cart, cache state, logged in or not) and the runs (count, median,
slowest). The report format in `SKILL.md` has a column for the method.
