#!/usr/bin/env node
// Read-only helper for the wp-full-site-scan skill. Lists every external host that the code under a folder refers to,
// with a count and example files per host, grouped by how the host is used:
//   script   <script src="https://host/...">, and wp_enqueue_script or wp_register_script with an absolute URL
//   request  wp_remote_get, wp_remote_post, wp_remote_request, wp_safe_remote_*, file_get_contents, fopen,
//            curl_init, fsockopen, and fetch() in JavaScript
//   redirect header('Location: https://host') and wp_redirect('https://host')
// Then ask host by host: is it the vendor of the plugin it sits in, a known service, or something nobody can explain?
// A phone-home host in a premium plugin is how nulled copies often show themselves.
//
// It reads every .php, .phtml, .inc, .js, .mjs, .html and .htm file, prints the inventory, and writes nothing. It
// makes no network requests and never resolves or opens the hosts it prints. Hosts built at run time (from variables
// or decoded strings) are not visible to it; scan-php.mjs and scan-js.mjs look for that kind of code. node_modules and
// .git folders are skipped; symbolic links are not followed.
//
// Usage:
//   node external-hosts.mjs <folder>
//   node external-hosts.mjs site/wp-content
//
// Exit codes: 0 done (an inventory, not a verdict), 2 bad arguments or unreadable folder. Node.js 20 or later, no
// dependencies.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const USAGE = "Usage: node external-hosts.mjs <folder>";
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const MAX_BYTES = 64 * 1024 * 1024;
const FILE = /\.(php[0-9s]?|phtml|inc|m?js|html?)$/i;
const EXAMPLES = 3;

// Two slashes, allowing the escaped form "\/\/" that JSON and some PHP strings use.
const SLASHES = String.raw`\\?\/\\?\/`;
const HOST = String.raw`([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)`;

// [kind, global pattern whose first group is the host]
const PATTERNS = [
  ["script", new RegExp(String.raw`<script\b[^>]{0,160}?\bsrc\s*=\s*\\?["']?\s*(?:https?:)?${SLASHES}${HOST}`, "gi")],
  ["script", new RegExp(String.raw`\bwp_(?:enqueue|register)_script\s*\([^;]{0,200}?['"](?:https?:)?${SLASHES}${HOST}`, "gi")],
  [
    "request",
    new RegExp(
      String.raw`\b(?:wp_remote_(?:get|post|request|head)|wp_safe_remote_(?:get|post|request|head)|file_get_contents|fopen|curl_init|fetch)\s*\(\s*['"\x60](?:(?:https?|ssl|tls):)?${SLASHES}${HOST}`,
      "gi",
    ),
  ],
  ["request", new RegExp(String.raw`\bcurl_setopt\s*\([^,]{1,60},\s*CURLOPT_URL\s*,\s*['"](?:https?:)?${SLASHES}${HOST}`, "gi")],
  ["request", new RegExp(String.raw`\bfsockopen\s*\(\s*['"](?:(?:ssl|tls|tcp|udp):${SLASHES})?${HOST}['"]`, "gi")],
  ["redirect", new RegExp(String.raw`\bheader\s*\(\s*['"]Location\s*:\s*(?:https?:)?${SLASHES}${HOST}`, "gi")],
  ["redirect", new RegExp(String.raw`\bwp_(?:safe_)?redirect\s*\(\s*['"](?:https?:)?${SLASHES}${HOST}`, "gi")],
];

function fail(message) {
  console.error(`external-hosts: ${message}`);
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

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith("-")) fail("expected one folder");
  const root = args[0];
  if (!existsSync(root) || !statSync(root).isDirectory()) fail(`${root} is not a directory`);

  const skipped = { dirs: [], links: [], unreadable: [], large: [] };
  // kind -> host -> { count, files: Set }
  const inventory = new Map([
    ["script", new Map()],
    ["request", new Map()],
    ["redirect", new Map()],
  ]);
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
    for (const [kind, re] of PATTERNS) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const host = m[1].toLowerCase();
        const hosts = inventory.get(kind);
        const entry = hosts.get(host) || { count: 0, files: new Set() };
        entry.count++;
        entry.files.add(rel);
        hosts.set(host, entry);
      }
    }
  }

  console.log(`Folder: ${path.resolve(root)}`);
  console.log(`Files read: ${scanned}`);
  if (skipped.dirs.length) console.log(`Skipped folders: ${skipped.dirs.length}`);
  if (skipped.links.length) console.log(`Symbolic links not followed: ${skipped.links.join(", ")}`);
  if (skipped.large.length) console.log(`Too large, not read: ${skipped.large.join(", ")}`);
  if (skipped.unreadable.length) console.log(`Unreadable: ${skipped.unreadable.join(", ")}`);

  const titles = {
    script: "Script sources (script src, wp_enqueue_script, wp_register_script)",
    request: "Outbound requests (wp_remote_*, file_get_contents, fopen, curl, fsockopen, fetch)",
    redirect: "Redirect targets (header Location, wp_redirect)",
  };
  const all = new Map();
  for (const [kind, hosts] of inventory) {
    const rows = [...hosts].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
    console.log(`\n== ${titles[kind]}, hosts: ${rows.length} ==`);
    for (const [host, { count, files }] of rows) {
      const list = [...files];
      console.log(`${String(count).padStart(6)}  ${host}`);
      for (const f of list.slice(0, EXAMPLES)) console.log(`          ${f}`);
      if (list.length > EXAMPLES) console.log(`          ... and ${list.length - EXAMPLES} more files`);
      all.set(host, (all.get(host) || 0) + count);
    }
  }
  console.log(`\n== All hosts, total: ${all.size} ==`);
  for (const [host, count] of [...all].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`${String(count).padStart(6)}  ${host}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`external-hosts: ${error.message}`);
  process.exit(2);
}
