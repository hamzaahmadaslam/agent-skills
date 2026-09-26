#!/usr/bin/env node
// Read-only helper. Describes a corpus before an audit: files by format, documents and chunks, estimated sizes, the
// writing systems (scripts) it contains, which metadata fields exist and how many documents and chunks fill them
// (grouped by the role they play for filtering, citations, freshness and access), duplicate or missing chunk IDs,
// and the date range with undated, old and future-dated documents.
//
// It reads the files you name and prints a report. It writes nothing and makes no network requests.
//
// Usage:
//   node scripts/corpus-inventory.mjs docs/
//   node scripts/corpus-inventory.mjs docs/ chunks.jsonl --as-of=2026-09-26 --json
//
// Options:
//   --by=<mode>            heading (default), paragraph or tokens=N, for Markdown, text and HTML files.
//   --as-of=<YYYY-MM-DD>   The date ages are measured against (default: today, UTC).
//   --max-age-days=<n>     A document older than this counts as old (default 365).
//   --top=<n>              How many documents to list per section (default 15).
//   --json                 Print JSON.
//
// Exit codes: 0 done, 1 bad arguments, 2 input not readable.

import path from "node:path";
import {
  daysBetween,
  describeBy,
  documentDate,
  estimateTokens,
  fmt,
  isoDate,
  loadCorpus,
  META_ROLES,
  metaRole,
  pad,
  parseArgs,
  parseAsOf,
  parseBy,
  parseDateValue,
  pct,
  percentile,
  printWarnings,
  run,
  scriptCounts,
  truncate,
} from "./corpus.mjs";

const HELP = `Usage: node corpus-inventory.mjs <folder|file ...> [--by=heading|paragraph|tokens=N] [--as-of=YYYY-MM-DD]
                                  [--max-age-days=365] [--top=15] [--json]`;

const SPEC = {
  by: { type: "string", default: "heading" },
  "as-of": { type: "string", default: "" },
  "max-age-days": { type: "number", default: 365, min: 1 },
  top: { type: "number", default: 15, min: 1 },
  json: { type: "boolean", default: false },
};

export const ROLE_PURPOSE = {
  id: "stable chunk ID: updates, deletions, citations",
  source: "where the text came from: citations, erasure requests",
  title: "document title: context for the chunk, citations",
  section: "heading path: context for the chunk",
  created: "first published",
  modified: "last changed: freshness filters and reviews",
  valid: "valid until or review by: expiry",
  language: "language tag: filters, embedding model choice",
  access: "audience, tenant or ACL: permission filters",
  version: "product or version it applies to: filters",
  replaces: "supersedes or superseded by: keeps old versions out",
  license: "rights to reuse the text",
  owner: "who keeps it correct",
};

const BCP47 = /^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|\d{3}))?(?:-[A-Za-z0-9]{5,8}|-\d[A-Za-z0-9]{3})*$/;

export function inventory(documents, files, opts) {
  const asOf = parseAsOf(opts["as-of"]);
  const chunks = documents.flatMap((d) => d.chunks);
  const sizes = chunks.map((c) => estimateTokens(c.text));
  const byExt = {};
  for (const f of files) {
    const ext = path.extname(f.full).toLowerCase() || "(none)";
    byExt[ext] = (byExt[ext] || 0) + 1;
  }

  // Scripts: letters per writing system, overall and each document's main one.
  const total = {};
  let letters = 0;
  const docScripts = [];
  for (const doc of documents) {
    const { counts, letters: n } = scriptCounts(doc.format === "jsonl" ? doc.chunks.map((c) => c.text).join("\n") : doc.text);
    letters += n;
    for (const [k, v] of Object.entries(counts)) total[k] = (total[k] || 0) + v;
    const main = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (main) docScripts.push({ source: doc.source, script: main[0], share: main[1] / n });
  }
  const corpusMain = Object.entries(total).sort((a, b) => b[1] - a[1])[0]?.[0];

  // Metadata: files (front matter, HTML head) and JSONL chunks (each row's own fields).
  const fileDocs = documents.filter((d) => d.format !== "jsonl");
  const docFields = {};
  for (const doc of fileDocs) for (const k of Object.keys(doc.meta)) docFields[k] = (docFields[k] || 0) + 1;
  const jsonlChunks = chunks.filter((c) => c.jsonl);
  const chunkFields = {};
  for (const c of jsonlChunks) for (const k of Object.keys(c.meta)) chunkFields[k] = (chunkFields[k] || 0) + 1;
  const roles = Object.keys(META_ROLES).map((role) => {
    const docHits = fileDocs.filter((d) => metaRole(d.meta, role)).length;
    const chunkHits = jsonlChunks.filter((c) => metaRole(c.meta, role)).length;
    const keys = new Set([...fileDocs.map((d) => metaRole(d.meta, role)?.key), ...jsonlChunks.map((c) => metaRole(c.meta, role)?.key)].filter(Boolean));
    return { role, purpose: ROLE_PURPOSE[role], keys: [...keys], files: docHits, chunks: chunkHits };
  });

  // IDs of JSONL chunks.
  const ids = new Map();
  let missingIds = 0;
  for (const c of jsonlChunks) {
    const id = metaRole(c.meta, "id")?.value;
    if (!id) missingIds += 1;
    else ids.set(id, [...(ids.get(id) || []), `${c.file}:${c.line}`]);
  }
  const duplicateIds = [...ids.entries()].filter(([, where]) => where.length > 1).map(([id, where]) => ({ id, where }));

  // Language tags.
  const badLanguage = [];
  for (const d of documents) {
    const lang = metaRole(d.meta, "language");
    if (lang && !BCP47.test(lang.value.trim())) badLanguage.push({ source: d.source, value: lang.value });
  }

  // Dates.
  const dated = documents.map((d) => {
    const own = documentDate(d.meta);
    let date = own?.date ?? null;
    let from = own?.key ?? null;
    if (!date && d.format === "jsonl") {
      for (const c of d.chunks) {
        const m = metaRole(c.meta, "modified") ?? metaRole(c.meta, "created");
        const p = m ? parseDateValue(m.value) : null;
        if (p && (!date || p.end > date)) {
          date = p.end;
          from = m.key;
        }
      }
    }
    return { source: d.source, date: date ? isoDate(date) : null, from, age_days: date ? daysBetween(date, asOf) : null };
  });
  const withDate = dated.filter((d) => d.date).sort((a, b) => a.date.localeCompare(b.date));

  return {
    as_of: isoDate(asOf),
    files: { total: files.length, by_extension: byExt },
    documents: documents.length,
    chunks: chunks.length,
    tokens: { total: sizes.reduce((a, b) => a + b, 0), median: percentile(sizes, 50), p90: percentile(sizes, 90), max: percentile(sizes, 100) },
    largest_documents: documents
      .map((d) => ({ source: d.source, chunks: d.chunks.length, tokens: d.chunks.reduce((n, c) => n + estimateTokens(c.text), 0) }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, opts.top),
    scripts: {
      letters,
      shares: Object.fromEntries(Object.entries(total).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round((v / letters) * 1000) / 10])),
      documents_in_other_scripts: docScripts.filter((d) => d.script !== corpusMain),
    },
    metadata: { file_fields: docFields, chunk_fields: chunkFields, files: fileDocs.length, jsonl_chunks: jsonlChunks.length, roles },
    ids: { jsonl_chunks: jsonlChunks.length, missing: missingIds, duplicates: duplicateIds },
    language_tags_not_bcp47: badLanguage,
    dates: {
      oldest: withDate[0] ?? null,
      newest: withDate[withDate.length - 1] ?? null,
      undated: dated.filter((d) => !d.date).map((d) => d.source),
      older_than_max: withDate.filter((d) => d.age_days > opts["max-age-days"]),
      after_as_of: withDate.filter((d) => d.age_days < 0),
    },
  };
}

function printText(r, opts, by, inputs) {
  console.log(`Corpus inventory (read-only): ${inputs.join(", ")}; as of ${r.as_of}`);
  const exts = Object.entries(r.files.by_extension).map(([k, v]) => `${v} ${k}`).join(", ");
  console.log(`Files: ${fmt(r.files.total)} (${exts})`);
  console.log(`Documents: ${fmt(r.documents)}; chunks: ${fmt(r.chunks)} (files split by ${by}; JSONL chunks as exported)`);
  console.log(`Estimated tokens: ${fmt(r.tokens.total)} in all; per chunk median ${fmt(r.tokens.median ?? 0)}, p90 ${fmt(r.tokens.p90 ?? 0)}, max ${fmt(r.tokens.max ?? 0)}`);

  console.log("\n== Largest documents ==");
  for (const d of r.largest_documents) console.log(`  ${pad(fmt(d.tokens), 9, true)} tokens  ${pad(d.chunks, 4, true)} chunks  ${d.source}`);

  console.log("\n== Writing systems (share of letters) ==");
  console.log(`  ${Object.entries(r.scripts.shares).map(([k, v]) => `${k} ${v}%`).join(", ") || "no letters"}`);
  if (r.scripts.documents_in_other_scripts.length) {
    console.log("  Documents whose main script differs from the corpus (check the language and the embedding model):");
    for (const d of r.scripts.documents_in_other_scripts.slice(0, opts.top)) console.log(`    ${d.source}: ${d.script} ${Math.round(d.share * 100)}%`);
  }

  const m = r.metadata;
  console.log("\n== Metadata by role (files with it: front matter or HTML head / JSONL chunks with it) ==");
  console.log(`  ${pad("role", 10)} ${pad("files", 10)} ${pad("chunks", 10)} ${pad("fields found", 26)} used for`);
  for (const role of m.roles) {
    const files = m.files ? `${role.files}/${m.files}` : "-";
    const chunks = m.jsonl_chunks ? `${role.chunks}/${m.jsonl_chunks}` : "-";
    console.log(`  ${pad(role.role, 10)} ${pad(files, 10)} ${pad(chunks, 10)} ${pad(truncate(role.keys.join(", ") || "none", 26), 26)} ${role.purpose}`);
  }
  const missing = m.roles.filter((x) => !x.files && !x.chunks).map((x) => x.role);
  if (missing.length) console.log(`  Missing everywhere: ${missing.join(", ")}`);
  if (m.files) console.log("  Files also carry their path and a title from their first heading: check that the pipeline stores them with each chunk.");
  if (Object.keys(m.file_fields).length) console.log(`  File fields: ${Object.entries(m.file_fields).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (Object.keys(m.chunk_fields).length) console.log(`  Chunk fields: ${Object.entries(m.chunk_fields).map(([k, v]) => `${k} ${v}`).join(", ")}`);

  if (r.ids.jsonl_chunks) {
    console.log("\n== Chunk IDs (JSONL) ==");
    console.log(`  missing: ${r.ids.missing} of ${r.ids.jsonl_chunks}; duplicated: ${r.ids.duplicates.length}`);
    for (const d of r.ids.duplicates.slice(0, opts.top)) console.log(`    "${d.id}" at ${d.where.join(", ")}`);
  }
  if (r.language_tags_not_bcp47.length) {
    console.log("\n== Language values that are not BCP 47 tags ==");
    for (const l of r.language_tags_not_bcp47.slice(0, opts.top)) console.log(`  ${l.source}: "${l.value}"`);
  }

  console.log(`\n== Dates (newest modified or created date per document; old means over ${opts["max-age-days"]} days) ==`);
  const d = r.dates;
  if (d.oldest) console.log(`  range ${d.oldest.date} (${d.oldest.source}) to ${d.newest.date} (${d.newest.source})`);
  console.log(`  undated: ${d.undated.length} of ${r.documents} (${pct(d.undated.length, r.documents)}); old: ${d.older_than_max.length}; dated after ${r.as_of}: ${d.after_as_of.length}`);
  for (const s of d.undated.slice(0, opts.top)) console.log(`    undated  ${s}`);
  for (const o of d.older_than_max.slice(0, opts.top)) console.log(`    old      ${o.date} (${fmt(o.age_days)} days, ${o.from})  ${o.source}`);
  for (const f of d.after_as_of.slice(0, opts.top)) console.log(`    future   ${f.date} (${f.from})  ${f.source}`);
}

function main(argv) {
  const { opts, positional } = parseArgs(argv, SPEC);
  if (opts.help) {
    console.log(HELP);
    return;
  }
  const by = parseBy(opts.by);
  const { documents, warnings, files } = loadCorpus(positional, { by });
  printWarnings(warnings);
  const result = inventory(documents, files, opts);
  if (opts.json) console.log(JSON.stringify({ by: describeBy(by), ...result }, null, 2));
  else printText(result, opts, describeBy(by), positional);
}

run(main, HELP, import.meta.url);
