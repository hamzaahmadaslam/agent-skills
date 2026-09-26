#!/usr/bin/env node
// Read-only helper. Checks the chunks of a RAG corpus for problems that retrieval cannot repair later: chunks below a
// useful size or above the embedding model's input limit, heading-only chunks, code blocks and Markdown tables cut
// across chunks, chunks that start in the middle of a numbered list or end in the middle of a sentence or on a colon,
// openings that lean on earlier text ("It", "This", "However"), references to text outside the chunk ("as shown
// above", "the following steps"), and how many chunks never name their document's subject.
//
// It reads the files you name and prints a report. It writes nothing and makes no network requests. Every finding is
// a pattern match, a candidate for a person (or the optional chunk-standalone tool) to read, not a verdict.
//
// Input: folders, Markdown, text and HTML files (split with --by, default heading), and JSONL chunk exports (checked
// as exported, one chunk per line). Check the chunks your pipeline really makes: export them to JSONL when you can.
//
// Usage:
//   node scripts/chunk-lint.mjs docs/
//   node scripts/chunk-lint.mjs chunks.jsonl --max-tokens=8192
//   node scripts/chunk-lint.mjs docs/ --by=tokens=300 --json
//
// Options:
//   --by=<mode>          heading (default), paragraph or tokens=N, for Markdown, text and HTML files.
//   --min-tokens=<n>     Chunks under this estimated size are listed as small (default 20).
//   --max-tokens=<n>     Your embedding model's input limit in tokens (default 512). Chunks above it are listed.
//   --top=<n>            How many chunks to list per check (default 15).
//   --json               Print JSON.
//
// Token counts are estimates at four characters per token; your model's tokenizer will differ.
// Exit codes: 0 done, 1 bad arguments, 2 input not readable.

import {
  describeBy,
  estimateTokens,
  contentTerms,
  fmt,
  isTableDelimiter,
  isTableRow,
  loadCorpus,
  nextFence,
  pad,
  parseArgs,
  parseBy,
  parseHeading,
  pct,
  percentile,
  printWarnings,
  run,
  splitSentences,
  truncate,
  where,
} from "./corpus.mjs";

const HELP = `Usage: node chunk-lint.mjs <folder|file ...> [--by=heading|paragraph|tokens=N] [--min-tokens=20]
                           [--max-tokens=512] [--top=15] [--json]`;

const SPEC = {
  by: { type: "string", default: "heading" },
  "min-tokens": { type: "number", default: 20, min: 1 },
  "max-tokens": { type: "number", default: 512, min: 1 },
  top: { type: "number", default: 15, min: 1 },
  json: { type: "boolean", default: false },
};

export const CHECKS = {
  "size-large": "larger than the embedding input limit",
  "size-small": "smaller than the minimum size",
  "heading-only": "heading with no content",
  "code-split": "code block cut across chunks",
  "table-no-header": "table rows without their header row",
  "table-no-rows": "table header without its rows",
  "list-mid": "starts in the middle of a numbered list",
  "cut-sentence": "ends in the middle of a sentence",
  "ends-colon": "ends on a colon (what follows is in the next chunk)",
  "opening-reference": "opens with a word that points to earlier text",
  "outside-reference": "refers to text outside the chunk",
};

// Openings that usually need the text before them (after Choi et al. 2021: pronoun and noun phrase swaps, discourse
// markers). "There is/are" is left out: it does not point back.
const OPENING =
  /^(?:it|its|it's|this|that|these|those|they|them|their|theirs|he|she|his|her|such|both|the latter|the former|the same|the above|here|however|therefore|thus|hence|also|additionally|furthermore|moreover|in addition|as a result|consequently|for example|for instance|instead|otherwise|then|next|finally|similarly|likewise|meanwhile|besides|in this case|in that case|on the other hand|again|but|and|or|so)\b/i;

const OUTSIDE = [
  /\bas (?:shown|mentioned|described|explained|noted|discussed|seen|stated|listed|outlined|defined|covered) (?:above|below|earlier|previously|before|in the (?:previous|preceding|last|next) (?:section|step|chapter|page))\b/i,
  /\b(?:see|refer to|check|go to) (?:above|below|the (?:previous|preceding|next|following|last) (?:section|step|chapter|page|table|example|figure))\b/i,
  /\bthe (?:above|preceding|previous|aforementioned|following|below) (?:section|step|steps|table|example|examples|list|command|commands|setting|settings|option|options|figure|diagram|screenshot|code|snippet|instructions|procedure|fields?)\b/i,
  /\b(?:in|from) the (?:previous|preceding|last|next) (?:section|step|chapter|page)\b/i,
  /\b(?:repeat|go back to|return to) step \d+\b/i,
  /\bsteps? \d+(?:\s*(?:-|to|and)\s*\d+)? (?:above|below)\b/i,
];

function firstTextLine(lines) {
  let fence = null;
  for (const line of lines) {
    const wasFence = fence;
    fence = nextFence(line, fence);
    if (wasFence || fence) return null; // the chunk opens with code
    if (!line.trim() || parseHeading(line) || isTableRow(line) || isTableDelimiter(line)) continue;
    return line.replace(/^\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])?\s*/, "");
  }
  return null;
}

/** Runs the per-chunk checks. Returns findings: [{ check, detail }]. */
export function checkChunk(chunk, prev, next, opts) {
  const findings = [];
  const text = chunk.text;
  const lines = text.split("\n");
  const tokens = estimateTokens(text);

  // Code fences, carried over from the previous chunk of the same document: does the chunk start or end inside a
  // code block? (CommonMark: an unclosed fence runs to the end of the document.)
  const startFence = prev?.openFence ?? null;
  let fence = startFence;
  for (const line of lines) fence = nextFence(line, fence);
  chunk.openFence = fence;
  chunk.endsInCode = Boolean(fence);
  if (startFence && fence) findings.push({ check: "code-split", detail: "the middle of a code block: it starts and ends inside one" });
  else if (startFence) findings.push({ check: "code-split", detail: "starts inside the previous chunk's code block" });
  else if (fence) findings.push({ check: "code-split", detail: "a code block opens and continues into the next chunk" });

  // Headings only.
  let body = 0;
  fence = null;
  for (const line of lines) {
    const wasFence = fence;
    fence = nextFence(line, fence);
    if (!line.trim()) continue;
    if (!wasFence && !fence && parseHeading(line)) continue;
    body += 1;
  }
  if (body === 0) findings.push({ check: "heading-only", detail: "only headings" });
  else if (tokens < opts["min-tokens"]) findings.push({ check: "size-small", detail: `minimum ${opts["min-tokens"]}` });
  if (tokens > opts["max-tokens"]) findings.push({ check: "size-large", detail: `limit ${fmt(opts["max-tokens"])}` });

  // Tables: groups of consecutive table lines outside code.
  fence = null;
  const groups = [];
  let group = null;
  lines.forEach((line) => {
    const wasFence = fence;
    fence = nextFence(line, fence);
    const tableLine = !wasFence && !fence && (isTableRow(line) || isTableDelimiter(line) || (group && line.includes("|") && line.trim()));
    if (tableLine) {
      if (!group) groups.push((group = []));
      group.push(line);
    } else {
      group = null;
    }
  });
  groups.forEach((g, gi) => {
    const delimiterAt = g.findIndex((l) => isTableDelimiter(l));
    if (delimiterAt === -1 && g.some((l) => isTableRow(l))) {
      findings.push({ check: "table-no-header", detail: `${g.length} table row(s) with no header and delimiter row` });
    } else if (delimiterAt === 0) {
      findings.push({ check: "table-no-header", detail: "the table starts at its delimiter row: the header row is in the previous chunk" });
    } else if (delimiterAt === g.length - 1 && gi === groups.length - 1 && lastNonBlank(lines) === g[g.length - 1]) {
      findings.push({ check: "table-no-rows", detail: "the chunk ends right after the table header" });
    }
  });

  // Numbered list continuing from the previous chunk.
  const first = firstTextLine(lines);
  const firstRaw = lines.find((l) => l.trim() && !parseHeading(l)) ?? "";
  const item = /^\s*(\d{1,9})[.)]\s+/.exec(firstRaw);
  if (item && Number(item[1]) > 1) findings.push({ check: "list-mid", detail: `starts at item ${item[1]}` });

  // Openings and outside references (the first chunk of a document has nothing before it).
  if (first && chunk.index > 1 && !startFence) {
    const sentence = splitSentences(first)[0]?.text ?? first;
    const m = OPENING.exec(sentence);
    if (m) findings.push({ check: "opening-reference", detail: `opens with "${m[0]}"` });
  }
  for (const re of OUTSIDE) {
    const m = re.exec(text);
    if (m) {
      findings.push({ check: "outside-reference", detail: `"${m[0]}"` });
      break;
    }
  }

  // Endings.
  const last = lastNonBlank(lines);
  if (last && !chunk.endsInCode) {
    const trimmed = last.trim();
    const structural = parseHeading(last) || isTableRow(last) || isTableDelimiter(last) || /^\s*([-*+]|\d{1,9}[.)])\s/.test(last) || /^ {0,3}(`{3,}|~{3,})/.test(last);
    if (/:$/.test(trimmed) && !structural) {
      const tail = trimmed.length > 60 ? `...${trimmed.slice(-57)}` : trimmed;
      findings.push({ check: "ends-colon", detail: `ends with "${tail}"` });
    }
    else if (!structural && /[\p{L}\p{N},]$/u.test(trimmed) && next && /^\s*\p{Ll}/u.test(next.text)) {
      findings.push({ check: "cut-sentence", detail: "no closing punctuation, and the next chunk starts in lower case" });
    }
  }
  return findings;
}

function lastNonBlank(lines) {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) return lines[i];
  return null;
}

/** Title words: content terms of the document title, 3 letters or more. */
function titleTerms(doc) {
  const title = doc.meta?.title ?? doc.meta?.doc_title ?? doc.meta?.document_title;
  if (!title) return [];
  return [...new Set(contentTerms(String(title), { numbers: false }).filter((t) => t.length >= 3))];
}

export function lint(documents, opts) {
  const findings = [];
  const sizes = [];
  let chunks = 0;
  let withTitle = 0;
  let missingTitleTerms = 0;
  const perDoc = [];
  for (const doc of documents) {
    const terms = titleTerms(doc);
    let docMissing = 0;
    doc.chunks.forEach((chunk, i) => {
      chunks += 1;
      const tokens = estimateTokens(chunk.text);
      sizes.push(tokens);
      for (const f of checkChunk(chunk, doc.chunks[i - 1], doc.chunks[i + 1], opts)) {
        findings.push({ ...f, where: where(chunk), source: chunk.source, file: chunk.file, line: chunk.line, id: chunk.id, tokens, preview: truncate(chunk.text, 90) });
      }
      if (terms.length) {
        withTitle += 1;
        const have = new Set(contentTerms(chunk.text, { numbers: false }));
        if (!terms.some((t) => have.has(t))) {
          missingTitleTerms += 1;
          docMissing += 1;
        }
      }
    });
    if (terms.length) perDoc.push({ source: doc.source, title: doc.meta.title, chunks: doc.chunks.length, missing: docMissing });
  }
  const counts = Object.fromEntries(Object.keys(CHECKS).map((k) => [k, findings.filter((f) => f.check === k).length]));
  return {
    chunks,
    documents: documents.length,
    sizes: {
      min: percentile(sizes, 0),
      median: percentile(sizes, 50),
      p90: percentile(sizes, 90),
      max: percentile(sizes, 100),
      under_min: sizes.filter((s) => s < opts["min-tokens"]).length,
      over_max: sizes.filter((s) => s > opts["max-tokens"]).length,
    },
    counts,
    findings,
    title_terms: {
      chunks_with_title: withTitle,
      chunks_without_title_words: missingTitleTerms,
      documents: perDoc.filter((d) => d.missing).sort((a, b) => b.missing / b.chunks - a.missing / a.chunks),
    },
  };
}

function printText(result, opts, by, inputs) {
  const s = result.sizes;
  console.log(`Chunk lint (read-only): ${inputs.length} input(s), ${fmt(result.documents)} documents, ${fmt(result.chunks)} chunks, files split by ${by}`);
  console.log(
    `Sizes (estimated tokens): min ${fmt(s.min ?? 0)}, median ${fmt(s.median ?? 0)}, p90 ${fmt(s.p90 ?? 0)}, max ${fmt(s.max ?? 0)}; ` +
      `under ${opts["min-tokens"]}: ${s.under_min}, over ${opts["max-tokens"]}: ${s.over_max}`,
  );
  console.log("\nFindings are pattern matches: read each chunk before deciding on a fix.\n");
  for (const [key, label] of Object.entries(CHECKS)) console.log(`  ${pad(label, 52)} ${pad(result.counts[key], 5, true)}`);
  for (const [key, label] of Object.entries(CHECKS)) {
    const list = result.findings.filter((f) => f.check === key);
    if (!list.length) continue;
    console.log(`\n== ${label} (${list.length}) ==`);
    for (const f of list.slice(0, opts.top)) {
      console.log(`  ${f.where}  ${fmt(f.tokens)} tokens  ${f.detail}`);
      console.log(`      "${f.preview}"`);
    }
    if (list.length > opts.top) console.log(`  ... ${list.length - opts.top} more (--top or --json)`);
  }
  const t = result.title_terms;
  console.log("\n== Chunks that never name their document's subject ==");
  if (!t.chunks_with_title) {
    console.log("  No document has a title (front matter title, first # heading, HTML <title> or a JSONL title field).");
  } else {
    console.log(
      `  ${fmt(t.chunks_without_title_words)} of ${fmt(t.chunks_with_title)} chunks (${pct(t.chunks_without_title_words, t.chunks_with_title)}) ` +
        "contain no word of their document's title.",
    );
    console.log("  If your pipeline does not add the title or heading path to each chunk before embedding, these chunks");
    console.log("  cannot match a question that names the subject. Documents with the highest share:");
    for (const d of t.documents.slice(0, opts.top)) {
      console.log(`    ${pad(`${d.missing}/${d.chunks}`, 7)} ${d.source}  "${truncate(d.title, 60)}"`);
    }
  }
}

function main(argv) {
  const { opts, positional } = parseArgs(argv, SPEC);
  if (opts.help) {
    console.log(HELP);
    return;
  }
  const by = parseBy(opts.by);
  const { documents, warnings } = loadCorpus(positional, { by });
  printWarnings(warnings);
  const result = lint(documents, opts);
  if (opts.json) console.log(JSON.stringify({ by: describeBy(by), options: { min_tokens: opts["min-tokens"], max_tokens: opts["max-tokens"] }, ...result }, null, 2));
  else printText(result, opts, describeBy(by), positional);
}

run(main, HELP, import.meta.url);
