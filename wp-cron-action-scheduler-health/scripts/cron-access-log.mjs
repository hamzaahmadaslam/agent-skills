#!/usr/bin/env node
// Read-only helper. Counts requests to wp-cron.php and to Action Scheduler's async runner
// (admin-ajax.php?action=as_async_request_queue_runner) in web server access logs in the common or combined format,
// per hour, by client (WordPress's own loopback, curl, Wget, a client named "Action Scheduler", other), by status
// class, by whether the request carried a doing_wp_cron value, and by source (private network or outside). It also
// counts page requests that carry ?doing_wp_cron, which ALTERNATE_WP_CRON's redirects produce. It reads the files it
// is given (plain or .gz) and prints a report; it writes nothing, makes no network requests, and prints no IP
// addresses, query strings or user agent strings.
//
// Usage:
//   node cron-access-log.mjs access.log [access.log.1 access.log.2.gz ...]
//   node cron-access-log.mjs access.log --after=2026-09-26T10:05:00Z   # time of the change: loopbacks after it are flagged
//   node cron-access-log.mjs access.log --since=2026-09-25T00:00:00Z --until=2026-09-26T00:00:00Z --json
//
// Clients: WordPress sends "WordPress/<version>; <site URL>" as its User-Agent for its loopback requests, and curl
// sends "curl/<version>" (references/wp-cron-internals.md, references/server-cron-setup.md). Behind a proxy or CDN,
// the logged address may be the proxy's, so "private network" and "outside" describe the last hop only.

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const option = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : "";
};
const flag = (name) => args.includes(`--${name}`);

if (files.length === 0 || flag("help")) {
  console.log("Usage: node cron-access-log.mjs <access log> [...] [--after=<ISO time>] [--since=<ISO time>] [--until=<ISO time>] [--json]");
  process.exit(files.length === 0 ? 1 : 0);
}

const parseOption = (name, fallback) => {
  const text = option(name);
  if (!text) return fallback;
  const value = Date.parse(text);
  if (Number.isNaN(value)) {
    console.error(`--${name} is not a date: ${text}`);
    process.exit(1);
  }
  return value;
};
const since = parseOption("since", Number.NEGATIVE_INFINITY);
const until = parseOption("until", Number.POSITIVE_INFINITY);
const after = parseOption("after", null);

// host ident user [time] "METHOD target PROTOCOL" status bytes ["referer" "user agent"]
const LINE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) \S+(?: "[^"]*" "([^"]*)")?/;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function parseTime(text) {
  // 26/Sep/2026:10:00:01 +0000
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(text);
  if (!m || !(m[2] in MONTHS)) return NaN;
  const utc = Date.UTC(Number(m[3]), MONTHS[m[2]], Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
  const offset = (Number(m[8]) * 60 + Number(m[9])) * 60000 * (m[7] === "+" ? 1 : -1);
  return utc - offset;
}

function client(agent) {
  if (!agent || agent === "-") return "none";
  if (/^WordPress\//i.test(agent)) return "WordPress loopback";
  if (/Action Scheduler/i.test(agent)) return "Action Scheduler";
  if (/^curl\//i.test(agent)) return "curl";
  if (/^Wget\//i.test(agent)) return "Wget";
  return "other";
}

function source(host) {
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return "private network";
  if (/^(::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(host)) return "private network";
  return "outside";
}

function statusClass(code) {
  if (code >= 200 && code < 300) return "2xx";
  if (code >= 300 && code < 400) return "3xx";
  if (code === 401 || code === 403 || code === 404 || code === 429) return String(code);
  if (code >= 500) return "5xx";
  return "other";
}

const bump = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n);
const totals = { lines: 0, unparsed: 0, cron: 0, asyncRunner: 0, alternateRedirects: 0 };
const byClient = new Map();
const byStatus = new Map();
const bySource = new Map();
const byLockValue = new Map();
const loopbackAfter = { count: 0, first: null };
const hours = new Map();
let first = Infinity;
let last = -Infinity;

for (const file of files) {
  let text;
  try {
    const buffer = readFileSync(file);
    text = file.endsWith(".gz") ? gunzipSync(buffer).toString("utf8") : buffer.toString("utf8");
  } catch (error) {
    console.error(`Cannot read ${file}: ${error.code || error.message}`);
    process.exit(1);
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    totals.lines += 1;
    const m = LINE.exec(line);
    if (!m) {
      totals.unparsed += 1;
      continue;
    }
    const time = parseTime(m[2]);
    if (Number.isNaN(time) || time < since || time > until) continue;
    first = Math.min(first, time);
    last = Math.max(last, time);
    const target = m[4];
    const [path, query = ""] = target.split("?", 2);
    const hourKey = new Date(time).toISOString().slice(0, 13) + ":00Z";
    if (!hours.has(hourKey)) hours.set(hourKey, { cron: 0, loopback: 0, curl: 0, wget: 0, other: 0, notOk: 0, asyncRunner: 0 });
    const hour = hours.get(hourKey);
    const status = Number(m[5]);

    if (/\/wp-cron\.php$/.test(path)) {
      const who = client(m[6]);
      const lockMatch = /(?:^|&)doing_wp_cron=([^&]*)/.exec(query);
      totals.cron += 1;
      bump(byClient, who);
      bump(byStatus, `${who} ${statusClass(status)}`);
      bump(bySource, source(m[1]));
      bump(byLockValue, lockMatch && lockMatch[1] ? "with a doing_wp_cron value (WordPress's own spawn)" : "without a value (an outside caller or a server cron)");
      hour.cron += 1;
      if (who === "WordPress loopback") hour.loopback += 1;
      else if (who === "curl") hour.curl += 1;
      else if (who === "Wget") hour.wget += 1;
      else hour.other += 1;
      if (status < 200 || status >= 300) hour.notOk += 1;
      if (after !== null && who === "WordPress loopback" && time > after) {
        loopbackAfter.count += 1;
        if (loopbackAfter.first === null) loopbackAfter.first = new Date(time).toISOString();
      }
    } else if (/\/admin-ajax\.php$/.test(path) && /(?:^|&)action=as_async_request_queue_runner(?:&|$)/.test(query)) {
      totals.asyncRunner += 1;
      hour.asyncRunner += 1;
    } else if (/(?:^|&)doing_wp_cron=/.test(query)) {
      totals.alternateRedirects += 1;
    }
  }
}

// Hours with no matching line still count: fill them in between the first and the last line read.
if (Number.isFinite(first)) {
  for (let hour = Math.floor(first / 3600000); hour <= Math.floor(last / 3600000); hour += 1) {
    const key = new Date(hour * 3600000).toISOString().slice(0, 13) + ":00Z";
    if (!hours.has(key)) hours.set(key, { cron: 0, loopback: 0, curl: 0, wget: 0, other: 0, notOk: 0, asyncRunner: 0 });
  }
}
const hourRows = [...hours.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([hour, h]) => ({ hour, ...h }));
const quietHours = hourRows.filter((h) => h.cron === 0).map((h) => h.hour);
const report = {
  files,
  from: Number.isFinite(first) ? new Date(first).toISOString().replace(".000Z", "Z") : null,
  to: Number.isFinite(last) ? new Date(last).toISOString().replace(".000Z", "Z") : null,
  totals,
  wpCronByClient: Object.fromEntries(byClient),
  wpCronByClientAndStatus: Object.fromEntries(byStatus),
  wpCronBySource: Object.fromEntries(bySource),
  wpCronByLockValue: Object.fromEntries(byLockValue),
  loopbacksAfterChange: after === null ? undefined : loopbackAfter,
  hoursWithoutWpCron: quietHours,
  hours: hourRows,
};

if (flag("json")) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const list = (map) => {
  if (map.size === 0) return ["  none"];
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([key, n]) => `  ${String(n).padStart(7)}  ${key}`);
};

console.log(`Access log summary: ${files.join(", ")}`);
console.log(`Covered: ${report.from || "-"} to ${report.to || "-"} (UTC); ${totals.lines} lines, ${totals.unparsed} not in common or combined format`);
console.log("");
console.log(`wp-cron.php requests: ${totals.cron}`);
console.log("By client:");
list(byClient).forEach((l) => console.log(l));
console.log("By client and status:");
list(byStatus).forEach((l) => console.log(l));
console.log("By source address:");
list(bySource).forEach((l) => console.log(l));
console.log("By doing_wp_cron value:");
list(byLockValue).forEach((l) => console.log(l));
console.log("");
console.log(`Async runner requests (admin-ajax.php?action=as_async_request_queue_runner): ${totals.asyncRunner}`);
console.log(`Page requests with ?doing_wp_cron (ALTERNATE_WP_CRON redirects): ${totals.alternateRedirects}`);
if (after !== null) {
  console.log("");
  const afterText = new Date(after).toISOString().replace(".000Z", "Z");
  console.log(
    loopbackAfter.count
      ? `After ${afterText}: ${loopbackAfter.count} wp-cron.php request(s) from WordPress's own loopback, first at ${loopbackAfter.first.replace(".000Z", "Z")}. Page views still start WP-Cron: DISABLE_WP_CRON is not in effect for this site, or another install shares this log.`
      : `After ${afterText}: no wp-cron.php requests from WordPress's own loopback.`,
  );
}
console.log("");
console.log(`Hours without any wp-cron.php request: ${quietHours.length ? quietHours.slice(0, 24).join(", ") + (quietHours.length > 24 ? ` (${quietHours.length - 24} more)` : "") : "none"}`);
console.log("");
console.log("  hour (UTC)            wp-cron  loopback  curl  wget  other  not-2xx  async-runner");
for (const h of hourRows.slice(-72)) {
  console.log(
    `  ${h.hour.padEnd(20)} ${String(h.cron).padStart(8)} ${String(h.loopback).padStart(9)} ${String(h.curl).padStart(5)} ${String(h.wget).padStart(5)} ${String(h.other).padStart(6)} ${String(h.notOk).padStart(8)} ${String(h.asyncRunner).padStart(13)}`,
  );
}
if (hourRows.length > 72) console.log(`  (${hourRows.length - 72} earlier hours in --json)`);
