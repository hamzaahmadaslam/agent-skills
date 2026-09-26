#!/usr/bin/env node
// Read-only helper. Maps script and resource URLs to the WordPress component that serves them:
// plugin:<slug>, mu-plugin:<name>, theme:<slug>, core, uploads:<folder>, cache:<folder>, inline:<handle>,
// or third-party:<host>. Use it on LoAF script URLs (sourceURL), LCP resource URLs, or any list of URLs.
//
// It reads the URLs you give it and prints a table (or JSON). It writes no files and makes no network requests.
// Node 20 or later, no dependencies. Other helpers in this folder import classifyUrl() from this file.
//
// Usage:
//   node scripts/wp-owner.mjs --site=https://www.example.com urls.txt
//   node scripts/wp-owner.mjs --site=https://www.example.com --cdn=cdn.example.com < urls.txt
//   node scripts/wp-owner.mjs --site=https://www.example.com https://www.example.com/wp-content/plugins/foo/a.js
//
// Input: one URL per line, optionally followed by a tab and a number (a weight, for example milliseconds of
// script time). Blank lines and lines starting with # are skipped.
//
// Options:
//   --site=<url>          The site's own origin. URLs on other hosts become third-party unless listed in --cdn.
//   --cdn=<host,host>     Hosts that serve the site's own files (a CDN or a static domain).
//   --content-dir=<name>  Name of the content directory if it is not wp-content (see WP_CONTENT_URL).
//   --json                Print JSON.
//
// Exit codes: 0 done, 1 bad arguments, 2 input not readable.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const INLINE_NAME = /^(.+)-(js-extra|js-before|js-after|js-translations|inline-css)$/;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Strips the query string and fragment so that ?ver=1.2.3 cache busters do not split the groups.
export function cleanUrl(raw) {
  return String(raw).split("#")[0].split("?")[0];
}

/**
 * Classifies one URL (or a LoAF sourceURL value) by the WordPress component that serves it.
 * @param {string} raw URL, path, or WordPress 6.9+ inline script name such as "my-handle-js-after".
 * @param {{site?: string, cdn?: string[], contentDir?: string}} options
 * @returns {{owner: string, kind: string, slug: string, host: string, path: string, note: string}}
 */
export function classifyUrl(raw, options = {}) {
  const value = String(raw ?? "").trim();
  const contentDir = options.contentDir || "wp-content";
  const cdnHosts = (options.cdn || []).map((h) => h.toLowerCase());
  let siteHost = "";
  if (options.site) {
    try {
      siteHost = new URL(options.site).host.toLowerCase();
    } catch {
      siteHost = "";
    }
  }

  const result = (kind, slug, host, urlPath, note = "") => ({
    owner: slug ? `${kind}:${slug}` : kind,
    kind,
    slug,
    host,
    path: urlPath,
    note,
  });

  if (value === "") {
    return result("unknown", "", "", "", "empty source URL: LoAF leaves it empty when there is no good source to point to, for example a callback not defined in page code");
  }

  // WordPress 6.9+ names inline scripts and styles with a sourceURL comment such as "foo-js-after".
  const inline = value.match(INLINE_NAME);
  if (inline && !value.includes("/") && !value.includes(":")) {
    return result("inline", inline[1], "", "", `inline ${inline[2]} code attached to the handle "${inline[1]}"`);
  }

  let url;
  try {
    url = new URL(value, options.site || "https://site.invalid");
  } catch {
    return result("unknown", "", "", value, "not a URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return result("unknown", "", "", value, `${url.protocol} URL`);
  }

  const host = url.host.toLowerCase() === "site.invalid" ? "" : url.host.toLowerCase();
  const urlPath = url.pathname;
  const isOwnHost = !siteHost || !host || host === siteHost || cdnHosts.includes(host);
  const via = host && siteHost && host !== siteHost ? `served from ${host}` : "";

  const content = new RegExp(`(?:^|/)${escapeRegExp(contentDir)}/(plugins|mu-plugins|themes|uploads|cache|languages|fonts)/([^/]+)`);
  const match = urlPath.match(content);
  let wp = null;
  if (match) {
    const [, area, first] = match;
    const name = decodeURIComponent(first);
    if (area === "plugins") wp = ["plugin", name, ""];
    else if (area === "mu-plugins") wp = ["mu-plugin", name.replace(/\.php$/, ""), "must-use plugin: always on, not listed with normal plugins"];
    else if (area === "themes") wp = ["theme", name, "check whether this is the child theme or the parent theme"];
    else if (area === "uploads") {
      // Multisite keeps each site's files under uploads/sites/<id>/.
      const rest = urlPath.slice(match.index + match[0].length);
      const folder = name === "sites" ? (rest.match(/^\/\d+\/([^/]+)/) || [])[1] || "" : name;
      wp = /^\d{4}$/.test(folder)
        ? ["uploads", "media", "Media Library file; find which template or block outputs it"]
        : ["uploads", folder, "generated file in uploads; find the plugin or theme that writes this folder"];
    } else if (area === "cache") wp = ["cache", name, "generated file, not part of WordPress; find the plugin that writes this folder, and turn off combining on staging to see the original files"];
    else wp = [area === "languages" ? "languages" : "content", name, ""];
  } else if (/(?:^|\/)wp-includes\//.test(urlPath)) {
    const block = urlPath.match(/wp-includes\/blocks\/([^/]+)\//);
    if (block) wp = ["core", `block-${block[1]}`, "core block asset"];
    else if (/wp-includes\/js\/jquery\//.test(urlPath)) wp = ["core", "jquery", "printed because an enqueued script depends on jquery; find the dependents"];
    else if (/wp-includes\/css\/dist\/block-library\//.test(urlPath)) wp = ["core", "block-library", "core block styles"];
    else wp = ["core", "", ""];
  } else if (/(?:^|\/)wp-admin\//.test(urlPath)) {
    wp = ["core", "admin", "wp-admin asset on a front-end page"];
  }

  if (wp) {
    const [kind, slug, note] = wp;
    if (!isOwnHost) {
      return result("third-party", host, host, urlPath, `path looks like ${kind} "${slug}"; if ${host} serves this site's files, pass --cdn=${host}`);
    }
    return result(kind, slug, host, urlPath, [note, via].filter(Boolean).join("; "));
  }

  if (!isOwnHost) {
    return result("third-party", host, host, urlPath, "");
  }
  if (!siteHost) {
    return result("other", host, host, urlPath, "pass --site to tell site files from third-party files");
  }
  return result("site", "", host, urlPath, "same-site URL outside WordPress asset folders: the page itself (inline code) or a custom path");
}

function parseArgs(argv) {
  const opts = { cdn: [], json: false, files: [], urls: [] };
  for (const arg of argv) {
    if (arg === "--json") opts.json = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg.startsWith("--site=")) opts.site = arg.slice(7);
    else if (arg.startsWith("--cdn=")) opts.cdn = arg.slice(6).split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith("--content-dir=")) opts.contentDir = arg.slice(14).replace(/^\/+|\/+$/g, "");
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else if (/^https?:\/\//i.test(arg)) opts.urls.push(arg);
    else opts.files.push(arg);
  }
  return opts;
}

function readLines(opts) {
  const lines = [...opts.urls];
  for (const file of opts.files) {
    lines.push(...readFileSync(file === "-" ? 0 : file, "utf8").split(/\r?\n/));
  }
  if (opts.urls.length === 0 && opts.files.length === 0) {
    if (process.stdin.isTTY) throw new Error("no input: pass a file, URLs, or pipe URLs on standard input");
    lines.push(...readFileSync(0, "utf8").split(/\r?\n/));
  }
  return lines;
}

export function aggregate(entries, options) {
  const groups = new Map();
  for (const { url, weight } of entries) {
    const c = classifyUrl(url, options);
    const key = c.owner;
    if (!groups.has(key)) groups.set(key, { owner: key, count: 0, weight: 0, notes: new Set(), examples: [] });
    const g = groups.get(key);
    g.count += 1;
    g.weight += weight;
    if (c.note) g.notes.add(c.note);
    const example = cleanUrl(url) || "(empty)";
    if (g.examples.length < 3 && !g.examples.includes(example)) g.examples.push(example);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, notes: [...g.notes] }))
    .sort((a, b) => b.weight - a.weight || b.count - a.count);
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`wp-owner: ${error.message}`);
    process.exit(1);
  }
  if (opts.help) {
    console.log("Usage: node scripts/wp-owner.mjs [--site=<url>] [--cdn=<hosts>] [--content-dir=<name>] [--json] [file|url ...]");
    return;
  }
  let lines;
  try {
    lines = readLines(opts);
  } catch (error) {
    console.error(`wp-owner: ${error.message}`);
    process.exit(error.code === "ENOENT" || error.code === "EACCES" ? 2 : 1);
  }
  const entries = [];
  for (const line of lines) {
    // Keep a leading tab: "<TAB>12" is an empty source URL with a weight of 12.
    const text = line.replace(/\s+$/, "");
    if (text.trim() === "" || text.trim().startsWith("#")) continue;
    const [url, weightText] = text.split("\t");
    const weight = Number.parseFloat(weightText);
    entries.push({ url: url.trim(), weight: Number.isFinite(weight) ? weight : 0 });
  }
  const options = { site: opts.site, cdn: opts.cdn, contentDir: opts.contentDir };
  const rows = aggregate(entries, options);
  if (opts.json) {
    console.log(JSON.stringify({ site: opts.site || null, urls: entries.length, owners: rows }, null, 2));
    return;
  }
  if (!opts.site) console.log("Note: without --site, files on other hosts cannot be told apart from the site's own files.\n");
  const hasWeight = entries.some((e) => e.weight > 0);
  console.log(`${entries.length} URL(s), ${rows.length} owner(s)\n`);
  for (const row of rows) {
    const weight = hasWeight ? `  weight ${Math.round(row.weight)}` : "";
    console.log(`${row.owner}  (${row.count} URL${row.count === 1 ? "" : "s"}${weight})`);
    for (const note of row.notes) console.log(`    note: ${note}`);
    for (const example of row.examples) console.log(`    ${example}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
