#!/usr/bin/env node
// Read-only helper for the wp-full-site-scan skill. Scans the JavaScript, HTML and SVG files under a folder for
// redirects and injected scripts: assignments of an external address to location, decoders fed to eval or new
// Function, long fromCharCode and hex chains, obfuscator names, redirects gated on the referrer, a mobile user agent
// or a cookie (cloaking), and payment skimmers (card number or CVV fields sent out with fetch, XMLHttpRequest, an
// image beacon or a WebSocket, and checkout form listeners in a file that also decodes strings).
//
// Expect innocent hits: bundlers build script tags, form plugins redirect after submit, payment gateways read card
// fields by design. Open each hit and read what the code does.
//
// It reads every .js, .mjs, .html, .htm and .svg file, prints counts per pattern and each hit with the line number of
// the first match and a 120-character excerpt, and writes nothing. It makes no network requests. Files are read as
// bytes (latin1), so binary content is safe. node_modules and .git folders are skipped; symbolic links are not
// followed; files over 64 MB are listed and skipped.
//
// Usage:
//   node scan-js.mjs <folder>
//   node scan-js.mjs site/wp-content
//
// Exit codes: 0 no hits, 1 hits found, 2 bad arguments or unreadable folder. Node.js 20 or later, no dependencies.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const USAGE = "Usage: node scan-js.mjs <folder>";
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const MAX_BYTES = 64 * 1024 * 1024;
const FILE = /\.(m?js|html?|svg)$/i;

const CARD_FIELD = String.raw`(?:card.?number|cc.?num(?:ber)?|cardnum|\bcvv2?\b|\bcvc\b|security.?code|card.?cvc|cc.?cvv|cc.?exp)`;
const SEND = String.raw`(?:\bfetch\s*\(|XMLHttpRequest|new\s+Image\s*\(|sendBeacon\s*\(|new\s+WebSocket\s*\()`;

// [name, pattern, description, optional second pattern that must also appear somewhere in the file]
const PATTERNS = [
  ["loc_assign_ext", /\b(?:window|document|top|self|parent)\.location(?:\.href)?\s*=\s*['"]https?:\/\//i, "location set to an external address"],
  ["loc_replace_ext", /\blocation\.(?:replace|assign)\s*\(\s*['"]https?:\/\//i, "location.replace or assign to an external address"],
  ["eval_atob", /\beval\s*\(\s*(?:atob|unescape|decodeURIComponent)\s*\(/i, "eval() of a decoded string"],
  ["newfunc_decode", /\bnew\s+Function\s*\(\s*(?:atob|unescape|decodeURIComponent)/i, "new Function() of a decoded string"],
  ["docwrite", /\bdocument\.write\s*\(\s*(?:unescape|atob)/i, "document.write of a decoded string"],
  ["fromcharcode", /fromCharCode\s*\(\s*(?:\d{2,3}\s*,\s*){24,}/i, "fromCharCode with 24 or more numbers"],
  ["referrer_gate", /document\.referrer[\s\S]{0,250}(?:google|bing|yahoo|duckduckgo)[\s\S]{0,500}location/i, "redirect gated on a search engine referrer"],
  ["mobile_gate", /(?:Android|iPhone|iPad|Mobi)[\s\S]{0,300}\.location(?:\.href)?\s*=/i, "redirect gated on a mobile user agent"],
  ["cookie_gate", /document\.cookie[\s\S]{0,300}\.location(?:\.href)?\s*=/i, "redirect gated on a cookie"],
  ["obfuscator", /_0x[0-9a-f]{4,6}\s*\(\s*0x[0-9a-f]+\s*\)/i, "obfuscator-style _0x names"],
  ["hex_chain", /(?:\\x[0-9a-fA-F]{2}){24,}/, "24 or more hex escapes in a row"],
  [
    "skimmer_exfil",
    new RegExp(`${CARD_FIELD}[\\s\\S]{0,2000}?${SEND}|${SEND}[\\s\\S]{0,2000}?${CARD_FIELD}`, "i"),
    "card number or CVV field near code that sends data out (fetch, XMLHttpRequest, image beacon, WebSocket)",
  ],
  [
    "skimmer_listener",
    /(?:checkout|billing|payment|place_order)[\s\S]{0,400}?(?:addEventListener\s*\(\s*['"](?:submit|click|change|blur)['"]|\.on\s*\(\s*['"](?:submit|click)['"]|\.onsubmit\s*=)/i,
    "listener on a checkout or payment form, in a file that also decodes strings (atob or fromCharCode)",
    /\batob\s*\(|fromCharCode/,
  ],
];

function fail(message) {
  console.error(`scan-js: ${message}`);
  console.error(USAGE);
  process.exit(2);
}

function* walk(root, skipped) {
  const stack = [""];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(path.join(root, current), { withFileTypes: true });
    } catch {
      skipped.unreadable.push(current || ".");
      continue;
    }
    entries.sort((a, b) => b.name.localeCompare(a.name));
    for (const entry of entries) {
      const rel = current ? `${current}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) skipped.links.push(rel);
      else if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) skipped.dirs.push(rel);
        else stack.push(rel);
      } else if (entry.isFile()) yield rel;
    }
  }
}

function lineOf(text, index) {
  let line = 1;
  for (let i = text.indexOf("\n"); i !== -1 && i < index; i = text.indexOf("\n", i + 1)) line++;
  return line;
}

function excerpt(text, index) {
  const start = Math.max(0, index - 20);
  return text
    .slice(start, start + 120)
    .replace(/[\r\n\t]/g, " ")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ".");
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith("-")) fail("expected one folder");
  const root = args[0];
  if (!existsSync(root) || !statSync(root).isDirectory()) fail(`${root} is not a directory`);

  const skipped = { dirs: [], links: [], unreadable: [], large: [] };
  const counts = new Map(PATTERNS.map(([name]) => [name, 0]));
  const results = [];
  let scanned = 0;

  for (const rel of walk(root, skipped)) {
    if (!FILE.test(rel)) continue;
    const file = path.join(root, rel);
    let text;
    try {
      const size = statSync(file).size;
      if (size > MAX_BYTES) {
        skipped.large.push(`${rel} (${size} bytes)`);
        continue;
      }
      text = readFileSync(file).toString("latin1");
    } catch {
      skipped.unreadable.push(rel);
      continue;
    }
    scanned++;
    const hits = [];
    for (const [name, re, why, also] of PATTERNS) {
      const m = re.exec(text);
      if (m && (!also || also.test(text))) hits.push({ name, why, line: lineOf(text, m.index), excerpt: excerpt(text, m.index) });
    }
    if (hits.length) {
      results.push({ rel, hits });
      for (const h of hits) counts.set(h.name, counts.get(h.name) + 1);
    }
  }

  console.log(`Folder: ${path.resolve(root)}`);
  console.log(`JavaScript, HTML and SVG files scanned: ${scanned}`);
  if (skipped.dirs.length) console.log(`Skipped folders: ${skipped.dirs.length} (${skipped.dirs.slice(0, 5).join(", ")}${skipped.dirs.length > 5 ? ", ..." : ""})`);
  if (skipped.links.length) console.log(`Symbolic links not followed: ${skipped.links.join(", ")}`);
  if (skipped.large.length) console.log(`Too large, not scanned (read by hand): ${skipped.large.join(", ")}`);
  if (skipped.unreadable.length) console.log(`Unreadable: ${skipped.unreadable.join(", ")}`);

  console.log("\nFiles per pattern:");
  for (const [name, n] of counts) console.log(`  ${name.padEnd(18)} ${n}`);

  if (!results.length) {
    console.log("\nNo hits.");
    process.exit(0);
  }
  console.log(`\nFiles with hits: ${results.length}. Most will be innocent; read the code at each line.`);
  for (const { rel, hits } of results) {
    console.log(`\n${rel}`);
    for (const h of hits) console.log(`  [${h.name}] line ${h.line}: ${h.why}\n      ${h.excerpt}`);
  }
  process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(`scan-js: ${error.message}`);
  process.exit(2);
}
