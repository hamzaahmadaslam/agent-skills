#!/usr/bin/env node
// Read-only helper. A first, lexical pass at coverage: for each real user question it finds the chunks that share the
// most words with it (BM25), shows how many of the question's words the best passages contain, and lists the words
// users use that the corpus never uses. Questions end up in three groups: no shared words (likely gaps), weak matches
// (possible gaps) and candidates (passages to read). It then leaves a verdict field in the JSON output for a person
// to fill in: answered, partly, not in corpus, conflicting or stale.
//
// It reads the files you name and prints a report. It writes nothing and makes no network requests. Shared words are
// not answers: a passage can share every word and not answer the question, and a passage that uses other words can
// answer it. Read the top passages of every question before deciding.
//
// Question files: .txt (one question per line; "count<TAB>question" for frequencies; lines starting with # are
// skipped), .csv (a header row with a question or query column and an optional count or frequency column), or
// .jsonl ({"question": "...", "count": 3}). Remove personal data from question logs before using them.
//
// Usage:
//   node scripts/question-coverage.mjs docs/ --questions=questions.txt
//   node scripts/question-coverage.mjs chunks.jsonl --questions=search-log.csv --top=5 --json
//
// Options:
//   --questions=<file>          The question log (required).
//   --by=<mode>                 heading (default), paragraph or tokens=N, for Markdown, text and HTML files.
//   --context=title|headings|none  Text added to each chunk before scoring, as many pipelines do: the document title
//                               (default), the title and heading path, or nothing.
//   --top=<n>                   Passages listed per question (default 3).
//   --weak=<share>              A best passage with less than this share of the question's words is a weak match
//                               (default 0.6).
//   --k1=<n>, --b=<n>           BM25 parameters (default 1.2 and 0.75).
//   --limit=<n>                 Questions listed per group in the text report (default 40).
//   --json                      Print JSON, with an empty verdict per question.
//
// Exit codes: 0 done, 1 bad arguments, 2 input not readable.

import path from "node:path";
import {
  contentTerms,
  describeBy,
  fmt,
  InputError,
  loadCorpus,
  pad,
  parseArgs,
  parseBy,
  pct,
  printWarnings,
  readText,
  run,
  truncate,
  UsageError,
  where,
  words,
} from "./corpus.mjs";

const HELP = `Usage: node question-coverage.mjs <folder|file ...> --questions=<file> [--by=heading|paragraph|tokens=N]
                                   [--context=title|headings|none] [--top=3] [--weak=0.6] [--k1=1.2] [--b=0.75]
                                   [--limit=40] [--json]`;

const SPEC = {
  questions: { type: "string", default: "" },
  by: { type: "string", default: "heading" },
  context: { type: "string", default: "title" },
  top: { type: "number", default: 3, min: 1, max: 20 },
  weak: { type: "number", default: 0.6, min: 0.05, max: 1 },
  k1: { type: "number", default: 1.2, min: 0 },
  b: { type: "number", default: 0.75, min: 0, max: 1 },
  limit: { type: "number", default: 40, min: 1 },
  json: { type: "boolean", default: false },
};

const QUESTION_FIELDS = ["question", "query", "text", "search", "q", "search_term", "keyword"];
const COUNT_FIELDS = ["count", "frequency", "freq", "n", "hits", "searches", "times", "asks"];

/** Parses CSV (RFC 4180 quoting) into rows of strings. */
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
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** Reads a question log: [{ question, count }], identical questions merged with their counts added. */
export function readQuestions(file) {
  const ext = path.extname(file).toLowerCase();
  const text = readText(file);
  const list = [];
  if (ext === ".csv") {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new InputError(`${file} needs a header row and at least one question.`);
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const qi = header.findIndex((h) => QUESTION_FIELDS.includes(h));
    const ci = header.findIndex((h) => COUNT_FIELDS.includes(h));
    if (qi === -1) throw new InputError(`${file} has no question column (${QUESTION_FIELDS.join(", ")}).`);
    for (const r of rows.slice(1)) list.push({ question: r[qi] ?? "", count: ci === -1 ? 1 : Number(r[ci]) || 1 });
  } else if (ext === ".jsonl" || ext === ".ndjson") {
    text.split("\n").forEach((line, i) => {
      if (!line.trim()) return;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        throw new InputError(`${file} line ${i + 1} is not valid JSON.`);
      }
      const q = QUESTION_FIELDS.map((k) => row?.[k]).find((v) => typeof v === "string");
      const c = COUNT_FIELDS.map((k) => row?.[k]).find((v) => v !== undefined);
      if (q) list.push({ question: q, count: Number(c) || 1 });
    });
  } else {
    for (const line of text.split("\n")) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const m = /^\s*(\d+)\t(.+)$/.exec(line);
      list.push(m ? { question: m[2], count: Number(m[1]) } : { question: line, count: 1 });
    }
  }
  const merged = new Map();
  for (const { question, count } of list) {
    const q = question.trim();
    if (!q) continue;
    const key = q.toLowerCase().replace(/\s+/g, " ").replace(/[?!.\s]+$/, "");
    if (merged.has(key)) merged.get(key).count += count;
    else merged.set(key, { question: q, count });
  }
  if (!merged.size) throw new InputError(`${file} has no questions.`);
  return [...merged.values()];
}

/** A BM25 index over chunks. Scores use idf = ln(1 + (N - n + 0.5) / (n + 0.5)). */
export function buildIndex(chunks, contextMode) {
  const docs = chunks.map((c) => {
    const title = c.doc.meta?.title ? String(c.doc.meta.title) : "";
    const extra = contextMode === "none" ? "" : contextMode === "headings" ? [title, ...c.headings].join(" ") : title;
    const terms = contentTerms(`${extra}\n${c.text}`);
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
    return { chunk: c, tf, length: terms.length };
  });
  const postings = new Map();
  docs.forEach((d, i) => {
    for (const [t, n] of d.tf) {
      if (!postings.has(t)) postings.set(t, []);
      postings.get(t).push([i, n]);
    }
  });
  const avgdl = docs.reduce((n, d) => n + d.length, 0) / Math.max(1, docs.length);
  return { docs, postings, avgdl, n: docs.length };
}

export function search(index, terms, { k1, b, top }) {
  const scores = new Map();
  for (const t of terms) {
    const list = index.postings.get(t);
    if (!list) continue;
    const idf = Math.log(1 + (index.n - list.length + 0.5) / (list.length + 0.5));
    for (const [i, tf] of list) {
      const dl = index.docs[i].length;
      const s = (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * dl) / index.avgdl));
      scores.set(i, (scores.get(i) || 0) + s);
    }
  }
  return [...scores.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, top)
    .map(([i, score]) => ({ doc: index.docs[i], score }));
}

export function coverage(documents, questions, opts) {
  const chunks = documents.flatMap((d) => d.chunks);
  const index = buildIndex(chunks, opts.context);
  const surface = new Map(); // stem -> a word as users wrote it
  const results = questions.map(({ question, count }) => {
    for (const w of words(question)) {
      const s = contentTerms(w)[0];
      if (s && !surface.has(s)) surface.set(s, w);
    }
    const terms = [...new Set(contentTerms(question))];
    const missing = terms.filter((t) => !index.postings.has(t));
    const hits = terms.length ? search(index, terms, opts) : [];
    const passages = hits.map(({ doc, score }) => {
      const matched = terms.filter((t) => doc.tf.has(t));
      return { where: where(doc.chunk), source: doc.chunk.source, file: doc.chunk.file, line: doc.chunk.line, id: doc.chunk.id, score: Math.round(score * 100) / 100, matched, share: terms.length ? matched.length / terms.length : 0, preview: truncate(doc.chunk.text, 110) };
    });
    const best = passages.reduce((m, p) => Math.max(m, p.share), 0);
    const group = !terms.length ? "no-words" : !passages.length ? "no-match" : best < opts.weak ? "weak" : "candidate";
    return { question, count, group, terms, missing, best_share: Math.round(best * 100) / 100, passages, verdict: null, notes: "" };
  });
  const missingTotals = new Map();
  for (const r of results) for (const t of r.missing) missingTotals.set(t, (missingTotals.get(t) || 0) + r.count);
  const missingWords = [...missingTotals.entries()].sort((a, b) => b[1] - a[1]).map(([t, asks]) => ({ word: surface.get(t) ?? t, asks }));
  const order = { "no-match": 0, weak: 1, candidate: 2, "no-words": 3 };
  results.sort((a, b) => order[a.group] - order[b.group] || b.count - a.count);
  return { chunks: chunks.length, questions: results.length, asks: results.reduce((n, r) => n + r.count, 0), missing_words: missingWords, results };
}

const GROUPS = {
  "no-match": "no shared words (likely gaps)",
  weak: "weak match (possible gaps)",
  candidate: "candidates (read the passages)",
  "no-words": "no content words (rewrite or skip)",
};

function printText(r, opts, by) {
  console.log(`Question coverage, lexical first pass (read-only): ${fmt(r.questions)} questions (${fmt(r.asks)} asks) against ${fmt(r.chunks)} chunks`);
  console.log(`BM25 (k1 ${opts.k1}, b ${opts.b}) over chunk text${opts.context === "none" ? "" : opts.context === "headings" ? " with the document title and heading path" : " with the document title"}; files split by ${by}.`);
  console.log("Shared words find candidate passages; they do not show that a passage answers the question. Read the top");
  console.log("passages of every question and record a verdict: answered, partly, not in corpus, conflicting or stale.\n");
  for (const [key, label] of Object.entries(GROUPS)) {
    const list = r.results.filter((x) => x.group === key);
    if (!list.length && key === "no-words") continue;
    const asks = list.reduce((n, x) => n + x.count, 0);
    console.log(`  ${pad(label, 36)} ${pad(`${list.length} question${list.length === 1 ? "" : "s"}`, 14, true)} ${pad(`${fmt(asks)} asks`, 11, true)} ${pad(`(${pct(asks, r.asks)})`, 7, true)}`);
  }
  if (r.missing_words.length) {
    console.log(`\nWords users use that the corpus never uses (weighted by asks): ${r.missing_words.slice(0, 25).map((m) => `${m.word} ${m.asks}`).join(", ")}`);
  }
  for (const [key, label] of Object.entries(GROUPS)) {
    const list = r.results.filter((x) => x.group === key);
    if (!list.length) continue;
    console.log(`\n== ${label} (${list.length}) ==`);
    for (const q of list.slice(0, opts.limit)) {
      console.log(`  ${pad(`${q.count} asks`, 9)} "${truncate(q.question, 100)}"`);
      const missing = q.missing.length ? `; not in the corpus: ${q.missing.join(", ")}` : "";
      if (q.terms.length) console.log(`      words: ${q.terms.join(", ")}${missing}; best passage has ${Math.round(q.best_share * q.terms.length)} of ${q.terms.length}`);
      q.passages.forEach((p, i) => {
        console.log(`      ${i + 1}. ${pad(p.score.toFixed(2), 6, true)}  ${p.where}  matched: ${p.matched.join(", ") || "-"}`);
        console.log(`             "${p.preview}"`);
      });
    }
    if (list.length > opts.limit) console.log(`  ... ${list.length - opts.limit} more (--limit or --json)`);
  }
}

function main(argv) {
  const { opts, positional } = parseArgs(argv, SPEC);
  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (!opts.questions) throw new UsageError("--questions=<file> is required.");
  if (!["title", "headings", "none"].includes(opts.context)) throw new UsageError("--context must be title, headings or none.");
  const by = parseBy(opts.by);
  const questions = readQuestions(opts.questions);
  const { documents, warnings } = loadCorpus(positional, { by });
  printWarnings(warnings);
  const result = coverage(documents, questions, opts);
  if (opts.json) console.log(JSON.stringify({ settings: { by: describeBy(by), context: opts.context, k1: opts.k1, b: opts.b, weak: opts.weak }, ...result }, null, 2));
  else printText(result, opts, describeBy(by));
}

run(main, HELP, import.meta.url);
