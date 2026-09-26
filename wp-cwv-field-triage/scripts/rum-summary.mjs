#!/usr/bin/env node
// Read-only helper. Summarizes real-user Core Web Vitals beacons collected with the web-vitals attribution build
// (the payload format in references/rum-attribution.md): the 75th percentile per page type or page, and for the slow
// part of the distribution, where the time went (LCP subparts, INP phases) and which WordPress component owns it
// (LCP resource URLs and Long Animation Frame script URLs mapped to plugin, theme, core or third party).
//
// It reads the files you name and prints a report. It writes no files and makes no network requests. Node 20 or
// later, no dependencies. Input: one JSON object per line, or one JSON array of objects per line (a batch sent by
// one page view). The same metric instance can arrive more than once (CLS and INP are reported again when the page is
// hidden); records are de-duplicated by name and id, keeping the last INP report (INP can fall as interactions add
// up) and the highest value of the other metrics.
//
// Usage:
//   node scripts/rum-summary.mjs beacons.ndjson --site=https://www.example.com
//   node scripts/rum-summary.mjs beacons.ndjson --site=https://www.example.com --by=page --metric=INP
//   node scripts/rum-summary.mjs beacons.ndjson --device=mobile --chromium-only --json
//
// Options:
//   --site=<url>            The site's origin, used to tell the site's files from third-party files.
//   --cdn=<host,host>       Hosts that serve the site's own files.
//   --content-dir=<name>    Content directory name if it is not wp-content.
//   --by=<field>            Group by pageType (default), page, device, or none.
//   --metric=<name>         LCP, INP, CLS, FCP, TTFB, or all (default all).
//   --device=<kind>         mobile, desktop, or all (default all).
//   --chromium-only         Keep only beacons from Chromium browsers (closer to CrUX, which is Chrome only).
//   --logged-in=<mode>      include (default), exclude, or only.
//   --min-samples=<n>       Groups with fewer records are marked "low sample" (default 50).
//   --top=<n>               How many owners, targets and URLs to list (default 5).
//   --json                  Print JSON.
//
// Exit codes: 0 done, 1 bad arguments, 2 input not readable.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyUrl, cleanUrl } from "./wp-owner.mjs";

// web.dev thresholds for LCP, INP, CLS; PageSpeed Insights thresholds for FCP and TTFB.
const THRESHOLDS = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800] };
const METRICS = ["LCP", "INP", "CLS", "FCP", "TTFB"];

function rate(name, value) {
  const t = THRESHOLDS[name];
  if (value <= t[0]) return "good";
  if (value <= t[1]) return "needs improvement";
  return "poor";
}

// Nearest-rank percentile: the smallest value with at least p of the records at or below it.
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function fmt(name, value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return name === "CLS" ? value.toFixed(3) : `${Math.round(value).toLocaleString("en-US")} ms`;
}

function pct(part, whole) {
  if (!whole || part === null || part === undefined || Number.isNaN(part)) return "-";
  return `${((part / whole) * 100).toFixed(0)}%`;
}

function countTop(items, top) {
  const counts = new Map();
  for (const item of items) {
    if (item === undefined || item === null || item === "") continue;
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
}

function parseArgs(argv) {
  const opts = { by: "pageType", metric: "all", device: "all", loggedIn: "include", minSamples: 50, top: 5, cdn: [], json: false, chromiumOnly: false, files: [] };
  for (const arg of argv) {
    const [key, value] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, ""];
    switch (key) {
      case "--json": opts.json = true; break;
      case "--chromium-only": opts.chromiumOnly = true; break;
      case "--help": case "-h": opts.help = true; break;
      case "--site": opts.site = value; break;
      case "--cdn": opts.cdn = value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean); break;
      case "--content-dir": opts.contentDir = value.replace(/^\/+|\/+$/g, ""); break;
      case "--by":
        if (!["pageType", "page", "device", "none"].includes(value)) throw new Error("--by must be pageType, page, device or none");
        opts.by = value; break;
      case "--metric":
        if (value !== "all" && !METRICS.includes(value.toUpperCase())) throw new Error("--metric must be LCP, INP, CLS, FCP, TTFB or all");
        opts.metric = value === "all" ? "all" : value.toUpperCase(); break;
      case "--device":
        if (!["mobile", "desktop", "all"].includes(value)) throw new Error("--device must be mobile, desktop or all");
        opts.device = value; break;
      case "--logged-in":
        if (!["include", "exclude", "only"].includes(value)) throw new Error("--logged-in must be include, exclude or only");
        opts.loggedIn = value; break;
      case "--min-samples": opts.minSamples = Number.parseInt(value, 10); break;
      case "--top": opts.top = Number.parseInt(value, 10); break;
      default:
        if (key.startsWith("--")) throw new Error(`unknown option ${key}`);
        opts.files.push(arg);
    }
  }
  if (!Number.isFinite(opts.minSamples) || opts.minSamples < 1) throw new Error("--min-samples needs a positive number");
  if (!Number.isFinite(opts.top) || opts.top < 1) throw new Error("--top needs a positive number");
  return opts;
}

export function readRecords(texts) {
  const records = [];
  let skipped = 0;
  for (const text of texts) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        skipped += 1;
        continue;
      }
      for (const r of Array.isArray(value) ? value : [value]) {
        if (r && METRICS.includes(r.name) && Number.isFinite(Number(r.value))) records.push({ ...r, value: Number(r.value) });
        else skipped += 1;
      }
    }
  }
  // De-duplicate repeated reports of one metric instance. CLS and LCP only grow, so their highest value is the final
  // one. INP takes the longest interaction but skips one per 50 interactions, so it can fall: the last report wins.
  const byId = new Map();
  const anonymous = [];
  for (const r of records) {
    if (!r.id) {
      anonymous.push(r);
      continue;
    }
    const key = `${r.name}|${r.id}`;
    const seen = byId.get(key);
    if (!seen || r.name === "INP" || r.value > seen.value) byId.set(key, r);
  }
  return { records: [...byId.values(), ...anonymous], skipped, duplicates: records.length - byId.size - anonymous.length };
}

function device(r) {
  return r.mobile === true ? "mobile" : r.mobile === false ? "desktop" : "unknown";
}

function groupKey(r, by) {
  if (by === "none") return "all";
  if (by === "device") return device(r);
  if (by === "page") return cleanUrl(r.page || "(no page)");
  return r.pageType || "(no page type)";
}

function lcpDetail(slow, ownerOf, top) {
  const shares = { ttfb: 0, delay: 0, duration: 0, render: 0 };
  let counted = 0;
  const urls = [];
  const targets = [];
  let text = 0;
  for (const r of slow) {
    const a = r.attribution || {};
    const parts = [a.timeToFirstByte, a.resourceLoadDelay, a.resourceLoadDuration, a.elementRenderDelay].map(Number);
    if (parts.every(Number.isFinite) && r.value > 0) {
      shares.ttfb += parts[0] / r.value;
      shares.delay += parts[1] / r.value;
      shares.duration += parts[2] / r.value;
      shares.render += parts[3] / r.value;
      counted += 1;
    }
    if (a.url) urls.push(a.url);
    else text += 1;
    if (a.target) targets.push(a.target);
  }
  const avg = (x) => (counted ? x / counted : null);
  const owners = countTop(urls.map((u) => ownerOf(u).owner), top);
  return {
    slow: slow.length,
    averageShare: { timeToFirstByte: avg(shares.ttfb), resourceLoadDelay: avg(shares.delay), resourceLoadDuration: avg(shares.duration), elementRenderDelay: avg(shares.render) },
    withoutResource: text,
    resourceOwners: owners,
    resources: countTop(urls.map(cleanUrl), top),
    targets: countTop(targets, top),
  };
}

function inpDetail(slow, ownerOf, top) {
  const shares = { input: 0, processing: 0, presentation: 0 };
  let counted = 0;
  const loadStates = [];
  const targets = [];
  const invokerTypes = [];
  const ownerTime = new Map();
  const functions = new Map();
  let withScript = 0;
  for (const r of slow) {
    const a = r.attribution || {};
    const parts = [a.inputDelay, a.processingDuration, a.presentationDelay].map(Number);
    if (parts.every(Number.isFinite) && r.value > 0) {
      shares.input += parts[0] / r.value;
      shares.processing += parts[1] / r.value;
      shares.presentation += parts[2] / r.value;
      counted += 1;
    }
    loadStates.push(a.loadState);
    targets.push(a.interactionTarget);
    const longest = a.longestScript;
    if (longest && longest.entry) {
      withScript += 1;
      const e = longest.entry;
      invokerTypes.push(e.invokerType);
      const o = ownerOf(e.sourceURL || "").owner;
      const ms = Number(longest.intersectingDuration) || 0;
      const current = ownerTime.get(o) || { owner: o, ms: 0, interactions: 0, subparts: new Map() };
      current.ms += ms;
      current.interactions += 1;
      current.subparts.set(longest.subpart, (current.subparts.get(longest.subpart) || 0) + 1);
      ownerTime.set(o, current);
      const fnKey = `${o}  ${e.sourceFunctionName || "(anonymous)"}  ${e.invoker || ""}  ${cleanUrl(e.sourceURL || "")}`;
      functions.set(fnKey, (functions.get(fnKey) || 0) + ms);
    }
  }
  const avg = (x) => (counted ? x / counted : null);
  return {
    slow: slow.length,
    averageShare: { inputDelay: avg(shares.input), processingDuration: avg(shares.processing), presentationDelay: avg(shares.presentation) },
    loadStates: countTop(loadStates, 4),
    targets: countTop(targets, top),
    withLongestScript: withScript,
    invokerTypes: countTop(invokerTypes, 6),
    scriptOwners: [...ownerTime.values()]
      .sort((x, y) => y.ms - x.ms)
      .slice(0, top)
      .map((o) => ({ owner: o.owner, ms: Math.round(o.ms), interactions: o.interactions, subparts: Object.fromEntries(o.subparts) })),
    functions: [...functions.entries()].sort((x, y) => y[1] - x[1]).slice(0, top).map(([key, ms]) => ({ key, ms: Math.round(ms) })),
  };
}

function clsDetail(slow, top) {
  const a = slow.map((r) => r.attribution || {});
  return {
    slow: slow.length,
    targets: countTop(a.map((x) => x.largestShiftTarget), top),
    loadStates: countTop(a.map((x) => x.loadState), 4),
  };
}

export function summarize(records, opts) {
  const ownerOf = (url) => classifyUrl(url, { site: opts.site, cdn: opts.cdn, contentDir: opts.contentDir });
  const filtered = records.filter((r) => {
    if (opts.metric !== "all" && r.name !== opts.metric) return false;
    if (opts.device !== "all" && device(r) !== opts.device) return false;
    if (opts.chromiumOnly && r.chromium !== true) return false;
    if (opts.loggedIn === "exclude" && r.loggedIn === true) return false;
    if (opts.loggedIn === "only" && r.loggedIn !== true) return false;
    return true;
  });
  const groups = new Map();
  for (const r of filtered) {
    const key = groupKey(r, opts.by);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const out = [];
  for (const [key, items] of groups) {
    const group = { group: key, records: items.length, metrics: {} };
    for (const name of METRICS) {
      const rs = items.filter((r) => r.name === name);
      if (!rs.length) continue;
      const values = rs.map((r) => r.value);
      const p75 = percentile(values, 0.75);
      const ratings = { good: 0, "needs improvement": 0, poor: 0 };
      for (const v of values) ratings[rate(name, v)] += 1;
      const m = { n: rs.length, lowSample: rs.length < opts.minSamples, p75, rating: rate(name, p75), share: ratings };
      const slow = rs.filter((r) => r.value > THRESHOLDS[name][0]);
      if (name === "LCP") m.slow = lcpDetail(slow, ownerOf, opts.top);
      if (name === "INP") m.slow = inpDetail(slow, ownerOf, opts.top);
      if (name === "CLS") m.slow = clsDetail(slow, opts.top);
      group.metrics[name] = m;
    }
    out.push(group);
  }
  return out.sort((a, b) => b.records - a.records);
}

function printGroups(groups, meta, opts) {
  const line = (t = "") => console.log(t);
  line(`${meta.records} record(s) after de-duplication (${meta.duplicates} repeated report(s) merged, ${meta.skipped} line(s) or item(s) skipped)`);
  line(`Filters: device=${opts.device}${opts.chromiumOnly ? ", Chromium only" : ""}, logged-in=${opts.loggedIn}; grouped by ${opts.by}. p75 is nearest-rank.`);
  if (!opts.site) line("Note: pass --site so the site's own files are not reported as third-party.");
  line();
  for (const g of groups) {
    line(`== ${g.group}  (${g.records} records)`);
    for (const [name, m] of Object.entries(g.metrics)) {
      const shares = `good ${pct(m.share.good, m.n)}, needs improvement ${pct(m.share["needs improvement"], m.n)}, poor ${pct(m.share.poor, m.n)}`;
      line(`  ${name.padEnd(5)} n=${String(m.n).padEnd(6)} p75 ${fmt(name, m.p75).padEnd(10)} ${m.rating.padEnd(18)} ${shares}${m.lowSample ? "  [low sample]" : ""}`);
      const s = m.slow;
      if (!s || !s.slow) continue;
      if (name === "LCP") {
        const sh = s.averageShare;
        line(`        slower than 2,500 ms: ${s.slow}; average share of LCP: TTFB ${pct(sh.timeToFirstByte, 1)}, resource load delay ${pct(sh.resourceLoadDelay, 1)}, resource load duration ${pct(sh.resourceLoadDuration, 1)}, element render delay ${pct(sh.elementRenderDelay, 1)}`);
        if (s.withoutResource) line(`        without an LCP resource (text): ${s.withoutResource}`);
        for (const [owner, n] of s.resourceOwners) line(`        LCP resource owner: ${owner} (${n})`);
        for (const [url, n] of s.resources) line(`        LCP resource: ${url} (${n})`);
        for (const [target, n] of s.targets) line(`        LCP element: ${target} (${n})`);
      }
      if (name === "INP") {
        const sh = s.averageShare;
        line(`        slower than 200 ms: ${s.slow}; average share of INP: input delay ${pct(sh.inputDelay, 1)}, processing ${pct(sh.processingDuration, 1)}, presentation delay ${pct(sh.presentationDelay, 1)}`);
        line(`        load state: ${s.loadStates.map(([k, n]) => `${k} ${n}`).join(", ") || "-"}`);
        line(`        with a longest-script entry (LoAF, Chromium): ${s.withLongestScript}; invoker types: ${s.invokerTypes.map(([k, n]) => `${k} ${n}`).join(", ") || "-"}`);
        for (const o of s.scriptOwners) line(`        script owner: ${o.owner.padEnd(36)} ${String(o.ms).padStart(7)} ms over ${o.interactions} interaction(s)  ${Object.entries(o.subparts).map(([k, n]) => `${k} ${n}`).join(", ")}`);
        for (const f of s.functions) line(`        function: ${f.key}  (${f.ms} ms)`);
        for (const [target, n] of s.targets) line(`        interaction target: ${target} (${n})`);
      }
      if (name === "CLS") {
        line(`        above 0.1: ${s.slow}; load state at the largest shift: ${s.loadStates.map(([k, n]) => `${k} ${n}`).join(", ") || "-"}`);
        for (const [target, n] of s.targets) line(`        largest shift target: ${target} (${n})`);
      }
    }
    line();
  }
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`rum-summary: ${error.message}`);
    process.exit(1);
  }
  if (opts.help || !opts.files.length) {
    console.log("Usage: node scripts/rum-summary.mjs <beacons.ndjson> [...] [--site=<url>] [--by=pageType|page|device|none] [--metric=<name>] [--device=<kind>] [--chromium-only] [--logged-in=<mode>] [--json]");
    process.exit(opts.help ? 0 : 1);
  }
  let texts;
  try {
    texts = opts.files.map((f) => readFileSync(f, "utf8"));
  } catch (error) {
    console.error(`rum-summary: ${error.message}`);
    process.exit(2);
  }
  const { records, skipped, duplicates } = readRecords(texts);
  const groups = summarize(records, opts);
  const meta = { records: records.length, skipped, duplicates };
  if (opts.json) console.log(JSON.stringify({ ...meta, groups }, null, 2));
  else printGroups(groups, meta, opts);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
