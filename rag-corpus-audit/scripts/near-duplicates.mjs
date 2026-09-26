#!/usr/bin/env node
// Read-only helper. Finds repeated content in a RAG corpus before it is indexed:
//   - exact duplicates: chunks with the same text after case and spacing are ignored;
//   - near-duplicates: chunks whose sets of word shingles overlap by at least --threshold (Jaccard resemblance), and
//     chunks that differ only in numbers or punctuation, with the numbers that differ (often two versions of a fact);
//   - contained excerpts: a shorter chunk whose shingles sit almost entirely inside a longer chunk (containment);
//   - boilerplate: lines repeated in many documents (menus, footers, cookie and contact text).
// Shingles, resemblance and containment follow Broder (1997); the normalization follows CCNet (lower case, digits to
// 0, punctuation and accents removed). Shingle overlaps are counted exactly with a sorted list of shingle hashes.
//
// It reads the files you name and prints a report. It writes nothing and makes no network requests. Matching is by
// words: paraphrases and translations of the same text are not found.
//
// Usage:
//   node scripts/near-duplicates.mjs docs/
//   node scripts/near-duplicates.mjs chunks.jsonl --threshold=0.6 --json
//
// Options:
//   --by=<mode>              heading (default), paragraph or tokens=N, for Markdown, text and HTML files.
//   --shingle=<n>            Words per shingle (default 4).
//   --threshold=<j>          Jaccard resemblance for near-duplicates, 0.5 to 1 (default 0.7).
//   --containment=<c>        Share of the shorter chunk's shingles inside the longer one (default 0.9).
//   --min-words=<n>          Chunks with fewer words are compared only as exact copies (default 8).
//   --max-df=<n>             Shingles found in more chunks than this are left out of the pair search and counted as
//                            common text instead (default 200).
//   --boilerplate-docs=<n>   A line counts as boilerplate when it is in at least this many documents (default 3).
//   --boilerplate-chars=<n>  Shortest line considered for boilerplate, in characters (default 30).
//   --top=<n>                How many groups to list per section (default 20).
//   --json                   Print JSON.
//
// Exit codes: 0 done, 1 bad arguments, 2 input not readable.

import {
  describeBy,
  documentDate,
  fmt,
  fnv1a,
  isoDate,
  loadCorpus,
  metaRole,
  nextFence,
  normalizeExact,
  normalizeLoose,
  pad,
  parseArgs,
  parseBy,
  parseDateValue,
  pct,
  printWarnings,
  run,
  sha1,
  truncate,
  UsageError,
  where,
} from "./corpus.mjs";

const HELP = `Usage: node near-duplicates.mjs <folder|file ...> [--by=heading|paragraph|tokens=N] [--shingle=4]
                                [--threshold=0.7] [--containment=0.9] [--min-words=8] [--max-df=200]
                                [--boilerplate-docs=3] [--boilerplate-chars=30] [--top=20] [--json]`;

const SPEC = {
  by: { type: "string", default: "heading" },
  shingle: { type: "number", default: 4, min: 1, max: 20 },
  threshold: { type: "number", default: 0.7, min: 0.5, max: 1 },
  containment: { type: "number", default: 0.9, min: 0.5, max: 1 },
  "min-words": { type: "number", default: 8, min: 1 },
  "max-df": { type: "number", default: 200, min: 2 },
  "boilerplate-docs": { type: "number", default: 3, min: 2 },
  "boilerplate-chars": { type: "number", default: 30, min: 1 },
  top: { type: "number", default: 20, min: 1 },
  json: { type: "boolean", default: false },
};

const CHUNK_BITS = 2 ** 21; // chunk index space packed next to a 32-bit hash in a float64 (2^53)

/** Unique shingle hashes of a normalized text, sorted. */
export function shingleSet(text, k) {
  const tokens = text.split(" ").filter(Boolean);
  const set = new Set();
  for (let i = 0; i + k <= tokens.length; i++) set.add(fnv1a(tokens.slice(i, i + k).join(" ")));
  return Uint32Array.from(set).sort();
}

const numbersOf = (text) => [...new Set(text.match(/\d+(?:[.,:]\d+)*/g) || [])].sort();

function chunkDate(chunk) {
  const own = metaRole(chunk.meta, "modified") ?? metaRole(chunk.meta, "created");
  const parsed = own ? parseDateValue(own.value) : null;
  if (parsed) return isoDate(parsed.end);
  const d = documentDate(chunk.doc.meta);
  return d ? isoDate(d.date) : null;
}

class UnionFind {
  constructor(n) {
    this.parent = Int32Array.from({ length: n }, (_, i) => i);
  }
  find(x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

export function findDuplicates(documents, opts) {
  const chunks = documents.flatMap((d) => d.chunks);
  if (chunks.length >= CHUNK_BITS) throw new UsageError(`Too many chunks (${chunks.length}); this helper handles up to ${CHUNK_BITS - 1}.`);

  // 1. Exact duplicates: one representative per distinct text.
  const exactGroups = new Map();
  chunks.forEach((c, i) => {
    const key = sha1(normalizeExact(c.text));
    if (!exactGroups.has(key)) exactGroups.set(key, []);
    exactGroups.get(key).push(i);
  });
  const reps = [...exactGroups.values()].map((members) => members[0]);
  const copiesOf = new Map([...exactGroups.values()].map((members) => [members[0], members]));

  // 2. Texts equal after loose normalization (they differ only in digits, punctuation or accents).
  const loose = reps.map((i) => normalizeLoose(chunks[i].text));
  const uf = new UnionFind(reps.length);
  const pairs = new Map();
  const looseGroups = new Map();
  loose.forEach((text, r) => {
    if (!text) return;
    const key = sha1(text);
    if (looseGroups.has(key)) {
      const first = looseGroups.get(key);
      uf.union(first, r);
      pairs.set(first * CHUNK_BITS + r, { jaccard: 1, containment: 1 });
    } else looseGroups.set(key, r);
  });

  // 3. Shingle overlaps between the remaining representatives, counted exactly from a sorted list of
  //    (shingle hash, representative) values. Very common shingles are counted as common text instead.
  const sets = loose.map((text, r) => (text.split(" ").length >= opts["min-words"] ? shingleSet(text, opts.shingle) : new Uint32Array(0)));
  const total = sets.reduce((n, s) => n + s.length, 0);
  const packed = new Float64Array(total);
  let p = 0;
  sets.forEach((s, r) => {
    for (const h of s) packed[p++] = h * CHUNK_BITS + r;
  });
  packed.sort();
  const shared = new Map();
  let commonShingles = 0;
  for (let i = 0; i < packed.length; ) {
    const h = Math.floor(packed[i] / CHUNK_BITS);
    let j = i + 1;
    while (j < packed.length && Math.floor(packed[j] / CHUNK_BITS) === h) j++;
    const run = j - i;
    if (run > opts["max-df"]) commonShingles += 1;
    else if (run > 1) {
      for (let a = i; a < j; a++) {
        const ra = packed[a] % CHUNK_BITS;
        for (let b = a + 1; b < j; b++) {
          const rb = packed[b] % CHUNK_BITS;
          const key = ra < rb ? ra * CHUNK_BITS + rb : rb * CHUNK_BITS + ra;
          shared.set(key, (shared.get(key) || 0) + 1);
        }
      }
    }
    i = j;
  }
  const contained = [];
  for (const [key, inter] of shared) {
    const a = Math.floor(key / CHUNK_BITS);
    const b = key % CHUNK_BITS;
    const na = sets[a].length;
    const nb = sets[b].length;
    const jaccard = inter / (na + nb - inter);
    const containment = inter / Math.min(na, nb);
    if (jaccard >= opts.threshold) {
      uf.union(a, b);
      pairs.set(key, { jaccard, containment });
    } else if (containment >= opts.containment && Math.min(na, nb) >= 3) {
      const [small, large] = na <= nb ? [a, b] : [b, a];
      contained.push({ small, large, containment, jaccard });
    }
  }

  // 4. Near-duplicate clusters.
  const clusters = new Map();
  for (const [key, score] of pairs) {
    const a = Math.floor(key / CHUNK_BITS);
    const root = uf.find(a);
    if (!clusters.has(root)) clusters.set(root, { members: new Set(), min: 1, max: 0 });
    const c = clusters.get(root);
    c.members.add(a).add(key % CHUNK_BITS);
    c.min = Math.min(c.min, score.jaccard);
    c.max = Math.max(c.max, score.jaccard);
  }
  const describe = (r) => {
    const i = reps[r];
    const chunk = chunks[i];
    return {
      where: where(chunk),
      source: chunk.source,
      file: chunk.file,
      line: chunk.line,
      id: chunk.id,
      date: chunkDate(chunk),
      exact_copies: copiesOf.get(i).length - 1,
      numbers: numbersOf(chunk.text),
      preview: truncate(chunk.text, 100),
    };
  };
  const near = [...clusters.values()]
    .map((c) => {
      const members = [...c.members].sort((a, b) => a - b).map(describe);
      const numberSets = new Set(members.map((m) => m.numbers.join(" ")));
      return { size: members.length, jaccard_min: round(c.min), jaccard_max: round(c.max), numbers_differ: numberSets.size > 1, members };
    })
    .sort((x, y) => Number(y.numbers_differ) - Number(x.numbers_differ) || y.size - x.size);

  const exact = [...exactGroups.values()]
    .filter((m) => m.length > 1)
    .map((m) => ({
      copies: m.length,
      preview: truncate(chunks[m[0]].text, 100),
      members: m.map((i) => ({ where: where(chunks[i]), source: chunks[i].source, file: chunks[i].file, line: chunks[i].line, id: chunks[i].id, date: chunkDate(chunks[i]) })),
    }))
    .sort((a, b) => b.copies - a.copies);

  const containedOut = contained
    .sort((a, b) => b.containment - a.containment)
    .map((c) => ({ containment: round(c.containment), jaccard: round(c.jaccard), shorter: describe(c.small), longer: describe(c.large) }));

  return {
    chunks: chunks.length,
    documents: documents.length,
    exact,
    near,
    contained: containedOut,
    common_shingles_skipped: commonShingles,
    boilerplate: findBoilerplate(documents, opts),
  };
}

const round = (n) => Math.round(n * 100) / 100;

/** Lines (outside code blocks) that appear in at least --boilerplate-docs documents. */
export function findBoilerplate(documents, opts) {
  const lines = new Map();
  for (const doc of documents) {
    const seen = new Map();
    for (const chunk of doc.chunks) {
      let fence = null;
      chunk.text.split("\n").forEach((line, i) => {
        const wasFence = fence;
        fence = nextFence(line, fence);
        if (wasFence || fence) return;
        const norm = normalizeLoose(line);
        if (norm.length < opts["boilerplate-chars"]) return;
        const entry = seen.get(norm) || { count: 0, line: line.trim(), where: `${chunk.source}:${chunk.jsonl ? chunk.line : chunk.line + i}` };
        entry.count += 1;
        seen.set(norm, entry);
      });
    }
    for (const [norm, entry] of seen) {
      if (!lines.has(norm)) lines.set(norm, { docs: 0, occurrences: 0, sample: entry.line, first: entry.where });
      const l = lines.get(norm);
      l.docs += 1;
      l.occurrences += entry.count;
    }
  }
  return [...lines.values()]
    .filter((l) => l.docs >= opts["boilerplate-docs"])
    .sort((a, b) => b.docs - a.docs || b.occurrences - a.occurrences)
    .map((l) => ({ documents: l.docs, share: round(l.docs / documents.length), occurrences: l.occurrences, first_seen: l.first, text: truncate(l.sample, 140) }));
}

function printText(r, opts, by) {
  const redundant = r.exact.reduce((n, g) => n + g.copies - 1, 0);
  console.log(
    `Duplicates and boilerplate (read-only): ${fmt(r.documents)} documents, ${fmt(r.chunks)} chunks (files split by ${by}); ` +
      `${opts.shingle}-word shingles, near-duplicate at Jaccard >= ${opts.threshold}`,
  );
  console.log(`  exact duplicate groups     ${pad(r.exact.length, 5, true)}   (${redundant} redundant copies)`);
  console.log(`  near-duplicate clusters    ${pad(r.near.length, 5, true)}   (${r.near.filter((c) => c.numbers_differ).length} with numbers that differ)`);
  console.log(`  contained excerpts         ${pad(r.contained.length, 5, true)}`);
  console.log(`  boilerplate lines          ${pad(r.boilerplate.length, 5, true)}   (in ${opts["boilerplate-docs"]} or more documents)`);
  if (r.common_shingles_skipped) {
    console.log(`  common shingles skipped    ${pad(r.common_shingles_skipped, 5, true)}   (in more than ${opts["max-df"]} chunks: templated text; see boilerplate)`);
  }

  const dated = (m) => (m.date ? `  (dated ${m.date})` : "  (undated)");
  if (r.exact.length) console.log("\n== Exact duplicates (same text apart from case and spacing) ==");
  for (const g of r.exact.slice(0, opts.top)) {
    console.log(`  ${g.copies} copies  "${g.preview}"`);
    for (const m of g.members) console.log(`      ${m.where}${dated(m)}`);
  }
  if (r.exact.length > opts.top) console.log(`  ... ${r.exact.length - opts.top} more groups (--top or --json)`);

  if (r.near.length) console.log("\n== Near-duplicates (numbers that differ are listed: two versions of one fact?) ==");
  r.near.slice(0, opts.top).forEach((c, i) => {
    const range = c.jaccard_min === c.jaccard_max ? `${c.jaccard_min.toFixed(2)}` : `${c.jaccard_min.toFixed(2)} to ${c.jaccard_max.toFixed(2)}`;
    console.log(`  cluster ${i + 1}: ${c.size} chunks, Jaccard ${range}${c.numbers_differ ? ", numbers differ" : ""}`);
    for (const m of c.members) {
      const copies = m.exact_copies ? ` (+${m.exact_copies} exact copies)` : "";
      const nums = c.numbers_differ ? `  numbers: ${m.numbers.join(", ") || "none"}` : "";
      console.log(`      ${m.where}${dated(m)}${copies}${nums}`);
    }
    console.log(`      "${c.members[0].preview}"`);
  });
  if (r.near.length > opts.top) console.log(`  ... ${r.near.length - opts.top} more clusters (--top or --json)`);

  if (r.contained.length) console.log("\n== Contained excerpts (the shorter chunk is almost all inside the longer one) ==");
  for (const c of r.contained.slice(0, opts.top)) {
    console.log(`  ${pct(c.containment, 1)} of ${c.shorter.where}`);
    console.log(`      is inside ${c.longer.where}`);
    console.log(`      "${c.shorter.preview}"`);
  }

  if (r.boilerplate.length) console.log(`\n== Boilerplate lines (in ${opts["boilerplate-docs"]} or more documents) ==`);
  for (const b of r.boilerplate.slice(0, opts.top)) {
    console.log(`  ${pad(`${b.documents} docs (${Math.round(b.share * 100)}%)`, 15)} "${b.text}"`);
  }
  if (!r.exact.length && !r.near.length && !r.contained.length && !r.boilerplate.length) console.log("\nNo repeated content found at these settings.");
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
  const result = findDuplicates(documents, opts);
  if (opts.json) {
    const settings = { by: describeBy(by), shingle: opts.shingle, threshold: opts.threshold, containment: opts.containment, min_words: opts["min-words"], max_df: opts["max-df"] };
    console.log(JSON.stringify({ settings, ...result }, null, 2));
  } else printText(result, opts, describeBy(by));
}

run(main, HELP, import.meta.url);
