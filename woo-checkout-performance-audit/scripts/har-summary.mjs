#!/usr/bin/env node
// Read-only helper. Summarises a HAR file exported from a browser's Network panel for a checkout performance audit:
// each checkout request with its status, server wait and total time, size and timing headers, then totals per
// endpoint and per host (first-party and third-party).
//
// It reads one local file and prints to the terminal. It writes nothing and makes no network requests. It never prints
// cookies, request or response bodies, query strings or header values, except the values of the Server-Timing and
// X-QM-overview-time-taken response headers. It warns when the file holds cookies (a "sanitized" export leaves them
// out) or request bodies (which keep what was typed into forms); delete such a file after the audit.
//
// Usage:
//   node har-summary.mjs checkout.har
//   node har-summary.mjs checkout.har --site=shop.example.com       # first-party host (default: host of the first page)
//   node har-summary.mjs checkout.har --checkout-path=/kasse/       # when the checkout page is not /checkout/
//   node har-summary.mjs checkout.har --json                        # machine-readable output
//
// Field meanings follow the HAR 1.2 spec: timings.wait is the wait for the server's first byte, time is the sum of the
// timings. Sizes are response headersSize + bodySize (bytes received), 0 for responses served from cache.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { classifyRequest, percentile } from "./classify-request.mjs";

const HELP = `Usage: node har-summary.mjs <file.har> [--site=<host>] [--checkout-path=/checkout/] [--cart-path=/cart/]
                                  [--account-path=/my-account/] [--json]`;

function parseArgs(argv) {
  const opts = { file: null, site: null, checkoutPath: "/checkout/", cartPath: "/cart/", accountPath: "/my-account/", json: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--json") opts.json = true;
    else if (arg.startsWith("--site=")) opts.site = arg.slice(7).toLowerCase();
    else if (arg.startsWith("--checkout-path=")) opts.checkoutPath = arg.slice(16);
    else if (arg.startsWith("--cart-path=")) opts.cartPath = arg.slice(12);
    else if (arg.startsWith("--account-path=")) opts.accountPath = arg.slice(15);
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}\n${HELP}`);
    else opts.file = arg;
  }
  return opts;
}

function headerValue(headers, name) {
  const found = (headers || []).find((h) => String(h.name).toLowerCase() === name);
  return found ? String(found.value) : "";
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// Registrable-ish comparison: shop.example.com and cdn.shop.example.com are the same party; example.net is not.
function sameParty(host, site) {
  if (!host || !site) return false;
  return host === site || host.endsWith(`.${site}`) || site.endsWith(`.${host}`);
}

const round = (n) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n));
const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;

function pad(value, width, right = false) {
  const s = value === null || value === undefined ? "-" : String(value);
  return right ? s.padStart(width) : s.padEnd(width);
}

export function summarise(har, opts) {
  const entries = har?.log?.entries;
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("No log.entries in this file: is it a HAR export?");

  const first = entries.reduce((a, e) => (Date.parse(e.startedDateTime) < Date.parse(a.startedDateTime) ? e : a), entries[0]);
  const t0 = Date.parse(first.startedDateTime);
  const firstPage = entries.find((e) => /text\/html/i.test(e.response?.content?.mimeType || "")) || first;
  const site = opts.site || hostOf(firstPage.request?.url);

  let withCookies = 0;
  let withBodies = 0;
  const rows = [];
  for (const e of entries) {
    const req = e.request || {};
    const res = e.response || {};
    const hasCookie =
      (req.cookies || []).length > 0 ||
      (res.cookies || []).length > 0 ||
      (req.headers || []).some((h) => /^cookie$/i.test(h.name)) ||
      (res.headers || []).some((h) => /^set-cookie$/i.test(h.name));
    if (hasCookie) withCookies++;
    if (req.postData && (req.postData.text || (req.postData.params || []).length)) withBodies++;

    const url = String(req.url || "");
    const host = hostOf(url);
    const mime = String(res.content?.mimeType || "").toLowerCase();
    const { name, group } = classifyRequest(req.method, url, opts);
    const bytes = Math.max(0, Number(res.headersSize) || 0) + Math.max(0, Number(res.bodySize) || 0);
    rows.push({
      start_ms: round(Date.parse(e.startedDateTime) - t0),
      name,
      group,
      method: String(req.method || ""),
      status: Number(res.status) || 0,
      wait_ms: e.timings && e.timings.wait >= 0 ? round(e.timings.wait) : null,
      total_ms: round(Number(e.time)),
      bytes,
      host,
      third_party: !sameParty(host, site),
      is_script: /javascript|ecmascript/.test(mime),
      server_timing: headerValue(res.headers, "server-timing").slice(0, 120),
      qm_time_taken: headerValue(res.headers, "x-qm-overview-time-taken"),
    });
  }

  const checkoutRows = rows
    .filter((r) => !["static", "other"].includes(r.group) && !r.third_party)
    .sort((a, b) => a.start_ms - b.start_ms);

  const byName = new Map();
  for (const r of checkoutRows) {
    const s = byName.get(r.name) || { name: r.name, group: r.group, count: 0, waits: [], totals: [], bytes: 0, errors: 0 };
    s.count++;
    // Status 0 means the request was blocked or aborted: count it as an error, keep it out of the timings.
    if (r.status > 0 && r.wait_ms !== null) s.waits.push(r.wait_ms);
    if (r.status > 0 && r.total_ms !== null) s.totals.push(r.total_ms);
    s.bytes += r.bytes;
    if (r.status >= 500 || r.status === 0) s.errors++;
    byName.set(r.name, s);
  }
  const endpoints = [...byName.values()].map((s) => {
    const w = [...s.waits].sort((a, b) => a - b);
    const t = [...s.totals].sort((a, b) => a - b);
    return {
      name: s.name,
      group: s.group,
      count: s.count,
      errors: s.errors,
      wait_median_ms: percentile(w, 50),
      wait_max_ms: w.length ? w[w.length - 1] : null,
      total_median_ms: percentile(t, 50),
      total_max_ms: t.length ? t[t.length - 1] : null,
      kb: kb(s.bytes),
    };
  });

  const byHost = new Map();
  for (const r of rows) {
    const h = byHost.get(r.host) || { host: r.host || "(none)", third_party: r.third_party, requests: 0, bytes: 0, script_bytes: 0, time_sum_ms: 0 };
    h.requests++;
    h.bytes += r.bytes;
    if (r.is_script) h.script_bytes += r.bytes;
    h.time_sum_ms += r.total_ms || 0;
    byHost.set(r.host, h);
  }
  const hosts = [...byHost.values()]
    .map((h) => ({ host: h.host, party: h.third_party ? "third" : "first", requests: h.requests, kb: kb(h.bytes), script_kb: kb(h.script_bytes), time_sum_ms: h.time_sum_ms }))
    .sort((a, b) => b.kb - a.kb);

  const totalBytes = rows.reduce((n, r) => n + r.bytes, 0);
  const thirdBytes = rows.filter((r) => r.third_party).reduce((n, r) => n + r.bytes, 0);
  const lastEnd = rows.reduce((max, r) => Math.max(max, (r.start_ms || 0) + (r.total_ms || 0)), 0);

  return {
    file_summary: {
      entries: rows.length,
      pages: (har.log.pages || []).length,
      first_party_host: site,
      span_s: Math.round(lastEnd / 100) / 10,
      total_kb: kb(totalBytes),
      third_party_requests: rows.filter((r) => r.third_party).length,
      third_party_kb: kb(thirdBytes),
      entries_with_cookies: withCookies,
      entries_with_request_bodies: withBodies,
    },
    checkout_requests: checkoutRows.map(({ bytes, host, third_party, is_script, ...r }) => ({ ...r, kb: kb(bytes) })),
    endpoints,
    hosts,
  };
}

function printText(s) {
  const f = s.file_summary;
  console.log("HAR summary (read-only)");
  console.log(`entries: ${f.entries}   pages: ${f.pages}   first-party host: ${f.first_party_host}   span: ${f.span_s} s`);
  console.log(`transferred: ${f.total_kb} KB   third-party: ${f.third_party_requests} requests, ${f.third_party_kb} KB`);
  if (f.entries_with_cookies || f.entries_with_request_bodies) {
    console.log(
      `\nWARNING: entries with cookies: ${f.entries_with_cookies}; entries with request bodies: ${f.entries_with_request_bodies}.` +
        "\nExport again with \"Export HAR (sanitized)\", use a test customer, and delete this file after the audit."
    );
  }

  console.log("\n== Checkout-related requests (first-party), in order ==");
  console.log(`${pad("start ms", 9, true)}  ${pad("request", 44)} ${pad("status", 6, true)} ${pad("wait ms", 8, true)} ${pad("total ms", 9, true)} ${pad("KB", 7, true)}  timing headers`);
  for (const r of s.checkout_requests) {
    const timing = [r.server_timing && `server-timing: ${r.server_timing}`, r.qm_time_taken && `qm: ${r.qm_time_taken} s`].filter(Boolean).join("; ");
    console.log(`${pad(r.start_ms, 9, true)}  ${pad(r.name, 44)} ${pad(r.status, 6, true)} ${pad(r.wait_ms, 8, true)} ${pad(r.total_ms, 9, true)} ${pad(r.kb, 7, true)}  ${timing}`);
  }
  if (!s.checkout_requests.length) console.log("(none: check --site and --checkout-path)");

  console.log("\n== Per endpoint ==");
  console.log(`${pad("request", 44)} ${pad("count", 6, true)} ${pad("errors", 7, true)} ${pad("wait p50", 9, true)} ${pad("wait max", 9, true)} ${pad("total p50", 10, true)} ${pad("total max", 10, true)}`);
  for (const e of [...s.endpoints].sort((a, b) => b.count - a.count)) {
    console.log(`${pad(e.name, 44)} ${pad(e.count, 6, true)} ${pad(e.errors, 7, true)} ${pad(e.wait_median_ms, 9, true)} ${pad(e.wait_max_ms, 9, true)} ${pad(e.total_median_ms, 10, true)} ${pad(e.total_max_ms, 10, true)}`);
  }
  if (s.endpoints.length) console.log("p50 is the nearest-rank median: with an even count, the lower of the two middle values.");

  console.log("\n== Hosts (by KB transferred, top 20) ==");
  console.log(`${pad("host", 40)} ${pad("party", 6)} ${pad("requests", 9, true)} ${pad("KB", 8, true)} ${pad("script KB", 10, true)} ${pad("time sum ms", 12, true)}`);
  for (const h of s.hosts.slice(0, 20)) {
    console.log(`${pad(h.host, 40)} ${pad(h.party, 6)} ${pad(h.requests, 9, true)} ${pad(h.kb, 8, true)} ${pad(h.script_kb, 10, true)} ${pad(h.time_sum_ms, 12, true)}`);
  }
  console.log("\nTime sum adds up request durations; requests overlap, so it is not wall-clock time.");
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (opts.help || !opts.file) {
    console.log(HELP);
    process.exit(opts.help ? 0 : 2);
  }
  let har;
  try {
    har = JSON.parse(readFileSync(opts.file, "utf8"));
  } catch (err) {
    console.error(`Cannot read ${opts.file} as JSON: ${err.message}`);
    process.exit(1);
  }
  let summary;
  try {
    summary = summarise(har, opts);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (opts.json) console.log(JSON.stringify(summary, null, 2));
  else printText(summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
