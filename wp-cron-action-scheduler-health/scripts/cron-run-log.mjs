#!/usr/bin/env node
// Read-only helper. Summarizes the log that the wp-cron-run script in references/server-cron-setup.md writes: runs per
// hour against the expected number, gaps between runs, skipped runs, failures by exit code, run durations, overlapping
// runs, per-site figures on a network, and the other lines (WP-CLI and PHP messages) counted by kind. It reads the
// files it is given and prints a report; it writes nothing and makes no network requests. Message texts are printed
// only with --show-messages, and then with digits masked and cut to 160 characters.
//
// Usage:
//   node cron-run-log.mjs /home/example/logs/wp-cron.log [more files] [--interval=60] [--since=2026-09-26T00:00:00Z]
//   node cron-run-log.mjs wp-cron.log --interval=300 --hours=24 --json
//   node cron-run-log.mjs wp-cron.log --show-messages
//
// Line formats read (anything else counts as a message line, attached to the next run line):
//   2026-09-26T10:00:01Z run exit=0 seconds=3
//   2026-09-26T10:00:01Z run exit=0 seconds=3 url=https://example.com/shop/
//   2026-09-26T10:00:09Z queue exit=0 seconds=21
//   2026-09-26T10:01:00Z skip previous-run-active
// Exit codes: 0 success, 1 a WP-CLI error, 124 stopped by timeout, 126 and 127 command not runnable or not found,
// 137 killed (timeout(1) and WP-CLI conventions; see references/verification.md).

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const option = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => args.includes(`--${name}`);

if (files.length === 0 || flag("help")) {
  console.log("Usage: node cron-run-log.mjs <log file> [...] [--interval=60] [--since=<ISO time>] [--hours=48] [--json] [--show-messages]");
  process.exit(flag("help") ? 0 : 1);
}

const interval = Number(option("interval", "60"));
if (!Number.isFinite(interval) || interval <= 0) {
  console.error("--interval must be a number of seconds, for example --interval=60 or --interval=300");
  process.exit(1);
}
const sinceText = option("since", "");
const since = sinceText ? Date.parse(sinceText) : Number.NEGATIVE_INFINITY;
if (Number.isNaN(since)) {
  console.error(`--since is not a date: ${sinceText}`);
  process.exit(1);
}
const hoursShown = Number(option("hours", "48"));
if (!Number.isInteger(hoursShown) || hoursShown <= 0) {
  console.error("--hours must be a whole number of hours, for example --hours=48");
  process.exit(1);
}

const RUN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) (run|queue) exit=(\d+) seconds=(\d+)(?: url=(\S+))?\s*$/;
const SKIP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) skip (\S+)/;
const EXIT_MEANING = { 0: "success", 1: "WP-CLI error", 124: "stopped by timeout", 125: "timeout failed", 126: "not runnable", 127: "command not found", 137: "killed" };

// Classify a message line by its start; the text itself is kept only for --show-messages.
function messageKind(line) {
  if (/A cron event run is already in progress; skipping/.test(line)) return "cron-command lock skip (2.3.5+)";
  if (/There are too many concurrent batches/.test(line)) return "Action Scheduler: batch slot busy";
  if (/PHP Fatal error|^Fatal error/i.test(line)) return "PHP fatal error";
  if (/^Error:/.test(line)) return "WP-CLI error";
  if (/PHP Warning|^Warning:/.test(line)) return "warning";
  if (/PHP (Notice|Deprecated)|^(Notice|Deprecated):/.test(line)) return "notice or deprecation";
  return "other output";
}

const events = [];
const messages = new Map();
const messageTexts = new Map();
let pending = [];
let otherLines = 0;

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    console.error(`Cannot read ${file}: ${error.code || error.message}`);
    process.exit(1);
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) continue;
    let m = RUN.exec(line);
    if (m) {
      const time = Date.parse(m[1]);
      if (time >= since) {
        events.push({ time, kind: m[2], exit: Number(m[3]), seconds: Number(m[4]), url: m[5] || "", messages: pending.length });
        for (const kind of pending) messages.set(kind.kind, (messages.get(kind.kind) || 0) + 1);
        for (const kind of pending) {
          if (!flag("show-messages")) continue;
          const masked = kind.text.replace(/\d/g, "#").slice(0, 160);
          messageTexts.set(masked, (messageTexts.get(masked) || 0) + 1);
        }
      }
      pending = [];
      continue;
    }
    m = SKIP.exec(line);
    if (m) {
      const time = Date.parse(m[1]);
      if (time >= since) events.push({ time, kind: "skip", reason: m[2] });
      // Keep the message lines: a long run writes its output before the next minute's skip line, and its own run
      // line comes after that.
      continue;
    }
    otherLines += 1;
    pending.push({ kind: messageKind(line), text: line });
  }
}

events.sort((a, b) => a.time - b.time);
const runs = events.filter((e) => e.kind === "run");
const queues = events.filter((e) => e.kind === "queue");
const skips = events.filter((e) => e.kind === "skip");

const percentile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const durationStats = (list) => {
  const secs = list.map((e) => e.seconds);
  return { count: list.length, p50: percentile(secs, 50), p95: percentile(secs, 95), max: secs.length ? Math.max(...secs) : null };
};
const exitCounts = (list) => {
  const counts = {};
  for (const e of list) counts[e.exit] = (counts[e.exit] || 0) + 1;
  return counts;
};

// Gaps: time between consecutive run or skip starts longer than two intervals.
const starts = events.filter((e) => e.kind === "run" || e.kind === "skip").map((e) => e.time);
const passStarts = [];
for (const t of starts) {
  // On a network, one pass writes one line per site within seconds; count a pass once.
  if (passStarts.length === 0 || t - passStarts[passStarts.length - 1] >= Math.min(interval * 1000, 30000)) passStarts.push(t);
}
const gaps = [];
for (let i = 1; i < passStarts.length; i += 1) {
  const gap = (passStarts[i] - passStarts[i - 1]) / 1000;
  if (gap > 2 * interval) gaps.push({ from: new Date(passStarts[i - 1]).toISOString().replace(".000Z", "Z"), to: new Date(passStarts[i]).toISOString().replace(".000Z", "Z"), seconds: gap });
}

// Overlaps: a run that starts before the previous run of the same site ended.
let overlaps = 0;
const lastEnd = new Map();
for (const e of runs) {
  const end = lastEnd.get(e.url);
  if (end !== undefined && e.time < end) overlaps += 1;
  lastEnd.set(e.url, e.time + e.seconds * 1000);
}

// Hours.
const hourKey = (t) => new Date(t).toISOString().slice(0, 13) + ":00Z";
const hours = new Map();
for (const e of events) {
  const key = hourKey(e.time);
  if (!hours.has(key)) hours.set(key, { runs: 0, skips: 0, failures: 0, maxSeconds: 0, sites: new Set() });
  const h = hours.get(key);
  if (e.kind === "skip") h.skips += 1;
  if (e.kind === "run") {
    h.runs += 1;
    h.sites.add(e.url);
    if (e.exit !== 0) h.failures += 1;
    h.maxSeconds = Math.max(h.maxSeconds, e.seconds);
  }
  if (e.kind === "queue" && e.exit !== 0) h.failures += 1;
}
// Hours with no line at all still count: fill them in between the first and the last event.
if (events.length) {
  const lastHour = Math.floor(events[events.length - 1].time / 3600000);
  for (let hour = Math.floor(events[0].time / 3600000); hour <= lastHour; hour += 1) {
    const key = hourKey(hour * 3600000);
    if (!hours.has(key)) hours.set(key, { runs: 0, skips: 0, failures: 0, maxSeconds: 0, sites: new Set() });
  }
}
const siteCount = new Set(runs.map((e) => e.url)).size || 1;
const expectedPerHour = Math.round(3600 / interval) * siteCount;
const hourRows = [...hours.entries()]
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map(([hour, h]) => ({ hour, runs: h.runs, skips: h.skips, failures: h.failures, maxSeconds: h.maxSeconds }));
const fullHours = hourRows.slice(1, -1);
const shortHours = fullHours.filter((h) => h.runs < 0.9 * expectedPerHour).map((h) => h.hour);

// Sites (network logs).
const sites = [];
if (runs.some((e) => e.url)) {
  const bySite = new Map();
  for (const e of runs) {
    if (!bySite.has(e.url)) bySite.set(e.url, []);
    bySite.get(e.url).push(e);
  }
  for (const [url, list] of bySite) {
    const stats = durationStats(list);
    sites.push({ url, runs: list.length, failures: list.filter((e) => e.exit !== 0).length, p95Seconds: stats.p95, maxSeconds: stats.max });
  }
  sites.sort((a, b) => b.p95Seconds - a.p95Seconds);
}

const report = {
  files,
  interval,
  from: events.length ? new Date(events[0].time).toISOString().replace(".000Z", "Z") : null,
  to: events.length ? new Date(events[events.length - 1].time).toISOString().replace(".000Z", "Z") : null,
  runs: { ...durationStats(runs), exits: exitCounts(runs) },
  queueRuns: { ...durationStats(queues), exits: exitCounts(queues) },
  skips: skips.length,
  overlaps,
  gaps,
  expectedRunsPerFullHour: expectedPerHour,
  hoursBelowExpected: shortHours,
  messageLinesTotal: otherLines,
  messageLines: Object.fromEntries(messages),
  unattachedMessageLines: pending.length,
  hours: hourRows.slice(-hoursShown),
  sites: sites.slice(0, 20),
  messages: flag("show-messages") ? [...messageTexts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([text, count]) => ({ count, text })) : undefined,
};

if (flag("json")) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const exitText = (counts) =>
  Object.entries(counts).map(([code, n]) => `${n} x exit ${code} (${EXIT_MEANING[code] || "see the lines before it"})`).join(", ") || "none";

console.log(`Runner log summary: ${files.join(", ")}`);
console.log(`Covered: ${report.from || "-"} to ${report.to || "-"} (UTC); interval ${interval} s; ${siteCount} site(s)`);
console.log("");
console.log(`WP-Cron runs:        ${runs.length}; duration p50 ${report.runs.p50 ?? "-"} s, p95 ${report.runs.p95 ?? "-"} s, max ${report.runs.max ?? "-"} s`);
console.log(`  exit codes:        ${exitText(report.runs.exits)}`);
if (queues.length) {
  console.log(`Queue runs:          ${queues.length}; duration p50 ${report.queueRuns.p50} s, p95 ${report.queueRuns.p95} s, max ${report.queueRuns.max} s`);
  console.log(`  exit codes:        ${exitText(report.queueRuns.exits)}`);
}
console.log(`Skipped (lock held): ${skips.length}`);
console.log(`Overlapping runs:    ${overlaps}${overlaps ? " (two runners write to this log, or runs without the lock)" : ""}`);
console.log(`Expected runs per full hour: ${expectedPerHour}; hours below 90% of that: ${shortHours.length ? shortHours.join(", ") : "none"}`);
console.log(`Gaps longer than two intervals: ${gaps.length}`);
for (const g of gaps.slice(0, 15)) console.log(`  ${g.from} -> ${g.to} (${Math.round(g.seconds)} s)`);
if (gaps.length > 15) console.log(`  (${gaps.length - 15} more)`);
console.log("");
console.log("Message lines by kind (attached to the run that followed them):");
if (messages.size === 0) console.log("  none");
for (const [kind, n] of [...messages.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${kind}`);
if (pending.length) console.log(`  ${String(pending.length).padStart(6)}  after the last run line (a run still going, or the job died before logging)`);
if (report.messages) {
  console.log("");
  console.log("Most frequent message texts (digits masked):");
  for (const m of report.messages) console.log(`  ${String(m.count).padStart(6)}  ${m.text}`);
}
if (sites.length) {
  console.log("");
  console.log("Slowest sites (p95 seconds):");
  for (const s of sites.slice(0, 10)) console.log(`  ${String(s.p95Seconds).padStart(5)} s  max ${s.maxSeconds} s  runs ${s.runs}  failures ${s.failures}  ${s.url}`);
}
console.log("");
console.log(`Last ${Math.min(hoursShown, hourRows.length)} hour(s):`);
console.log("  hour (UTC)            runs  skips  failures  max s");
for (const h of report.hours) {
  console.log(`  ${h.hour.padEnd(20)} ${String(h.runs).padStart(5)} ${String(h.skips).padStart(6)} ${String(h.failures).padStart(9)} ${String(h.maxSeconds).padStart(6)}`);
}
