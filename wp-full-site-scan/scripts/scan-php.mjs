#!/usr/bin/env node
// Read-only helper for the wp-full-site-scan skill. Signature scan of the PHP files under a folder: decoders fed to
// eval, request data run as code or commands, includes of image or text files, admin users created from code, known
// web shell names, obfuscation (hex and chr chains, long base64 strings, very long lines), code that hides users from
// the admin list, auto_prepend_file set from code or config, and PHP inside wp-content/uploads.
//
// A hit is a place to read, not a verdict. Vendor libraries use assert() and long constants, and security plugins
// write auto_prepend_file on purpose. Open every hit and read the code around the line before calling it malware.
//
// It reads every file with a PHP extension (plus .user.ini, php.ini and .htaccess for auto_prepend_file, and every
// file under an uploads folder for a PHP open tag), prints counts per pattern and each hit with the line number of
// the first match and a 120-character excerpt, and writes nothing. It makes no network requests. Files are read as
// bytes (latin1), so binary content is safe. node_modules and .git folders are skipped; symbolic links are not
// followed; files over 64 MB are listed and skipped.
//
// Usage:
//   node scan-php.mjs <folder>
//   node scan-php.mjs site/wp-content/plugins/some-plugin
//
// Exit codes: 0 no hits, 1 hits found, 2 bad arguments or unreadable folder. Node.js 20 or later, no dependencies.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const USAGE = "Usage: node scan-php.mjs <folder>";
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const MAX_BYTES = 64 * 1024 * 1024;
const LONG_LINE = 20000;

const PHP_FILE = /\.(php[0-9s]?|phtml|pht|inc|phar|suspected)$/i;
const CONFIG_FILE = /^(\.user\.ini|php\.ini|\.htaccess)$/i;
const RUNNABLE_IN_UPLOADS = /\.(php[0-9s]?|phtml|pht|phar|suspected)$/i;

// [name, pattern, description]. Every pattern runs on the whole file read as latin1.
const PATTERNS = [
  ["eval_decode", /\beval\s*\(\s*(?:base64_decode|gzinflate|gzuncompress|str_rot13|strrev|hex2bin|gzdecode)\b/i, "eval() of a decoded string"],
  ["assert_var", /\bassert\s*\(\s*\$/i, "assert() on a variable (runs code on PHP 7 and older)"],
  ["superglobal_call", /\$_(?:POST|GET|REQUEST|COOKIE)\s*\[[^\]]{1,40}\]\s*\(/i, "request data called as a function"],
  ["exec_input", /\b(?:shell_exec|passthru|system|exec|popen|proc_open|pcntl_exec)\s*\([^)]{0,60}\$_(?:POST|GET|REQUEST|COOKIE)/i, "shell command fed by request data"],
  ["include_nonphp", /\b(?:include|require)(?:_once)?\s*\(?\s*['"][^'"]{1,200}\.(?:ico|png|jpe?g|gif|txt|log|bmp|webp)['"]/i, "include of an image, text or log file"],
  ["globals_call", /\$GLOBALS\s*\[\s*['"][A-Za-z0-9_]{6,}['"]\s*\]\s*\(/i, "function called through $GLOBALS"],
  ["file_put_input", /\bfile_put_contents\s*\([^;]{0,150}\$_(?:POST|GET|REQUEST|FILES)/i, "file written from request data"],
  ["create_admin", /\bwp_(?:create|insert)_user\s*\([\s\S]{0,400}?administrator/i, "administrator created from code"],
  ["known_shell", /(?:FilesMan|b374k|r57shell|c99shell|IndoXploit|Alfa-?Shell|WSO\s*[245]\.|anonymousfox)/i, "known web shell name"],
  // A quoted pattern whose closing delimiter is followed by modifiers that include e.
  ["preg_e", /\bpreg_replace\s*\(\s*(['"])([^A-Za-z0-9\s'"])(?:(?!\1).){0,200}?\2[a-zA-Z]*e[a-zA-Z]*\1/i, "preg_replace with the /e modifier"],
  ["create_function", /\bcreate_function\s*\(/i, "create_function() (runs a string as code)"],
  ["hex_chain", /(?:\\x[0-9a-fA-F]{2}){16,}/, "16 or more hex escapes in a row"],
  ["chr_chain", /(?:\bchr\s*\(\s*\d+\s*\)\s*\.\s*){8,}/i, "8 or more chr() calls joined"],
  ["long_b64", /['"][A-Za-z0-9+/]{3000,}={0,2}['"]/, "base64-looking string of 3,000 or more characters"],
  [
    "hide_users",
    /\b(?:pre_user_query|users_list_table_query_args|pre_get_users)\b[\s\S]{0,800}?(?:query_where|\bID\s*(?:!=|<>|NOT\s+IN)|user_login\s*(?:!=|<>|NOT\s+IN)|['"]exclude['"]|login__not_in)/i,
    "user query filter that excludes IDs or logins (hides accounts from the Users screen)",
  ],
  ["auto_prepend", /\bauto_prepend_file\b/i, "auto_prepend_file (loads a file before every request)"],
];

function fail(message) {
  console.error(`scan-php: ${message}`);
  console.error(USAGE);
  process.exit(2);
}

// Files under root, with forward-slash paths relative to root.
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

// 120 characters from just before the match, with control bytes shown as dots.
function excerpt(text, index) {
  const start = Math.max(0, index - 20);
  return text
    .slice(start, start + 120)
    .replace(/[\r\n\t]/g, " ")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ".");
}

function longestLine(text) {
  let longest = 0;
  let at = 0;
  let start = 0;
  for (;;) {
    const end = text.indexOf("\n", start);
    const length = (end === -1 ? text.length : end) - start;
    if (length > longest) {
      longest = length;
      at = start;
    }
    if (end === -1) return { longest, at };
    start = end + 1;
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith("-")) fail("expected one folder");
  const root = args[0];
  if (!existsSync(root) || !statSync(root).isDirectory()) fail(`${root} is not a directory`);

  const skipped = { dirs: [], links: [], unreadable: [], large: [] };
  const counts = new Map(PATTERNS.map(([name]) => [name, 0]));
  for (const name of ["very_long_line", "php_in_uploads", "php_tag_in_upload"]) counts.set(name, 0);
  const results = [];
  const stubs = [];
  let scanned = 0;
  let uploadsRead = 0;

  for (const rel of walk(root, skipped)) {
    const base = rel.slice(rel.lastIndexOf("/") + 1);
    const lower = `/${rel.toLowerCase()}`;
    const inUploads = lower.includes("/uploads/");
    const isPhp = PHP_FILE.test(base);
    const isConfig = CONFIG_FILE.test(base);
    if (!isPhp && !isConfig && !inUploads) continue;

    const file = path.join(root, rel);
    let size;
    try {
      size = statSync(file).size;
    } catch {
      skipped.unreadable.push(rel);
      continue;
    }
    if (size > MAX_BYTES) {
      skipped.large.push(`${rel} (${size} bytes)`);
      continue;
    }
    let text;
    try {
      text = readFileSync(file).toString("latin1");
    } catch {
      skipped.unreadable.push(rel);
      continue;
    }

    const hits = [];
    if (isPhp) {
      scanned++;
      for (const [name, re, why] of PATTERNS) {
        const m = re.exec(text);
        if (m) hits.push({ name, why, line: lineOf(text, m.index), excerpt: excerpt(text, m.index) });
      }
      const { longest, at } = longestLine(text);
      if (longest > LONG_LINE) {
        hits.push({ name: "very_long_line", why: `a line of ${longest} characters`, line: lineOf(text, at), excerpt: excerpt(text, at + 20) });
      }
      if (inUploads && RUNNABLE_IN_UPLOADS.test(base)) {
        // A small index.php with no other hit is the usual empty guard stub: listed, not counted.
        if (base.toLowerCase() === "index.php" && size < 200 && !hits.length) stubs.push(`${rel} (${size} bytes): ${excerpt(text, 20).trim()}`);
        else hits.push({ name: "php_in_uploads", why: `PHP file in uploads (${size} bytes)`, line: 1, excerpt: excerpt(text, 20) });
      }
    } else if (isConfig) {
      const m = /\bauto_prepend_file\b/i.exec(text);
      if (m) hits.push({ name: "auto_prepend", why: "auto_prepend_file in a server config file", line: lineOf(text, m.index), excerpt: excerpt(text, m.index) });
    } else {
      // Any other file in uploads: a PHP open tag hidden in an image, text or archive file.
      uploadsRead++;
      const i = text.indexOf("<?php");
      if (i !== -1) hits.push({ name: "php_tag_in_upload", why: "PHP open tag inside a non-PHP file in uploads", line: lineOf(text, i), excerpt: excerpt(text, i) });
    }

    if (hits.length) {
      results.push({ rel, hits });
      for (const h of hits) counts.set(h.name, counts.get(h.name) + 1);
    }
  }

  console.log(`Folder: ${path.resolve(root)}`);
  console.log(`PHP files scanned: ${scanned}; other files read in uploads: ${uploadsRead}`);
  if (skipped.dirs.length) console.log(`Skipped folders: ${skipped.dirs.length} (${skipped.dirs.slice(0, 5).join(", ")}${skipped.dirs.length > 5 ? ", ..." : ""})`);
  if (skipped.links.length) console.log(`Symbolic links not followed: ${skipped.links.join(", ")}`);
  if (skipped.large.length) console.log(`Too large, not scanned (read by hand): ${skipped.large.join(", ")}`);
  if (skipped.unreadable.length) console.log(`Unreadable: ${skipped.unreadable.join(", ")}`);

  console.log("\nFiles per pattern:");
  for (const [name, n] of counts) console.log(`  ${name.padEnd(18)} ${n}`);

  if (stubs.length) {
    console.log("\nSmall index.php files in uploads, not counted (usually empty guard stubs; confirm each by reading):");
    for (const s of stubs) console.log(`  ${s}`);
  }

  if (!results.length) {
    console.log("\nNo hits.");
    process.exit(0);
  }
  console.log(`\nFiles with hits: ${results.length}. Read the code at each line before deciding.`);
  for (const { rel, hits } of results) {
    console.log(`\n${rel}`);
    for (const h of hits) console.log(`  [${h.name}] line ${h.line}: ${h.why}\n      ${h.excerpt}`);
  }
  process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(`scan-php: ${error.message}`);
  process.exit(2);
}
