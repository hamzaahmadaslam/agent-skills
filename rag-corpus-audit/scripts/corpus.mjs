// Read-only helper module shared by the rag-corpus-audit scripts. It loads a corpus (folders, Markdown, plain text,
// HTML and JSONL chunk exports), splits files into chunks the way common chunkers do, and provides the text utilities
// the scripts share: blocks and sentences, word lists, dates, hashing, argument parsing and output helpers.
//
// It reads only the files it is given. It writes nothing and makes no network requests. Node.js 20 or later, no
// dependencies.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TEXT_EXTENSIONS = [".md", ".markdown", ".mdx", ".txt", ".html", ".htm"];
export const JSONL_EXTENSIONS = [".jsonl", ".ndjson"];
const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdx"];
const HTML_EXTENSIONS = [".html", ".htm"];

/** Bad command-line arguments: the scripts exit with code 1. */
export class UsageError extends Error {}
/** An input that cannot be read: the scripts exit with code 2. */
export class InputError extends Error {}

// ---------------------------------------------------------------------------------------------------------------
// Command line

/**
 * Parses --name=value options and positional arguments against a spec such as
 *   { json: { type: "boolean", default: false }, top: { type: "number", default: 20, min: 1 } }.
 * Types: string, number, boolean, list (repeatable). Unknown options are a UsageError.
 */
export function parseArgs(argv, spec) {
  const opts = {};
  for (const [name, def] of Object.entries(spec)) {
    opts[name] = def.type === "list" ? [...(def.default || [])] : def.default;
  }
  const positional = [];
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const value = eq === -1 ? undefined : arg.slice(eq + 1);
    const def = spec[name];
    if (!def) throw new UsageError(`Unknown option --${name}.`);
    if (def.type === "boolean") {
      if (value !== undefined && value !== "true" && value !== "false") throw new UsageError(`--${name} takes no value.`);
      opts[name] = value !== "false";
      continue;
    }
    if (value === undefined || value === "") throw new UsageError(`--${name} needs a value: --${name}=<value>.`);
    if (def.type === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new UsageError(`--${name} must be a number, not "${value}".`);
      if (def.min !== undefined && n < def.min) throw new UsageError(`--${name} must be at least ${def.min}.`);
      if (def.max !== undefined && n > def.max) throw new UsageError(`--${name} must be at most ${def.max}.`);
      opts[name] = n;
    } else if (def.type === "list") {
      opts[name].push(value);
    } else {
      opts[name] = value;
    }
  }
  return { opts, positional };
}

/**
 * Runs a script with the collection's exit codes: 0 done, 1 bad arguments, 2 input not readable. Does nothing when
 * the script is imported by another module instead of being run.
 */
export function run(main, help, moduleUrl) {
  if (moduleUrl && !(process.argv[1] && moduleUrl === pathToFileURL(path.resolve(process.argv[1])).href)) return;
  try {
    main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`${err.message}\n\n${help}`);
      process.exit(1);
    }
    if (err instanceof InputError) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }
}

/** Parses --by: heading, paragraph or tokens=N. */
export function parseBy(value) {
  const text = String(value ?? "heading").trim().toLowerCase();
  if (text === "heading" || text === "paragraph") return { mode: text };
  const match = /^tokens=(\d+)$/.exec(text);
  if (match && Number(match[1]) >= 20 && Number(match[1]) <= 14000) return { mode: "tokens", size: Number(match[1]) };
  throw new UsageError(`--by must be heading, paragraph or tokens=N with N from 20 to 14000, not "${value}".`);
}

export function describeBy(by) {
  return by.mode === "tokens" ? `tokens=${by.size}` : by.mode;
}

/** Parses --as-of (YYYY-MM-DD) or returns today's date at 00:00 UTC. */
export function parseAsOf(value) {
  if (!value) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!date || date.getUTCMonth() !== Number(m[2]) - 1) throw new UsageError(`--as-of must be a date as YYYY-MM-DD, not "${value}".`);
  return date;
}

// ---------------------------------------------------------------------------------------------------------------
// Loading

const posix = (p) => p.split(path.sep).join("/");

/** Every corpus file below a folder (text formats and JSONL), skipping node_modules and dot folders, sorted by path. */
export function listCorpusFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (TEXT_EXTENSIONS.includes(ext) || JSONL_EXTENSIONS.includes(ext)) found.push(full);
      }
    }
  };
  walk(root);
  return found.sort();
}

/** Expands the positional inputs (files and folders) into [{ full, display }]. */
export function resolveInputs(inputs) {
  if (!inputs.length) throw new UsageError("Name at least one folder or file.");
  const files = [];
  for (const input of inputs) {
    let stat;
    try {
      stat = statSync(input);
    } catch {
      throw new InputError(`Cannot read ${input}: there is no such file or folder.`);
    }
    if (stat.isDirectory()) {
      const list = listCorpusFiles(input);
      if (!list.length) throw new InputError(`${input} has no ${[...TEXT_EXTENSIONS, ...JSONL_EXTENSIONS].join(", ")} files.`);
      for (const full of list) files.push({ full, display: posix(path.relative(process.cwd(), full)) || full });
    } else {
      const ext = path.extname(input).toLowerCase();
      if (!TEXT_EXTENSIONS.includes(ext) && !JSONL_EXTENSIONS.includes(ext)) {
        throw new InputError(`${input} is not a supported file (${[...TEXT_EXTENSIONS, ...JSONL_EXTENSIONS].join(", ")}).`);
      }
      files.push({ full: input, display: posix(path.relative(process.cwd(), input)) || input });
    }
  }
  return files;
}

export function readText(full) {
  try {
    return normalizeNewlines(readFileSync(full, "utf8"));
  } catch (err) {
    throw new InputError(`Cannot read ${full}: ${err.message}`);
  }
}

/** Removes a byte order mark and turns CRLF and CR line endings into LF. */
export function normalizeNewlines(text) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

/**
 * Loads documents from files and folders.
 * Returns { documents, warnings, files }. A document is
 *   { key, source, file, format, meta, text, chunks }
 * and a chunk is { id, label, index, line, text, meta, headings, source, file, jsonl, doc }.
 * Markdown, text and HTML files are one document each (split with `by`); a JSONL file holds ready-made chunks, one
 * per line, grouped into documents by their source.
 */
export function loadCorpus(inputs, { by = { mode: "heading" } } = {}) {
  const files = resolveInputs(inputs);
  const documents = [];
  const warnings = [];
  for (const { full, display } of files) {
    const ext = path.extname(full).toLowerCase();
    if (JSONL_EXTENSIONS.includes(ext)) documents.push(...loadJsonl(full, display, warnings));
    else documents.push(loadTextFile(full, display, ext, by));
  }
  return { documents, warnings, files };
}

function loadTextFile(full, display, ext, by) {
  let raw = readText(full);
  let meta = {};
  let format = "text";
  if (MARKDOWN_EXTENSIONS.includes(ext)) {
    format = "markdown";
    const fm = splitFrontMatter(raw);
    meta = fm.data;
    raw = fm.text;
  } else if (HTML_EXTENSIONS.includes(ext)) {
    format = "html";
    const html = htmlToText(raw);
    meta = html.meta;
    raw = html.text;
  }
  const lines = raw.split("\n");
  if (!meta.title) {
    const h1 = firstHeading(lines, 1);
    if (h1) meta = { ...meta, title: h1 };
  }
  const doc = { key: display, source: display, file: display, format, meta, text: raw, chunks: [] };
  doc.chunks = chunkLines(lines, by).map((c, i) => ({
    id: `${display}#${i + 1}`,
    label: `#${i + 1}`,
    index: i + 1,
    line: c.line,
    text: c.text,
    headings: c.headings,
    meta: {},
    source: display,
    file: display,
    jsonl: false,
    doc,
  }));
  return doc;
}

const TEXT_FIELDS = ["text", "page_content", "content", "chunk", "body", "chunk_text"];
const ID_FIELDS = ["id", "chunk_id", "_id", "uuid"];
const SOURCE_FIELDS = ["source", "file_name", "filename", "url", "doc_id", "document_id", "path", "source_url"];

function loadJsonl(full, display, warnings) {
  const groups = new Map();
  const lines = readText(full).split("\n");
  let bad = 0;
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    let row;
    try {
      row = JSON.parse(raw);
    } catch {
      bad += 1;
      return;
    }
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      bad += 1;
      return;
    }
    const meta = flattenMeta(row);
    const textKey = TEXT_FIELDS.find((k) => typeof row[k] === "string");
    if (!textKey) {
      bad += 1;
      return;
    }
    for (const k of TEXT_FIELDS) delete meta[k];
    const source = firstValue(meta, SOURCE_FIELDS) ?? display;
    const id = firstValue(meta, ID_FIELDS);
    if (!groups.has(source)) groups.set(source, []);
    groups.get(source).push({ id, text: normalizeNewlines(row[textKey]), meta, line: i + 1 });
  });
  if (bad) warnings.push(`${display}: skipped ${bad} line(s) that are not JSON objects with a text field (${TEXT_FIELDS.join(", ")}).`);
  const docs = [];
  for (const [source, rows] of groups) {
    const doc = { key: `${display}>${source}`, source, file: display, format: "jsonl", meta: { ...rows[0].meta }, text: "", chunks: [] };
    if (!firstValue(doc.meta, ["title"])) {
      const h1 = firstHeading(rows[0].text.split("\n"), 1);
      if (h1) doc.meta.title = h1;
    }
    doc.chunks = rows.map((r, i) => ({
      id: r.id ?? `${display}:${r.line}`,
      label: r.id ?? `line ${r.line}`,
      index: i + 1,
      line: r.line,
      text: r.text,
      headings: headingsFromMeta(r.meta),
      meta: r.meta,
      source,
      file: display,
      jsonl: true,
      doc,
    }));
    doc.text = rows.map((r) => r.text).join("\n\n");
    docs.push(doc);
  }
  return docs;
}

/** Flattens a JSONL row: top-level fields plus the fields of a "metadata" object, lower-cased, nested keys dotted. */
export function flattenMeta(row) {
  const out = {};
  const put = (key, value) => {
    const k = key.toLowerCase();
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) out[k] = value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
    else if (typeof value === "object") for (const [sub, v] of Object.entries(value)) put(`${k}.${sub}`, v);
    else out[k] = value;
  };
  for (const [key, value] of Object.entries(row)) {
    if (key === "metadata" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [sub, v] of Object.entries(value)) {
        if (!(sub.toLowerCase() in out)) put(sub, v);
      }
    } else {
      put(key, value);
    }
  }
  return out;
}

function firstValue(meta, keys) {
  for (const k of keys) {
    const v = meta[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return undefined;
}

function headingsFromMeta(meta) {
  const v = firstValue(meta, ["heading_path", "headings", "section", "heading", "breadcrumbs"]);
  return v ? v.split(/\s*(?:>|\/|\|)\s*/).filter(Boolean) : [];
}

// ---------------------------------------------------------------------------------------------------------------
// Metadata roles

/** Metadata keys (lower case) that fill each role; JSONL "metadata.x" keys are flattened to "x". */
export const META_ROLES = {
  id: ["id", "chunk_id", "_id", "uuid", "doc_id", "document_id"],
  source: ["source", "url", "source_url", "path", "file_name", "filename", "file", "link", "uri"],
  title: ["title", "doc_title", "document_title", "page_title"],
  section: ["heading_path", "headings", "section", "heading", "breadcrumbs"],
  created: ["created", "created_at", "date_created", "datecreated", "published", "published_at", "date_published", "datepublished", "issued", "date", "article:published_time"],
  modified: ["modified", "updated", "last_modified", "lastmod", "last_updated", "updated_at", "modified_at", "date_modified", "datemodified", "last_reviewed", "reviewed", "article:modified_time", "dcterms.modified", "last-modified"],
  valid: ["valid", "valid_until", "expires", "expiry", "expiration", "review_by", "review_date", "next_review"],
  language: ["language", "lang", "locale", "inlanguage", "content-language"],
  access: ["access", "access_level", "accessrights", "access_rights", "visibility", "audience", "acl", "permissions", "roles", "tenant", "tenant_id", "group", "groups", "classification", "confidentiality"],
  version: ["version", "product_version", "applies_to", "product", "release"],
  replaces: ["replaces", "supersedes", "isreplacedby", "is_replaced_by", "superseded_by", "replaced_by", "canonical", "canonical_url"],
  license: ["license", "rights", "copyright"],
  owner: ["owner", "author", "maintainer", "team"],
};

/** The first metadata key that fills a role, with its value: { key, value } or null. */
export function metaRole(meta, role) {
  for (const key of META_ROLES[role]) {
    const v = meta?.[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") return { key, value: String(v) };
  }
  return null;
}

/** The newest date among a document's modified-type fields, else its created-type fields: { date, key } or null. */
export function documentDate(meta) {
  for (const role of ["modified", "created"]) {
    let best = null;
    for (const key of META_ROLES[role]) {
      const v = meta?.[key];
      if (v === undefined || v === null || String(v).trim() === "") continue;
      const parsed = parseDateValue(String(v));
      if (parsed && (!best || parsed.end > best.date)) best = { date: parsed.end, key };
    }
    if (best) return best;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Markdown front matter and HTML

/** Blanks YAML front matter (line numbers still match the file) and returns its flat key: value pairs. */
export function splitFrontMatter(text) {
  const lines = text.split("\n");
  if (!/^---\s*$/.test(lines[0] ?? "")) return { data: {}, text };
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)\s*$/.test(lines[i])) {
      const data = parseSimpleYaml(lines.slice(1, i));
      for (let j = 0; j <= i; j++) lines[j] = "";
      return { data, text: lines.join("\n") };
    }
  }
  return { data: {}, text };
}

const unquote = (v) => v.replace(/^(["'])(.*)\1$/, "$2");

/** Top-level "key: value", "key: [a, b]" and "key:" followed by "- item" lines. Nested maps are skipped. */
function parseSimpleYaml(lines) {
  const data = {};
  let listKey = null;
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const item = /^\s*-\s+(.*)$/.exec(raw);
    if (item && listKey) {
      data[listKey].push(unquote(item[1].trim()));
      continue;
    }
    const m = /^([A-Za-z0-9_.:-]+)\s*:\s*(.*)$/.exec(raw);
    if (!m) {
      listKey = null;
      continue;
    }
    const key = m[1].toLowerCase();
    const value = m[2].replace(/\s+#.*$/, "").trim();
    if (value === "") {
      data[key] = [];
      listKey = key;
      continue;
    }
    listKey = null;
    if (/^\[.*\]$/.test(value)) {
      data[key] = value.slice(1, -1).split(",").map((v) => unquote(v.trim())).filter(Boolean);
    } else {
      data[key] = unquote(value);
    }
  }
  for (const [k, v] of Object.entries(data)) if (Array.isArray(v)) data[k] = v.join(", ");
  return data;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", hellip: "...", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', copy: "(c)" };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name) => {
    if (name[0] === "#") {
      const cp = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
    }
    return ENTITIES[name.toLowerCase()] ?? all;
  });
}

/** Keeps only the line breaks of a span, so text after it stays on the same line number. */
const keepLines = (s) => s.replace(/[^\n]/g, "");

/**
 * Turns an HTML page into text with the same line numbers: head, scripts, styles and comments become empty lines,
 * tags become spaces, headings keep a Markdown marker ("## ") so heading chunking works. Returns { text, meta } with
 * the title, the lang attribute and meta tags (name or property, lower case).
 */
export function htmlToText(html) {
  const meta = {};
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title) meta.title = decodeEntities(title[1]).replace(/\s+/g, " ").trim();
  const lang = /<html[^>]*\blang\s*=\s*["']?([A-Za-z0-9-]+)/i.exec(html);
  if (lang) meta.lang = lang[1];
  for (const tag of html.match(/<meta\s[^>]*>/gi) || []) {
    const name = /\b(?:name|property|http-equiv|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag);
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (name && content) meta[name[1].toLowerCase()] = decodeEntities(content[1]);
  }
  let text = html
    .replace(/<head[\s>][\s\S]*?<\/head>/i, keepLines)
    .replace(/<(script|style|noscript|template|svg)[\s>][\s\S]*?<\/\1>/gi, keepLines)
    .replace(/<!--[\s\S]*?-->/g, keepLines)
    .replace(/<h([1-6])(?:\s[^>]*)?>/gi, (_, level) => `${"#".repeat(Number(level))} `)
    .replace(/<(?:td|th)(?:\s[^>]*)?>/gi, " | ")
    .replace(/<\/tr\s*>/gi, " |")
    .replace(/<[^>]+>/g, (tag) => (tag.includes("\n") ? keepLines(tag) : " "));
  text = decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n");
  return { text, meta };
}

// ---------------------------------------------------------------------------------------------------------------
// Chunking

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;

/** Returns the open fence after `line` (null outside a code block), following CommonMark's fence rules. */
export function nextFence(line, open) {
  if (!open) {
    const m = FENCE_OPEN.exec(line);
    return m ? m[1] : null;
  }
  const m = FENCE_CLOSE.exec(line);
  return m && m[1][0] === open[0] && m[1].length >= open.length ? null : open;
}

/** An ATX heading: { level, text } or null. */
export function parseHeading(line) {
  const m = HEADING.exec(line);
  if (!m) return null;
  const text = (m[2] ?? "").replace(/[ \t]+#+$/, "").replace(/^#+$/, "").trim();
  return { level: m[1].length, text };
}

function firstHeading(lines, level) {
  let fence = null;
  for (const line of lines) {
    if (!fence) {
      const h = parseHeading(line);
      if (h && h.level === level && h.text) return h.text;
    }
    fence = nextFence(line, fence);
  }
  return null;
}

/** Splits lines into chunks: [{ line (1-based), text, headings (the heading path at the chunk's start) }]. */
export function chunkLines(lines, by) {
  if (by.mode === "tokens") return chunkByTokens(lines, by.size);
  const chunks = [];
  const path = [];
  let start = 0;
  let startPath = [];
  let fence = null;
  const push = (end) => {
    let s = start;
    let e = end;
    while (s < e && !lines[s].trim()) s++;
    while (e > s && !lines[e - 1].trim()) e--;
    if (s < e) chunks.push({ line: s + 1, text: lines.slice(s, e).join("\n"), headings: [...startPath] });
  };
  lines.forEach((line, i) => {
    const heading = fence ? null : parseHeading(line);
    if (heading) {
      if (by.mode === "heading") {
        push(i);
        start = i;
      }
      path.length = Math.min(path.length, heading.level - 1);
      while (path.length < heading.level - 1) path.push("");
      path.push(heading.text);
      if (by.mode === "heading") startPath = path.filter(Boolean);
    }
    if (by.mode === "paragraph" && !fence && !line.trim()) {
      push(i);
      start = i + 1;
      startPath = path.filter(Boolean);
    }
    fence = nextFence(line, fence);
  });
  push(lines.length);
  return chunks;
}

function chunkByTokens(lines, size) {
  const maxChars = size * 4;
  const chunks = [];
  const path = [];
  let current = "";
  let startLine = 1;
  let startPath = [];
  let fence = null;
  lines.forEach((line, i) => {
    const heading = fence ? null : parseHeading(line);
    if (heading) {
      path.length = Math.min(path.length, heading.level - 1);
      while (path.length < heading.level - 1) path.push("");
      path.push(heading.text);
    }
    fence = nextFence(line, fence);
    for (const word of line.match(/\S+/g) || []) {
      if (current && current.length + 1 + word.length > maxChars) {
        chunks.push({ line: startLine, text: current, headings: startPath });
        current = "";
      }
      if (!current) {
        startLine = i + 1;
        startPath = path.filter(Boolean);
        current = word;
      } else {
        current += (current.endsWith("\n") ? "" : " ") + word;
      }
    }
    if (current && !current.endsWith("\n")) current += "\n";
  });
  if (current.trim()) chunks.push({ line: startLine, text: current.trimEnd(), headings: startPath });
  return chunks.map((c) => ({ ...c, text: c.text.replace(/[ \t]+\n/g, "\n").trimEnd() }));
}

/** About four characters per token, which fits English prose. Used for sizes only. */
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------------------------------------------
// Blocks and sentences

const TABLE_DELIMITER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
export const isTableDelimiter = (line) => line.includes("|") && TABLE_DELIMITER.test(line);
export const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line) && !isTableDelimiter(line);
const splitCells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/**
 * Splits text into blocks outside code fences, each with the line it starts on:
 * heading, paragraph, list item, table row (with the header row's cells when the table has one) and code.
 */
export function textBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let fence = null;
  let para = null;
  let header = null;
  const flush = () => {
    if (para) blocks.push(para);
    para = null;
  };
  lines.forEach((line, i) => {
    const wasFence = fence;
    fence = nextFence(line, fence);
    if (wasFence || fence) {
      flush();
      header = null;
      if (!wasFence) blocks.push({ kind: "code", line: i + 1, text: "" });
      else if (fence) blocks[blocks.length - 1].text += `${line}\n`;
      return;
    }
    if (!line.trim()) {
      flush();
      header = null;
      return;
    }
    const heading = parseHeading(line);
    if (heading) {
      flush();
      header = null;
      blocks.push({ kind: "heading", line: i + 1, text: heading.text, level: heading.level });
      return;
    }
    if (isTableDelimiter(line)) {
      flush();
      const prev = blocks[blocks.length - 1];
      if (prev && prev.line === i && (prev.kind === "table" || (prev.kind === "paragraph" && prev.text.includes("|")))) {
        header = splitCells(prev.text);
        blocks.pop();
      }
      return;
    }
    if (isTableRow(line)) {
      flush();
      blocks.push({ kind: "table", line: i + 1, text: line.trim(), cells: splitCells(line), header });
      return;
    }
    const item = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      para = { kind: "list", line: i + 1, text: item[1] };
      return;
    }
    const quote = line.replace(/^\s*>\s?/, "");
    if (para) para.text += ` ${quote.trim()}`;
    else para = { kind: "paragraph", line: i + 1, text: quote.trim() };
  });
  flush();
  return blocks;
}

/** A table row as a sentence: "Header: cell; Header: cell" when the header is known, else the cells. */
export function tableRowSentence(block) {
  if (block.header && block.header.length === block.cells.length) {
    return block.cells.map((c, i) => `${block.header[i]}: ${c}`).join("; ");
  }
  return block.cells.join("; ");
}

const ABBREVIATIONS = /\b(?:e\.g|i\.e|etc|vs|approx|mr|mrs|ms|dr|no|inc|ltd|co|corp|fig|ref|st|jr|sr)\.$/i;

/** Splits a paragraph into sentences: [{ text, offset }]. */
export function splitSentences(text) {
  const out = [];
  const re = /[.!?]+["')\]]*(?=\s+["'(\[]?[\p{Lu}\p{N}])/gu;
  let start = 0;
  let m;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const piece = text.slice(start, end);
    if (ABBREVIATIONS.test(piece.trim())) continue;
    if (piece.trim()) out.push({ text: piece.trim(), offset: start + (piece.length - piece.trimStart().length) });
    start = end;
  }
  const rest = text.slice(start);
  if (rest.trim()) out.push({ text: rest.trim(), offset: start + (rest.length - rest.trimStart().length) });
  return out;
}

/** Sentences of a text with their line numbers, table rows as sentences, code skipped: [{ text, line, kind }]. */
export function sentencesWithLines(text, firstLine = 1) {
  const out = [];
  for (const block of textBlocks(text)) {
    if (block.kind === "code" || block.kind === "heading") continue;
    if (block.kind === "table") {
      out.push({ text: tableRowSentence(block), line: block.line + firstLine - 1, kind: "table" });
      continue;
    }
    for (const s of splitSentences(block.text)) out.push({ text: s.text, line: block.line + firstLine - 1, kind: block.kind });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Words

export const STOPWORDS = new Set(
  (
    "a about above after again against all am an and any are aren't as at be because been before being below between both but by " +
    "can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has " +
    "hasn't have haven't having he her here hers herself him himself his how i i'm if in into is isn't it it's its itself just " +
    "let's me more most my myself no nor not of off on once only or other ought our ours ourselves out over own same she should " +
    "shouldn't so some such than that that's the their theirs them themselves then there there's these they this those through " +
    "to too under until up very was wasn't we we're were weren't what what's when where which while who whom why will with won't " +
    "would wouldn't you you're your yours yourself yourselves also get got may might must shall us via per much many able please"
  ).split(" "),
);

/** Lower-case words without accents: letters and digits, with an apostrophe inside a word kept. */
export function words(text) {
  return (
    text
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .replace(/’/g, "'")
      .match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) || []
  );
}

/** Light English plural stemming: "policies" -> "policy", "boxes" -> "box", "files" -> "file". */
export function stem(word) {
  if (word.length <= 3 || /\d/.test(word)) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(?:ss|us|is|ous)$/.test(word)) return word;
  if (/(?:sh|ch|x|z|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** Content terms: words without stop words, stemmed. Numbers are kept unless `numbers` is false. */
export function contentTerms(text, { numbers = true } = {}) {
  const out = [];
  for (const w of words(text)) {
    if (STOPWORDS.has(w)) continue;
    if (/^\d+$/.test(w) && !numbers) continue;
    if (w.length < 2 && !/\d/.test(w)) continue;
    out.push(stem(w.replace(/'s$/, "")));
  }
  return out;
}

/** Share of letters per Unicode script: { Latin: 0.98, Arabic: 0.02, ... } and the letter count. */
const SCRIPTS = ["Latin", "Cyrillic", "Greek", "Arabic", "Hebrew", "Devanagari", "Bengali", "Han", "Hiragana", "Katakana", "Hangul", "Thai"];
const SCRIPT_RES = SCRIPTS.map((name) => [name, new RegExp(`\\p{Script=${name}}`, "u")]);
export function scriptCounts(text) {
  const counts = {};
  let letters = 0;
  for (const ch of text.match(/\p{L}/gu) || []) {
    letters += 1;
    const hit = SCRIPT_RES.find(([, re]) => re.test(ch));
    const name = hit ? hit[0] : "Other";
    counts[name] = (counts[name] || 0) + 1;
  }
  return { counts, letters };
}

// ---------------------------------------------------------------------------------------------------------------
// Normalization and hashing

/** CCNet-style normalization: lower case, each digit to 0, accents and punctuation removed, spaces collapsed. */
export function normalizeLoose(text) {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\p{Nd}/gu, "0")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Case and space normalization only, for exact duplicates. */
export function normalizeExact(text) {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function sha1(text) {
  return createHash("sha1").update(text).digest("hex");
}

/** 32-bit FNV-1a. */
export function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Dates

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const monthIndex = (name) => MONTHS[name.toLowerCase().replace(/\.$/, "").slice(0, name.toLowerCase().startsWith("sept") ? 4 : 3)];
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const lastDay = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const validDay = (y, m, d) => m >= 0 && m <= 11 && d >= 1 && d <= lastDay(y, m);

export const MONTH_PATTERN = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
export const YEAR_PATTERN = "(?:19[5-9]\\d|20\\d\\d)";

/** A period { start, end } (UTC dates) for a year, month, quarter, half or day. */
export function period(year, month = null, day = null) {
  if (month === null) return { start: utc(year, 0, 1), end: utc(year, 11, 31) };
  if (day === null) return { start: utc(year, month, 1), end: utc(year, month, lastDay(year, month)) };
  return { start: utc(year, month, day), end: utc(year, month, day) };
}

/**
 * Parses a metadata date: ISO 8601 (YYYY, YYYY-MM, YYYY-MM-DD, with or without a time), "Month D, YYYY",
 * "D Month YYYY", or Unix seconds or milliseconds. Returns { start, end } or null.
 */
export function parseDateValue(value) {
  const v = String(value).trim();
  let m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(v);
  if (m) {
    const y = Number(m[1]);
    if (y < 1900 || y > 2200) return null;
    if (!m[2]) return period(y);
    const mo = Number(m[2]) - 1;
    if (!m[3]) return mo >= 0 && mo <= 11 ? period(y, mo) : null;
    const d = Number(m[3]);
    return validDay(y, mo, d) ? period(y, mo, d) : null;
  }
  m = new RegExp(`^(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})$`, "i").exec(v);
  if (m) {
    const y = Number(m[3]);
    const mo = monthIndex(m[1]);
    return validDay(y, mo, Number(m[2])) ? period(y, mo, Number(m[2])) : null;
  }
  m = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\.?,?\\s+(\\d{4})$`, "i").exec(v);
  if (m) {
    const y = Number(m[3]);
    const mo = monthIndex(m[2]);
    return validDay(y, mo, Number(m[1])) ? period(y, mo, Number(m[1])) : null;
  }
  m = new RegExp(`^(${MONTH_PATTERN})\\.?,?\\s+(\\d{4})$`, "i").exec(v);
  if (m) return period(Number(m[2]), monthIndex(m[1]));
  if (/^\d{10}$/.test(v)) return period(...ymd(new Date(Number(v) * 1000)));
  if (/^\d{13}$/.test(v)) return period(...ymd(new Date(Number(v))));
  return null;
}

const ymd = (d) => [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];

const TEXT_DATE_RES = [
  ["iso", new RegExp(`\\b(${YEAR_PATTERN})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\\d|3[01]))?\\b`, "gi")],
  ["month-day-year", new RegExp(`\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(${YEAR_PATTERN})\\b`, "gi")],
  ["day-month-year", new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_PATTERN})\\.?,?\\s+(${YEAR_PATTERN})\\b`, "gi")],
  ["month-year", new RegExp(`\\b(${MONTH_PATTERN})\\.?,?\\s+(?:of\\s+)?(${YEAR_PATTERN})\\b`, "gi")],
  ["quarter", new RegExp(`\\b(?:Q([1-4])\\s*(?:of\\s+)?(${YEAR_PATTERN})|(${YEAR_PATTERN})\\s*Q([1-4]))\\b`, "gi")],
  ["half", new RegExp(`\\b(?:H([12])\\s*(${YEAR_PATTERN})|(${YEAR_PATTERN})\\s*H([12]))\\b`, "gi")],
  ["numeric", new RegExp(`\\b(\\d{1,2})[/.](\\d{1,2})[/.](${YEAR_PATTERN})\\b`, "g")],
  [
    "year",
    new RegExp(
      `(?:\\b(?:in|since|until|till|by|from|during|through|before|after|as of|early|late|mid|end of|start of|beginning of|circa|around|spring|summer|autumn|fall|winter|fiscal|fy|copyright)|\\(c\\)|©)\\s*(${YEAR_PATTERN})\\b(?!-\\d)`,
      "gi",
    ),
  ],
];

/**
 * Finds dates in running text: ISO dates, "March 3, 2025", "3 March 2025", "March 2025", "Q3 2025", "H1 2025",
 * numeric dates (ambiguous day and month give the widest period) and years after words such as "in", "since",
 * "until", "as of". Returns [{ text, index, kind, start, end }] without overlaps, in text order.
 */
export function findDates(text) {
  const found = [];
  const taken = [];
  const free = (s, e) => !taken.some(([a, b]) => s < b && e > a);
  for (const [kind, re] of TEXT_DATE_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const s = m.index;
      const e = s + m[0].length;
      if (!free(s, e)) continue;
      let p = null;
      if (kind === "iso") {
        const y = Number(m[1]);
        const mo = Number(m[2]) - 1;
        p = m[3] ? (validDay(y, mo, Number(m[3])) ? period(y, mo, Number(m[3])) : null) : period(y, mo);
      } else if (kind === "month-day-year") {
        const y = Number(m[3]);
        const mo = monthIndex(m[1]);
        p = validDay(y, mo, Number(m[2])) ? period(y, mo, Number(m[2])) : null;
      } else if (kind === "day-month-year") {
        const y = Number(m[3]);
        const mo = monthIndex(m[2]);
        p = validDay(y, mo, Number(m[1])) ? period(y, mo, Number(m[1])) : null;
      } else if (kind === "month-year") {
        p = period(Number(m[2]), monthIndex(m[1]));
      } else if (kind === "quarter") {
        const q = Number(m[1] ?? m[4]) - 1;
        const y = Number(m[2] ?? m[3]);
        p = { start: utc(y, q * 3, 1), end: utc(y, q * 3 + 2, lastDay(y, q * 3 + 2)) };
      } else if (kind === "half") {
        const h = Number(m[1] ?? m[4]);
        const y = Number(m[2] ?? m[3]);
        p = h === 1 ? { start: utc(y, 0, 1), end: utc(y, 5, 30) } : { start: utc(y, 6, 1), end: utc(y, 11, 31) };
      } else if (kind === "numeric") {
        const a = Number(m[1]);
        const b = Number(m[2]);
        const y = Number(m[3]);
        const options = [];
        if (validDay(y, a - 1, b)) options.push(period(y, a - 1, b));
        if (validDay(y, b - 1, a)) options.push(period(y, b - 1, a));
        if (options.length) p = { start: new Date(Math.min(...options.map((o) => o.start))), end: new Date(Math.max(...options.map((o) => o.end))) };
      } else {
        const y = Number(m[1]);
        const yearStart = m[0].lastIndexOf(m[1]);
        p = period(y);
        found.push({ text: m[0].slice(yearStart), index: s + yearStart, kind, ...p });
        taken.push([s, e]);
        continue;
      }
      if (!p) continue;
      found.push({ text: m[0], index: s, kind, ...p });
      taken.push([s, e]);
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

export const DAY_MS = 86_400_000;
export const isoDate = (d) => d.toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((b - a) / DAY_MS);

// ---------------------------------------------------------------------------------------------------------------
// Output

export function truncate(text, n) {
  const s = String(text).replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 3)}...` : s;
}

export function pad(value, width, right = false) {
  const s = value === null || value === undefined ? "-" : String(value);
  return right ? s.padStart(width) : s.padEnd(width);
}

export const fmt = (n) => Number(n).toLocaleString("en-US");
export const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : "-");

/** Nearest-rank percentile of numbers (p from 0 to 100). */
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** Where a chunk is: "guide.md:12 #3" for files, "guide.md [id] (chunks.jsonl:4)" for JSONL chunks. */
export function where(chunk) {
  return chunk.jsonl ? `${chunk.source} [${chunk.label}] (${chunk.file}:${chunk.line})` : `${chunk.source}:${chunk.line} ${chunk.label}`;
}

/** Where a line of a document is. */
export function whereLine(doc, line, chunk) {
  if (chunk && chunk.jsonl) return where(chunk);
  return `${doc.source}:${line}`;
}

export function printWarnings(warnings) {
  for (const w of warnings) console.error(`warning: ${w}`);
}
