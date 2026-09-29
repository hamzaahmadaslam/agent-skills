#!/usr/bin/env node
// Read-only helper. Summarises the mismatch rows that lookup-readonly-report.sh prints (the "Detail" blocks of
// lookup-checks.sql), and compares two reports taken before and after a repair.
//
// It reads local text files and prints to the terminal. It writes nothing and makes no network requests. The rows it
// reads hold product IDs, SKUs, prices, stock values and attribute term IDs (catalog data); it prints IDs, counts and
// column names, and never the SKU or price values from the detail column.
//
// Usage:
//   node summarise-lookup-report.mjs lookup-report-before.txt
//   node summarise-lookup-report.mjs lookup-report-before.txt lookup-report-after.txt   # compare two runs
//   node summarise-lookup-report.mjs report.txt --top=20 --json
//
// Input: the report text, or any output of `wp db query` that holds Detail rows. A Detail row has six tab-separated
// fields: class, product_id, parent_id, taxonomy, term_id, detail. A line "-- count Detail <class>: ..." followed by a
// number gives the full count for that class; without it the summary counts the listed rows only.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const HELP = `Usage: node summarise-lookup-report.mjs <report.txt> [<report-after.txt>] [--top=10] [--json]`;

// Fixed labels and severities; references/mismatch-classes.md explains each class.
export const CLASSES = {
  "meta.missing_row": ["high", "product or variation has no meta lookup row"],
  "meta.orphan_row": ["low", "meta lookup row for a deleted post or another post type"],
  "meta.stale_value": ["high", "meta lookup values differ from post meta"],
  "meta.no_price": ["high", "no _price in post meta (a regeneration copies it as is)"],
  "attr.orphan_row": ["medium", "attribute rows for a deleted or trashed product"],
  "attr.structure_mismatch": ["medium", "attribute rows with the wrong parent or variation flag"],
  "attr.deleted_term": ["medium", "attribute rows for a deleted term"],
  "attr.stale_term": ["high", "attribute rows for a term the product no longer has"],
  "attr.missing_term_row": ["high", "product term with no attribute row"],
  "attr.missing_product_rows": ["high", "product with attribute terms and no rows at all"],
  "attr.missing_variation_rows": ["high", "variation attribute with no row"],
  "attr.variation_term_mismatch": ["high", "variation row term differs from the variation's value"],
  "attr.stale_stock": ["medium", "in_stock contradicts _stock_status"],
};

const CLASS_RE = /^(meta|attr)\.[a-z_]+$/;
const COUNT_RE = /^-- count Detail ((?:meta|attr)\.[a-z_]+)\b/;

export function parseArgs(argv) {
  const opts = { files: [], top: 10, json: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--json") opts.json = true;
    else if (arg.startsWith("--top=")) opts.top = Number(arg.slice(6));
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}\n${HELP}`);
    else opts.files.push(arg);
  }
  if (!Number.isInteger(opts.top) || opts.top < 1) throw new Error("--top takes a whole number above 0");
  if (opts.files.length > 2) throw new Error(`Give one report, or two to compare.\n${HELP}`);
  return opts;
}

const clean = (v) => (v === undefined || v === "NULL" ? "" : String(v).trim());

/** Parse report text into full counts per class and the listed rows. */
export function parseReport(text) {
  const counts = new Map();
  const rows = [];
  let pendingCount = null;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const countHeader = line.match(COUNT_RE);
    if (countHeader) {
      pendingCount = countHeader[1];
      continue;
    }
    if (pendingCount) {
      if (/^\d+$/.test(line.trim())) {
        counts.set(pendingCount, Number(line.trim()));
        pendingCount = null;
        continue;
      }
      if (line.startsWith("-- ") || line.startsWith("== ")) pendingCount = null;
    }
    const fields = line.split("\t");
    if (fields.length !== 6 || !CLASS_RE.test(fields[0])) continue;
    rows.push({
      class: fields[0],
      product_id: clean(fields[1]),
      parent_id: clean(fields[2]),
      taxonomy: clean(fields[3]),
      term_id: clean(fields[4]),
      detail: clean(fields[5]),
    });
  }
  return { counts, rows };
}

const rowKey = (r) => [r.class, r.product_id, r.parent_id, r.taxonomy, r.term_id].join("|");

function tally(values) {
  const m = new Map();
  for (const v of values) if (v !== "") m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

/** Summarise one parsed report. */
export function summarise(parsed, top = 10) {
  const names = new Set([...parsed.counts.keys(), ...parsed.rows.map((r) => r.class)]);
  const classes = [...names].sort().map((name) => {
    const listed = parsed.rows.filter((r) => r.class === name);
    const full = parsed.counts.has(name) ? parsed.counts.get(name) : null;
    const entry = {
      class: name,
      severity: (CLASSES[name] || ["unknown"])[0],
      label: (CLASSES[name] || ["", "not a class this helper knows"])[1],
      count: full,
      listed: listed.length,
      capped: full !== null && listed.length < full,
      products: new Set(listed.map((r) => r.product_id)).size,
      // A parent_id of 0 is a product without a parent.
      parents: new Set(listed.map((r) => r.parent_id).filter((p) => p !== "" && p !== "0")).size,
    };
    if (name === "meta.stale_value") {
      const columns = [];
      for (const r of listed) {
        const m = r.detail.match(/^columns: ([a-z_,]+)/);
        if (m) columns.push(...m[1].split(","));
      }
      entry.columns = tally(columns).map(([column, rows]) => ({ column, rows }));
    }
    if (name.startsWith("attr.")) {
      entry.top_parents = tally(listed.map((r) => r.parent_id)).slice(0, top).map(([parent_id, rows]) => ({ parent_id, rows }));
      entry.taxonomies = tally(listed.map((r) => r.taxonomy)).slice(0, top).map(([taxonomy, rows]) => ({ taxonomy, rows }));
    }
    return entry;
  });
  return { classes, listed_rows: parsed.rows.length };
}

/** Compare two parsed reports: counts per class, and listed rows fixed, remaining and new. */
export function compare(before, after) {
  const names = new Set([
    ...before.counts.keys(), ...after.counts.keys(),
    ...before.rows.map((r) => r.class), ...after.rows.map((r) => r.class),
  ]);
  return [...names].sort().map((name) => {
    const b = new Set(before.rows.filter((r) => r.class === name).map(rowKey));
    const a = new Set(after.rows.filter((r) => r.class === name).map(rowKey));
    const bCount = before.counts.has(name) ? before.counts.get(name) : null;
    const aCount = after.counts.has(name) ? after.counts.get(name) : null;
    return {
      class: name,
      severity: (CLASSES[name] || ["unknown"])[0],
      count_before: bCount,
      count_after: aCount,
      listed_fixed: [...b].filter((k) => !a.has(k)).length,
      listed_remaining: [...b].filter((k) => a.has(k)).length,
      listed_new: [...a].filter((k) => !b.has(k)).length,
      capped: (bCount !== null && b.size < bCount) || (aCount !== null && a.size < aCount),
    };
  });
}

const pad = (v, w, right = false) => {
  const s = v === null || v === undefined ? "-" : String(v);
  return right ? s.padStart(w) : s.padEnd(w);
};

function printSummary(file, s) {
  console.log(`Lookup mismatch summary (read-only): ${file}`);
  console.log(`listed rows read: ${s.listed_rows}`);
  if (!s.classes.length) {
    console.log("No Detail rows or counts found. Is this the output of lookup-readonly-report.sh?");
    return;
  }
  console.log(`\n${pad("class", 30)} ${pad("severity", 8)} ${pad("count", 8, true)} ${pad("listed", 7, true)} ${pad("products", 9, true)} ${pad("parents", 8, true)}  meaning`);
  for (const c of s.classes) {
    console.log(`${pad(c.class, 30)} ${pad(c.severity, 8)} ${pad(c.count, 8, true)} ${pad(c.listed, 7, true)} ${pad(c.products, 9, true)} ${pad(c.parents, 8, true)}  ${c.label}${c.capped ? " (listing capped)" : ""}`);
  }
  for (const c of s.classes) {
    if (c.columns && c.columns.length) {
      console.log(`\n${c.class}: stale columns among listed rows`);
      for (const { column, rows } of c.columns) console.log(`  ${pad(column, 28)} ${pad(rows, 7, true)}`);
    }
    if (c.top_parents && c.top_parents.length && c.listed) {
      console.log(`\n${c.class}: parents with the most listed rows`);
      for (const { parent_id, rows } of c.top_parents) console.log(`  parent ${pad(parent_id, 12)} ${pad(rows, 7, true)}`);
      if (c.taxonomies.length) console.log(`  taxonomies: ${c.taxonomies.map((t) => `${t.taxonomy} (${t.rows})`).join(", ")}`);
    }
  }
  console.log("\ncount is the full number from the report's count line; listed, products and parents cover listed rows only.");
}

function printComparison(files, rows) {
  console.log(`Lookup mismatch comparison (read-only)\nbefore: ${files[0]}\nafter:  ${files[1]}`);
  console.log(`\n${pad("class", 30)} ${pad("severity", 8)} ${pad("before", 8, true)} ${pad("after", 8, true)} ${pad("fixed", 7, true)} ${pad("remain", 7, true)} ${pad("new", 7, true)}`);
  for (const r of rows) {
    console.log(`${pad(r.class, 30)} ${pad(r.severity, 8)} ${pad(r.count_before, 8, true)} ${pad(r.count_after, 8, true)} ${pad(r.listed_fixed, 7, true)} ${pad(r.listed_remaining, 7, true)} ${pad(r.listed_new, 7, true)}${r.capped ? "  (listing capped)" : ""}`);
  }
  console.log("\nbefore and after are full counts; fixed, remain and new compare listed rows only. When a listing is capped,");
  console.log("raise LOOKUP_DETAIL_LIMIT for both runs before reading the row columns.");
}

function main() {
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
  const parsed = [];
  for (const file of opts.files) {
    try {
      parsed.push(parseReport(readFileSync(file, "utf8")));
    } catch (err) {
      console.error(`Cannot read ${file}: ${err.message}`);
      process.exit(1);
    }
  }
  if (parsed.length === 2) {
    const rows = compare(parsed[0], parsed[1]);
    if (opts.json) console.log(JSON.stringify({ before: opts.files[0], after: opts.files[1], classes: rows }, null, 2));
    else printComparison(opts.files, rows);
    return;
  }
  const summary = summarise(parsed[0], opts.top);
  if (opts.json) console.log(JSON.stringify({ file: opts.files[0], ...summary }, null, 2));
  else printSummary(opts.files[0], summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
