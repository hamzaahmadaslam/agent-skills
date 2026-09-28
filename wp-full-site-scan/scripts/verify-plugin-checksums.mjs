#!/usr/bin/env node
// Read-only helper for the wp-full-site-scan skill. Compares every plugin in a plugins folder with the WordPress.org
// checksum list saved for its version, and reports per plugin: files that differ (modified), code files the release
// does not contain (added), and listed files that are absent (missing).
//
// It reads the plugin files and the saved JSON lists, prints a report, and writes nothing. It makes no network
// requests: list-plugin-versions.mjs prints the curl lines that save each list as checksums/<slug>-<version>.json.
// A list holds {"plugin", "version", "files": {"path": {"md5": "<md5>" or ["<md5>", ...]}}}. When a file differs
// only by Windows line endings, it is reported as such instead of as modified.
//
// Usage:
//   node verify-plugin-checksums.mjs <plugins-dir> <checksums-dir>
//
// Exit codes: 0 every verifiable plugin matches, 1 modified files or added code files found, 2 bad arguments or
// unreadable input. Plugins without a saved list are reported as not verifiable and do not change the exit code;
// they need the checks in the skill's step for code that checksums cannot cover. Node.js 20 or later, no dependencies.

import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const USAGE = "Usage: node verify-plugin-checksums.mjs <plugins-dir> <checksums-dir>";
const CODE = /\.(php[0-9s]?|phtml|pht|inc|phar|m?js|suspected)$/i;

function fail(message) {
  console.error(`verify-plugin-checksums: ${message}`);
  console.error(USAGE);
  process.exit(2);
}

function head(file) {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(8192);
    const n = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, n).toString("utf8").replace(/\r\n?/g, "\n");
  } finally {
    closeSync(fd);
  }
}

function field(text, name) {
  const re = new RegExp(`^(?:[ \\t]*<\\?php)?[ \\t/*#@]*${name}:(.*)$`, "mi");
  const m = re.exec(text);
  return m ? m[1].replace(/\s*(?:\*\/|\?>).*$/, "").trim() : "";
}

// The version from the top-level PHP file that carries a "Plugin Name:" header.
function pluginVersion(dir) {
  for (const name of readdirSync(dir).filter((n) => /\.php$/i.test(n)).sort()) {
    const file = path.join(dir, name);
    try {
      if (!statSync(file).isFile()) continue;
      const text = head(file);
      if (field(text, "Plugin Name")) return field(text, "Version") || null;
    } catch {
      // unreadable: try the next file
    }
  }
  return null;
}

function md5(buffer) {
  return createHash("md5").update(buffer).digest("hex");
}

// Every file under dir, relative, with forward slashes. Symbolic links are listed separately and not followed.
function listFiles(dir) {
  const files = [];
  const links = [];
  const stack = [""];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(path.join(dir, current), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const rel = current ? `${current}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) links.push(rel);
      else if (entry.isDirectory()) stack.push(rel);
      else if (entry.isFile()) files.push(rel);
    }
  }
  return { files: files.sort(), links: links.sort() };
}

// Read every saved list once, keyed by "slug@version" from the JSON itself, so file names do not matter.
function loadLists(dir) {
  const lists = new Map();
  const bad = [];
  for (const name of readdirSync(dir).filter((n) => /\.json$/i.test(n)).sort()) {
    let data;
    try {
      data = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
    } catch {
      bad.push(name);
      continue;
    }
    if (!data || typeof data.files !== "object" || !data.plugin || !data.version) {
      bad.push(name);
      continue;
    }
    lists.set(`${data.plugin}@${data.version}`, { name, files: data.files });
  }
  return { lists, bad };
}

function verify(pluginDir, files) {
  const listed = new Map();
  for (const [rel, entry] of Object.entries(files)) {
    const sums = Array.isArray(entry?.md5) ? entry.md5 : [entry?.md5];
    listed.set(rel, new Set(sums.filter((s) => typeof s === "string").map((s) => s.toLowerCase())));
  }
  const modified = [];
  const lineEndings = [];
  const missing = [];
  for (const [rel, sums] of listed) {
    const file = path.join(pluginDir, rel);
    let buffer;
    try {
      buffer = readFileSync(file);
    } catch {
      missing.push(rel);
      continue;
    }
    if (sums.has(md5(buffer))) continue;
    const unix = Buffer.from(buffer.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
    if (sums.has(md5(unix))) lineEndings.push(rel);
    else modified.push(rel);
  }
  const { files: present, links } = listFiles(pluginDir);
  const unlisted = present.filter((rel) => !listed.has(rel));
  return {
    listedCount: listed.size,
    modified,
    lineEndings,
    missing,
    added: unlisted.filter((rel) => CODE.test(rel)),
    addedOther: unlisted.filter((rel) => !CODE.test(rel)),
    links,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args.some((a) => a.startsWith("-"))) fail("expected two folders");
  const [pluginsDir, sumsDir] = args;
  for (const dir of args) if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`${dir} is not a directory`);

  const { lists, bad } = loadLists(sumsDir);
  const byPlugin = new Map();
  for (const key of lists.keys()) {
    const slug = key.slice(0, key.lastIndexOf("@"));
    byPlugin.set(slug, [...(byPlugin.get(slug) || []), key.slice(slug.length + 1)]);
  }

  const verified = [];
  const flagged = [];
  const notVerifiable = [];
  const plugins = readdirSync(pluginsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  console.log(`Plugins folder: ${path.resolve(pluginsDir)}`);
  console.log(`Checksum lists: ${path.resolve(sumsDir)} (${lists.size} readable${bad.length ? `, ${bad.length} not a checksum list: ${bad.join(", ")}` : ""})\n`);

  for (const slug of plugins) {
    const dir = path.join(pluginsDir, slug);
    const version = pluginVersion(dir);
    if (!version) {
      notVerifiable.push(`${slug}: no version header`);
      continue;
    }
    const list = lists.get(`${slug}@${version}`);
    if (!list) {
      const other = byPlugin.get(slug);
      notVerifiable.push(
        other
          ? `${slug} ${version}: saved list is for ${other.join(", ")}, not the version in the header`
          : `${slug} ${version}: not verifiable (premium, custom or removed from the directory)`,
      );
      continue;
    }
    const r = verify(dir, list.files);
    const check = r.modified.length || r.added.length;
    const line =
      `${slug} ${version}: listed=${r.listedCount} MODIFIED=${r.modified.length} ADDED code=${r.added.length}` +
      ` missing=${r.missing.length}` +
      (r.lineEndings.length ? ` line-endings-only=${r.lineEndings.length}` : "") +
      (r.addedOther.length ? ` added other=${r.addedOther.length}` : "") +
      (check ? "   <<< CHECK" : "");
    console.log(line);
    for (const rel of r.modified) console.log(`    MODIFIED  ${rel}${CODE.test(rel) ? "" : "  (not code; often harmless, still look)"}`);
    for (const rel of r.added) console.log(`    ADDED     ${rel}`);
    for (const rel of r.lineEndings) console.log(`    CRLF      ${rel}  (same content, Windows line endings)`);
    for (const rel of r.links) console.log(`    LINK      ${rel}  (symbolic link, not followed)`);
    for (const rel of r.missing.slice(0, 10)) console.log(`    missing   ${rel}`);
    if (r.missing.length > 10) console.log(`    missing   ... and ${r.missing.length - 10} more`);
    (check ? flagged : verified).push(slug);
  }

  console.log(`\nPlugin folders: ${plugins.length}`);
  console.log(`Verified clean: ${verified.length}`);
  console.log(`Need a look (modified or added code): ${flagged.length}${flagged.length ? `  ${flagged.join(", ")}` : ""}`);
  console.log(`Not verifiable: ${notVerifiable.length}`);
  for (const line of notVerifiable) console.log(`  ${line}`);
  process.exit(flagged.length ? 1 : 0);
}

try {
  main();
} catch (error) {
  console.error(`verify-plugin-checksums: ${error.message}`);
  process.exit(2);
}
