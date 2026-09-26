#!/usr/bin/env node
// Read-only helper for the agent-tool-call-audit skill. Turns a saved log of the tool calls an AI agent made into a
// table: server and tool, the tool's MCP annotations (as declared, or the specification's defaults when a hint is
// missing), the arguments, the result, and flags for a person to check. A flag is a prompt to look, not a finding;
// the files in references/ say how to confirm or dismiss each one.
//
// It reads only the files you name and prints a report. It writes no files, makes no network requests, never
// resolves or opens the URLs and hosts it prints, and masks values that look like secrets (first four characters,
// length and a SHA-256 fingerprint) and personal data. Node.js 20 or later, no dependencies.
//
// Input it reads:
//   - MCP JSON-RPC messages, one per line (the stdio framing), bare or inside wrapper objects such as
//     {"ts": ..., "server": ..., "msg": {...}}, after a text prefix ("2026-09-20T09:14:02Z [server] --> {...}"),
//     as SSE "data:" lines, as one JSON array, or as JSON-RPC batches;
//   - OpenTelemetry OTLP JSON traces with GenAI "execute_tool" spans or MCP "tools/call" spans.
//   MCP revisions 2024-11-05 to 2026-07-28: initialize or server/discover, tools/list, tools/call, resources/read,
//   prompts/get, multi round-trip retries (input_required), and task results (tasks/result in 2025-11-25, tasks/get
//   in the 2026-07-28 tasks extension).
//
// Usage:
//   node scripts/tool-call-table.mjs session.jsonl --task=task.txt
//   node scripts/tool-call-table.mjs client.txt server.jsonl --allow-host=api.example.com --details
//   node scripts/tool-call-table.mjs trace.json --tools=tools-list.json --json
//
// Options:
//   --task=<file>        the task the agent was given; values found in it are not reported as coming from output
//   --tools=<file>       a saved tools/list result, used for calls whose tool definition is not in the log
//   --allow-host=<host>  a host the task allows (repeatable); other hosts in arguments are flagged
//   --details            print the detail block of every call, not only of flagged calls
//   --json               print JSON instead of text
//
// Exit codes: 0 done (flags do not change it), 1 bad arguments, 2 input not readable or no calls found.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------------------------------------------
// Detectors

// [label, pattern, capture group that holds the secret value (0 means the whole match)]
export const SECRET_PATTERNS = [
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 0],
  ["JSON Web Token", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, 0],
  ["bearer token", /\bBearer\s+([A-Za-z0-9._~+/-]{16,}=*)/gi, 1],
  ["password in URL", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"']+:([^\s/@"']+)@/gi, 1],
  [
    "well-known token prefix",
    /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}\b|\bglpat-[A-Za-z0-9_-]{20,}\b/g,
    0,
  ],
  [
    "secret assignment",
    /\b([A-Za-z0-9_.-]*(?:token|secret|passw(?:or)?d|passphrase|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*["']?)([^\s"'&,;]{6,})/gi,
    3,
  ],
];

// Argument names that hold secrets, checked after camelCase is turned into snake_case.
const SECRET_NAME =
  /^(?:.*[_-])?(?:pass(?:word|wd|phrase)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|authorization|bearer|cookie|session[_-]?(?:id|key|token)|credentials?|pin|cvv|cvc|card[_-]?number|iban|ssn)(?:[_-].*)?$/i;

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
const PHONE = /(?<![\w+])\+\d[\d ().-]{7,18}\d\b/g;
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;
const URL_RE = /\b(?:https?|wss?|ftp):\/\/[^\s"'<>`\\)\]}]+/gi;
const PATH_RE = /(?:~|\/(?:home|Users|root|etc|var|opt|srv|tmp|mnt|usr|private))\/[^\s"'<>`|;&]*|\b[A-Za-z]:\\[^\s"'<>`|;&]+/g;
const SSH_HOST = /\b(?:ssh|scp|rsync|sftp)\s+(?:-\S+\s+)*(?:[\w.-]+@)?([A-Za-z0-9][\w-]*(?:\.[\w-]+)+)/g;

// A tool name that starts with one of these reads; its other words ("get_message") say what it reads.
const READ_VERBS = new Set(["get", "list", "read", "fetch", "search", "find", "query", "show", "describe", "view", "lookup", "count", "check", "inspect", "browse", "load", "retrieve", "scan", "preview", "diff", "status", "stat", "head", "tail", "cat", "grep", "ls", "download", "resolve", "summarize", "explain"]);

// Words in a tool name that suggest what a call does to the world (matched against whole name tokens).
const EFFECT_WORDS = {
  delete: ["delete", "remove", "rm", "del", "destroy", "drop", "truncate", "purge", "wipe", "erase", "revoke", "kill", "terminate", "uninstall", "unpublish", "reset", "overwrite", "prune", "clear"],
  send: ["send", "post", "email", "mail", "message", "notify", "publish", "share", "invite", "upload", "export", "webhook", "reply", "comment", "sms", "forward", "tweet"],
  write: ["write", "update", "set", "put", "patch", "edit", "modify", "create", "insert", "add", "append", "save", "commit", "push", "merge", "deploy", "release", "apply", "grant", "chmod", "chown", "move", "rename", "sync", "install", "enable", "disable", "schedule", "assign", "close", "approve"],
  exec: ["exec", "execute", "run", "shell", "bash", "sh", "cmd", "command", "terminal", "eval", "script", "spawn", "powershell"],
  money: ["pay", "payment", "transfer", "charge", "refund", "invoice", "purchase", "buy", "withdraw", "checkout"],
};

// [label, pattern, effect] checked against string arguments that hold commands, SQL or scripts: arguments with one
// of the names in COMMAND_KEYS, or every string argument of a tool whose name has a word in COMMAND_TOOL_WORDS.
const COMMAND_KEYS = /^(?:command|commands|cmd|script|shell|sql|query|statement|statements|code|args|argv|line|exec|run|program|expression|input)$/i;
const COMMAND_TOOL_WORDS = new Set(["exec", "execute", "run", "shell", "bash", "sh", "cmd", "command", "terminal", "eval", "script", "powershell", "query", "sql", "psql", "mysql", "database", "db", "ssh"]);
const COMMAND_PATTERNS = [
  ["forced or recursive delete", /\brm\s+-[a-zA-Z]*[rRf]|\bRemove-Item\b[^\n]*-Recurse|\brmdir\s+\/s|\bdel\s+\/[sq]/i, "delete"],
  ["SQL delete, drop or truncate", /\b(?:DROP\s+(?:TABLE|DATABASE|SCHEMA|INDEX|USER)|TRUNCATE\s+(?:TABLE\s+)?\w|DELETE\s+FROM|ALTER\s+TABLE\s+\S+\s+DROP)\b/i, "delete"],
  ["SQL write or grant", /\b(?:INSERT\s+INTO|UPDATE\s+\S+\s+SET|GRANT\s+\w|REVOKE\s+\w|CREATE\s+(?:USER|ROLE))\b/i, "write"],
  ["force push, hard reset or clean", /\bgit\s+(?:push\b[^\n]*(?:--force\b|\s-f\b)|reset\s+--hard|clean\s+-[a-z]*f)/i, "delete"],
  ["download piped to a shell", /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/i, "exec"],
  ["privileged command", /(?:^|[\s'"`;&|])(?:sudo|doas|runas)\s/i, "exec"],
  ["infrastructure delete", /\b(?:terraform\s+destroy|kubectl\s+delete|docker\s+(?:rm|rmi|system\s+prune)|helm\s+uninstall)\b/i, "delete"],
  ["disk or permission change", /\b(?:mkfs(?:\.\w+)?|dd\s+if=|chmod\s+-R|chown\s+-R)\b/i, "delete"],
  ["remote shell", /\b(?:ssh|scp|rsync|sftp)\s/i, "exec"],
  ["upload with curl or PowerShell", /\bcurl\b[^\n]*(?:\s-d\b|\s--data|\s-F\b|\s-T\b|--upload-file)|\bInvoke-WebRequest\b[^\n]*-Method\s+Post/i, "send"],
];

// Words in a result that report a change; a read-only tool should not report one.
const CHANGE_WORDS = /\b(?:deleted|removed|created|updated|inserted|wrote|written|overwrote|overwritten|sent|posted|published|uploaded|dropped|truncated|merged|pushed|deployed|revoked|granted|modified|rows? affected)\b/i;

// Text in tool output, tool definitions or server instructions that reads like instructions to the agent.
const INSTRUCTION_PATTERNS = [
  ["override", /\b(?:ignore|disregard|forget)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|other|your)\b[^.\n]{0,20}\b(?:instructions?|rules|directions|messages|prompts?|guidelines)\b/i],
  [
    "addressed to the agent",
    /\b(?:ai|llm|assistant|agent|model|chatbot|bot|copilot)s?\b[^.\n]{0,60}\b(?:must|should|need to|are required to|have to|please)\b|\b(?:note|message|instructions?|reminder|attention)\s+(?:for|to)\s+(?:the\s+|any\s+|all\s+)?(?:ai|llm|assistant|agent|model|chatbot|bot|copilot)s?\b|\b(?:dear|hey|hello|hi)\s+(?:ai|llm|assistant|agent|model|bot)\b/i,
  ],
  ["secrecy", /\b(?:do not|don't|never)\s+(?:tell|inform|mention|reveal|show|report|disclose)\b|\bwithout (?:telling|asking|informing|notifying)\b/i],
  ["tool directive", /\b(?:call|use|invoke|run|execute)\s+(?:the\s+)?[`'"]?[A-Za-z][\w.-]*[`'"]?\s+(?:tool|function|command)\b/i],
  ["new instructions", /\b(?:new|updated|important|urgent|system)\s+(?:instructions?|directive|task)\s*:/i],
  ["send data out", /\b(?:send|post|upload|forward|exfiltrate|append|include|attach)\b[^.\n]{0,60}\b(?:contents?|credentials?|tokens?|keys?|secrets?|passwords?|files?|env)\b[^.\n]{0,80}\b(?:to|into|in)\b/i],
  ["hidden comment", /<!--[\s\S]{20,}?-->/],
  ["invisible characters", /[\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2064}\u{FEFF}]|[\u{E0000}-\u{E007F}]/u],
];

const SERVER_TO_CLIENT = new Set(["sampling/createMessage", "elicitation/create", "roots/list"]);
const LEVEL_WORDS = new Set(["info", "debug", "warn", "warning", "error", "trace", "notice", "fatal", "stderr", "stdout", "log", "client", "server"]);
const TS_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/;
const MSG_KEYS = ["message", "msg", "payload", "data", "body", "json", "rpc", "jsonrpc", "frame", "request", "response"];
const TS_KEYS = ["ts", "timestamp", "time", "@timestamp", "date", "datetime", "receivedAt", "sentAt"];
const SERVER_KEYS = ["server", "serverName", "server_name", "mcpServer", "mcp_server", "serverId", "server_id"];
const SESSION_KEYS = ["session", "sessionId", "session_id", "conversationId", "conversation_id", "connectionId", "connection_id"];
const LIST_KEYS = ["messages", "entries", "events", "records", "items", "log", "logs"];

// Weights for the "Review first" list. They order the calls; they are not severities.
const WEIGHT = {
  "secret-flow": 5, "secret-in-arguments": 4, "secret-in-input-response": 3, "hint-mismatch": 3, "internal-address": 3,
  "form-asks-secret": 3, "elicitation-url-carries-data": 2, "instructions-in-result": 3, "instructions-in-definition": 2, "definition-changed": 2,
  "data-in-url": 2, "encoded-hostname": 2, "host-not-allowed": 2, "repeat-non-idempotent": 2,
  "personal-data-in-arguments": 2, "sampling-with-context": 2, "secret-in-result": 2, "from-output": 1, "effect": 1,
  "personal-data-in-input-response": 1, "personal-data-in-result": 1, "no-response": 1, "no-definition": 1,
  "retry-args-changed": 1, "list-changed": 1, "arguments-not-recorded": 0, "repeat": 0,
};

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

// Every value detected as a secret anywhere in the log. buildReport masks each of them wherever it appears, so a
// secret copied into a field that does not look secret (for example "billing: <value>") is still masked.
const KNOWN_SECRETS = new Set();
const remember = (value) => {
  if (typeof value === "string" && value.length >= 6) KNOWN_SECRETS.add(value);
};

const fingerprint = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 8);
const maskValue = (value) => `${String(value).slice(0, 4)}...[masked, ${String(value).length} chars, sha256:${fingerprint(value)}]`;
const clip = (text, width) => (text.length > width ? `${text.slice(0, Math.max(0, width - 3))}...` : text);
const snake = (key) => String(key).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const isSecretName = (key) => SECRET_NAME.test(snake(key));

export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function safeDecode(text) {
  if (typeof text !== "string" || !/%[0-9A-Fa-f]{2}/.test(text)) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function* leaves(value, at = "arguments", depth = 0) {
  if (depth > 12) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* leaves(value[i], `${at}[${i}]`, depth + 1);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) yield* leaves(v, `${at}.${k}`, depth + 1);
  } else {
    yield [at, value];
  }
}

const leafKey = (at) => at.replace(/\[\d+\]$/, "").split(".").pop();

const WORD_RE = /[\p{L}\p{N}]+/gu;
const WORD_CHAR = /[\p{L}\p{N}]/u;

// True when needle occurs in text and does not continue a longer word at either end ("rec-12" is not in "rec-123").
function containsWhole(text, needle) {
  if (!needle) return false;
  const startsWord = WORD_CHAR.test(needle[0]);
  const endsWord = WORD_CHAR.test(needle[needle.length - 1]);
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
    const before = i > 0 ? text[i - 1] : "";
    const after = text[i + needle.length] || "";
    if ((!startsWord || !before || !WORD_CHAR.test(before)) && (!endsWord || !after || !WORD_CHAR.test(after))) return true;
  }
  return false;
}

function luhn(digits) {
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

export function secretHits(text) {
  const hits = [];
  if (!text) return hits;
  for (const [label, re, group] of SECRET_PATTERNS) {
    for (const m of String(text).matchAll(re)) {
      const value = group ? m[group] : m[0];
      if (value) {
        hits.push({ label, value, name: group === 3 ? m[1] : "" });
        remember(value);
      }
    }
  }
  return hits;
}

function scrubKnown(value) {
  if (!KNOWN_SECRETS.size) return value;
  const secrets = [...KNOWN_SECRETS].sort((a, b) => b.length - a.length);
  const scrub = (v) => {
    if (typeof v === "string") {
      let out = v;
      for (const s of secrets) if (out.includes(s)) out = out.split(s).join(maskValue(s));
      return out;
    }
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
    return v;
  };
  return scrub(value);
}

// "user@host" after ssh, scp, rsync or sftp, before ":path", or inside a URL's user part is a login target, not an
// email address.
function isLoginTarget(text, index, match) {
  const before = text.slice(Math.max(0, index - 120), index);
  return /\b(?:ssh|scp|rsync|sftp)\s+(?:-\S+\s+)*$/.test(before) || /[a-z][a-z0-9+.-]*:\/\/[^\s/@]*$/i.test(before) || text[index + match.length] === ":";
}

export function piiHits(text) {
  const hits = [];
  if (!text) return hits;
  const s = String(text);
  for (const m of s.matchAll(EMAIL)) if (!isLoginTarget(s, m.index, m[0])) hits.push({ label: "email address", value: m[0] });
  for (const m of s.matchAll(PHONE)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 15) hits.push({ label: "phone number", value: m[0] });
  }
  for (const m of s.matchAll(CARD)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) hits.push({ label: "card-like number", value: m[0] });
  }
  return hits;
}

// Masks secrets and personal data inside free text for display.
export function mask(text) {
  let out = String(text);
  for (const [, re, group] of SECRET_PATTERNS) {
    out = out.replace(re, (...m) => {
      const value = group ? m[group] : m[0];
      return value ? m[0].replace(value, maskValue(value)) : m[0];
    });
  }
  out = out.replace(EMAIL, (e, index, whole) => (isLoginTarget(whole, index, e) ? e : `${e[0]}...@${e.split("@")[1]}`));
  out = out.replace(PHONE, (p) => {
    const digits = p.replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? `${p.slice(0, 3)}...[phone, ${digits.length} digits]` : p;
  });
  out = out.replace(CARD, (c) => {
    const digits = c.replace(/\D/g, "");
    return digits.length >= 13 && luhn(digits) ? `[card-like number ending ${digits.slice(-4)}]` : c;
  });
  return out;
}

// A masked deep copy, for JSON output and argument display.
function maskDeep(value, key = "") {
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v, k)]));
  if (typeof value === "string") {
    if (key && isSecretName(key) && value.length >= 6) return maskValue(value);
    return mask(safeDecode(value));
  }
  return value;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return "";
  }
}

export function internalHost(host) {
  const h = String(host).toLowerCase();
  if (h === "localhost" || /\.(?:localhost|internal|local|lan|corp|home\.arpa)$/.test(h)) return "internal name";
  if (/^127\./.test(h) || h === "::1" || h === "0.0.0.0") return "loopback";
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(h)) return "private range";
  if (h === "169.254.169.254") return "cloud metadata address";
  if (/^169\.254\./.test(h)) return "link-local";
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return "private IPv6";
  if (/^fe[89ab][0-9a-f]:/.test(h)) return "link-local IPv6";
  return "";
}

function tokens(name) {
  return String(name).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function instructionHits(text) {
  if (!text) return [];
  return INSTRUCTION_PATTERNS.filter(([, re]) => re.test(text)).map(([label]) => label);
}

// Annotations as a four-letter code. Uppercase: declared by the server. Lowercase: not declared, so the MCP default
// applies. "-": not meaningful for a read-only tool. "????": no definition seen.
export function hintCode(annotations, known) {
  if (!known) return "????";
  const a = annotations || {};
  const ro = a.readOnlyHint;
  const readOnly = ro === true;
  const p1 = ro === undefined ? "w" : ro ? "R" : "W";
  const p2 = readOnly ? "-" : a.destructiveHint === undefined ? "d" : a.destructiveHint ? "D" : "A";
  const p3 = readOnly ? "-" : a.idempotentHint === undefined ? "n" : a.idempotentHint ? "I" : "N";
  const p4 = a.openWorldHint === undefined ? "o" : a.openWorldHint ? "O" : "C";
  return p1 + p2 + p3 + p4;
}

export function effective(annotations) {
  const a = annotations || {};
  return {
    readOnly: a.readOnlyHint === true,
    destructive: a.readOnlyHint === true ? false : a.destructiveHint !== false,
    idempotent: a.readOnlyHint === true ? true : a.idempotentHint === true,
    openWorld: a.openWorldHint !== false,
  };
}

function nanoToIso(nanos) {
  try {
    return new Date(Number(BigInt(String(nanos)) / 1000000n)).toISOString();
  } catch {
    return "";
  }
}

function normalizeTs(value) {
  if (typeof value === "number") {
    const ms = value > 1e14 ? value / 1e6 : value > 1e11 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return String(value);
}

function maybeJson(value) {
  if (typeof value === "string" && /^\s*[[{]/.test(value)) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading files into records: { msg | otlp, where, file, meta: { ts, server, session } }

export function isRpc(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  if (o.jsonrpc === "2.0") return typeof o.method === "string" || "result" in o || "error" in o;
  if (typeof o.method === "string") return o.method.includes("/") || o.method === "initialize" || o.method === "ping";
  return "id" in o && ("result" in o || "error" in o);
}

function parsePrefix(prefix) {
  const meta = {};
  const ts = prefix.match(TS_RE);
  if (ts) meta.ts = ts[0];
  for (const m of prefix.matchAll(/\[([^\]]{1,64})\]/g)) {
    const token = m[1].trim();
    if (!token || LEVEL_WORDS.has(token.toLowerCase()) || TS_RE.test(token) || /^[\d:.,]+$/.test(token)) continue;
    meta.server = token;
    break;
  }
  return meta;
}

function parseTail(line) {
  let from = 0;
  for (let tries = 0; tries < 12; tries++) {
    const i = line.slice(from).search(/[[{]/);
    if (i < 0) return null;
    const at = from + i;
    try {
      return { value: JSON.parse(line.slice(at)), prefix: line.slice(0, at) };
    } catch {
      from = at + 1;
    }
  }
  return null;
}

function walk(value, ctx, out, depth = 0) {
  if (depth > 5 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    const batch = value.length > 0 && value.every(isRpc);
    value.forEach((item, i) => walk(item, { ...ctx, where: `${ctx.where}[${i}]`, batch: batch || ctx.batch }, out, depth + 1));
    return;
  }
  if (Array.isArray(value.resourceSpans)) {
    out.push({ otlp: value, where: ctx.where, file: ctx.file, meta: ctx.meta });
    return;
  }
  if (isRpc(value)) {
    out.push({ msg: value, where: ctx.where, file: ctx.file, meta: ctx.meta, batch: ctx.batch });
    return;
  }
  const meta = { ...ctx.meta };
  for (const k of TS_KEYS) {
    if (value[k] !== undefined && value[k] !== null && typeof value[k] !== "object") {
      meta.ts = normalizeTs(value[k]);
      break;
    }
  }
  for (const k of SERVER_KEYS) {
    if (typeof value[k] === "string" && value[k]) {
      meta.server = value[k];
      break;
    }
  }
  for (const k of SESSION_KEYS) {
    if (typeof value[k] === "string" || typeof value[k] === "number") {
      meta.session = String(value[k]);
      break;
    }
  }
  for (const k of MSG_KEYS) {
    let inner = value[k];
    if (typeof inner === "string" && /^\s*[[{]/.test(inner)) {
      try {
        inner = JSON.parse(inner);
      } catch {
        continue;
      }
    }
    if (inner && typeof inner === "object" && (isRpc(inner) || Array.isArray(inner.resourceSpans) || (Array.isArray(inner) && inner.some(isRpc)))) {
      walk(inner, { ...ctx, meta }, out, depth + 1);
      return;
    }
  }
  for (const k of LIST_KEYS) {
    if (Array.isArray(value[k])) {
      walk(value[k], { ...ctx, meta, where: `${ctx.where}.${k}` }, out, depth + 1);
      return;
    }
  }
}

export function readRecords(file, text, notes) {
  const out = [];
  const clean = String(text).replace(/^\u{FEFF}/u, "");
  const trimmed = clean.trim();
  const name = path.basename(file);
  if (!trimmed) {
    notes.push(`${name}: the file is empty`);
    return out;
  }
  if (trimmed[0] === "[" || trimmed[0] === "{") {
    try {
      walk(JSON.parse(trimmed), { file, where: name, meta: {} }, out);
      return out;
    } catch {
      // Not one JSON document: read it line by line.
    }
  }
  let skipped = 0;
  const examples = [];
  clean.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const where = `${name}:${i + 1}`;
    let value;
    let prefix = "";
    try {
      value = JSON.parse(line);
    } catch {
      const tail = parseTail(line);
      if (tail) ({ value, prefix } = tail);
    }
    if (value === undefined || value === null || typeof value !== "object") {
      skipped++;
      if (examples.length < 3) examples.push(i + 1);
      return;
    }
    walk(value, { file, where, meta: parsePrefix(prefix) }, out);
  });
  if (skipped) {
    notes.push(`${name}: ${skipped} line(s) are not JSON and were skipped (for example line ${examples.join(", ")}); server stderr and log text land here`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Analysis

export function analyze(records, options = {}) {
  const taskLower = (options.task || "").toLowerCase();
  const allow = new Set((options.allowHosts || []).map((h) => h.toLowerCase()));
  const channels = new Map();
  const calls = [];
  const serverRequests = [];
  const warnings = [];
  const flows = [];
  const tasks = new Map();
  const sources = [];
  const wordIndex = new Map();
  const secretSources = new Map();

  const channelOf = (rec) => {
    const key = `${rec.file}|${rec.meta?.server || ""}|${rec.meta?.session || ""}`;
    let ch = channels.get(key);
    if (!ch) {
      ch = { key, label: rec.meta?.server || "", file: path.basename(rec.file), info: null, version: null, instructions: null, pending: new Map(), tools: new Map(), defs: new Map(), listChanged: false };
      channels.set(key, ch);
    }
    return ch;
  };
  const idKey = (side, id) => `${side}:${typeof id}:${id}`;
  const flag = (call, code, detail) => call.flags.push({ code, detail });

  // Output that the agent saw becomes a source: later arguments are checked against it. Sources are indexed by word,
  // so a value is looked up by its rarest word and then confirmed as a whole-word match in each candidate source.
  function addSource(label, n, text) {
    if (!text) return;
    const lower = String(text).toLowerCase();
    const at = sources.length;
    sources.push({ label, n, lower });
    for (const word of new Set(lower.match(WORD_RE) || [])) {
      const list = wordIndex.get(word);
      if (list) list.push(at);
      else wordIndex.set(word, [at]);
    }
    for (const hit of secretHits(text)) {
      if (!secretSources.has(hit.value)) secretSources.set(hit.value, { label, n, kind: hit.label });
    }
  }
  function findSource(lower) {
    const words = [...new Set(lower.match(WORD_RE) || [])];
    let best = null;
    for (const word of words) {
      const list = wordIndex.get(word);
      if (!list) return null;
      if (!best || list.length < best.length) best = list;
    }
    const pool = best ? best.map((i) => sources[i]) : sources;
    return pool.find((s) => containsWhole(s.lower, lower)) || null;
  }

  function candidates(args) {
    const out = [];
    const seen = new Set();
    const add = (kind, value, at) => {
      const v = String(value).trim();
      if (v.length < 6 || seen.has(v.toLowerCase())) return;
      seen.add(v.toLowerCase());
      out.push({ kind, value: v, at });
    };
    for (const [at, raw] of leaves(args)) {
      if (typeof raw !== "string") continue;
      const text = safeDecode(raw);
      if (text.length <= 200) {
        const kind = /^[a-z]+:\/\//i.test(text) ? "url" : /^[^\s@]+@[^\s@]+$/.test(text) ? "email" : /^(?:~|\/|[A-Za-z]:\\)/.test(text) ? "path" : "value";
        add(kind, text, at);
      }
      for (const u of text.match(URL_RE) || []) {
        add("url", u, at);
        const h = hostOf(u);
        if (h) add("host", h, at);
      }
      for (const m of text.matchAll(SSH_HOST)) add("host", m[1].toLowerCase(), at);
      for (const e of text.match(EMAIL) || []) add("email", e, at);
      for (const f of text.match(PATH_RE) || []) add("path", f.replace(/[.,)']+$/, ""), at);
    }
    return out;
  }

  function checkProvenance(call) {
    const found = [];
    const coveredHosts = new Set();
    for (const c of candidates(call.args)) {
      const lower = c.value.toLowerCase();
      if (taskLower && containsWhole(taskLower, lower)) continue;
      const src = findSource(lower);
      if (!src) continue;
      // A host already covered by a whole URL from the same source adds nothing.
      if (c.kind === "url") coveredHosts.add(`${hostOf(c.value)}|${src.label}`);
      if (c.kind === "host" && coveredHosts.has(`${lower}|${src.label}`)) continue;
      const shown = mask(c.value);
      flows.push({ from: src.label, fromN: src.n, to: call.n, kind: c.kind, value: shown, at: c.at });
      found.push(`${c.kind} ${JSON.stringify(clip(shown, 60))} (${c.at}) first seen in ${src.label}`);
    }
    if (found.length) flag(call, "from-output", `${found.join("; ")}${options.task ? "; not in the task text" : " (no task text given)"}`);
    const argText = safeDecode(JSON.stringify(call.args));
    for (const [secret, src] of secretSources) {
      if (argText.includes(secret) || argText.includes(encodeURIComponent(secret))) {
        flows.push({ from: src.label, fromN: src.n, to: call.n, kind: "secret", value: maskValue(secret), at: "arguments" });
        flag(call, "secret-flow", `${src.kind} ${maskValue(secret)} from ${src.label} is in the arguments`);
      }
    }
  }

  function summarizeInputRequests(requests) {
    const out = [];
    for (const [key, req] of Object.entries(requests || {})) {
      const p = req?.params || {};
      if (req?.method === "elicitation/create") {
        out.push({ key, method: req.method, mode: p.mode || "form", fields: Object.keys(p.requestedSchema?.properties || {}), message: p.message || "", url: p.url || "" });
      } else {
        out.push({ key, method: req?.method || "?", includeContext: p.includeContext || "", messages: Array.isArray(p.messages) ? p.messages.length : 0 });
      }
    }
    return out;
  }

  function addInputResponses(call, responses, where) {
    call.inputResponses = Object.entries(responses || {}).map(([key, r]) => ({ key, action: r?.action || (r?.role ? "sampling result" : "?"), content: r?.content ?? null, where }));
  }

  function newCall(rec, ch, m) {
    const p = m.params || {};
    const kind = m.method === "tools/call" ? "tool" : m.method === "resources/read" ? "resource" : "prompt";
    const name = String(kind === "resource" ? p.uri ?? "?" : p.name ?? "?");
    let args = {};
    if (kind === "tool" || kind === "prompt") args = p.arguments && typeof p.arguments === "object" ? p.arguments : {};
    if (kind === "resource") args = { uri: p.uri };
    const call = {
      n: calls.length + 1, kind, where: rec.where, ts: rec.meta?.ts || "", id: m.id, ch, name, args, argsRecorded: true,
      status: "no response", result: null, resultText: "", error: null, resultWhere: "", flags: [], notes: [],
      def: null, defSource: "", retryOf: null, requestState: null, inputRequests: null, inputResponses: null, task: null, cancelled: "",
    };
    if (rec.batch) call.notes.push("sent in a JSON-RPC batch (allowed only in MCP 2025-03-26)");
    if (kind === "tool") {
      call.def = ch.tools.get(name) || null;
      call.defSource = call.def ? "log" : "";
      if (p.task) call.notes.push("the client asked for task-augmented execution (2025-11-25 tasks)");
      if (p.inputResponses || p.requestState) {
        const original = [...calls].reverse().find((c) => c.ch === ch && c.kind === "tool" && c.name === name && c.status === "input required" && (!p.requestState || !c.requestState || c.requestState === p.requestState));
        if (original) {
          call.retryOf = original.n;
          if (stable(original.args) !== stable(args)) flag(call, "retry-args-changed", `the arguments differ from the first attempt #${original.n}`);
        }
        if (p.inputResponses) addInputResponses(call, p.inputResponses, rec.where);
      }
      if (ch.listChanged) flag(call, "list-changed", `the server announced a changed tool list (${ch.listChangedWhere}) and the client had not listed tools again`);
    }
    calls.push(call);
    checkProvenance(call);
    return call;
  }

  function setFinalResult(call, r, where) {
    call.result = r;
    call.resultText = resultText(r);
    call.status = r && r.isError === true ? "tool error" : "ok";
    call.resultWhere = where;
    addSource(`#${call.n}`, call.n, call.resultText);
  }

  function onCallResult(call, r, err, rec) {
    call.resultWhere = rec.where;
    if (err) {
      call.status = `rpc error ${err.code ?? "?"}`;
      call.error = err;
      call.resultText = `${err.message || ""}${err.data !== undefined ? ` ${JSON.stringify(err.data)}` : ""}`;
      addSource(`#${call.n}`, call.n, call.resultText);
      return;
    }
    if (!r || typeof r !== "object") {
      call.status = "empty result";
      return;
    }
    const serverInfo = r._meta?.["io.modelcontextprotocol/serverInfo"];
    if (serverInfo && !call.ch.info) call.ch.info = serverInfo;
    if (r.resultType === "input_required") {
      call.status = "input required";
      call.requestState = r.requestState ?? null;
      call.inputRequests = summarizeInputRequests(r.inputRequests);
      const text = call.inputRequests.map((q) => `${q.message || ""} ${q.url || ""}`).join("\n");
      call.resultText = text.trim();
      addSource(`#${call.n}`, call.n, call.resultText);
      return;
    }
    const task = r.resultType === "task" ? r : r.task && r.task.taskId ? r.task : null;
    if (task) {
      call.task = { id: task.taskId, status: task.status || "created" };
      call.status = `task ${call.task.status}`;
      tasks.set(`${call.ch.key}|${task.taskId}`, call);
      return;
    }
    setFinalResult(call, r, rec.where);
    if (r.resultType && r.resultType !== "complete") call.notes.push(`unknown resultType "${r.resultType}"`);
  }

  function findTask(ch, taskId) {
    if (taskId === undefined) return null;
    const direct = tasks.get(`${ch.key}|${taskId}`);
    if (direct) return direct;
    const any = [...tasks.entries()].filter(([k]) => k.endsWith(`|${taskId}`));
    return any.length === 1 ? any[0][1] : null;
  }

  function onTaskState(call, state, rec) {
    if (!state || typeof state !== "object") return;
    if (state.status) {
      call.task = { ...(call.task || {}), status: state.status };
      call.status = `task ${state.status}`;
    }
    if (state.status === "completed" && state.result && typeof state.result === "object") {
      setFinalResult(call, state.result, rec.where);
      call.notes.push(`result delivered in a task state at ${rec.where}`);
    }
    if (state.status === "failed" && state.error) {
      call.status = `task failed ${state.error.code ?? ""}`.trim();
      call.error = state.error;
      call.resultText = state.error.message || "";
    }
    if (state.status === "input_required" && state.inputRequests) call.inputRequests = summarizeInputRequests(state.inputRequests);
  }

  function onToolList(ch, entry, r, rec) {
    ch.listChanged = false;
    for (const t of Array.isArray(r.tools) ? r.tools : []) {
      if (!t || typeof t.name !== "string") continue;
      const def = {
        name: t.name, title: t.title || t.annotations?.title || "", description: t.description || "",
        annotations: t.annotations || null, inputSchema: t.inputSchema || null, where: rec.where, ch,
      };
      def.key = stable({ title: t.title, description: t.description, annotations: t.annotations, inputSchema: t.inputSchema });
      def.instructionHits = instructionHits(toolText(t));
      def.headerParams = mirroredParams(t.inputSchema);
      const history = ch.defs.get(t.name) || [];
      const last = history[history.length - 1];
      if (!last || last.key !== def.key) {
        if (last) def.changes = ["title", "description", "annotations", "inputSchema"].filter((f) => stable(last[f] ?? null) !== stable(def[f] ?? null));
        history.push(def);
        ch.defs.set(t.name, history);
        addSource(`the definition of ${t.name} (${rec.where})`, null, toolText(t));
      }
      ch.tools.set(t.name, history[history.length - 1]);
    }
  }

  function setInstructions(ch, text, where) {
    if (!text) return;
    ch.instructions = { text, where, hits: instructionHits(text) };
    addSource(`server instructions (${where})`, null, text);
  }

  function onRequest(rec, ch) {
    const m = rec.msg;
    const side = SERVER_TO_CLIENT.has(m.method) ? "s" : "c";
    const key = idKey(side, m.id);
    if (ch.pending.has(key)) warnings.push(`${rec.where}: request id ${JSON.stringify(m.id)} reused while the request at ${ch.pending.get(key).where} is unanswered`);
    const p = m.params || {};
    const entry = { method: m.method, params: p, where: rec.where };
    ch.pending.set(key, entry);
    const version = p._meta?.["io.modelcontextprotocol/protocolVersion"];
    if (version && !ch.version) ch.version = version;
    if (m.method === "tools/call" || m.method === "resources/read" || m.method === "prompts/get") entry.call = newCall(rec, ch, m);
    if (m.method.startsWith("tasks/")) {
      entry.taskId = p.taskId;
      const call = findTask(ch, p.taskId);
      if (call && m.method === "tasks/cancel") call.notes.push(`task cancel requested at ${rec.where} (cancellation is cooperative)`);
      if (call && m.method === "tasks/update" && p.inputResponses) addInputResponses(call, p.inputResponses, rec.where);
    }
    if (side === "s") {
      entry.serverRequest = { where: rec.where, ch, method: m.method, includeContext: p.includeContext || "", mode: p.mode || "", fields: Object.keys(p.requestedSchema?.properties || {}), message: p.message || "" };
      serverRequests.push(entry.serverRequest);
      if (p.message) addSource(`${m.method} message (${rec.where})`, null, p.message);
      // Before 2026-07-28 a server asked for input with its own request while a tool call was running: attach it to
      // the newest unanswered call on this server so the same checks apply as for input_required results.
      const running = [...calls].reverse().find((c) => c.ch === ch && c.status === "no response");
      if (running) {
        entry.serverRequest.call = running;
        running.inputRequests = [...(running.inputRequests || []), ...summarizeInputRequests({ [`${m.method} at ${rec.where}`]: { method: m.method, params: p } })];
      }
    }
  }

  function onResponse(rec, ch) {
    const m = rec.msg;
    let key = idKey("c", m.id);
    let entry = ch.pending.get(key);
    const serverSide = ch.pending.get(idKey("s", m.id));
    const r = m.result;
    const looksClientAnswer = r && typeof r === "object" && ("action" in r || ("role" in r && "model" in r) || Array.isArray(r.roots));
    if (serverSide && (!entry || looksClientAnswer)) {
      entry = serverSide;
      key = idKey("s", m.id);
    }
    if (!entry) {
      warnings.push(`${rec.where}: response to id ${JSON.stringify(m.id)} has no matching request in this log`);
      return;
    }
    ch.pending.delete(key);
    const err = m.error;
    const serverInfo = r?._meta?.["io.modelcontextprotocol/serverInfo"] || (entry.method === "initialize" ? r?.serverInfo : null);
    if (serverInfo && ch.info && (serverInfo.name !== ch.info.name || serverInfo.version !== ch.info.version)) {
      ch.infoChanges = [...(ch.infoChanges || []), { from: `${ch.info.name} ${ch.info.version || ""}`.trim(), to: `${serverInfo.name} ${serverInfo.version || ""}`.trim(), where: rec.where }];
    }
    if (serverInfo) ch.info = serverInfo;
    switch (entry.method) {
      case "initialize":
        if (r) {
          ch.info = r.serverInfo || ch.info;
          ch.version = r.protocolVersion || ch.version;
          setInstructions(ch, r.instructions, rec.where);
        }
        break;
      case "server/discover":
        if (r) {
          ch.versions = r.supportedVersions || null;
          setInstructions(ch, r.instructions, rec.where);
        }
        break;
      case "tools/list":
        if (r) onToolList(ch, entry, r, rec);
        break;
      case "tools/call":
      case "resources/read":
      case "prompts/get":
        onCallResult(entry.call, r, err, rec);
        break;
      case "tasks/get":
      case "tasks/result": {
        const call = findTask(ch, entry.taskId) || findTask(ch, r?._meta?.["io.modelcontextprotocol/related-task"]?.taskId);
        if (!call) break;
        if (err) {
          call.status = `task rpc error ${err.code ?? "?"}`;
          call.error = err;
        } else if (entry.method === "tasks/result") {
          setFinalResult(call, r, rec.where);
          call.notes.push(`result delivered by tasks/result at ${rec.where}`);
        } else onTaskState(call, r, rec);
        break;
      }
      default:
        if (entry.serverRequest) {
          entry.serverRequest.response = err ? `error ${err.code}` : r?.action || (r?.role ? "sampling result" : "answered");
          const running = entry.serverRequest.call;
          if (running && r) {
            const answers = running.inputResponses || [];
            addInputResponses(running, { [`${entry.method} at ${entry.where}`]: r }, rec.where);
            running.inputResponses = [...answers, ...running.inputResponses];
          }
        }
    }
  }

  function onNotification(rec, ch) {
    const m = rec.msg;
    const p = m.params || {};
    if (m.method === "notifications/cancelled") {
      const entry = ch.pending.get(idKey("c", p.requestId));
      if (entry?.call) entry.call.cancelled = rec.where;
      else if (!entry) {
        const done = calls.find((c) => c.ch === ch && c.id === p.requestId);
        if (done) done.notes.push(`a cancel notification at ${rec.where} arrived after the result`);
      }
    } else if (m.method === "notifications/tools/list_changed") {
      ch.listChanged = true;
      ch.listChangedWhere = rec.where;
    } else if (m.method === "notifications/tasks/status" || m.method === "notifications/tasks") {
      const call = findTask(ch, p.taskId);
      if (call) onTaskState(call, p, rec);
    }
  }

  function onOtlp(rec) {
    const spans = [];
    const byId = new Map();
    for (const rs of rec.otlp.resourceSpans || []) {
      const res = attrs(rs.resource?.attributes);
      for (const ss of rs.scopeSpans || rs.instrumentationLibrarySpans || []) {
        for (const sp of ss.spans || []) {
          const s = { sp, a: attrs(sp.attributes), res };
          spans.push(s);
          byId.set(`${sp.traceId}/${sp.spanId}`, s);
        }
      }
    }
    const toolName = (s) => s.a["gen_ai.tool.name"] || String(s.sp.name || "").replace(/^(?:execute_tool|tools\/call)\s+/, "");
    const isTool = (s) => s.a["gen_ai.operation.name"] === "execute_tool" || s.a["mcp.method.name"] === "tools/call";
    const start = (s) => {
      try {
        return BigInt(String(s.sp.startTimeUnixNano ?? 0));
      } catch {
        return 0n;
      }
    };
    const toolSpans = spans.filter(isTool).sort((x, y) => (start(x) < start(y) ? -1 : start(x) > start(y) ? 1 : 0));
    // An MCP client span inside an execute_tool span for the same tool is one call: merge into the outermost span.
    for (const s of toolSpans) {
      let parent = s.sp.parentSpanId;
      for (let hops = 0; parent && hops < 32; hops++) {
        const up = byId.get(`${s.sp.traceId}/${parent}`);
        if (!up) break;
        if (isTool(up) && toolName(up) === toolName(s)) s.into = up;
        parent = up.sp.parentSpanId;
      }
    }
    const merged = new Map();
    for (const s of toolSpans) if (s.into) merged.set(s.into, [...(merged.get(s.into) || []), s]);
    for (const s of toolSpans) {
      if (s.into) continue;
      const group = [s, ...(merged.get(s) || [])];
      const get = (k) => group.map((g) => g.a[k]).find((v) => v !== undefined && v !== "");
      const server = get("server.address") ? `${get("server.address")}${get("server.port") ? `:${get("server.port")}` : ""}` : `agent ${s.res["service.name"] || "?"}`;
      const ch = channelOf({ file: rec.file, meta: { server } });
      const rawArgs = maybeJson(get("gen_ai.tool.call.arguments"));
      const call = {
        n: calls.length + 1, kind: "tool", where: `${rec.where}#span ${String(s.sp.spanId || "").slice(0, 8)}`, ts: nanoToIso(s.sp.startTimeUnixNano),
        id: get("gen_ai.tool.call.id") ?? get("jsonrpc.request.id") ?? s.sp.spanId, ch, name: toolName(s),
        args: rawArgs && typeof rawArgs === "object" ? rawArgs : rawArgs === undefined ? {} : { value: rawArgs }, argsRecorded: rawArgs !== undefined,
        status: "ok", result: null, resultText: "", error: null, resultWhere: "", flags: [], notes: [], def: null, defSource: "",
        retryOf: null, requestState: null, inputRequests: null, inputResponses: null, task: null, cancelled: "",
      };
      const description = get("gen_ai.tool.description");
      if (description) call.traceDescription = description;
      const errorType = get("error.type");
      if (errorType === "tool_error") call.status = "tool error";
      else if (errorType) call.status = `error ${errorType}`;
      else if (group.some((g) => g.sp.status?.code === 2)) call.status = "error";
      if (get("mcp.protocol.version") && !ch.version) ch.version = get("mcp.protocol.version");
      calls.push(call);
      checkProvenance(call);
      const result = maybeJson(get("gen_ai.tool.call.result"));
      if (result !== undefined) {
        call.result = result;
        call.resultText = typeof result === "string" ? result : JSON.stringify(result);
        addSource(`#${call.n}`, call.n, call.resultText);
      } else call.notes.push("result not recorded (gen_ai.tool.call.result is an opt-in attribute)");
    }
  }

  // Main pass, in log order.
  for (const rec of records) {
    if (rec.otlp) {
      onOtlp(rec);
      continue;
    }
    const ch = channelOf(rec);
    const m = rec.msg;
    if (typeof m.method === "string" && m.id !== undefined && m.id !== null) onRequest(rec, ch);
    else if (typeof m.method === "string") onNotification(rec, ch);
    else if ("result" in m || "error" in m) onResponse(rec, ch);
  }

  // Definitions for calls whose server listed no tools in this log.
  const fileTools = new Map((options.tools || []).map((t) => [t.name, t]));
  for (const call of calls) {
    if (call.kind !== "tool" || call.def) continue;
    const later = call.ch.tools.get(call.name);
    if (later) {
      call.def = later;
      call.defSource = "log";
      call.notes.push(`the tool was listed only after this call (${later.where})`);
      continue;
    }
    const elsewhere = [...channels.values()].map((c) => c.tools.get(call.name)).filter(Boolean);
    if (elsewhere.length === 1) {
      call.def = elsewhere[0];
      call.defSource = "other";
      call.notes.push(`definition taken from another server's list (${elsewhere[0].where}); check that it is the same server`);
    } else if (fileTools.has(call.name)) {
      const t = fileTools.get(call.name);
      call.def = { name: t.name, description: t.description || "", annotations: t.annotations || null, inputSchema: t.inputSchema || null, where: "--tools file", instructionHits: instructionHits(toolText(t)), headerParams: mirroredParams(t.inputSchema) };
      call.defSource = "file";
    } else if (elsewhere.length > 1) call.notes.push("several servers list a tool with this name; the log does not say which one ran");
  }

  // Flags that need the whole log. A repeat is a second call with the same tool and arguments after an earlier one
  // that may have taken effect; a first attempt that ended in input_required, a protocol error or a tool error is
  // not counted, so a normal multi round-trip retry is not a repeat, but a replayed retry is.
  const repeats = new Map();
  for (const call of calls) {
    assess(call, { allow, flag });
    if (call.kind !== "tool") continue;
    const key = `${call.ch.key}|${call.name}|${stable(call.args)}`;
    const earlier = (repeats.get(key) || []).filter((c) => c.status !== "input required" && c.status !== "tool error" && !c.status.startsWith("rpc error"));
    if (earlier.length) {
      const first = earlier[0];
      const eff = effective(call.def?.annotations);
      if (!eff.readOnly && !eff.idempotent) flag(call, "repeat-non-idempotent", `same tool and arguments as #${first.n}, and the tool is ${call.def?.annotations?.idempotentHint === false ? "declared" : "by default"} not idempotent`);
      else {
        flag(call, "repeat", `same tool and arguments as #${first.n}`);
        if (call.def?.annotations?.idempotentHint === true && first.resultText && call.resultText && first.resultText !== call.resultText) {
          flag(call, "hint-mismatch", `declared idempotentHint true, but the result differs from #${first.n} for the same arguments`);
        }
      }
    }
    repeats.set(key, [...(repeats.get(key) || []), call]);
  }
  for (const [, ch] of channels) {
    for (const [, entry] of ch.pending) {
      if (!entry.call && entry.method !== "subscriptions/listen") warnings.push(`${entry.where}: ${entry.method} request has no response in this log`);
    }
  }
  for (const call of calls) {
    call.score = call.flags.reduce((sum, f) => sum + (WEIGHT[f.code] ?? 1), 0);
    const effects = call.effects || [];
    if (effects.some((e) => e.effect === "delete" || e.effect === "money")) call.score += 2;
    if (effects.some((e) => e.effect === "send" || e.effect === "exec")) call.score += 1;
    if (effects.length && call.flags.some((f) => f.code === "from-output")) call.score += 2;
  }
  return { channels: [...channels.values()], calls, flows, serverRequests, warnings };
}

function attrs(list) {
  const out = {};
  for (const a of list || []) out[a.key] = anyValue(a.value);
  return out;
}

function anyValue(v) {
  if (!v || typeof v !== "object") return v;
  if ("stringValue" in v) return v.stringValue;
  if ("boolValue" in v) return v.boolValue;
  if ("intValue" in v) return Number(v.intValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("arrayValue" in v) return (v.arrayValue?.values || []).map(anyValue);
  if ("kvlistValue" in v) return Object.fromEntries((v.kvlistValue?.values || []).map((kv) => [kv.key, anyValue(kv.value)]));
  if ("bytesValue" in v) return `[bytes, ${String(v.bytesValue).length} base64 chars]`;
  return undefined;
}

export function resultText(r) {
  if (!r || typeof r !== "object") return r === undefined || r === null ? "" : String(r);
  const parts = [];
  for (const c of Array.isArray(r.content) ? r.content : []) {
    if (!c || typeof c !== "object") continue;
    if (c.type === "text") parts.push(c.text || "");
    else if (c.type === "resource" && c.resource) parts.push(c.resource.uri || "", c.resource.text || "");
    else if (c.type === "resource_link") parts.push(c.uri || "", c.name || "", c.description || "");
    else if (c.type === "image" || c.type === "audio") parts.push(`[${c.type} ${c.mimeType || ""}, ${String(c.data || "").length} base64 chars, not decoded]`);
  }
  for (const c of Array.isArray(r.contents) ? r.contents : []) parts.push(c?.uri || "", c?.text || "");
  for (const msg of Array.isArray(r.messages) ? r.messages : []) if (msg?.content?.type === "text") parts.push(msg.content.text || "");
  if (r.structuredContent !== undefined) parts.push(JSON.stringify(r.structuredContent));
  return parts.filter(Boolean).join("\n");
}

function toolText(t) {
  const parts = [t.title || "", t.annotations?.title || "", t.description || ""];
  for (const [at, v] of leaves(t.inputSchema || {}, "inputSchema")) if (typeof v === "string" && /\.(?:description|title)$/.test(at)) parts.push(v);
  return parts.filter(Boolean).join("\n");
}

function mirroredParams(schema, at = "", out = []) {
  const props = schema && typeof schema === "object" ? schema.properties : null;
  if (!props || typeof props !== "object") return out;
  for (const [name, prop] of Object.entries(props)) {
    const here = at ? `${at}.${name}` : name;
    if (prop && typeof prop === "object") {
      if (prop["x-mcp-header"]) out.push({ param: here, header: `Mcp-Param-${prop["x-mcp-header"]}`, sensitive: isSecretName(name) });
      mirroredParams(prop, here, out);
    }
  }
  return out;
}

// Per-call flags that need only the call itself and its definition.
function assess(call, { allow, flag }) {
  if (!call.argsRecorded) flag(call, "arguments-not-recorded", "the trace did not record the arguments (gen_ai.tool.call.arguments is an opt-in attribute)");
  if (call.kind === "tool") {
    const def = call.def;
    call.hints = hintCode(def?.annotations, Boolean(def));
    if (!def) flag(call, "no-definition", "no tool definition in the log; the MCP defaults apply (not read-only, destructive, not idempotent, open world)");
    if (def && call.defSource === "log") {
      const first = call.ch.defs.get(call.name)?.[0];
      if (first && first !== def) flag(call, "definition-changed", `the definition in effect (${def.where}) differs from the first one seen (${first.where}) in: ${(def.changes || []).join(", ") || "content"}`);
    }
    if (def?.instructionHits?.length) flag(call, "instructions-in-definition", `the tool's definition has instruction-like text: ${def.instructionHits.join(", ")}`);
    const traceHits = instructionHits(call.traceDescription);
    if (traceHits.length) flag(call, "instructions-in-definition", `the traced tool description has instruction-like text: ${traceHits.join(", ")}`);

    // What the call appears to do, from its name and from arguments that hold commands, SQL or scripts.
    const effects = [];
    const toks = tokens(call.name);
    if (!READ_VERBS.has(toks[0])) {
      for (const [effect, words] of Object.entries(EFFECT_WORDS)) {
        const word = toks.find((t) => words.includes(t));
        if (word) effects.push({ effect, why: `tool name "${word}"` });
      }
    }
    const commandTool = toks.some((t) => COMMAND_TOOL_WORDS.has(t));
    for (const [at, v] of leaves(call.args)) {
      if (typeof v !== "string" || !(commandTool || COMMAND_KEYS.test(leafKey(at)))) continue;
      for (const [label, re, effect] of COMMAND_PATTERNS) if (re.test(v)) effects.push({ effect, why: `${label} in ${at}` });
    }
    call.effects = effects;
    if (effects.length) flag(call, "effect", effects.map((e) => `${e.effect} (${e.why})`).join("; "));

    const ann = def?.annotations || {};
    if (ann.readOnlyHint === true) {
      const changed = call.resultText && call.resultText.match(CHANGE_WORDS);
      if (effects.length) flag(call, "hint-mismatch", `declared readOnlyHint true, but ${effects.map((e) => `${e.why} suggests ${e.effect}`).join("; ")}`);
      if (changed) flag(call, "hint-mismatch", `declared readOnlyHint true, but the result reports a change ("${changed[0]}")`);
    }
    if (ann.readOnlyHint !== true && ann.destructiveHint === false) {
      const del = effects.filter((e) => e.effect === "delete");
      if (del.length) flag(call, "hint-mismatch", `declared destructiveHint false, but ${del.map((e) => e.why).join("; ")} suggests a delete or overwrite`);
    }
    const urls = [];
    for (const [at, v] of leaves(call.args)) if (typeof v === "string") for (const u of safeDecode(v).match(URL_RE) || []) urls.push({ at, u });
    if (ann.openWorldHint === false && urls.length) flag(call, "hint-mismatch", `declared openWorldHint false, but the arguments hold a URL (${urls[0].at})`);
  } else call.hints = "n/a";

  // Hosts and URLs in the arguments.
  const hosts = new Map();
  for (const [at, v] of leaves(call.args)) {
    if (typeof v !== "string") continue;
    const text = safeDecode(v);
    // Query strings are read from the URL as sent (still encoded), so a decoded value keeps its line breaks.
    for (const u of v.match(URL_RE) || []) {
      const h = hostOf(u);
      if (!h) continue;
      hosts.set(h, at);
      try {
        for (const [qk, qv] of new URL(u).searchParams) {
          if (qv.length >= 24 || secretHits(`${qk}=${qv}`).length || piiHits(qv).length) {
            flag(call, "data-in-url", `query parameter "${qk}" in ${at} carries ${qv.length} characters${secretHits(`${qk}=${qv}`).length ? " that look like a secret" : ""}`);
            break;
          }
        }
      } catch {
        // not a parseable URL
      }
    }
    for (const m of text.matchAll(SSH_HOST)) hosts.set(m[1].toLowerCase(), at);
  }
  call.hosts = [...hosts.keys()];
  for (const [h, at] of hosts) {
    const internal = internalHost(h);
    if (internal) flag(call, "internal-address", `${h} (${internal}) in ${at}`);
    if (h.split(".").some((label) => label.length >= 30)) flag(call, "encoded-hostname", `${h} has a label of 30 or more characters (data in a DNS name?) in ${at}`);
    if (allow.size && !allow.has(h) && ![...allow].some((a) => h.endsWith(`.${a}`))) flag(call, "host-not-allowed", `${h} in ${at} is not in --allow-host`);
  }

  // Secrets and personal data.
  const argSecrets = [];
  const argPii = [];
  for (const [at, v] of leaves(call.args)) {
    if (typeof v !== "string") continue;
    const text = safeDecode(v);
    if (isSecretName(leafKey(at)) && v.length >= 6) {
      argSecrets.push(`argument named "${leafKey(at)}" (${at}) ${maskValue(v)}`);
      remember(v);
    }
    for (const hit of secretHits(text)) argSecrets.push(`${hit.label} in ${at} ${maskValue(hit.value)}`);
    for (const hit of piiHits(text)) argPii.push(`${hit.label} in ${at} (${mask(hit.value)})`);
  }
  if (argSecrets.length) flag(call, "secret-in-arguments", [...new Set(argSecrets)].join("; "));
  if (argPii.length) flag(call, "personal-data-in-arguments", [...new Set(argPii)].join("; "));
  const resSecrets = secretHits(call.resultText);
  if (resSecrets.length) flag(call, "secret-in-result", [...new Set(resSecrets.map((h) => `${h.label}${h.name ? ` (${h.name})` : ""} ${maskValue(h.value)}`))].join("; "));
  const resPii = piiHits(call.resultText);
  if (resPii.length) flag(call, "personal-data-in-result", `${resPii.length} value(s): ${[...new Set(resPii.map((h) => h.label))].join(", ")}`);

  // Text in the output that reads like instructions to the agent.
  const hits = instructionHits(call.resultText);
  if (hits.length) flag(call, "instructions-in-result", hits.join(", "));

  // Multi round-trip input: what the server asked for and what went back.
  for (const q of call.inputRequests || []) {
    if (q.method === "elicitation/create" && q.mode !== "url" && q.fields.some((f) => isSecretName(f))) {
      flag(call, "form-asks-secret", `form elicitation "${q.key}" asks for ${q.fields.filter((f) => isSecretName(f)).join(", ")} (MCP: servers must not ask for secrets in form mode)`);
    }
    if (q.method === "elicitation/create" && q.url) {
      const decoded = safeDecode(q.url);
      if (secretHits(decoded).length || piiHits(decoded).length) flag(call, "elicitation-url-carries-data", `URL elicitation "${q.key}" puts a secret or personal data in the URL (MCP: servers must not)`);
    }
    if (q.method === "sampling/createMessage" && (q.includeContext === "thisServer" || q.includeContext === "allServers")) {
      flag(call, "sampling-with-context", `sampling request "${q.key}" asks for includeContext "${q.includeContext}"`);
    }
  }
  for (const r of call.inputResponses || []) {
    if (!r.content || typeof r.content !== "object") continue;
    const secrets = [];
    const pii = [];
    for (const [at, v] of leaves(r.content, `inputResponses.${r.key}`)) {
      if (typeof v !== "string") continue;
      if (isSecretName(leafKey(at)) && v.length >= 6) {
        secrets.push(`${at} ${maskValue(v)}`);
        remember(v);
      }
      for (const hit of secretHits(v)) secrets.push(`${hit.label} in ${at} ${maskValue(hit.value)}`);
      for (const hit of piiHits(v)) pii.push(`${hit.label} in ${at}`);
    }
    if (secrets.length) flag(call, "secret-in-input-response", secrets.join("; "));
    if (pii.length) flag(call, "personal-data-in-input-response", pii.join("; "));
  }
  if (call.status === "no response") {
    flag(call, "no-response", `no result in this log${call.cancelled ? ` (a cancel was sent at ${call.cancelled}, which does not prove the work stopped)` : ""}: the effect is unknown`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Output

function serverName(ch) {
  return ch.label || ch.info?.name || ch.file || "?";
}

function formatArgs(args, width = 160) {
  const parts = [];
  for (const [k, v] of Object.entries(args || {})) {
    if (typeof v === "string") {
      const decoded = safeDecode(v);
      const shown = isSecretName(k) && v.length >= 6 ? maskValue(v) : mask(decoded);
      parts.push(`${k}=${JSON.stringify(clip(shown, width))}${decoded !== v ? " (URL-decoded)" : ""}`);
    } else parts.push(`${k}=${clip(JSON.stringify(maskDeep(v)), width)}`);
  }
  return parts.join(" ") || "(none)";
}

function statusText(status, chars, retryOf, cancelled) {
  let s = status;
  if (chars && (s === "ok" || s === "tool error")) s += `, ${chars} chars`;
  if (retryOf) s += `, retry of #${retryOf}`;
  if (cancelled) s += ", cancel sent";
  return s;
}

export function buildReport(inputs, analysis, options) {
  const { calls, channels, flows, serverRequests, warnings } = analysis;
  const dates = new Set(calls.map((c) => String(c.ts).slice(0, 10)).filter(Boolean));
  const times = calls.map((c) => c.ts).filter(Boolean);
  return scrubKnown({
    input: inputs.files,
    notes: inputs.notes,
    messages: inputs.messageCount,
    task: options.task ? `${options.taskFile} (${options.task.length} chars)` : "",
    allowHosts: options.allowHosts || [],
    timeRange: times.length ? [times[0], times[times.length - 1]] : [],
    sameDay: dates.size <= 1,
    servers: channels.filter((ch) => ch.tools.size || calls.some((c) => c.ch === ch) || ch.info).map((ch) => ({
      server: serverName(ch),
      software: ch.info ? `${ch.info.name || "?"} ${ch.info.version || ""}`.trim() : "",
      protocol: ch.version || (ch.versions ? ch.versions.join(", ") : ""),
      softwareChanges: ch.infoChanges || [],
      tools: ch.tools.size,
      instructions: ch.instructions ? { where: ch.instructions.where, chars: ch.instructions.text.length, instructionLike: ch.instructions.hits } : null,
    })),
    tools: channels.flatMap((ch) => [...ch.defs.entries()].map(([name, history]) => {
      const last = history[history.length - 1];
      return {
        server: serverName(ch), tool: name, hints: hintCode(last.annotations, true), annotations: last.annotations,
        listedAt: history[0].where, versions: history.length,
        changes: history.slice(1).map((d) => ({ where: d.where, fields: d.changes || [] })),
        instructionLike: last.instructionHits, headerParams: last.headerParams,
      };
    })),
    calls: calls.map((c) => ({
      n: c.n, kind: c.kind, where: c.where, time: c.ts, id: c.id ?? null, server: serverName(c.ch), tool: c.name,
      hints: c.hints, effective: c.kind === "tool" ? effective(c.def?.annotations) : null, definition: c.defSource || (c.kind === "tool" ? "none" : "n/a"),
      arguments: maskDeep(c.args), argumentsText: formatArgs(c.args), argumentsRecorded: c.argsRecorded, status: c.status, resultChars: c.resultText.length, resultAt: c.resultWhere,
      retryOf: c.retryOf, task: c.task, cancelled: c.cancelled || null, hosts: c.hosts || [],
      inputRequests: c.inputRequests ? c.inputRequests.map((q) => ({ ...q, message: q.message ? mask(q.message) : q.message, url: q.url ? mask(q.url) : q.url })) : null,
      inputResponses: c.inputResponses ? c.inputResponses.map((r) => ({ key: r.key, action: r.action, fields: r.content && typeof r.content === "object" ? Object.keys(r.content) : [] })) : null,
      flags: c.flags, notes: c.notes, score: c.score,
    })),
    flows,
    hosts: [...calls.reduce((m, c) => {
      for (const h of c.hosts || []) m.set(h, [...(m.get(h) || []), c.n]);
      return m;
    }, new Map())].map(([host, n]) => ({ host, calls: n, internal: internalHost(host) || null })),
    serverRequests: serverRequests.map((r) => ({ where: r.where, server: serverName(r.ch), method: r.method, includeContext: r.includeContext || null, mode: r.mode || null, fields: r.fields, response: r.response || null })),
    reviewFirst: calls.filter((c) => c.score >= 3).sort((a, b) => b.score - a.score || a.n - b.n).slice(0, 8).map((c) => ({ n: c.n, server: serverName(c.ch), tool: c.name, flags: [...new Set(c.flags.map((f) => f.code))] })),
    warnings,
  });
}

function printText(report, showAll) {
  const lines = [];
  const L = (text = "") => lines.push(text);
  const time = (ts) => (!ts ? "-" : report.sameDay && /T\d{2}:\d{2}:\d{2}/.test(ts) ? ts.slice(11, 19) : ts);
  const oneFile = report.input.length === 1;
  const base = oneFile ? path.basename(report.input[0]) : "";
  const where = (w) => (oneFile ? w.replace(/^[^:#[\]]+(?=[:#[])/, "").replace(/^:/, "line ") : w);
  const tidy = (text) => (oneFile ? String(text).split(`${base}:`).join("line ") : String(text));
  L("Tool call table (read-only; values that look like secrets or personal data are masked)");
  L(`Input: ${report.input.join(", ")} (${report.messages} messages or spans)`);
  for (const n of report.notes) L(`Note: ${n}`);
  L(`Task text: ${report.task || "not given (use --task=<file>; without it, values from tool output cannot be told apart from values in the task)"}`);
  if (report.allowHosts.length) L(`Allowed hosts: ${report.allowHosts.join(", ")}`);
  if (report.timeRange.length) L(`Time: ${report.timeRange[0]} to ${report.timeRange[1]}`);
  L();
  L("Servers");
  for (const s of report.servers) {
    const extra = s.instructions ? `; instructions ${s.instructions.chars} chars at ${where(s.instructions.where)}${s.instructions.instructionLike.length ? ` (instruction-like: ${s.instructions.instructionLike.join(", ")})` : ""}` : "";
    L(`  ${s.server}: ${s.software || "software not reported"}; protocol ${s.protocol || "not seen"}; ${s.tools} tool(s) listed${extra}`);
    for (const c of s.softwareChanges) L(`    reported software changed from ${c.from} to ${c.to} at ${tidy(where(c.where))}`);
  }
  L();
  if (report.tools.length) {
    L("Tool definitions (as the servers listed them)");
    const w1 = report.tools.reduce((max, t) => Math.max(max, t.server.length), 6);
    const w2 = report.tools.reduce((max, t) => Math.max(max, t.tool.length), 4);
    L(`  ${"server".padEnd(w1)}  ${"tool".padEnd(w2)}  hints  notes`);
    for (const t of report.tools) {
      const notes = [];
      if (!t.annotations) notes.push("no annotations: defaults apply");
      for (const c of t.changes) notes.push(`changed at ${where(c.where)} (${c.fields.join(", ")})`);
      if (t.instructionLike?.length) notes.push(`instruction-like text: ${t.instructionLike.join(", ")}`);
      for (const h of t.headerParams || []) notes.push(`${h.param} mirrored to ${h.header}${h.sensitive ? " (looks sensitive)" : ""}`);
      L(`  ${t.server.padEnd(w1)}  ${t.tool.padEnd(w2)}  ${t.hints}   ${notes.join("; ") || "-"}`);
    }
    L();
  }
  L("Calls");
  if (!report.calls.length) L("  (none)");
  else {
    const rows = report.calls.map((c) => ({
      n: `#${c.n}`, w: where(c.where), t: time(c.time), st: clip(`${c.server}/${c.kind === "tool" ? c.tool : `${c.kind} ${c.tool}`}`, 40), h: c.hints, r: clip(statusText(c.status, c.resultChars, c.retryOf, c.cancelled), 34),
      f: [...new Set(c.flags.map((f) => f.code))].join(", ") || "-",
    }));
    const w = (k, min) => rows.reduce((max, r) => Math.max(max, r[k].length), min);
    const [wn, ww, wt, ws, wr] = [w("n", 3), w("w", 5), w("t", 4), w("st", 11), w("r", 6)];
    L(`  ${"#".padEnd(wn)}  ${"where".padEnd(ww)}  ${"time".padEnd(wt)}  ${"server/tool".padEnd(ws)}  hints  ${"result".padEnd(wr)}  flags`);
    for (const r of rows) L(`  ${r.n.padEnd(wn)}  ${r.w.padEnd(ww)}  ${r.t.padEnd(wt)}  ${r.st.padEnd(ws)}  ${r.h.padEnd(5)}  ${r.r.padEnd(wr)}  ${r.f}`);
  }
  L();
  const detailed = report.calls.filter((c) => showAll || c.flags.some((f) => f.code !== "repeat"));
  if (detailed.length) {
    L(showAll ? "Details (every call)" : "Details (calls with flags; --details shows every call)");
    for (const c of detailed) {
      L(`  #${c.n} ${c.server}/${c.tool}  ${where(c.where)}  id ${JSON.stringify(c.id)}  ${c.time || ""}`.trimEnd());
      L(`     args     ${c.argumentsRecorded ? c.argumentsText : "(not recorded)"}`);
      L(`     result   ${statusText(c.status, c.resultChars, c.retryOf, c.cancelled)}${c.resultAt ? ` at ${where(c.resultAt)}` : ""}`);
      if (c.kind === "tool") L(`     hints    ${c.hints} (definition: ${c.definition})`);
      for (const q of c.inputRequests || []) L(`     input    server asked "${tidy(q.key)}": ${q.method}${q.mode ? ` ${q.mode}` : ""}${q.fields?.length ? ` fields ${q.fields.join(", ")}` : ""}${q.message ? ` "${clip(q.message, 70)}"` : ""}`);
      for (const r of c.inputResponses || []) L(`     answer   "${tidy(r.key)}": ${r.action}${r.fields.length ? ` with ${r.fields.join(", ")}` : ""}`);
      for (const f of c.flags) L(`     flag     ${f.code}: ${tidy(f.detail)}`);
      for (const n of c.notes) L(`     note     ${tidy(n)}`);
    }
    L();
  }
  if (report.flows.length) {
    L("Data flows (values in a call's arguments that first appeared in earlier output)");
    for (const f of report.flows) L(`  ${tidy(f.from)} -> #${f.to}  ${f.kind} ${JSON.stringify(clip(f.value, 90))}${f.at && f.at !== "arguments" ? ` (${f.at})` : ""}`);
    L();
  }
  if (report.hosts.length) {
    L("Hosts named in arguments (not contacted by this script)");
    for (const h of report.hosts) L(`  ${h.host}${h.internal ? ` (${h.internal})` : ""}: ${h.calls.map((n) => `#${n}`).join(", ")}`);
    L();
  }
  if (report.serverRequests.length) {
    L("Requests from servers to the client (2025-11-25 and earlier)");
    for (const r of report.serverRequests) L(`  ${where(r.where)} ${r.server}: ${r.method}${r.mode ? ` ${r.mode}` : ""}${r.fields.length ? ` fields ${r.fields.join(", ")}` : ""}${r.includeContext ? ` includeContext ${r.includeContext}` : ""}; answer ${r.response || "not in log"}`);
    L();
  }
  if (report.reviewFirst.length) {
    L("Review first (ordered by the flags, not a severity rating)");
    for (const c of report.reviewFirst) L(`  #${c.n} ${c.server}/${c.tool}: ${c.flags.join(", ")}`);
    L();
  }
  if (report.warnings.length) {
    L("Warnings");
    for (const w of report.warnings) L(`  ${tidy(where(w))}`);
    L();
  }
  L("Legend");
  L("  hints: 1st R read-only / W not read-only; 2nd D destructive / A additive; 3rd I idempotent / N not idempotent;");
  L("         4th O open world / C closed world. Uppercase: declared by the server. Lowercase: not declared, so the");
  L("         MCP default applies. \"-\": not meaningful for a read-only tool. \"????\": no definition seen.");
  L("  Flags are prompts for a person to check, not findings. Annotations are hints from the server, not guarantees.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Command line

function otlpStart(doc) {
  let min = Infinity;
  for (const rs of doc.resourceSpans || []) {
    for (const ss of rs.scopeSpans || rs.instrumentationLibrarySpans || []) {
      for (const sp of ss.spans || []) {
        if (sp.startTimeUnixNano === undefined) continue;
        const iso = nanoToIso(sp.startTimeUnixNano);
        const t = iso ? Date.parse(iso) : NaN;
        if (Number.isFinite(t) && t < min) min = t;
      }
    }
  }
  return min;
}

function loadTools(file) {
  const value = JSON.parse(readFileSync(file, "utf8"));
  const list = Array.isArray(value) ? value : Array.isArray(value.tools) ? value.tools : Array.isArray(value.result?.tools) ? value.result.tools : null;
  if (!list) throw new Error(`${file}: no tools array (expected a tools/list result)`);
  return list.filter((t) => t && typeof t.name === "string");
}

function main() {
  const args = process.argv.slice(2);
  const files = [];
  const options = { allowHosts: [] };
  let json = false;
  let details = false;
  const fail = (message, code) => {
    console.error(`tool-call-table: ${message}`);
    process.exit(code);
  };
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/tool-call-table.mjs <log> [<log> ...] [--task=<file>] [--tools=<file>] [--allow-host=<host>] [--details] [--json]");
      return;
    }
    if (arg === "--json") json = true;
    else if (arg === "--details") details = true;
    else if (arg.startsWith("--task=")) options.taskFile = arg.slice(7);
    else if (arg.startsWith("--tools=")) options.toolsFile = arg.slice(8);
    else if (arg.startsWith("--allow-host=")) {
      const host = arg.slice(13).trim().toLowerCase();
      if (!host) fail("--allow-host needs a host name", 1);
      options.allowHosts.push(host);
    }
    else if (arg.startsWith("--")) fail(`unknown option ${arg}`, 1);
    else files.push(arg);
  }
  if (!files.length) fail("name at least one log file (JSON Lines, JSON, a text log with JSON messages, or an OTLP JSON trace)", 1);
  try {
    if (options.taskFile) options.task = readFileSync(options.taskFile, "utf8");
    if (options.toolsFile) options.tools = loadTools(options.toolsFile);
  } catch (error) {
    fail(error.message, 1);
  }
  const notes = [];
  let records = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      fail(`cannot read ${file}: ${error.message}`, 2);
    }
    records = records.concat(readRecords(file, text, notes));
  }
  if (files.length > 1) {
    const when = (r) => (r.otlp ? otlpStart(r.otlp) : Date.parse(r.meta?.ts ?? ""));
    if (records.every((r) => Number.isFinite(when(r)))) {
      records = records.map((r, i) => ({ r, i, t: when(r) })).sort((a, b) => a.t - b.t || a.i - b.i).map((x) => x.r);
    } else notes.push("several files without a timestamp on every message: they are read one after the other, so data flows between files may be missed");
  }
  const analysis = analyze(records, options);
  const messageCount = records.reduce((n, r) => n + (r.otlp ? r.otlp.resourceSpans.reduce((m, rs) => m + (rs.scopeSpans || rs.instrumentationLibrarySpans || []).reduce((k, ss) => k + (ss.spans || []).length, 0), 0) : 1), 0);
  if (!analysis.calls.length) {
    const report = buildReport({ files, notes, messageCount }, analysis, options);
    if (json) console.log(JSON.stringify(report, null, 2));
    else console.log(printText(report, details));
    fail(`no tools/call, resources/read or prompts/get messages and no tool spans found in ${files.join(", ")}`, 2);
  }
  const report = buildReport({ files, notes, messageCount }, analysis, options);
  console.log(json ? JSON.stringify(report, null, 2) : printText(report, details));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
