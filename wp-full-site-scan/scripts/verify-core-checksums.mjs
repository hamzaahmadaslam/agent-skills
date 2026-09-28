#!/usr/bin/env node
// Read-only helper for the wp-full-site-scan skill. Compares the WordPress core files in a site copy with the
// checksums that WordPress.org publishes for that release, and lists files in the root, wp-admin and wp-includes
// that the release does not contain. wp-content is skipped: plugins and themes have their own checks.
//
// It reads the site copy and the checksum file you name, prints a report, and writes nothing. It makes no network
// requests: download the checksum file first, for the version and locale in wp-includes/version.php, for example
//   curl -sf -o core-checksums.json "https://api.wordpress.org/core/checksums/1.0/?version=6.8.2&locale=en_US"
// The file holds {"checksums": {"wp-login.php": "<md5>", ...}}. Without &locale= the API nests the list under the
// version, {"checksums": {"6.8.2": {...}}}; both shapes are read. {"checksums": false} means the API has no list for
// that version and locale.
//
// Usage:
//   node verify-core-checksums.mjs <site-root> <checksums.json>
//
// Exit codes: 0 every core file matches and nothing extra was found, 1 modified, missing or extra files found,
// 2 bad arguments or unreadable input. Node.js 20 or later, no dependencies.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const USAGE = "Usage: node verify-core-checksums.mjs <site-root> <checksums.json>";

function fail(message) {
  console.error(`verify-core-checksums: ${message}`);
  console.error(USAGE);
  process.exit(2);
}

function md5(file) {
  return createHash("md5").update(readFileSync(file)).digest("hex");
}

// Every file under dir, as paths relative to root with forward slashes. Symbolic links are listed, not followed.
function listFiles(root, dir, out, links) {
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(path.join(root, current), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const rel = current ? `${current}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) links.push(rel);
      else if (entry.isDirectory()) stack.push(rel);
      else if (entry.isFile()) out.push(rel);
    }
  }
}

function loadChecksums(file) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`cannot read ${file} as JSON (${error.message}). Was the download an error page?`);
  }
  let sums = data?.checksums;
  if (sums === false) fail(`${file} says {"checksums": false}: the API has no list for that version and locale`);
  if (!sums || typeof sums !== "object") fail(`${file} has no "checksums" object`);
  const values = Object.values(sums);
  // Without a locale the list sits under the version number.
  if (values.length === 1 && values[0] && typeof values[0] === "object") sums = values[0];
  const out = new Map();
  for (const [rel, hash] of Object.entries(sums)) {
    if (typeof hash === "string" && /^[0-9a-f]{32}$/i.test(hash)) out.set(rel, hash.toLowerCase());
  }
  if (!out.size) fail(`${file} holds no MD5 checksums`);
  return out;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args.some((a) => a === "-h" || a === "--help")) fail("expected two arguments");
  const [root, sumsFile] = args;
  if (!existsSync(root) || !statSync(root).isDirectory()) fail(`${root} is not a directory`);
  if (!existsSync(sumsFile)) fail(`${sumsFile} does not exist`);

  const sums = loadChecksums(sumsFile);
  const core = [...sums.keys()].filter((rel) => !rel.startsWith("wp-content/")).sort();

  const modified = [];
  const missing = [];
  for (const rel of core) {
    const file = path.join(root, rel);
    let stat;
    try {
      stat = statSync(file);
    } catch {
      missing.push(rel);
      continue;
    }
    if (!stat.isFile()) {
      missing.push(rel);
      continue;
    }
    if (md5(file) !== sums.get(rel)) modified.push(rel);
  }

  // Files the release does not contain: top-level files, and everything under wp-admin and wp-includes.
  const found = [];
  const links = [];
  const extraDirs = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) links.push(entry.name);
    else if (entry.isFile()) found.push(entry.name);
    else if (entry.isDirectory() && !["wp-admin", "wp-includes", "wp-content"].includes(entry.name)) extraDirs.push(entry.name);
  }
  for (const dir of ["wp-admin", "wp-includes"]) {
    const full = path.join(root, dir);
    if (existsSync(full) && lstatSync(full).isDirectory()) listFiles(root, dir, found, links);
  }
  const extra = found.filter((rel) => !sums.has(rel) && rel !== "wp-config.php").sort();

  const coreDirsMissing = ["wp-admin", "wp-includes"].filter((d) => !existsSync(path.join(root, d)));

  console.log(`Site root:        ${path.resolve(root)}`);
  console.log(`Checksum file:    ${path.resolve(sumsFile)}`);
  console.log(`Core files in the list (wp-content skipped): ${core.length}`);
  console.log(`Checked:  ${core.length - missing.length}`);
  console.log(`Match:    ${core.length - missing.length - modified.length}`);
  console.log(`MODIFIED: ${modified.length}`);
  console.log(`Missing:  ${missing.length}`);
  console.log(`Extra files in the root, wp-admin and wp-includes: ${extra.length}`);

  if (modified.length) {
    console.log("\nModified core files (read each one; treat as infected until proven otherwise):");
    for (const rel of modified) console.log(`  MODIFIED  ${rel}`);
  }
  if (extra.length) {
    console.log("\nFiles that are not part of this release (read their names, then the code files):");
    for (const rel of extra) console.log(`  EXTRA     ${rel}`);
  }
  if (extraDirs.length) {
    console.log("\nFolders in the root besides wp-admin, wp-includes and wp-content (not scanned here):");
    for (const dir of extraDirs.sort()) console.log(`  FOLDER    ${dir}/`);
  }
  if (links.length) {
    console.log("\nSymbolic links (not followed):");
    for (const rel of links.sort()) console.log(`  LINK      ${rel}`);
  }
  if (missing.length) {
    const shown = missing.slice(0, 50);
    console.log(`\nMissing core files${missing.length > shown.length ? ` (first ${shown.length})` : ""}:`);
    for (const rel of shown) console.log(`  MISSING   ${rel}`);
  }
  if (coreDirsMissing.length) {
    console.log(`\nNote: ${coreDirsMissing.join(" and ")} not found. On managed hosts core can live outside the backup as a`);
    console.log("symbolic link; then the site cannot modify it. Say so in the report instead of calling core unchecked.");
  }
  if (existsSync(path.join(root, "wp-config.php"))) {
    console.log("\nwp-config.php is never in the release list. Read it in full by hand.");
  }

  const findings = modified.length + missing.length + extra.length;
  console.log(findings ? "\nResult: differences found." : "\nResult: every core file matches and nothing extra was found.");
  process.exit(findings ? 1 : 0);
}

try {
  main();
} catch (error) {
  console.error(`verify-core-checksums: ${error.message}`);
  process.exit(2);
}
