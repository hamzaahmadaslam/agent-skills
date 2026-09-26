#!/usr/bin/env node
// Read-only helper. Reads web server access logs and prints request-time percentiles for checkout endpoints
// (checkout page, wc-ajax actions, Store API routes, cart fragments, admin-ajax, wp-cron.php, gateway callbacks).
//
// It reads local files (plain or .gz) line by line and prints aggregates only: no IP addresses, user agents, referrers,
// cookies or URLs. Endpoint names come from classify-request.mjs, which drops query strings and IDs. It writes nothing
// and makes no network requests.
//
// The log format must include the request time. nginx: add $request_time (seconds) or $upstream_response_time;
// Apache: %D (microseconds) or %{ms}T. See references/measuring.md.
//
// Usage:
//   node access-log-timings.mjs /var/log/nginx/access.log                      # time is the last field, in seconds
//   node access-log-timings.mjs access.log access.log.1.gz --since=2026-09-20
//   node access-log-timings.mjs access.log --time-field=last-1                 # time is the second-to-last field
//   node access-log-timings.mjs access.log --time-regex='rt=([0-9.]+)'         # time found by a regular expression
//   node access-log-timings.mjs access_log --unit=us                          # Apache %D
//   node access-log-timings.mjs access.log --checkout-path=/kasse/ --json
//
// Expects the common or combined layout around the request: [day/Mon/year:hh:mm:ss zone] "METHOD target HTTP/x" status.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";
import { classifyRequest, percentile } from "./classify-request.mjs";

const HELP = `Usage: node access-log-timings.mjs <log> [more logs] [--time-field=last|last-1|last-2] [--time-regex=<re>]
                                  [--unit=s|ms|us] [--since=YYYY-MM-DD] [--until=YYYY-MM-DD]
                                  [--checkout-path=/checkout/] [--cart-path=/cart/] [--account-path=/my-account/]
                                  [--include-other] [--json]`;

const UNIT_TO_MS = { s: 1000, ms: 1, us: 0.001 };
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const REQUEST_RE = /"([A-Z]+) (\S+) HTTP\/[0-9.]+"\s+(\d{3})\s/;
const TIME_RE = /\[(\d{2})\/([A-Z][a-z]{2})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})\]/;

export function parseArgs(argv) {
  const opts = {
    files: [],
    timeField: "last",
    timeRegex: null,
    unit: "s",
    since: null,
    until: null,
    checkoutPath: "/checkout/",
    cartPath: "/cart/",
    accountPath: "/my-account/",
    includeOther: false,
    json: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--include-other") opts.includeOther = true;
    else if (arg.startsWith("--time-field=")) opts.timeField = arg.slice(13);
    else if (arg.startsWith("--time-regex=")) opts.timeRegex = new RegExp(arg.slice(13));
    else if (arg.startsWith("--unit=")) opts.unit = arg.slice(7);
    else if (arg.startsWith("--since=")) opts.since = Date.parse(`${arg.slice(8)}T00:00:00Z`);
    else if (arg.startsWith("--until=")) opts.until = Date.parse(`${arg.slice(8)}T00:00:00Z`) + 86400000;
    else if (arg.startsWith("--checkout-path=")) opts.checkoutPath = arg.slice(16);
    else if (arg.startsWith("--cart-path=")) opts.cartPath = arg.slice(12);
    else if (arg.startsWith("--account-path=")) opts.accountPath = arg.slice(15);
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}\n${HELP}`);
    else opts.files.push(arg);
  }
  if (!(opts.unit in UNIT_TO_MS)) throw new Error(`--unit must be s, ms or us, not "${opts.unit}"`);
  if (!/^last(-[0-9])?$/.test(opts.timeField)) throw new Error(`--time-field must be last, last-1 or last-2, not "${opts.timeField}"`);
  if (Number.isNaN(opts.since) || Number.isNaN(opts.until)) throw new Error("--since and --until take a date as YYYY-MM-DD");
  return opts;
}

function logTime(line) {
  const m = line.match(TIME_RE);
  if (!m) return null;
  const [, d, mon, y, hh, mm, ss, sign, zh, zm] = m;
  if (!(mon in MONTHS)) return null;
  const utc = Date.UTC(Number(y), MONTHS[mon], Number(d), Number(hh), Number(mm), Number(ss));
  const offset = (Number(zh) * 60 + Number(zm)) * 60000 * (sign === "+" ? 1 : -1);
  return utc - offset;
}

function duration(line, opts) {
  let raw;
  if (opts.timeRegex) {
    const m = line.match(opts.timeRegex);
    raw = m ? m[1] : null;
  } else {
    const fields = line.trim().split(/\s+/);
    const back = opts.timeField === "last" ? 0 : Number(opts.timeField.slice(5));
    raw = fields[fields.length - 1 - back];
  }
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).replace(/^"|"$/g, "");
  // nginx writes "0.123, 0.456" or "0.123 : 0.456" for retried upstreams; take the last value.
  const value = Number(cleaned.split(/[,:]/).pop().trim());
  if (!Number.isFinite(value) || value < 0 || cleaned === "-") return null;
  return value * UNIT_TO_MS[opts.unit];
}

export function createAggregator(opts) {
  const stats = {
    lines: 0,
    unparsed: 0,
    without_time: 0,
    outside_period: 0,
    static_skipped: 0,
    other_skipped: 0,
    first: null,
    last: null,
  };
  const groups = new Map();

  function add(line) {
    stats.lines++;
    const req = line.match(REQUEST_RE);
    if (!req) {
      stats.unparsed++;
      return;
    }
    const when = logTime(line);
    if (when !== null) {
      if ((opts.since && when < opts.since) || (opts.until && when >= opts.until)) {
        stats.outside_period++;
        return;
      }
      stats.first = stats.first === null ? when : Math.min(stats.first, when);
      stats.last = stats.last === null ? when : Math.max(stats.last, when);
    }
    const [, method, target, statusText] = req;
    const { name, group } = classifyRequest(method, target, opts);
    if (group === "static") {
      stats.static_skipped++;
      return;
    }
    if (group === "other" && !opts.includeOther) {
      stats.other_skipped++;
      return;
    }
    const ms = duration(line, opts);
    if (ms === null) {
      stats.without_time++;
      return;
    }
    const g = groups.get(name) || { name, group, times: [], errors: 0 };
    g.times.push(ms);
    if (Number(statusText) >= 500) g.errors++;
    groups.set(name, g);
  }

  function result() {
    const rows = [...groups.values()].map((g) => {
      const t = g.times.sort((a, b) => a - b);
      const r = (v) => (v === null ? null : Math.round(v));
      return {
        name: g.name,
        group: g.group,
        count: t.length,
        errors_5xx: g.errors,
        p50_ms: r(percentile(t, 50)),
        p75_ms: r(percentile(t, 75)),
        p95_ms: r(percentile(t, 95)),
        max_ms: r(t[t.length - 1]),
      };
    });
    const order = ["page", "checkout-ajax", "store-api", "cart-fragments", "add-to-cart", "wc-ajax", "admin-ajax", "rest", "gateway-callback", "cron", "other"];
    rows.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || b.count - a.count);
    return {
      stats: {
        ...stats,
        first: stats.first === null ? null : new Date(stats.first).toISOString(),
        last: stats.last === null ? null : new Date(stats.last).toISOString(),
      },
      endpoints: rows,
    };
  }

  return { add, result };
}

async function readFile(path, onLine) {
  let stream = createReadStream(path);
  if (path.endsWith(".gz")) stream = stream.pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) onLine(line);
}

function printText(res, opts) {
  const s = res.stats;
  const pad = (v, w, right = true) => {
    const x = v === null || v === undefined ? "-" : String(v);
    return right ? x.padStart(w) : x.padEnd(w);
  };
  console.log("Access log timings (read-only)");
  console.log(`files: ${opts.files.length}   lines: ${s.lines}   period: ${s.first ?? "?"} to ${s.last ?? "?"}`);
  console.log(
    `skipped: ${s.unparsed} unparsed, ${s.outside_period} outside the period, ${s.static_skipped} static files, ` +
      `${s.other_skipped} other pages, ${s.without_time} without a request time`
  );
  if (s.lines && s.without_time > (s.lines - s.unparsed - s.static_skipped - s.other_skipped - s.outside_period) / 2) {
    console.log("More than half of the matching lines had no readable time: check --time-field, --time-regex and --unit.");
  }
  console.log(`\n${pad("endpoint", 46, false)} ${pad("count", 8)} ${pad("5xx", 6)} ${pad("p50 ms", 8)} ${pad("p75 ms", 8)} ${pad("p95 ms", 8)} ${pad("max ms", 9)}`);
  for (const r of res.endpoints) {
    console.log(`${pad(r.name, 46, false)} ${pad(r.count, 8)} ${pad(r.errors_5xx, 6)} ${pad(r.p50_ms, 8)} ${pad(r.p75_ms, 8)} ${pad(r.p95_ms, 8)} ${pad(r.max_ms, 9)}`);
  }
  if (!res.endpoints.length) console.log("(no checkout endpoints found: check --checkout-path and the log format)");
  console.log("\nPercentiles use the nearest-rank method. Times are what the server logged, not what the browser saw.");
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (opts.help || !opts.files.length) {
    console.log(HELP);
    process.exit(opts.help ? 0 : 2);
  }
  const agg = createAggregator(opts);
  for (const file of opts.files) {
    try {
      await readFile(file, agg.add);
    } catch (err) {
      console.error(`Cannot read ${file}: ${err.message}`);
      process.exit(1);
    }
  }
  const res = agg.result();
  if (opts.json) console.log(JSON.stringify(res, null, 2));
  else printText(res, opts);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
