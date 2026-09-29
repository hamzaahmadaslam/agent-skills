#!/usr/bin/env node
// Read-only helper. Explains, product by product, what WooCommerce's sale rules expect at a given time and whether
// the stored _price agrees. It reads rows exported by the "Export" block of sale-state-checks.sql (tab-separated, as
// `wp db query` prints them, or comma-separated) from a file or from standard input, and prints a report. It makes no
// network requests, writes no files and changes nothing.
//
// Usage (Node.js 20 or later):
//   node explain-sale-state.mjs rows.tsv --tz=Europe/Lisbon
//   node explain-sale-state.mjs rows.tsv --tz=+05:30 --at=2026-11-30T23:59:59Z
//   SALE_AUDIT_BLOCK=Export bash sale-readonly-report.sh --path=/var/www/html | node explain-sale-state.mjs - --tz=UTC
//   node explain-sale-state.mjs rows.tsv --tz=Europe/Berlin --only=problems --format=json
//
// Options:
//   --tz=<zone>      The site timezone: an IANA name (timezone_string) or a fixed offset such as +05:30 (gmt_offset).
//                    Required, because the sale dates are UTC timestamps and the admin shows them in site time.
//   --at=<time>      Audit time: ISO 8601 with a zone (2026-11-30T12:00:00Z) or Unix seconds. Default: now.
//   --only=problems  Print only rows whose stored _price disagrees, or that match a known problem shape.
//   --format=json    One JSON object per row instead of text.
//
// Columns read (header names, any order): id, regular_price, sale_price, price, date_from, date_to; optional:
// post_type, product_type, parent_id, price_rows. "NULL" and empty cells count as empty.
// The rules follow WooCommerce 11.1.2: WC_Product::is_on_sale(), wc_apply_sale_state_for_product(),
// WC_Product_Data_Store_CPT::get_starting_sales() and get_ending_sales(). Sources: references/sale-data-model.md and
// references/scheduled-events.md.

import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const opts = { file: null, tz: null, at: null, only: null, format: "text" };
for (const arg of argv) {
  if (arg.startsWith("--tz=")) opts.tz = arg.slice(5);
  else if (arg.startsWith("--at=")) opts.at = arg.slice(5);
  else if (arg.startsWith("--only=")) opts.only = arg.slice(7);
  else if (arg.startsWith("--format=")) opts.format = arg.slice(9);
  else if (arg === "--help" || arg === "-h") usage(0);
  else if (!opts.file) opts.file = arg;
  else fail(`Unexpected argument: ${arg}`);
}

function usage(code) {
  console.log("Usage: node explain-sale-state.mjs <rows.tsv|-> --tz=<IANA zone or +HH:MM> [--at=<ISO or Unix>] [--only=problems] [--format=json]");
  process.exit(code);
}
function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!opts.file) usage(1);
if (!opts.tz) fail("--tz is required: pass the site's timezone_string (for example Europe/Lisbon) or its offset (for example +05:30).");
if (!["text", "json"].includes(opts.format)) fail("--format must be text or json.");
if (opts.only && opts.only !== "problems") fail("--only accepts only the value problems.");

// Timezone: an IANA name through Intl, or a fixed offset in minutes.
const offsetMatch = /^(UTC)?([+-])(\d{1,2}):?(\d{2})?$/.exec(opts.tz);
let fixedOffsetMinutes = null;
if (opts.tz === "UTC" || opts.tz === "Z") {
  fixedOffsetMinutes = 0;
} else if (offsetMatch) {
  fixedOffsetMinutes = (offsetMatch[2] === "-" ? -1 : 1) * (Number(offsetMatch[3]) * 60 + Number(offsetMatch[4] ?? 0));
} else {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: opts.tz }).format(0);
  } catch {
    fail(`Unknown timezone "${opts.tz}". Use an IANA name such as Europe/Lisbon, or an offset such as +05:30.`);
  }
}

// Audit time in Unix seconds.
let now;
if (!opts.at) now = Math.floor(Date.now() / 1000);
else if (/^\d{9,11}$/.test(opts.at)) now = Number(opts.at);
else {
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(opts.at)) fail("--at needs a zone (Z or an offset) or Unix seconds, so the time is not guessed.");
  const ms = Date.parse(opts.at);
  if (Number.isNaN(ms)) fail(`Cannot read --at value "${opts.at}".`);
  now = Math.floor(ms / 1000);
}

function pad(n) {
  return String(n).padStart(2, "0");
}
function utcString(ts) {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
// Wall-clock parts in the site timezone.
function siteParts(ts) {
  if (fixedOffsetMinutes !== null) {
    const d = new Date((ts + fixedOffsetMinutes * 60) * 1000);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: opts.tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ts * 1000));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}
function siteString(ts) {
  const p = siteParts(ts);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}
function siteClock(ts) {
  const p = siteParts(ts);
  return `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}
function duration(seconds) {
  const abs = Math.abs(seconds);
  const days = Math.floor(abs / 86400);
  const hours = Math.floor((abs % 86400) / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// Input.
let text;
try {
  text = opts.file === "-" ? readFileSync(0, "utf8") : readFileSync(opts.file, "utf8");
} catch (error) {
  fail(`Cannot read ${opts.file}: ${error.message}`);
}
const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
const headerIndex = lines.findIndex((l) => /(^|[\t,])id([\t,]|$)/.test(l) && /regular_price/.test(l));
if (headerIndex < 0) fail("No header row with id and regular_price found. Export with the Export block of sale-state-checks.sql.");
const sep = lines[headerIndex].includes("\t") ? "\t" : ",";
const header = lines[headerIndex].split(sep).map((h) => h.trim());
for (const required of ["id", "regular_price", "sale_price", "price", "date_from", "date_to"]) {
  if (!header.includes(required)) fail(`Missing column ${required}.`);
}
const rows = [];
for (const line of lines.slice(headerIndex + 1)) {
  const cells = line.split(sep);
  if (cells.length < header.length || !/^\d+$/.test(cells[header.indexOf("id")].trim())) continue; // report text or footers
  const row = {};
  header.forEach((h, i) => {
    const v = (cells[i] ?? "").trim();
    row[h] = v === "NULL" ? "" : v;
  });
  rows.push(row);
}

// Numbers as WooCommerce compares them: empty stays empty.
const num = (v) => (v === "" || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const ts = (v) => (v === "" || v === undefined ? null : /^\d+$/.test(v) ? (Number(v) === 0 ? null : Number(v)) : "invalid");

function explain(row) {
  const type = row.product_type || (row.post_type === "product_variation" ? "variation" : "");
  const regular = num(row.regular_price);
  const sale = num(row.sale_price);
  const stored = num(row.price);
  const from = ts(row.date_from);
  const to = ts(row.date_to);
  const notes = [];
  const out = { id: Number(row.id), type, parent_id: row.parent_id ?? "", regular_price: row.regular_price, sale_price: row.sale_price, stored_price: row.price };

  if (type === "variable" || type === "grouped") {
    out.verdict = "DERIVED";
    out.window = "not applicable";
    notes.push("Parent price is derived from its children: compare its _price rows with the children (variable-products.md).");
    if (row.price_rows) notes.push(`${row.price_rows} _price row(s) stored on the parent.`);
    out.notes = notes;
    return out;
  }
  if (from === "invalid" || to === "invalid") {
    out.verdict = "BAD_DATES";
    out.window = "unreadable";
    notes.push("A sale date is not stored as a Unix timestamp; WooCommerce CRUD always stores digits (sale-data-model.md).");
    out.notes = notes;
    return out;
  }

  // WC_Product::is_on_sale(): a non-empty sale price below the regular price, and now inside the dates that are set.
  const discount = row.sale_price !== "" && regular !== null && sale !== null && regular > sale;
  const started = !(from !== null && from > now);
  const notEnded = !(to !== null && to < now);
  const onSale = discount && started && notEnded;
  out.window = onSale ? "open" : !discount ? (row.sale_price === "" ? "no sale price" : "sale price not below regular") : !started ? "not started" : "ended";
  const expected = onSale ? sale : regular;
  out.expected_price = expected === null ? "" : String(expected);
  if (from !== null) out.sale_from = { utc: utcString(from), site: siteString(from) };
  if (to !== null) out.sale_to = { utc: utcString(to), site: siteString(to) };

  if (stored === expected) out.verdict = "OK";
  else if (stored !== null && sale !== null && stored === sale) out.verdict = "STALE_SALE_PRICE";
  else if (stored !== null && regular !== null && stored === regular) out.verdict = "STALE_REGULAR_PRICE";
  else if (stored === null) out.verdict = "NO_STORED_PRICE";
  else out.verdict = "CUSTOM_PRICE";

  if (out.verdict === "STALE_SALE_PRICE") notes.push("Sale price stored while the window is closed: the end (or a start before its time) was applied wrongly or not undone.");
  if (out.verdict === "STALE_REGULAR_PRICE") notes.push("Regular price stored while the window is open: the start was not applied.");
  if (out.verdict === "CUSTOM_PRICE") notes.push("Stored _price matches neither price; another plugin may set it on purpose (scheduled-events.md, handle_updated_props comment).");

  // Known shapes from the issues in version-notes.md.
  if (!["", "0"].includes(row.sale_price) && from !== null && from < now && to !== null && to < now && row.price !== row.sale_price) {
    notes.push("Completed sale that the 10.5.0 to 11.1.x daily query still selects as starting: reprocessed on every daily run (issue 66720; the fix is merged for 11.2.0 and is not in 11.1.2).");
  }
  if (from !== null && from < now && ["", "0"].includes(row.sale_price) && row.price !== row.sale_price) {
    notes.push("Start date with an empty or 0 sale price: selected by the daily query on every run and never settled (issue 67995, open).");
  }
  if (row.sale_price === "0" && onSale && stored !== 0) {
    notes.push("Sale price 0 is on sale by is_on_sale(), but the start handler skips a falsy sale price and does not write _price.");
  }
  if (row.sale_price !== "" && regular !== null && sale !== null && sale >= regular) {
    notes.push("Sale price is not below the regular price, so is_on_sale() is false; a CRUD save that changes either price clears the sale price.");
  }
  if (from !== null && to !== null && to < from) notes.push("End is before start: the window never opens.");
  if (to !== null) {
    const clock = siteClock(to);
    if (clock === "00:00:00") notes.push("Ends at 00:00:00 site time: the shape a date-only CSV import value gives; the product editor stores 23:59:59 (timezones-and-dates.md).");
    else if (clock !== "23:59:59") notes.push(`Ends at ${clock} site time, not the editor's 23:59:59: set by the API, an import, code, or before a timezone change.`);
  }
  if (from !== null && siteClock(from) !== "00:00:00") notes.push(`Starts at ${siteClock(from)} site time, not the editor's 00:00:00.`);
  if (from !== null && from > now) notes.push(`Starts in ${duration(from - now)}.`);
  if (to !== null && to > now && started) notes.push(`Ends in ${duration(to - now)}.`);
  out.notes = notes;
  return out;
}

const results = rows.map(explain);
const isProblem = (r) => !["OK", "DERIVED"].includes(r.verdict) || r.notes.some((n) => /issue \d+/.test(n));
const shown = opts.only === "problems" ? results.filter(isProblem) : results;

if (opts.format === "json") {
  for (const r of shown) console.log(JSON.stringify(r));
} else {
  const zoneLabel = fixedOffsetMinutes !== null && opts.tz !== "UTC" ? `fixed offset ${opts.tz}` : opts.tz;
  console.log(`Audit time: ${utcString(now)} UTC = ${siteString(now)} site time (${zoneLabel})`);
  console.log(`Rows read: ${rows.length}. Shown: ${shown.length}.`);
  const counts = {};
  for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  console.log(`Verdicts: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  for (const r of shown) {
    console.log("");
    console.log(`#${r.id} ${r.type || "product"}${r.parent_id && r.parent_id !== "0" ? ` (parent ${r.parent_id})` : ""}: ${r.verdict}`);
    console.log(`  regular ${r.regular_price || "-"} | sale ${r.sale_price || "-"} | stored _price ${r.stored_price || "-"} | expected ${r.expected_price ?? "-"} | window ${r.window}`);
    if (r.sale_from) console.log(`  from ${r.sale_from.site} site time (${r.sale_from.utc} UTC)`);
    if (r.sale_to) console.log(`  to   ${r.sale_to.site} site time (${r.sale_to.utc} UTC)`);
    for (const n of r.notes) console.log(`  - ${n}`);
  }
}
