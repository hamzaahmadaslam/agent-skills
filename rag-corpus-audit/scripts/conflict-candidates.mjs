#!/usr/bin/env node
// Read-only helper. Lists pairs of sentences from different documents that talk about the same thing (their content
// words overlap) but differ in a way that can make them contradict each other:
//   - a quantity of the same kind differs: money ($12 vs $10), durations (14 days vs 30 days, compared in one unit),
//     sizes, percentages, counts of the same thing (3 devices vs 5 devices) or years;
//   - one sentence is negated and the other is not ("is supported" vs "is not supported");
//   - they use opposite words (required vs optional, free vs paid, enabled vs disabled, always vs never).
// Table rows are read as sentences with their header ("Plan: Pro; Price: $12").
//
// It reads the files you name and prints a report. It writes nothing and makes no network requests. English only. A
// candidate is not a contradiction: two statements can both be true for different plans, regions, versions or dates.
// A person reads each pair and decides.
//
// Usage:
//   node scripts/conflict-candidates.mjs docs/
//   node scripts/conflict-candidates.mjs docs/ chunks.jsonl --min-overlap=0.4 --json
//
// Options:
//   --min-overlap=<j>   Jaccard overlap of the two sentences' content words (default 0.5).
//   --min-terms=<n>     Sentences with fewer content words are skipped (default 2).
//   --max-df=<n>        Words in more sentences than this do not start a comparison (default 100).
//   --same-doc          Also compare sentences within one document.
//   --top=<n>           How many pairs to list (default 30).
//   --json              Print JSON.
//
// Exit codes: 0 done, 1 bad arguments, 2 input not readable.

import {
  documentDate,
  fmt,
  isoDate,
  loadCorpus,
  metaRole,
  normalizeLoose,
  parseArgs,
  parseDateValue,
  printWarnings,
  run,
  sentencesWithLines,
  stem,
  STOPWORDS,
  truncate,
  words,
} from "./corpus.mjs";

const HELP = `Usage: node conflict-candidates.mjs <folder|file ...> [--min-overlap=0.5] [--min-terms=2] [--max-df=100]
                                     [--same-doc] [--top=30] [--json]`;

const SPEC = {
  "min-overlap": { type: "number", default: 0.5, min: 0.1, max: 1 },
  "min-terms": { type: "number", default: 2, min: 1 },
  "max-df": { type: "number", default: 100, min: 2 },
  "same-doc": { type: "boolean", default: false },
  top: { type: "number", default: 30, min: 1 },
  json: { type: "boolean", default: false },
};

const NEGATIONS = new Set(["not", "no", "never", "cannot", "can't", "won't", "isn't", "aren't", "doesn't", "don't", "didn't", "wasn't", "weren't", "hasn't", "haven't", "without", "none", "neither", "nor", "unable"]);

// Opposite words: each group has two sides.
const OPPOSITES = [
  [["required", "mandatory", "compulsory", "must"], ["optional"]],
  [["free"], ["paid"]],
  [["enabled", "enable", "on"], ["disabled", "disable"]],
  [["supported"], ["unsupported"]],
  [["allowed", "permitted"], ["prohibited", "forbidden", "blocked"]],
  [["available"], ["unavailable"]],
  [["included", "includes", "include"], ["excluded", "excludes", "exclude"]],
  [["always"], ["never"]],
  [["public"], ["private"]],
  [["automatic", "automatically"], ["manual", "manually"]],
  [["unlimited"], ["limited"]],
  [["refundable"], ["non-refundable", "nonrefundable"]],
];
const OPPOSITE_OF = new Map();
OPPOSITES.forEach(([a, b], group) => {
  for (const w of a) OPPOSITE_OF.set(w, { group, side: 0 });
  for (const w of b) OPPOSITE_OF.set(w, { group, side: 1 });
});

const DURATION = { second: 1, seconds: 1, sec: 1, secs: 1, minute: 60, minutes: 60, min: 60, mins: 60, hour: 3600, hours: 3600, hr: 3600, hrs: 3600, day: 86400, days: 86400, week: 604800, weeks: 604800, month: 2592000, months: 2592000, year: 31536000, years: 31536000, yr: 31536000, yrs: 31536000 };
const SIZE = { b: 1, byte: 1, bytes: 1, kb: 1e3, kib: 1024, mb: 1e6, mib: 1048576, gb: 1e9, gib: 1073741824, tb: 1e12, tib: 1099511627776, pb: 1e15 };
const CURRENCY_CODES = new Set(["usd", "eur", "gbp", "pkr", "inr", "aud", "cad", "jpy", "chf", "cny", "aed", "sar", "rs", "dollars", "dollar", "euros", "euro", "pounds", "pound", "rupees", "rupee"]);
const UNIT_WORDS = new Set([...Object.keys(DURATION), ...Object.keys(SIZE), ...CURRENCY_CODES, "percent", "per", "cent"]);

const QUANTITY = /(?<![\w.])(?:([$€£¥₹])\s?|\b(USD|EUR|GBP|PKR|INR|AUD|CAD|Rs\.?)\s?)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s?(%|percent\b|[A-Za-z]+\b))?/g;

/** Quantities in a sentence: [{ kind, value, text }] with durations in seconds and sizes in bytes. */
export function quantities(sentence) {
  const out = [];
  QUANTITY.lastIndex = 0;
  for (let m; (m = QUANTITY.exec(sentence)); ) {
    const number = Number(`${m[3].replace(/,/g, "")}${m[4] ? `.${m[4]}` : ""}`);
    const unit = (m[5] || "").toLowerCase();
    const numText = `${m[3]}${m[4] ? `.${m[4]}` : ""}`;
    const text = m[1] ? `${m[1]}${numText}` : m[2] ? `${m[2]} ${numText}` : unit === "%" ? `${numText}%` : `${numText}${m[5] ? ` ${m[5]}` : ""}`;
    if (m[1] || m[2]) out.push({ kind: `money ${(m[1] || m[2]).replace(/\.$/, "").toUpperCase()}`, value: number, text });
    else if (unit === "%" || unit === "percent") out.push({ kind: "percent", value: number, text });
    else if (DURATION[unit]) out.push({ kind: "duration", value: number * DURATION[unit], text });
    else if (SIZE[unit]) out.push({ kind: "size", value: number * SIZE[unit], text });
    else if (CURRENCY_CODES.has(unit)) out.push({ kind: `money ${unit.toUpperCase()}`, value: number, text });
    else if (!unit && number >= 1950 && number <= 2099 && !m[4]) out.push({ kind: "year", value: number, text });
    else if (unit && unit.length >= 3 && !STOPWORDS.has(unit) && /^[a-z]+$/.test(unit)) out.push({ kind: `count of ${stem(unit)}`, value: number, text });
  }
  return out;
}

/** Content words for the topic: no stop words, numbers, units, negations or opposite words. */
export function topicTerms(sentence) {
  const out = new Set();
  for (const w of words(sentence)) {
    if (STOPWORDS.has(w) || NEGATIONS.has(w) || OPPOSITE_OF.has(w) || UNIT_WORDS.has(w) || /\d/.test(w) || w.length < 2) continue;
    out.add(stem(w.replace(/'s$/, "")));
  }
  return out;
}

function signals(sentence) {
  const ws = words(sentence);
  const negated = ws.filter((w) => NEGATIONS.has(w)).length + (/\bno longer\b/i.test(sentence) ? 1 : 0);
  const opposites = new Map();
  for (const w of ws) {
    const o = OPPOSITE_OF.get(w);
    if (o) opposites.set(o.group, { side: o.side, word: w });
  }
  return { negated: negated % 2 === 1, opposites, quantities: quantities(sentence) };
}

function differences(a, b) {
  const out = [];
  const kinds = new Set(a.quantities.map((q) => q.kind));
  for (const kind of kinds) {
    const qa = a.quantities.filter((q) => q.kind === kind);
    const qb = b.quantities.filter((q) => q.kind === kind);
    if (!qb.length) continue;
    const va = [...new Set(qa.map((q) => q.value))].sort((x, y) => x - y).join("|");
    const vb = [...new Set(qb.map((q) => q.value))].sort((x, y) => x - y).join("|");
    if (va !== vb) out.push({ type: "numbers", detail: `${qa.map((q) => q.text).join(", ")} | ${qb.map((q) => q.text).join(", ")}` });
  }
  for (const [group, oa] of a.opposites) {
    const ob = b.opposites.get(group);
    if (ob && ob.side !== oa.side) out.push({ type: "opposite", detail: `${oa.word} | ${ob.word}` });
  }
  if (a.negated !== b.negated) out.push({ type: "negation", detail: a.negated ? "first is negated" : "second is negated" });
  return out;
}

function unitDate(doc, chunk) {
  if (chunk?.jsonl) {
    const m = metaRole(chunk.meta, "modified") ?? metaRole(chunk.meta, "created");
    const p = m ? parseDateValue(m.value) : null;
    if (p) return isoDate(p.end);
  }
  const d = documentDate(doc.meta);
  return d ? isoDate(d.date) : null;
}

export function findConflicts(documents, opts) {
  const sentences = [];
  for (const doc of documents) {
    const units = doc.format === "jsonl" ? doc.chunks.map((c) => ({ text: c.text, chunk: c })) : [{ text: doc.text, chunk: null }];
    for (const unit of units) {
      for (const s of sentencesWithLines(unit.text)) {
        const sig = signals(s.text);
        if (!sig.quantities.length && !sig.opposites.size && !sig.negated) continue;
        const terms = topicTerms(s.text);
        if (terms.size < opts["min-terms"]) continue;
        sentences.push({
          doc: doc.key,
          source: doc.source,
          line: unit.chunk ? unit.chunk.line : s.line,
          id: unit.chunk?.id,
          date: unitDate(doc, unit.chunk),
          text: s.text,
          norm: normalizeLoose(s.text),
          terms,
          sig,
        });
      }
    }
  }

  const postings = new Map();
  sentences.forEach((s, i) => {
    for (const t of s.terms) {
      if (!postings.has(t)) postings.set(t, []);
      postings.get(t).push(i);
    }
  });
  const shared = new Map();
  for (const list of postings.values()) {
    if (list.length < 2 || list.length > opts["max-df"]) continue;
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const key = list[x] * sentences.length + list[y];
        shared.set(key, (shared.get(key) || 0) + 1);
      }
    }
  }

  const pairs = [];
  for (const key of shared.keys()) {
    const i = Math.floor(key / sentences.length);
    const j = key % sentences.length;
    const a = sentences[i];
    const b = sentences[j];
    if (!opts["same-doc"] && a.doc === b.doc) continue;
    if (a.text === b.text) continue;
    let inter = 0;
    for (const t of a.terms) if (b.terms.has(t)) inter += 1;
    const overlap = inter / (a.terms.size + b.terms.size - inter);
    if (overlap < opts["min-overlap"]) continue;
    const diffs = differences(a.sig, b.sig);
    if (!diffs.length) continue;
    const weight = (diffs.some((d) => d.type === "numbers") ? 0.3 : 0) + (diffs.some((d) => d.type === "opposite") ? 0.2 : 0) + (diffs.some((d) => d.type === "negation") ? 0.1 : 0);
    pairs.push({ overlap: Math.round(overlap * 100) / 100, score: overlap + weight, differences: diffs, a, b });
  }
  // One pair per two sentences' normalized text (duplicated documents repeat the same pair).
  const seen = new Set();
  const unique = [];
  for (const p of pairs.sort((x, y) => y.score - x.score)) {
    const k = [p.a.norm, p.b.norm].sort().join("\u0000") + p.differences.map((d) => d.detail).join();
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(p);
  }
  const side = (s) => ({ source: s.source, line: s.line, id: s.id, date: s.date, sentence: truncate(s.text, 220) });
  return {
    documents: documents.length,
    fact_sentences: sentences.length,
    pairs: unique.map((p) => ({ overlap: p.overlap, differences: p.differences, first: side(p.a), second: side(p.b) })),
  };
}

function printText(r, opts) {
  console.log(`Conflict candidates (read-only): ${fmt(r.documents)} documents, ${fmt(r.fact_sentences)} sentences with a number, negation or opposite word;`);
  console.log(`${fmt(r.pairs.length)} candidate pairs with a topic overlap of at least ${opts["min-overlap"]}${opts["same-doc"] ? " (within documents too)" : " (across documents)"}`);
  console.log("Each pair talks about the same thing and differs in a number, a negation or an opposite word. Read both: it can");
  console.log("be a contradiction, a difference in scope (plan, region, product version, date), or no conflict at all.");
  r.pairs.slice(0, opts.top).forEach((p, n) => {
    const diff = p.differences.map((d) => `${d.type}: ${d.detail}`).join("; ");
    console.log(`\n${n + 1}. ${diff}   (overlap ${p.overlap.toFixed(2)})`);
    for (const s of [p.first, p.second]) {
      console.log(`   ${s.source}:${s.line}${s.id ? ` [${s.id}]` : ""}  ${s.date ? `dated ${s.date}` : "undated"}`);
      console.log(`     "${s.sentence}"`);
    }
  });
  if (r.pairs.length > opts.top) console.log(`\n... ${r.pairs.length - opts.top} more pairs (--top or --json)`);
  if (!r.pairs.length) console.log("\nNo candidates at these settings. Lower --min-overlap to look wider.");
}

function main(argv) {
  const { opts, positional } = parseArgs(argv, SPEC);
  if (opts.help) {
    console.log(HELP);
    return;
  }
  const { documents, warnings } = loadCorpus(positional, { by: { mode: "heading" } });
  printWarnings(warnings);
  const result = findConflicts(documents, opts);
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else printText(result, opts);
}

run(main, HELP, import.meta.url);
