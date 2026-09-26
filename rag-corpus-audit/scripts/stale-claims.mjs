#!/usr/bin/env node
// Read-only helper. Finds time-sensitive and possibly stale claims in a RAG corpus, measured against an "as of" date:
//   - expired future claims: "will", "planned", "coming" with a date that has passed;
//   - expired deadlines and offers: "until", "valid through", "expires", "ends" with a date that has passed;
//   - old anchored claims: "as of", "currently", "latest" next to a date older than --max-age-days;
//   - relative time with no date: "currently", "recently", "this year", "latest" in a sentence without a date;
//   - prices and version numbers in documents that are undated or older than --max-age-days;
//   - deprecated, legacy, discontinued or superseded markers;
//   - documents with no date, an old date, or a date after the as-of date (in metadata or a "Last updated" line).
//
// It reads the files you name and prints a report. It writes nothing and makes no network requests. It finds
// candidates by patterns in English text; a person decides which claims are wrong today.
//
// Usage:
//   node scripts/stale-claims.mjs docs/ --as-of=2026-09-26
//   node scripts/stale-claims.mjs chunks.jsonl --max-age-days=180 --json
//
// Options:
//   --as-of=<YYYY-MM-DD>     The date to measure against (default: today, UTC).
//   --max-age-days=<n>       A date older than this is old (default 365).
//   --all                    Also list relative-time sentences, prices and versions in recent documents.
//   --top=<n>                How many findings to list per kind (default 25).
//   --json                   Print JSON.
//
// Exit codes: 0 done, 1 bad arguments, 2 input not readable.

import {
  daysBetween,
  documentDate,
  findDates,
  fmt,
  isoDate,
  loadCorpus,
  metaRole,
  pad,
  parseArgs,
  parseAsOf,
  parseDateValue,
  printWarnings,
  run,
  sentencesWithLines,
  truncate,
} from "./corpus.mjs";

const HELP = `Usage: node stale-claims.mjs <folder|file ...> [--as-of=YYYY-MM-DD] [--max-age-days=365] [--all] [--top=25]
                              [--json]`;

const SPEC = {
  "as-of": { type: "string", default: "" },
  "max-age-days": { type: "number", default: 365, min: 1 },
  all: { type: "boolean", default: false },
  top: { type: "number", default: 25, min: 1 },
  json: { type: "boolean", default: false },
};

export const KINDS = {
  "expired-future": { label: "future claim whose date has passed", level: "high" },
  "expired-deadline": { label: "deadline or offer whose date has passed", level: "high" },
  "doc-future": { label: "document dated after the as-of date", level: "medium" },
  "old-anchored": { label: "\"as of\", \"currently\" or \"latest\" with an old date", level: "medium" },
  superseded: { label: "deprecated, legacy or superseded marker", level: "medium" },
  "relative-undated": { label: "relative time with no date in the sentence", level: "medium" },
  "volatile-value": { label: "price or version number in an old or undated document", level: "low" },
  "doc-old": { label: "document older than the maximum age", level: "medium" },
  "doc-undated": { label: "document with no date", level: "low" },
};

const FUTURE = /\b(?:will(?! not have)|won['’]t|shall|is going to|are going to|coming|upcoming|planned|scheduled|expected to|plans? to|launching|to be (?:released|launched|available|introduced|retired|removed|deprecated|replaced)|coming soon|in the coming|next (?:release|version|update))\b/i;
const DEADLINE = /\b(?:until|till|through|thru|valid (?:until|through|till)|expires?(?: on)?|expiring|expiry|ends?(?: on)?|ending|deadline|due (?:by|on)|no later than|last day|available until|register by|apply by|before the end of)\b/gi;
const ANCHOR = /\b(?:as of|currently|at present|at the moment|at the time of writing|to date|so far|right now|today|the (?:latest|newest|most recent|current)|up to date)\b/i;
const RELATIVE =
  /\b(?:currently|at present|at the moment|at the time of writing|right now|nowadays|these days|this (?:year|month|quarter|week|season)|next (?:year|month|quarter|week)|last (?:year|month|quarter|week)|recently|lately|the (?:latest|newest|most recent)|upcoming|coming soon|soon|(?:is|are|has|have) now|now (?:supports?|available|includes?|requires?|offers?|uses?|has|comes? with|allows?)|just (?:launched|released|added|announced)|brand[- ]new|new(?:ly)? (?:released|launched|added|introduced))\b/i;
// Strong markers first, so "The Legacy API is deprecated" reports "deprecated".
const SUPERSEDED = [
  /\b(?:deprecated|no longer (?:supported|available|maintained|recommended|offered|works?)|end[- ]of[- ]life|discontinued|replaced by|superseded(?: by)?|will be removed|to be removed|retired)\b/i,
  /\b(?:obsolete|legacy|EOL|sunset(?:ted|ting)?)\b/i,
];
const PRICE =
  /(?:[$€£¥₹]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|PKR|INR|AUD|CAD|JPY|dollars?|euros?|pounds?|rupees?)\b|\b(?:USD|EUR|GBP|PKR|INR|AUD|CAD|Rs\.?)\s?\d[\d,]*(?:\.\d+)?)/i;
const VERSION = /\b(?:version|release|v)\s?\d+(?:\.\d+){0,3}\b/i;
const LAST_UPDATED = /\b(?:last (?:updated|modified|reviewed|revised)|updated|reviewed|revised)(?: on)?\s*[:-]?\s*/i;

/** The document's own date: metadata first, else a "Last updated: <date>" line in its text. */
function docDate(doc) {
  const fromMeta = documentDate(doc.meta);
  if (fromMeta) return { date: fromMeta.date, from: fromMeta.key };
  for (const line of doc.text.split("\n").slice(0, 400)) {
    const m = LAST_UPDATED.exec(line);
    if (!m) continue;
    const dates = findDates(line.slice(m.index + m[0].length));
    if (dates.length && dates[0].index <= 2) return { date: dates[0].end, from: "text" };
  }
  return null;
}

/** Scans one text (a document, or one JSONL chunk) and returns findings. */
export function scanText(text, ctx) {
  const findings = [];
  const { asOf, maxAge, docAge, docUndated, all } = ctx;
  const oldDoc = docUndated || docAge > maxAge;
  for (const s of sentencesWithLines(text, ctx.firstLine)) {
    const dates = findDates(s.text);
    const past = dates.filter((d) => d.end < asOf);
    const add = (kind, detail, date) =>
      findings.push({ kind, line: s.line, date: date ? { text: date.text, end: isoDate(date.end), days_ago: daysBetween(date.end, asOf) } : null, detail, sentence: truncate(s.text, 180) });

    if (past.length && FUTURE.test(s.text)) {
      add("expired-future", `"${FUTURE.exec(s.text)[0]}" with ${past[past.length - 1].text}`, past[past.length - 1]);
      continue;
    }
    let deadline = null;
    DEADLINE.lastIndex = 0;
    for (let m; !deadline && (m = DEADLINE.exec(s.text)); ) {
      const end = m.index + m[0].length;
      deadline = past.find((d) => d.index >= end && d.index - end <= 40) ?? null;
      if (deadline) deadline = { marker: m[0], date: deadline };
    }
    if (deadline) {
      add("expired-deadline", `"${deadline.marker}" ${deadline.date.text}`, deadline.date);
      continue;
    }
    const anchor = ANCHOR.exec(s.text);
    const oldDate = dates.find((d) => daysBetween(d.end, asOf) > maxAge);
    if (anchor && oldDate) add("old-anchored", `"${anchor[0]}" with ${oldDate.text}`, oldDate);
    const superseded = SUPERSEDED[0].exec(s.text) ?? SUPERSEDED[1].exec(s.text);
    if (superseded) add("superseded", `"${superseded[0]}"`, null);
    const relative = RELATIVE.exec(s.text);
    if (relative && !dates.length && (oldDoc || all)) {
      add("relative-undated", `"${relative[0]}"${docUndated ? ", undated document" : oldDoc ? ", old document" : ""}`, null);
    }
    const price = PRICE.exec(s.text);
    const version = VERSION.exec(s.text);
    if ((price || version) && (oldDoc || all)) add("volatile-value", price ? `price ${price[0].trim()}` : `version "${version[0]}"`, null);
  }
  return findings;
}

export function scan(documents, opts) {
  const asOf = parseAsOf(opts["as-of"]);
  const maxAge = opts["max-age-days"];
  const findings = [];
  const docs = [];
  for (const doc of documents) {
    const units = doc.format === "jsonl" ? doc.chunks : [{ text: doc.text, line: 1, jsonl: false }];
    const d = docDate(doc);
    const docAge = d ? daysBetween(d.date, asOf) : null;
    const info = { source: doc.source, file: doc.file, date: d ? isoDate(d.date) : null, from: d?.from ?? null, age_days: docAge, findings: 0 };
    docs.push(info);
    const base = { source: doc.source, file: doc.file };
    if (!d) findings.push({ ...base, kind: "doc-undated", line: 1, date: null, detail: "no date in metadata or a \"Last updated\" line", sentence: "" });
    else if (docAge > maxAge) findings.push({ ...base, kind: "doc-old", line: 1, date: { text: info.date, end: info.date, days_ago: docAge }, detail: `${info.from} ${info.date}`, sentence: "" });
    else if (docAge < 0) findings.push({ ...base, kind: "doc-future", line: 1, date: { text: info.date, end: info.date, days_ago: docAge }, detail: `${info.from} ${info.date}`, sentence: "" });
    for (const unit of units) {
      let unitAge = docAge;
      let undated = !d;
      if (unit.jsonl) {
        const own = metaRole(unit.meta, "modified") ?? metaRole(unit.meta, "created");
        const parsed = own ? parseDateValue(own.value) : null;
        if (parsed) {
          unitAge = daysBetween(parsed.end, asOf);
          undated = false;
        }
      }
      const found = scanText(unit.text, { asOf, maxAge, docAge: unitAge ?? 0, docUndated: undated, all: opts.all, firstLine: 1 });
      for (const f of found) {
        findings.push({ ...base, ...f, line: unit.jsonl ? unit.line : f.line, id: unit.jsonl ? unit.id : undefined });
        info.findings += 1;
      }
    }
  }
  const order = Object.keys(KINDS);
  findings.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.source.localeCompare(b.source) || a.line - b.line);
  return { as_of: isoDate(asOf), max_age_days: maxAge, documents: docs, findings };
}

function printText(r, opts) {
  const undated = r.documents.filter((d) => !d.date).length;
  const old = r.documents.filter((d) => d.date && d.age_days > r.max_age_days).length;
  console.log(`Stale and time-sensitive claims (read-only): as of ${r.as_of}, maximum age ${r.max_age_days} days`);
  console.log(`${fmt(r.documents.length)} documents: ${undated} undated, ${old} older than ${r.max_age_days} days`);
  console.log("Findings are candidates: check each claim against the current source of truth.\n");
  for (const [kind, k] of Object.entries(KINDS)) {
    const n = r.findings.filter((f) => f.kind === kind).length;
    console.log(`  ${pad(k.label, 58)} ${pad(n, 4, true)}  ${k.level}`);
  }
  if (!opts.all) console.log("  (relative-time, price and version findings are listed for old or undated documents only; --all lists every one)");

  console.log("\n== Documents by date ==");
  const sorted = [...r.documents].sort((a, b) => (a.date ? 1 : 0) - (b.date ? 1 : 0) || (a.date ?? "").localeCompare(b.date ?? ""));
  for (const d of sorted.slice(0, opts.top)) {
    const age = d.date ? `${fmt(d.age_days)} days` : "-";
    console.log(`  ${pad(d.date ?? "undated", 11)} ${pad(age, 12, true)}  ${d.source}${d.from ? `  (${d.from})` : ""}`);
  }
  if (sorted.length > opts.top) console.log(`  ... ${sorted.length - opts.top} more documents`);

  for (const [kind, k] of Object.entries(KINDS)) {
    if (kind.startsWith("doc-")) continue;
    const list = r.findings.filter((f) => f.kind === kind);
    if (!list.length) continue;
    console.log(`\n== ${k.label} (${list.length}) ==`);
    for (const f of list.slice(0, opts.top)) {
      const when = f.date ? `  ${f.date.text} (${f.date.days_ago >= 0 ? `${fmt(f.date.days_ago)} days before` : `${fmt(-f.date.days_ago)} days after`} ${r.as_of})` : "";
      const id = f.id ? ` [${f.id}]` : "";
      console.log(`  ${f.source}:${f.line}${id}  ${f.detail}${when}`);
      console.log(`      "${f.sentence}"`);
    }
    if (list.length > opts.top) console.log(`  ... ${list.length - opts.top} more (--top or --json)`);
  }
}

function main(argv) {
  const { opts, positional } = parseArgs(argv, SPEC);
  if (opts.help) {
    console.log(HELP);
    return;
  }
  const { documents, warnings } = loadCorpus(positional, { by: { mode: "heading" } });
  printWarnings(warnings);
  const result = scan(documents, opts);
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else printText(result, opts);
}

run(main, HELP, import.meta.url);
