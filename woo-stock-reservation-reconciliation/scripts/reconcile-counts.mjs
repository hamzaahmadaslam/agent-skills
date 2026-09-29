#!/usr/bin/env node
// Read-only helper. Reads the stock ledger (the tab-separated output of stock-ledger-hpos.sql or stock-ledger-posts.sql
// through `wp db query`) and, optionally, the owner's shelf count as CSV, and prints:
//   - products whose live holds cover all of _stock or more (the page shows stock, nobody can buy it);
//   - with a count: for each counted product, the _stock the count implies and the difference from today's _stock.
//
// It reads local files and prints to the terminal. It writes nothing, changes nothing and makes no network requests.
// Every difference it prints is a proposal: correcting _stock is change 5 in references/changes-and-rollback.md and
// needs the owner's approval per product.
//
// How the expected _stock is worked out (references/stock-reduction-and-restore.md):
//   expected _stock = counted units on the shelf - units of orders that took stock off _stock but have not shipped
// "Not shipped" is a store decision. By default it is processing and on-hold orders (--unshipped=processing,on-hold);
// a store that ships on-hold orders, or keeps shipped orders in processing, passes its own list.
// Reservations (live_held) never changed _stock, so they are not part of the expected value.
//
// Usage:
//   node reconcile-counts.mjs --ledger=ledger.tsv
//   node reconcile-counts.mjs --ledger=ledger.tsv --counts=counts.csv
//   node reconcile-counts.mjs --ledger=ledger.tsv --counts=counts.csv --unshipped=processing --json
//
// Count file: CSV with a header row, a "counted" column, and a "product_id" or "sku" column (product_id wins when both
// are filled in). Count the product or variation that manages the stock: a variation whose parent manages stock is
// counted on the parent's row. Example: examples/counts.csv (synthetic).

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const HELP = `Usage: node reconcile-counts.mjs --ledger=<ledger.tsv> [--counts=<counts.csv>]
                                 [--unshipped=processing,on-hold] [--json]`;

const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`); // a byte order mark at the start of a CSV saved by a spreadsheet
const UNSHIPPED_COLUMNS = { processing: "reduced_processing", "on-hold": "reduced_on_hold" };
const LEDGER_COLUMNS = ["product_id", "parent_id", "product_type", "sku", "stock", "stock_status", "live_held",
  "available_to_shoppers", "reduced_processing", "reduced_on_hold"];

export function parseArgs(argv) {
  const opts = { ledger: null, counts: null, unshipped: ["processing", "on-hold"], json: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--json") opts.json = true;
    else if (arg.startsWith("--ledger=")) opts.ledger = arg.slice(9);
    else if (arg.startsWith("--counts=")) opts.counts = arg.slice(9);
    else if (arg.startsWith("--unshipped=")) opts.unshipped = arg.slice(12).split(",").map((s) => s.trim()).filter(Boolean);
    else throw new Error(`Unknown argument ${arg}\n${HELP}`);
  }
  for (const status of opts.unshipped) {
    if (!(status in UNSHIPPED_COLUMNS)) throw new Error(`--unshipped takes processing and on-hold, not "${status}"`);
  }
  return opts;
}

// The mysql client in batch mode escapes tab, newline and backslash, and prints NULL for SQL NULL.
function unescapeField(value) {
  if (value === "NULL") return null;
  return value.replace(/\\(.)/g, (_, ch) => ({ t: "\t", n: "\n", r: "\r", "0": "\0", "\\": "\\" })[ch] ?? ch);
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseLedger(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) throw new Error("The ledger file is empty.");
  const header = lines[0].split("\t").map((h) => h.trim());
  const missing = LEDGER_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    throw new Error(`The ledger has no ${missing.join(", ")} column(s). Run stock-ledger-*.sql through wp db query without --skip-column-names.`);
  }
  return lines.slice(1).map((line, i) => {
    const cells = line.split("\t").map(unescapeField);
    if (cells.length !== header.length) throw new Error(`Ledger line ${i + 2} has ${cells.length} fields, the header has ${header.length}.`);
    const row = Object.fromEntries(header.map((h, j) => [h, cells[j]]));
    for (const key of ["product_id", "parent_id", "stock", "live_held", "available_to_shoppers", "reduced_processing", "reduced_on_hold"]) {
      row[key] = toNumber(row[key]);
    }
    return row;
  });
}

// Small CSV reader: commas, double quotes with "" inside, CRLF or LF.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export function parseCounts(text) {
  const rows = parseCsv(text.replace(BOM, ""));
  if (!rows.length) throw new Error("The count file is empty.");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  if (col("counted") < 0 || (col("product_id") < 0 && col("sku") < 0)) {
    throw new Error('The count file needs a header with "counted" and "product_id" or "sku".');
  }
  return rows.slice(1).map((r, i) => {
    const productId = col("product_id") >= 0 ? toNumber(r[col("product_id")]?.trim()) : null;
    const sku = col("sku") >= 0 ? (r[col("sku")] ?? "").trim() : "";
    const counted = toNumber(r[col("counted")]?.trim());
    if (counted === null) throw new Error(`Count line ${i + 2}: "counted" is not a number.`);
    if (productId === null && sku === "") throw new Error(`Count line ${i + 2}: neither product_id nor sku is filled in.`);
    return { line: i + 2, product_id: productId, sku, counted };
  });
}

const round = (n) => (n === null ? null : Math.round(n * 10000) / 10000);

export function reconcile(ledger, counts, opts) {
  const fullyHeld = ledger
    .filter((r) => r.stock !== null && r.live_held > 0 && r.live_held >= r.stock)
    .map((r) => ({ product_id: r.product_id, sku: r.sku, stock: r.stock, live_held: r.live_held, stock_status: r.stock_status }));
  const negativeStock = ledger.filter((r) => r.stock !== null && r.stock < 0).map((r) => ({ product_id: r.product_id, sku: r.sku, stock: r.stock }));

  const summary = {
    ledger_rows: ledger.length,
    live_held_units: round(ledger.reduce((n, r) => n + (r.live_held || 0), 0)),
    products_with_live_holds: ledger.filter((r) => r.live_held > 0).length,
    products_fully_held: fullyHeld.length,
    products_with_negative_stock: negativeStock.length,
    unshipped_statuses: opts.unshipped,
  };
  const result = { summary, fully_held: fullyHeld, negative_stock: negativeStock };
  if (!counts) return result;

  const byId = new Map(ledger.map((r) => [r.product_id, r]));
  const bySku = new Map();
  for (const r of ledger) {
    if (!r.sku) continue;
    bySku.set(r.sku, bySku.has(r.sku) ? "duplicate" : r);
  }
  const seen = new Set();
  const differences = [];
  const unmatched = [];
  let matched = 0;
  for (const c of counts) {
    let row = c.product_id !== null ? byId.get(c.product_id) : bySku.get(c.sku);
    if (row === "duplicate") {
      unmatched.push({ line: c.line, key: `sku ${c.sku}`, reason: "SKU is on more than one ledger row; use product_id" });
      continue;
    }
    if (!row) {
      unmatched.push({ line: c.line, key: c.product_id !== null ? `product_id ${c.product_id}` : `sku ${c.sku}`, reason: "not in the ledger (not stock-managed, trashed, or stock managed by the parent)" });
      continue;
    }
    if (seen.has(row.product_id)) {
      unmatched.push({ line: c.line, key: `product_id ${row.product_id}`, reason: "counted twice; add the counts up in one line" });
      continue;
    }
    seen.add(row.product_id);
    matched++;
    const unshipped = opts.unshipped.reduce((n, s) => n + (row[UNSHIPPED_COLUMNS[s]] || 0), 0);
    const expected = c.counted - unshipped;
    const diff = row.stock === null ? null : row.stock - expected;
    if (diff === null || Math.abs(diff) > 1e-9) {
      differences.push({
        product_id: row.product_id,
        sku: row.sku,
        counted: c.counted,
        unshipped_reduced: round(unshipped),
        expected_stock: round(expected),
        stock_now: row.stock,
        difference: round(diff),
        live_held: row.live_held,
      });
    }
  }
  differences.sort((a, b) => Math.abs(b.difference ?? Infinity) - Math.abs(a.difference ?? Infinity));
  result.counts = {
    count_lines: counts.length,
    matched,
    matching: matched - differences.length,
    differing: differences.length,
    unmatched: unmatched.length,
    ledger_rows_not_counted: ledger.length - seen.size,
  };
  result.differences = differences;
  result.unmatched = unmatched;
  return result;
}

function pad(value, width, right = true) {
  const s = value === null || value === undefined ? "-" : String(value);
  return right ? s.padStart(width) : s.padEnd(width);
}

function printText(res) {
  const s = res.summary;
  console.log("Stock reservation ledger (read-only)");
  console.log(`ledger rows: ${s.ledger_rows}   products with live holds: ${s.products_with_live_holds}   live held units: ${s.live_held_units}`);
  console.log(`unshipped statuses used: ${s.unshipped_statuses.join(", ") || "(none)"}`);

  console.log("\n== Products whose live holds cover all of _stock ==");
  console.log(`${pad("product_id", 11)}  ${pad("sku", 20, false)} ${pad("stock", 10)} ${pad("live_held", 10)}  stock_status`);
  for (const r of res.fully_held) console.log(`${pad(r.product_id, 11)}  ${pad(r.sku, 20, false)} ${pad(r.stock, 10)} ${pad(r.live_held, 10)}  ${r.stock_status ?? "-"}`);
  if (!res.fully_held.length) console.log("(none)");

  if (res.negative_stock.length) {
    console.log("\n== Products with _stock below zero (backorders, or reductions without stock) ==");
    for (const r of res.negative_stock) console.log(`${pad(r.product_id, 11)}  ${pad(r.sku, 20, false)} ${pad(r.stock, 10)}`);
  }

  if (!res.counts) {
    console.log("\nNo --counts file: pass the owner's shelf count to compare _stock with it.");
    return;
  }
  const c = res.counts;
  console.log(`\n== Count against _stock ==`);
  console.log(`count lines: ${c.count_lines}   matched: ${c.matched}   matching: ${c.matching}   differing: ${c.differing}   unmatched: ${c.unmatched}   ledger rows not counted: ${c.ledger_rows_not_counted}`);
  console.log(`${pad("product_id", 11)}  ${pad("sku", 20, false)} ${pad("counted", 9)} ${pad("unshipped", 10)} ${pad("expected", 9)} ${pad("stock_now", 10)} ${pad("difference", 11)} ${pad("live_held", 10)}`);
  for (const d of res.differences) {
    console.log(`${pad(d.product_id, 11)}  ${pad(d.sku, 20, false)} ${pad(d.counted, 9)} ${pad(d.unshipped_reduced, 10)} ${pad(d.expected_stock, 9)} ${pad(d.stock_now, 10)} ${pad(d.difference, 11)} ${pad(d.live_held, 10)}`);
  }
  if (!res.differences.length) console.log("(no differences)");
  for (const u of res.unmatched) console.log(`count line ${u.line}, ${u.key}: ${u.reason}`);
  console.log(
    "\ndifference = stock_now - expected. Positive: _stock is higher than the shelf supports (oversell risk)." +
      "\nNegative: _stock is lower than the shelf (lost sales). Each correction is change 5 in" +
      "\nreferences/changes-and-rollback.md, one product at a time, with the owner's approval. Nothing was changed."
  );
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (opts.help || !opts.ledger) {
    console.log(HELP);
    process.exit(opts.help ? 0 : 2);
  }
  let ledger;
  let counts = null;
  try {
    ledger = parseLedger(readFileSync(opts.ledger, "utf8"));
    if (opts.counts) counts = parseCounts(readFileSync(opts.counts, "utf8"));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const res = reconcile(ledger, counts, opts);
  if (opts.json) console.log(JSON.stringify(res, null, 2));
  else printText(res);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
