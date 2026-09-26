#!/usr/bin/env node
// Read-only helper. Summarizes saved CrUX API responses (records:queryRecord) and CrUX History API responses
// (records:queryHistoryRecord): the 75th percentile of each metric with its rating, the good / needs improvement /
// poor shares, the Core Web Vitals assessment, LCP resource types and LCP image subparts, navigation types, and for
// history responses the p75 per weekly collection period with the largest week-over-week rise.
//
// It reads the JSON files you name and prints a report. It writes no files and makes no network requests; fetch
// the JSON yourself first (references/field-data-sources.md has the curl commands). Node 20 or later, no
// dependencies. A file may hold one response, a JSON array of responses, or one response per line.
//
// Usage:
//   node scripts/crux-summary.mjs origin-phone.json url-phone.json
//   node scripts/crux-summary.mjs history-phone.json --periods=12
//   node scripts/crux-summary.mjs *.json --json
//
// Exit codes: 0 done, 1 bad arguments, 2 input not readable or not JSON.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Thresholds from web.dev (LCP, INP, CLS) and PageSpeed Insights (FCP, TTFB). A value up to and including the
// first number is good, up to and including the second needs improvement, above it is poor.
export const THRESHOLDS = {
  largest_contentful_paint: [2500, 4000],
  interaction_to_next_paint: [200, 500],
  cumulative_layout_shift: [0.1, 0.25],
  first_contentful_paint: [1800, 3000],
  experimental_time_to_first_byte: [800, 1800],
};

const LABELS = {
  largest_contentful_paint: "LCP",
  interaction_to_next_paint: "INP",
  cumulative_layout_shift: "CLS",
  first_contentful_paint: "FCP",
  experimental_time_to_first_byte: "TTFB (experimental)",
};

const SUBPARTS = [
  ["largest_contentful_paint_image_time_to_first_byte", "TTFB"],
  ["largest_contentful_paint_image_resource_load_delay", "resource load delay"],
  ["largest_contentful_paint_image_resource_load_duration", "resource load duration"],
  ["largest_contentful_paint_image_element_render_delay", "element render delay"],
];

export function rate(metric, value) {
  const t = THRESHOLDS[metric];
  if (!t || value === null || value === undefined || Number.isNaN(Number(value))) return "";
  const v = Number(value);
  if (v <= t[0]) return "good";
  if (v <= t[1]) return "needs improvement";
  return "poor";
}

function formatValue(metric, value) {
  if (value === null || value === undefined || value === "" || Number.isNaN(Number(value))) return "-";
  if (metric === "cumulative_layout_shift") return Number(value).toFixed(2);
  return `${Math.round(Number(value)).toLocaleString("en-US")} ms`;
}

function pct(x) {
  return x === null || x === undefined || Number.isNaN(Number(x)) ? "-" : `${(Number(x) * 100).toFixed(1)}%`;
}

function date(d) {
  if (!d) return "?";
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

function keyText(key = {}) {
  const target = key.url ? `url ${key.url}` : key.origin ? `origin ${key.origin}` : "unknown key";
  return `${target}, ${key.formFactor || "all form factors"}`;
}

function parseInput(text, file) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const value = JSON.parse(trimmed);
    return Array.isArray(value) ? value : [value];
  } catch {
    // One JSON document per line.
    return trimmed.split(/\r?\n/).filter((l) => l.trim()).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`${file}: line ${index + 1} is not JSON`);
      }
    });
  }
}

export function summarizeDaily(response) {
  const record = response.record || {};
  const metrics = record.metrics || {};
  const out = { key: record.key || {}, period: record.collectionPeriod || null, metrics: {}, normalized: response.urlNormalizationDetails || null };
  for (const metric of Object.keys(THRESHOLDS)) {
    const m = metrics[metric];
    if (!m) continue;
    const p75 = m.percentiles ? m.percentiles.p75 : null;
    const bins = (m.histogram || []).map((b) => b.density);
    out.metrics[metric] = { p75: p75 === null ? null : Number(p75), rating: rate(metric, p75), good: bins[0], ni: bins[1], poor: bins[2] };
  }
  const lcp = out.metrics.largest_contentful_paint;
  const cls = out.metrics.cumulative_layout_shift;
  const inp = out.metrics.interaction_to_next_paint;
  if (!lcp || !cls) out.cwv = "cannot be assessed (LCP or CLS has no data)";
  else {
    const failing = [lcp, inp, cls]
      .map((m, i) => (m && m.rating !== "good" ? `${["LCP", "INP", "CLS"][i]} ${m.rating}` : null))
      .filter(Boolean);
    out.cwv = failing.length ? `not passed: ${failing.join("; ")}` : inp ? "passed" : "passed on LCP and CLS (no INP data)";
  }
  out.subparts = SUBPARTS.map(([name, label]) => ({ label, p75: metrics[name]?.percentiles?.p75 ?? null })).filter((s) => s.p75 !== null);
  out.resourceType = metrics.largest_contentful_paint_resource_type?.fractions || null;
  out.navigationTypes = metrics.navigation_types?.fractions || null;
  out.formFactors = metrics.form_factors?.fractions || null;
  const rtt = metrics.round_trip_time;
  out.rtt = rtt ? { p75: rtt.percentiles?.p75 ?? null, bins: (rtt.histogram || []).map((b) => b.density) } : null;
  return out;
}

export function summarizeHistory(response, maxPeriods) {
  const record = response.record || {};
  const periods = record.collectionPeriods || response.collectionPeriods || [];
  const metrics = record.metrics || {};
  const series = {};
  for (const metric of [...Object.keys(THRESHOLDS), ...SUBPARTS.map(([n]) => n)]) {
    const p75s = metrics[metric]?.percentilesTimeseries?.p75s;
    if (p75s) series[metric] = p75s.map((v) => (v === null || v === "NaN" ? null : Number(v)));
  }
  const out = { key: record.key || {}, periods: periods.map((p) => ({ first: date(p.firstDate), last: date(p.lastDate) })), series, rows: [], stats: {} };
  for (const [metric, values] of Object.entries(series)) {
    const present = values.filter((v) => v !== null);
    if (!present.length) continue;
    let rise = { delta: 0, index: -1 };
    for (let i = 1; i < values.length; i++) {
      if (values[i] === null || values[i - 1] === null) continue;
      const delta = values[i] - values[i - 1];
      if (delta > rise.delta) rise = { delta, index: i };
    }
    const t = THRESHOLDS[metric];
    let crossed = -1;
    if (t) {
      for (let i = 1; i < values.length; i++) {
        if (values[i] !== null && values[i - 1] !== null && values[i - 1] <= t[0] && values[i] > t[0]) crossed = i;
      }
    }
    out.stats[metric] = {
      first: present[0],
      last: present[present.length - 1],
      min: Math.min(...present),
      max: Math.max(...present),
      rise: rise.index >= 0 ? { delta: rise.delta, periodEnd: out.periods[rise.index]?.last } : null,
      crossedGood: crossed >= 0 ? out.periods[crossed]?.last : null,
    };
  }
  const start = Math.max(0, out.periods.length - maxPeriods);
  for (let i = start; i < out.periods.length; i++) {
    const row = { end: out.periods[i].last, change: {} };
    for (const metric of Object.keys(series)) {
      row[metric] = series[metric][i];
      const before = i > 0 ? series[metric][i - 1] : null;
      row.change[metric] = row[metric] !== null && before !== null ? row[metric] - before : null;
    }
    out.rows.push(row);
  }
  return out;
}

function printDaily(s) {
  const line = (t = "") => console.log(t);
  line(`== ${keyText(s.key)}${s.period ? `  (${date(s.period.firstDate)} to ${date(s.period.lastDate)})` : ""}`);
  if (s.normalized) line(`URL normalized by CrUX: ${s.normalized.originalUrl} -> ${s.normalized.normalizedUrl}`);
  line("metric                 p75         rating              good    needs   poor");
  for (const [metric, m] of Object.entries(s.metrics)) {
    line(`${LABELS[metric].padEnd(22)} ${formatValue(metric, m.p75).padEnd(11)} ${(m.rating || "-").padEnd(19)} ${pct(m.good).padEnd(7)} ${pct(m.ni).padEnd(7)} ${pct(m.poor)}`);
  }
  line(`Core Web Vitals at p75: ${s.cwv}`);
  if (s.resourceType) line(`LCP resource type: ${Object.entries(s.resourceType).map(([k, v]) => `${k} ${pct(v)}`).join(", ")}`);
  if (s.subparts.length) {
    const largest = s.subparts.reduce((a, b) => (b.p75 > a.p75 ? b : a));
    line(`LCP image subparts, each its own p75 (they do not add up to LCP): ${s.subparts.map((p) => `${p.label} ${formatValue("x", p.p75)}`).join(" | ")}`);
    line(`  largest subpart: ${largest.label}`);
  }
  if (s.navigationTypes) line(`Navigation types: ${Object.entries(s.navigationTypes).map(([k, v]) => `${k} ${pct(v)}`).join(", ")}`);
  if (s.formFactors) line(`Form factors: ${Object.entries(s.formFactors).map(([k, v]) => `${k} ${pct(v)}`).join(", ")}`);
  if (s.rtt) line(`Round trip time (the visitors' network, not the site): p75 ${formatValue("x", s.rtt.p75)}; low ${pct(s.rtt.bins[0])}, medium ${pct(s.rtt.bins[1])}, high ${pct(s.rtt.bins[2])}`);
  line();
}

function printHistory(h) {
  const line = (t = "") => console.log(t);
  const span = h.periods.length ? `${h.periods[0].first} to ${h.periods[h.periods.length - 1].last}` : "no periods";
  line(`== History: ${keyText(h.key)}, ${h.periods.length} weekly 28-day periods (${span})`);
  line("metric                 first       last        min         max         largest weekly rise");
  for (const [metric, st] of Object.entries(h.stats)) {
    const label = LABELS[metric] || SUBPARTS.find(([n]) => n === metric)?.[1] || metric;
    const rise = st.rise ? `+${formatValue(metric, st.rise.delta)} (period ending ${st.rise.periodEnd})` : "-";
    line(`${label.padEnd(22)} ${formatValue(metric, st.first).padEnd(11)} ${formatValue(metric, st.last).padEnd(11)} ${formatValue(metric, st.min).padEnd(11)} ${formatValue(metric, st.max).padEnd(11)} ${rise}`);
    if (st.crossedGood) line(`${"".padEnd(22)} crossed the good threshold in the period ending ${st.crossedGood}`);
  }
  const shown = Object.keys(h.series).filter((m) => THRESHOLDS[m]);
  if (h.rows.length && shown.length) {
    line();
    line(`p75 per period (last ${h.rows.length}; each period covers the 28 days ending on that date):`);
    line(`end         ${shown.map((m) => `${LABELS[m].split(" ")[0]} (change)`.padEnd(22)).join(" ")}`);
    const cell = (m, row) => {
      const change = row.change[m];
      const sign = change === null ? "" : change > 0 ? " (+" : change < 0 ? " (-" : " (";
      const delta = change === null ? "" : `${sign}${formatValue(m, Math.abs(change)).replace(" ms", "")})`;
      return `${formatValue(m, row[m])}${delta}`.padEnd(22);
    };
    for (const row of h.rows) line(`${row.end}  ${shown.map((m) => cell(m, row)).join(" ")}`);
  }
  line("A step change needs four weekly periods to fill the 28-day window, so it shows as a ramp; it began in the week");
  line("before the end date of the first period that moved.");
  line();
}

function main() {
  const args = process.argv.slice(2);
  let json = false;
  let maxPeriods = 40;
  const files = [];
  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/crux-summary.mjs <response.json> [...] [--periods=<n>] [--json]");
      return;
    } else if (arg.startsWith("--periods=")) {
      maxPeriods = Number.parseInt(arg.slice(10), 10);
      if (!Number.isFinite(maxPeriods) || maxPeriods < 1) {
        console.error("crux-summary: --periods needs a positive number");
        process.exit(1);
      }
    } else if (arg.startsWith("--")) {
      console.error(`crux-summary: unknown option ${arg}`);
      process.exit(1);
    } else files.push(arg);
  }
  if (!files.length) {
    console.error("crux-summary: name at least one saved CrUX API response (JSON)");
    process.exit(1);
  }
  const results = [];
  for (const file of files) {
    let responses;
    try {
      responses = parseInput(readFileSync(file, "utf8"), file);
    } catch (error) {
      console.error(`crux-summary: ${error.message}`);
      process.exit(2);
    }
    for (const response of responses) {
      if (response && response.error) {
        results.push({ file, error: response.error });
        continue;
      }
      if (response && (response.loadingExperience || response.lighthouseResult)) {
        results.push({ file, error: { message: "this is a PageSpeed Insights API response; save a CrUX API response instead" } });
        continue;
      }
      const record = response && response.record;
      if (!record) {
        results.push({ file, error: { message: "no record in this JSON" } });
        continue;
      }
      const isHistory = Boolean(record.collectionPeriods || response.collectionPeriods) ||
        Object.values(record.metrics || {}).some((m) => m.percentilesTimeseries || m.histogramTimeseries || m.fractionTimeseries);
      results.push(isHistory ? { file, history: summarizeHistory(response, maxPeriods) } : { file, daily: summarizeDaily(response) });
    }
  }
  if (json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  for (const r of results) {
    if (r.error) {
      const code = r.error.code ? `${r.error.code} ${r.error.status || ""} ` : "";
      console.log(`== ${r.file}: ${code}${r.error.message || "error"}`);
      if (r.error.code === 404) console.log("   No CrUX data for this key: check the exact origin (scheme, www) or try the origin instead of the URL.");
      console.log();
    } else if (r.daily) printDaily(r.daily);
    else printHistory(r.history);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
