#!/usr/bin/env node
// Read-only helper. Scans a corpus before it is indexed for text that should not reach a retriever:
//   - secrets: private key blocks (RFC 7468 labels), JWTs (RFC 7519), passwords in URLs (RFC 3986 userinfo), AWS
//     access key IDs, GitHub tokens, bearer tokens, and assignments such as password = "..." or api_key: ...;
//   - personal data by format: email addresses, phone numbers, payment card numbers (Luhn check), IP and MAC
//     addresses, plus your own patterns (--pattern) for national ID or account formats;
//   - hidden text: HTML comments, elements hidden with CSS, white text, zero-width characters, bidirectional
//     controls and Unicode tag characters (their hidden ASCII text is decoded and shown);
//   - instruction-like text aimed at a model ("ignore previous instructions", "if you are an AI assistant").
//
// It reads raw files (HTML as markup, JSONL line by line with every string field) and prints a report. It writes
// nothing and makes no network requests. It never prints a secret or personal value: findings show the file, line,
// column and the line with every value replaced by [TYPE]. Reserved example domains and documentation addresses
// (RFC 2606, RFC 5737, RFC 3849) are counted as placeholders and not listed unless you ask.
//
// A format scan does not find names, street addresses, health details or confidential business text in prose:
// read a sample of documents for those.
//
// Usage:
//   node scripts/sensitive-scan.mjs docs/
//   node scripts/sensitive-scan.mjs docs/ chunks.jsonl --pattern="national id=\b\d{5}-\d{7}-\d\b" --json
//
// Options:
//   --pattern=<name>=<regex>  An extra personal-data pattern (JavaScript syntax, case-sensitive). Repeatable.
//   --include-placeholders    Also list values at reserved example domains and documentation addresses.
//   --no-context              Leave the redacted line out of the report.
//   --top=<n>                 How many findings to list per category (default 50).
//   --json                    Print JSON.
//
// Exit codes: 0 done, 1 bad arguments, 2 input not readable.

import { isIPv6 } from "node:net";
import path from "node:path";
import { fmt, JSONL_EXTENSIONS, pad, parseArgs, printWarnings, readText, resolveInputs, run, truncate, UsageError } from "./corpus.mjs";

const HELP = `Usage: node sensitive-scan.mjs <folder|file ...> [--pattern=<name>=<regex> ...] [--include-placeholders]
                                [--no-context] [--top=50] [--json]`;

const SPEC = {
  pattern: { type: "list", default: [] },
  "include-placeholders": { type: "boolean", default: false },
  "no-context": { type: "boolean", default: false },
  top: { type: "number", default: 50, min: 1 },
  json: { type: "boolean", default: false },
};

export const CATEGORIES = {
  secret: "secrets",
  personal: "personal data",
  hidden: "hidden text",
  instruction: "instruction-like text",
};

// ---------------------------------------------------------------------------------------------------------------
// Value checks

/** Shannon entropy in bits per character. */
export function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Luhn check digit validation (the mod 10 scheme of US patent 2,950,048). */
export function luhn(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const PLACEHOLDER_VALUE =
  /^(?:\*+|x+|X+|\.{2,}|-+|<[^>]*>|\[[^\]]*\]|\{\{?[^}]*\}?\}|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|%[A-Za-z_]+%|(?:your|my|the|some)[_-]?\w*|example\w*|sample\w*|placeholder\w*|redacted|changeme|password|passwd|secret|token|none|null|nil|undefined|true|false|string|required|optional|todo|tbd|n\/a)$/i;
const CODE_REFERENCE = /^(?:process\.env|os\.environ|env\.|getenv|config\.|settings\.|secrets\.|vault:|\$\()|\(/i;

/** RFC 2606 names: example.com, example.net, example.org and the .example, .test, .invalid, .localhost TLDs. */
export function isReservedDomain(domain) {
  const d = domain.toLowerCase().replace(/\.$/, "");
  if (/(?:^|\.)example\.(?:com|net|org)$/.test(d)) return true;
  return /\.(?:example|test|invalid|localhost)$/.test(d) || d === "localhost";
}

const ROLE_LOCAL = /^(?:info|support|sales|admin|administrator|contact|help|billing|privacy|security|abuse|postmaster|hostmaster|webmaster|hello|team|office|hr|jobs|careers|press|media|marketing|noreply|no-reply|donotreply|do-not-reply|notifications?|git|root|service|accounts?|legal|compliance|feedback)$/i;

function ipv4Kind(ip) {
  const [a, b, c] = ip.split(".").map(Number);
  if ((a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return "placeholder";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "internal";
  if (a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || ip === "255.255.255.255") return "skip";
  return "public";
}

function ipv6Kind(ip) {
  const lower = ip.toLowerCase();
  if (/^2001:0?db8:/.test(lower)) return "placeholder";
  if (lower === "::1" || lower === "::" || /^fe[89ab][0-9a-f]:/.test(lower)) return "skip";
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return "internal";
  return "public";
}

const before = (line, index, n) => line.slice(Math.max(0, index - n), index);

/** The span of a capture group inside a match, so only the value is redacted and the name stays readable. */
function valueSpan(m, group) {
  const offset = m[0].lastIndexOf(m[group]);
  return [m.index + offset, m.index + offset + m[group].length];
}

// ---------------------------------------------------------------------------------------------------------------
// Detectors. Order matters: earlier detectors claim their span of the line first.

const DETECTORS = [
  { category: "secret", type: "private key", tag: "PRIVATE KEY", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g, check: () => ({ confidence: "high" }) },
  { category: "secret", type: "JWT", tag: "JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, check: () => ({ confidence: "high" }) },
  {
    category: "secret",
    type: "password in URL",
    tag: "PASSWORD",
    span: (m) => valueSpan(m, 1),
    re: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/?#]+:([^\s@/?#]+)@[^\s/?#]+/gi,
    check: (m) => (PLACEHOLDER_VALUE.test(decodeURIComponentSafe(m[1])) ? { placeholder: true } : { confidence: "high" }),
  },
  { category: "secret", type: "AWS access key ID", tag: "AWS KEY ID", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, check: () => ({ confidence: "high" }) },
  { category: "secret", type: "GitHub token", tag: "GITHUB TOKEN", re: /\b(?:(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_.-]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, check: () => ({ confidence: "high" }) },
  { category: "secret", type: "bearer token", tag: "TOKEN", re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g, check: () => ({ confidence: "high" }) },
  {
    category: "secret",
    type: "secret assignment",
    tag: "SECRET",
    span: (m) => valueSpan(m, 1),
    re: /(?<![A-Za-z0-9_])(?:[A-Za-z0-9]+[_.-])*(?:password|passwd|pwd|pass|passcode|passphrase|credentials?|secret|client[_-]?secret|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|private[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|token)(?:[_.-][A-Za-z0-9]+)*["']?\s*(?:=|:|=>)\s*["'`]?([^\s"'`,;<>]{6,})/gi,
    check: (m) => {
      const value = m[1];
      if (PLACEHOLDER_VALUE.test(value) || CODE_REFERENCE.test(value)) return null;
      const h = entropy(value);
      if (h >= 3.5 && value.length >= 12) return { confidence: "high" };
      if (h >= 2.5) return { confidence: "medium" };
      return { confidence: "low" };
    },
  },
  {
    category: "personal",
    type: "email address",
    tag: "EMAIL",
    re: /(?<![\w.%+-])[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g,
    check: (m) => {
      if (isReservedDomain(m[1])) return { placeholder: true };
      const local = m[0].slice(0, m[0].indexOf("@"));
      return ROLE_LOCAL.test(local) ? { confidence: "low", note: "role address" } : { confidence: "medium" };
    },
  },
  {
    category: "personal",
    type: "payment card number",
    tag: "CARD NUMBER",
    re: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g,
    check: (m, line) => {
      const digits = m[0].replace(/\D/g, "");
      if (/^(\d)\1+$/.test(digits) || !luhn(digits)) return null;
      const context = /\b(?:card|visa|mastercard|amex|american express|discover|credit|debit|cc|pan|payment)\b/i.test(before(line, m.index, 40));
      return { confidence: context ? "high" : "medium" };
    },
  },
  {
    category: "personal",
    type: "phone number",
    tag: "PHONE",
    re: /(?<![\w+.])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,5}(?:[\s.-]?\d{2,8}){1,4}(?![\w.]?\d)/g,
    check: (m, line) => {
      const text = m[0];
      const digits = text.replace(/\D/g, "");
      if (digits.length < 8 || digits.length > 15) return null;
      if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$|^\d{1,2}[-./]\d{1,2}[-./]\d{4}$/.test(text)) return null; // a date
      if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(text)) return null; // an IPv4 address
      if (/\b(?:v|version|release|build|ver)\.?\s*$/i.test(before(line, m.index, 12))) return null;
      const keyword = /\b(?:phone|tel|telephone|mobile|cell|call|fax|whatsapp|sms|contact|number|hotline)\b/i.test(before(line, m.index, 40));
      if (!text.startsWith("+") && !text.includes("(") && !keyword) return null;
      return { confidence: keyword || text.startsWith("+") ? "medium" : "low" };
    },
  },
  {
    category: "personal",
    type: "IP address",
    tag: "IP",
    re: /(?<!\d\.|\d)(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?!\.?\d)/g,
    check: (m, line) => {
      if (/\b(?:v|version|release|build|ver)\.?\s*$/i.test(before(line, m.index, 12))) return null;
      const kind = ipv4Kind(m[0]);
      if (kind === "skip") return null;
      if (kind === "placeholder") return { placeholder: true };
      return kind === "internal" ? { confidence: "low", note: "internal network address" } : { confidence: "medium" };
    },
  },
  {
    category: "personal",
    type: "IP address",
    tag: "IP",
    re: /(?<![\w:])(?:[0-9A-Fa-f]{1,4}:){1,7}(?::|[0-9A-Fa-f]{1,4})(?:[0-9A-Fa-f:]*)(?![\w:])/g,
    check: (m) => {
      if (!isIPv6(m[0])) return null;
      const kind = ipv6Kind(m[0]);
      if (kind === "skip") return null;
      if (kind === "placeholder") return { placeholder: true };
      return kind === "internal" ? { confidence: "low", note: "internal network address" } : { confidence: "medium" };
    },
  },
  { category: "personal", type: "MAC address", tag: "MAC", re: /(?<![\w:-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![\w:-])/g, check: () => ({ confidence: "low" }) },
  {
    category: "hidden",
    type: "element hidden with CSS",
    re: /<[a-z][^>]*\bstyle\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:\.0+)?(?:px|pt|em|rem|%)?(?=\s*(?:;|["']))|opacity\s*:\s*0(?:\.0+)?(?=\s*(?:;|["'])))[^"']*["'][^>]*>|<[a-z][^>]*\shidden(?:\s|=|>)[^>]*>?/gi,
    check: () => ({ confidence: "medium" }),
  },
  {
    category: "hidden",
    type: "white text",
    re: /<[a-z][^>]*\bstyle\s*=\s*["'][^"']*(?<![\w-])color\s*:\s*(?:#fff(?:fff)?\b|white\b|rgba?\(\s*255\s*,\s*255\s*,\s*255)[^"']*["'][^>]*>/gi,
    check: () => ({ confidence: "low", note: "check the background color" }),
  },
];

const INSTRUCTIONS = [
  { re: /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}?\b(?:previous|prior|above|earlier|preceding|all|any|your|these)\b[^.\n]{0,20}?\b(?:instructions?|prompts?|rules|directions|guidelines|context)\b/gi, confidence: "high" },
  { re: /\bif you are an? (?:ai|assistant|ai assistant|language model|llm|chatbot|bot|model|agent)\b/gi, confidence: "high" },
  { re: /\b(?:note|message|instructions?) (?:to|for) (?:the |any |all )?(?:ai|ai assistants?|assistants?|language models?|llms?|chatbots?|bots?|models?|agents?)\b/gi, confidence: "high" },
  { re: /\b(?:you are now|from now on,? you|pretend (?:to be|you are))\b/gi, confidence: "medium" },
  { re: /\b(?:system prompt|developer (?:message|instructions)|jailbreak)\b/gi, confidence: "medium" },
  { re: /\bdo not (?:tell|reveal|mention|disclose|inform)\b[^.\n]{0,40}\b(?:user|users|customer|customers|anyone|people)\b/gi, confidence: "medium" },
  { re: /\b(?:respond|reply|answer) only with\b/gi, confidence: "medium" },
];

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const TAG_RUN = /[\u{E0000}-\u{E007F}]+/gu;
const ZERO_WIDTH = /[\u200B\u2060\uFEFF]|(?<=[A-Za-z0-9 ])[\u200C\u200D](?=[A-Za-z0-9 ])/g;
const BIDI = /[\u202A-\u202E\u2066-\u2069]/g;

/** Scans one line of text. Returns findings with column numbers (1-based) and the spans they cover. */
export function scanLine(line, extra = []) {
  const findings = [];
  const taken = [];
  const free = (s, e) => !taken.some(([a, b]) => s < b && e > a);
  const detectors = [...DETECTORS, ...extra];
  // matchAll iterates over a private copy of each regular expression, so the nested scan in redactText() cannot
  // reset the position of an outer loop.
  for (const d of detectors) {
    for (const m of line.matchAll(d.re)) {
      if (m[0].length === 0) continue;
      const s = m.index;
      const e = s + m[0].length;
      if (!free(s, e)) continue;
      const verdict = d.check ? d.check(m, line) : { confidence: "medium" };
      if (!verdict) continue;
      taken.push([s, e]);
      const [rs, re] = d.span ? d.span(m) : [s, e];
      findings.push({ category: d.category, type: d.type, tag: d.tag, column: rs + 1, start: rs, end: re, ...verdict });
    }
  }
  // One instruction finding per line: the first pattern that matches, with every matched phrase in the note.
  const phrases = [];
  let firstInstruction = null;
  for (const ins of INSTRUCTIONS) {
    for (const m of line.matchAll(ins.re)) {
      phrases.push(`"${truncate(m[0], 50)}"`);
      if (!firstInstruction || m.index < firstInstruction.start) {
        firstInstruction = { start: m.index, end: m.index + m[0].length, confidence: firstInstruction?.confidence === "high" ? "high" : ins.confidence };
      }
    }
  }
  if (firstInstruction) {
    findings.push({ category: "instruction", type: "instruction-like text", column: firstInstruction.start + 1, ...firstInstruction, note: phrases.join(", ") });
  }
  for (const m of line.matchAll(TAG_RUN)) {
    const precededByFlag = line.codePointAt(Math.max(0, m.index - 2)) === 0x1f3f4 && m[0].endsWith("\u{E007F}");
    if (precededByFlag) continue; // an emoji flag tag sequence (UTS #51)
    const decoded = [...m[0]].map((ch) => {
      const cp = ch.codePointAt(0) - 0xe0000;
      return cp >= 0x20 && cp <= 0x7e ? String.fromCharCode(cp) : "";
    });
    findings.push({ category: "hidden", type: "Unicode tag characters", column: m.index + 1, start: m.index, end: m.index + m[0].length, confidence: "high", note: `hidden text "${truncate(redactText(decoded.join("")), 80)}"` });
  }
  const zw = [...line.matchAll(ZERO_WIDTH)];
  if (zw.length) findings.push({ category: "hidden", type: "zero-width character", column: zw[0].index + 1, start: zw[0].index, end: zw[0].index + 1, confidence: "medium", note: `${zw.length} on this line` });
  const bidi = [...line.matchAll(BIDI)];
  if (bidi.length) findings.push({ category: "hidden", type: "bidirectional control", column: bidi[0].index + 1, start: bidi[0].index, end: bidi[0].index + 1, confidence: "high", note: `${bidi.length} on this line` });
  return findings;
}

/** Replaces invisible characters with visible markers: [TAGS], [ZW], [BIDI]. */
const showInvisible = (s) =>
  s
    .replace(/[\u{E0000}-\u{E007F}]+/gu, "[TAGS]")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "[ZW]")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "[BIDI]");

/**
 * The line with every secret and personal value replaced by its [TAG] and invisible characters shown as markers,
 * clipped to about 130 characters around the finding without cutting a marker in half.
 */
export function redact(line, findings, focus) {
  const spans = findings.filter((f) => f.tag).sort((a, b) => a.start - b.start);
  let out = "";
  let pos = 0;
  let focusAt = null;
  const mark = (target) => {
    if (focusAt === null && focus && focus.start <= target) focusAt = out.length + showInvisible(line.slice(pos, Math.max(pos, focus.start))).length;
  };
  for (const f of spans) {
    if (f.start < pos) continue;
    mark(f.start);
    out += showInvisible(line.slice(pos, f.start));
    out += `[${f.tag}]`;
    pos = f.end;
  }
  mark(line.length);
  out += showInvisible(line.slice(pos));
  const width = 130;
  if (out.length <= width) return out.trim();
  let from = Math.max(0, Math.min((focusAt ?? 0) - 50, out.length - width));
  let to = from + width;
  const openBefore = out.lastIndexOf("[", from);
  if (openBefore !== -1 && out.indexOf("]", openBefore) >= from) from = openBefore;
  const openInside = out.lastIndexOf("[", to);
  if (openInside !== -1 && openInside >= from && out.indexOf("]", openInside) >= to) to = out.indexOf("]", openInside) + 1;
  return `${from > 0 ? "..." : ""}${out.slice(from, to).trim()}${to < out.length ? "..." : ""}`;
}

/** A text with its secret and personal values replaced by tags, for notes such as comment contents. */
export function redactText(text) {
  return redact(text, scanLine(text), null);
}

/** HTML comments anywhere in a text (they can span lines). */
function htmlComments(text) {
  const out = [];
  const re = /<!--([\s\S]*?)-->/g;
  for (let m; (m = re.exec(text)); ) {
    const line = text.slice(0, m.index).split("\n").length;
    const column = m.index - text.lastIndexOf("\n", m.index - 1);
    out.push({ line, column, content: m[1].replace(/\s+/g, " ").trim() });
  }
  return out;
}

function parsePatterns(list) {
  return list.map((spec) => {
    const eq = spec.indexOf("=");
    if (eq < 1) throw new UsageError(`--pattern must be <name>=<regex>, not "${spec}".`);
    const name = spec.slice(0, eq).trim();
    let re;
    try {
      re = new RegExp(spec.slice(eq + 1), "g");
    } catch (err) {
      throw new UsageError(`--pattern "${name}" is not a valid regular expression: ${err.message}`);
    }
    return { category: "personal", type: name, re, check: () => ({ confidence: "medium", note: "your pattern" }) };
  });
}

/** Scans every file. Returns { files, lines, findings, placeholders }. */
export function scanFiles(inputs, opts) {
  const extra = parsePatterns(opts.pattern);
  const files = resolveInputs(inputs);
  const findings = [];
  let placeholders = 0;
  let lineCount = 0;
  const warnings = [];
  const record = (base, lineText, lineFindings) => {
    for (const f of lineFindings) {
      if (f.placeholder && !opts["include-placeholders"]) {
        placeholders += 1;
        continue;
      }
      findings.push({
        ...base,
        category: f.category,
        type: f.type,
        confidence: f.placeholder ? "placeholder" : f.confidence,
        column: f.column,
        note: f.note,
        context: opts["no-context"] ? undefined : redact(lineText, lineFindings, f),
      });
    }
  };
  for (const { full, display } of files) {
    const text = readText(full);
    const isJsonl = JSONL_EXTENSIONS.includes(path.extname(full).toLowerCase());
    if (isJsonl) {
      let bad = 0;
      text.split("\n").forEach((raw, i) => {
        if (!raw.trim()) return;
        lineCount += 1;
        let row;
        try {
          row = JSON.parse(raw);
        } catch {
          bad += 1;
          // Still scan the raw line: a broken export can hold secrets too.
          record({ file: display, line: i + 1 }, raw, scanLine(raw, extra));
          return;
        }
        const id = row && typeof row === "object" ? (row.id ?? row.chunk_id ?? row._id) : undefined;
        for (const [field, value] of stringFields(row)) {
          const sublines = value.split("\n");
          sublines.forEach((sub, k) => record({ file: display, line: i + 1, id, field, subline: sublines.length > 1 ? k + 1 : undefined }, sub, scanLine(sub, extra)));
          for (const c of htmlComments(value)) {
            findings.push({ file: display, line: i + 1, id, field, category: "hidden", type: "HTML comment", confidence: "medium", column: c.column, note: `"${truncate(redactText(c.content), 80)}"` });
          }
        }
      });
      if (bad) warnings.push(`${display}: ${bad} line(s) are not valid JSON; they were scanned as raw text.`);
      continue;
    }
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      lineCount += 1;
      record({ file: display, line: i + 1 }, line, scanLine(line, extra));
    });
    for (const c of htmlComments(text)) {
      findings.push({ file: display, line: c.line, category: "hidden", type: "HTML comment", confidence: "medium", column: c.column, note: `"${truncate(redactText(c.content), 80)}"` });
    }
  }
  const rank = { high: 0, medium: 1, low: 2, placeholder: 3 };
  const order = Object.keys(CATEGORIES);
  findings.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || rank[a.confidence] - rank[b.confidence] || a.file.localeCompare(b.file) || a.line - b.line);
  return { files: files.length, lines: lineCount, findings, placeholders, warnings };
}

/** Every string value in a JSON value, with its dotted field name. */
function stringFields(value, prefix = "") {
  const out = [];
  if (typeof value === "string") out.push([prefix || "(value)", value]);
  else if (Array.isArray(value)) value.forEach((v, i) => out.push(...stringFields(v, `${prefix}[${i}]`)));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) out.push(...stringFields(v, prefix ? `${prefix}.${k}` : k));
  return out;
}

const ADVICE = {
  secret: "treat every one as exposed: rotate it, then remove it from the corpus, the index and their backups",
  personal: "remove, mask or restrict it; the index keeps a copy in its text and in its vectors",
  hidden: "remove it at extraction; a retriever indexes text a reader never sees",
  instruction: "remove it, or quote it as data if the document is about such text",
};

function printText(r, opts) {
  console.log(`Sensitive data scan (read-only): ${fmt(r.files)} files, ${fmt(r.lines)} lines`);
  console.log("Values are never printed: each finding shows where it is, and the line with values replaced by tags such as [EMAIL].\n");
  for (const [key, label] of Object.entries(CATEGORIES)) {
    const n = r.findings.filter((f) => f.category === key).length;
    console.log(`  ${pad(label, 24)} ${pad(n, 5, true)}   ${n ? ADVICE[key] : ""}`);
  }
  if (r.placeholders) console.log(`  ${pad("placeholders", 24)} ${pad(r.placeholders, 5, true)}   reserved example domains and documentation addresses, not listed (--include-placeholders)`);
  for (const [key, label] of Object.entries(CATEGORIES)) {
    const list = r.findings.filter((f) => f.category === key);
    if (!list.length) continue;
    console.log(`\n== ${label} (${list.length}) ==`);
    for (const f of list.slice(0, opts.top)) {
      const where =
        f.field !== undefined
          ? `${f.file}:${f.line}${f.id !== undefined ? ` [${f.id}]` : ""} (field ${f.field}${f.subline ? `, line ${f.subline}` : ""}, column ${f.column})`
          : `${f.file}:${f.line}:${f.column}`;
      console.log(`  ${pad(f.confidence, 11)} ${pad(f.type, 26)} ${where}${f.note ? `  ${f.note}` : ""}`);
      if (f.context) console.log(`      ${f.context}`);
    }
    if (list.length > opts.top) console.log(`  ... ${list.length - opts.top} more (--top or --json)`);
  }
  if (!r.findings.length) console.log("\nNothing found by format. Names, addresses and health or business details in prose need a reading pass.");
}

function main(argv) {
  const { opts, positional } = parseArgs(argv, SPEC);
  if (opts.help) {
    console.log(HELP);
    return;
  }
  const result = scanFiles(positional, opts);
  printWarnings(result.warnings);
  if (opts.json) {
    const counts = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, result.findings.filter((f) => f.category === k).length]));
    console.log(JSON.stringify({ files: result.files, lines: result.lines, counts, placeholders_not_listed: opts["include-placeholders"] ? 0 : result.placeholders, findings: result.findings }, null, 2));
  } else printText(result, opts);
}

run(main, HELP, import.meta.url);
