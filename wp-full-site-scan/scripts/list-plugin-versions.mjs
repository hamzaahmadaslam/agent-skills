#!/usr/bin/env node
// Read-only helper for the wp-full-site-scan skill. Lists every plugin in a plugins folder with the version from its
// main plugin file header, the URL of its WordPress.org checksum list, and a curl line that saves that list. With
// --themes it also lists every theme with the version from style.css and the URL of the matching WordPress.org zip.
//
// It reads the file headers (the first 8 KB of each file, as WordPress does) and prints. It writes nothing and makes
// no network requests; you run the printed curl lines yourself. A slug or version with characters outside
// letters, digits, dot, dash and underscore gets no curl line, because a header is text the attacker may control.
//
// Checksum lists live at https://downloads.wordpress.org/plugin-checksums/<slug>/<version>.json and hold
// {"plugin", "version", "files": {"path": {"md5": "<md5>" or ["<md5>", ...], "sha256": ...}}}. A plugin that is not
// in the directory (premium, custom, or removed) returns a 404 page; curl --fail then saves nothing.
//
// Usage:
//   node list-plugin-versions.mjs <plugins-dir>
//   node list-plugin-versions.mjs <plugins-dir> --themes <themes-dir>
//
// Exit codes: 0 done, 2 bad arguments or unreadable folder. Node.js 20 or later, no dependencies.

import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const USAGE = "Usage: node list-plugin-versions.mjs <plugins-dir> [--themes <themes-dir>]";
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function fail(message) {
  console.error(`list-plugin-versions: ${message}`);
  console.error(USAGE);
  process.exit(2);
}

// The first 8 KB of a file, as WordPress's get_file_data() reads it.
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

// One header field, matched the way get_file_data() matches it, with the closing comment removed.
function field(text, name) {
  const re = new RegExp(`^(?:[ \\t]*<\\?php)?[ \\t/*#@]*${name}:(.*)$`, "mi");
  const m = re.exec(text);
  return m ? m[1].replace(/\s*(?:\*\/|\?>).*$/, "").trim() : "";
}

function pluginHeader(dir) {
  let names;
  try {
    names = readdirSync(dir).filter((n) => /\.php$/i.test(n)).sort();
  } catch {
    return null;
  }
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      if (!statSync(file).isFile()) continue;
      const text = head(file);
      const pluginName = field(text, "Plugin Name");
      if (pluginName) return { file: name, name: pluginName, version: field(text, "Version") };
    } catch {
      // unreadable file: try the next one
    }
  }
  return null;
}

function listPlugins(dir) {
  const rows = [];
  const singles = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      const header = pluginHeader(path.join(dir, entry.name));
      rows.push({ slug: entry.name, header });
    } else if (entry.isFile() && /\.php$/i.test(entry.name) && entry.name !== "index.php") {
      const text = head(path.join(dir, entry.name));
      const pluginName = field(text, "Plugin Name");
      singles.push({ file: entry.name, name: pluginName, version: field(text, "Version") });
    }
  }

  console.log(`== Plugins in ${path.resolve(dir)} ==`);
  const width = Math.max(10, ...rows.map((r) => r.slug.length));
  const curls = [];
  for (const { slug, header } of rows) {
    if (!header) {
      console.log(`${slug.padEnd(width)}  (no file with a "Plugin Name:" header in the top level; not a plugin, or its main file is missing)`);
      continue;
    }
    if (!header.version) {
      console.log(`${slug.padEnd(width)}  (no Version header in ${header.file})`);
      continue;
    }
    if (!SAFE.test(slug) || !SAFE.test(header.version)) {
      console.log(`${slug.padEnd(width)}  version "${header.version}" has unexpected characters; no URL printed. Read ${header.file}.`);
      continue;
    }
    const url = `https://downloads.wordpress.org/plugin-checksums/${slug}/${header.version}.json`;
    console.log(`${slug.padEnd(width)}  ${header.version.padEnd(12)}  ${url}`);
    curls.push(`curl -sfL -o 'checksums/${slug}-${header.version}.json' '${url}' || echo 'no checksums: ${slug} ${header.version}'`);
  }
  if (singles.length) {
    console.log("\nSingle-file PHP in the plugins folder (a plugin's slug cannot be read from the file name; read each one):");
    for (const s of singles) {
      console.log(`  ${s.file}  ${s.name ? `Plugin Name: ${s.name}  Version: ${s.version || "(none)"}` : "(no Plugin Name header)"}`);
    }
  }
  console.log(`\nPlugin folders: ${rows.length}, with a usable version: ${curls.length}`);
  if (curls.length) {
    console.log("\n== Download the checksum lists (run from the scan workspace) ==");
    console.log("mkdir -p checksums");
    for (const line of curls) console.log(line);
  }
}

function listThemes(dir) {
  console.log(`\n== Themes in ${path.resolve(dir)} ==`);
  const curls = [];
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    count++;
    const style = path.join(dir, entry.name, "style.css");
    if (!existsSync(style)) {
      console.log(`${entry.name}  (no style.css; not a theme, or a broken copy)`);
      continue;
    }
    const text = head(style);
    const name = field(text, "Theme Name");
    const version = field(text, "Version");
    const parent = field(text, "Template");
    if (!version) {
      console.log(`${entry.name}  (${name || "no Theme Name"}; no Version header)`);
      continue;
    }
    const note = parent ? `  child theme of ${parent}: usually custom, compare it by reading` : "";
    if (!SAFE.test(entry.name) || !SAFE.test(version)) {
      console.log(`${entry.name}  version "${version}" has unexpected characters; no URL printed. Read style.css.${note}`);
      continue;
    }
    const url = `https://downloads.wordpress.org/theme/${entry.name}.${version}.zip`;
    console.log(`${entry.name}  ${version}  ${url}${note}`);
    if (!parent) curls.push(`curl -sfL -o 'theme-zips/${entry.name}.${version}.zip' '${url}' || echo 'not on wordpress.org: ${entry.name} ${version}'`);
  }
  console.log(`\nTheme folders: ${count}`);
  if (curls.length) {
    console.log("\n== Download the theme zips (run from the scan workspace; a 404 means premium or custom) ==");
    console.log("mkdir -p theme-zips");
    for (const line of curls) console.log(line);
    console.log("Unzip each into its own folder outside the site copy and compare, for example: diff -rq theme-zips/<slug>/<slug> <themes-dir>/<slug>");
  }
}

function main() {
  const args = process.argv.slice(2);
  let pluginsDir = null;
  let themesDir = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") fail("help");
    if (a === "--themes") {
      themesDir = args[++i];
      if (!themesDir) fail("--themes needs a folder");
    } else if (a.startsWith("--themes=")) themesDir = a.slice(9);
    else if (a.startsWith("-")) fail(`unknown option ${a}`);
    else if (!pluginsDir) pluginsDir = a;
    else fail(`unexpected argument ${a}`);
  }
  if (!pluginsDir) fail("expected a plugins folder");
  for (const dir of [pluginsDir, themesDir].filter(Boolean)) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`${dir} is not a directory`);
  }
  listPlugins(pluginsDir);
  if (themesDir) listThemes(themesDir);
}

try {
  main();
} catch (error) {
  console.error(`list-plugin-versions: ${error.message}`);
  process.exit(2);
}
