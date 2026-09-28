#!/usr/bin/env node
// Helper for the wp-full-site-scan skill. Prepares a cleaned SQL dump for the server it will be restored to, by
// rewriting identifiers and table options only:
//   --prefix-from=X --prefix-to=Y  table names that start with X after a backtick become Y, on CREATE TABLE, DROP
//                                  TABLE, LOCK TABLES, ALTER TABLE, TRUNCATE, view and REFERENCES lines, and the
//                                  table name at the start of INSERT and REPLACE lines. Used when MySQL on Windows
//                                  lowercased the prefix (ab3_ must become Ab3_ again for a Linux server).
//   --collation-downgrade[=NAME]   utf8mb4_0900_* (MySQL 8) and utf8mb4_uca1400_* (MariaDB 11) become NAME
//                                  (default utf8mb4_unicode_520_ci); utf8mb3_uca1400_* becomes utf8mb3_unicode_ci
//   --utf8mb3-to-utf8              utf8mb3 becomes utf8, for servers older than MySQL 8
//   --strip-mariadb-sandbox        drops MariaDB's "enable the sandbox mode" first line, which other clients reject
// Row data is never changed: the rest of every INSERT line, and every line that is not a table definition, a
// statement naming a table, or a SET line at the top of the dump, is copied byte for byte.
//
// It reads <in.sql> and writes one new file, <out.sql>. It refuses when <out.sql> is the input or already exists, so
// it never overwrites anything, never changes the input, touches no database and makes no network requests. It
// streams line by line, so dumps of any size work. It expects one statement per line for row data, as mysqldump,
// mariadb-dump and phpMyAdmin write it.
//
// This changes table names only. When the prefix itself changes (not only its letter case), the option
// <prefix>user_roles and the usermeta keys <prefix>capabilities and <prefix>user_level must be renamed too; the
// summary shows which prefix the row data uses.
//
// Usage:
//   node fix-export.mjs <in.sql> <out.sql> --prefix-from=ab3_ --prefix-to=Ab3_ [--collation-downgrade[=NAME]]
//                       [--utf8mb3-to-utf8] [--strip-mariadb-sandbox]
// Then check the result and test-import it into a throwaway database before touching the live one:
//   grep -c 'CREATE TABLE' out.sql
//   grep -c 'utf8mb3\|0900_ai_ci\|uca1400' out.sql     # 0 for an older target
//
// Exit codes: 0 written and the checks passed, 1 written but a check found leftovers (read the summary), 2 bad
// arguments or refused. Node.js 20 or later, no dependencies.

import { once } from "node:events";
import { closeSync, createReadStream, createWriteStream, existsSync, openSync, statSync } from "node:fs";
import path from "node:path";

const USAGE =
  "Usage: node fix-export.mjs <in.sql> <out.sql> [--prefix-from=X --prefix-to=Y] [--collation-downgrade[=NAME]] [--utf8mb3-to-utf8] [--strip-mariadb-sandbox]";

function fail(message) {
  console.error(`fix-export: ${message}`);
  console.error(USAGE);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { files: [], from: null, to: null, collation: null, utf8: false, sandbox: false };
  for (const a of argv) {
    if (a === "-h" || a === "--help") fail("help");
    else if (a.startsWith("--prefix-from=")) opts.from = a.slice(14);
    else if (a.startsWith("--prefix-to=")) opts.to = a.slice(12);
    else if (a === "--collation-downgrade") opts.collation = "utf8mb4_unicode_520_ci";
    else if (a.startsWith("--collation-downgrade=")) opts.collation = a.slice(22);
    else if (a === "--utf8mb3-to-utf8") opts.utf8 = true;
    else if (a === "--strip-mariadb-sandbox") opts.sandbox = true;
    else if (a.startsWith("-")) fail(`unknown option ${a}`);
    else opts.files.push(a);
  }
  if (opts.files.length !== 2) fail("expected <in.sql> and <out.sql>");
  if ((opts.from === null) !== (opts.to === null)) fail("--prefix-from and --prefix-to go together");
  for (const p of [opts.from, opts.to]) {
    if (p !== null && !/^[A-Za-z0-9_$]+$/.test(p)) fail(`prefix "${p}" may hold only letters, digits, _ and $`);
  }
  if (opts.from !== null && opts.from === opts.to) fail("--prefix-from and --prefix-to are the same");
  if (opts.collation !== null && !/^utf8mb4_[a-z0-9_]+$/i.test(opts.collation)) fail(`"${opts.collation}" is not a utf8mb4 collation name`);
  if (opts.from === null && !opts.collation && !opts.utf8 && !opts.sandbox) fail("nothing to do: give at least one option");
  return opts;
}

function sameFile(a, b) {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  if (process.platform === "win32" || process.platform === "darwin") return ra.toLowerCase() === rb.toLowerCase();
  return ra === rb;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [inPath, outPath] = opts.files;
  if (!existsSync(inPath) || !statSync(inPath).isFile()) fail(`${inPath} is not a file`);
  if (sameFile(inPath, outPath)) fail("<out.sql> must be a different file from <in.sql>");
  if (existsSync(outPath)) fail(`${outPath} already exists; choose a new name (nothing is ever overwritten)`);

  const tickFrom = opts.from === null ? null : "`" + opts.from;
  const tickTo = opts.to === null ? null : "`" + opts.to;
  const insertHead = tickFrom === null ? null : /^(\s*(?:INSERT(?:\s+IGNORE)?|REPLACE)(?:\s+INTO)?\s+)`/i;
  const identifierLine =
    /^\s*(?:CREATE\s+TABLE|DROP\s+TABLE|DROP\s+VIEW|LOCK\s+TABLES|ALTER\s+TABLE|TRUNCATE(?:\s+TABLE)?|RENAME\s+TABLE|CREATE\s+(?:ALGORITHM|DEFINER|OR\s+REPLACE|VIEW|SQL\s+SECURITY)|\/\*!\d+\s+(?:CREATE|DROP|ALTER|VIEW|SQL\s+SECURITY|DEFINER|ALGORITHM)|--\s.*\bfor\s+(?:table|view)\b)/i;
  const setLine = /^\s*(?:\/\*!\d+\s+)?SET\s/i;
  const insertLine = /^\s*(?:INSERT|REPLACE)\b/i;

  const stats = {
    lines: 0,
    createTables: 0,
    insertLines: 0,
    prefixChanged: 0,
    collations: 0,
    utf8: 0,
    sandboxDropped: false,
    sandboxKept: false,
    sandboxLater: 0,
    leftoverPrefix: 0,
    leftoverCharset: 0,
    dataFrom: 0,
    dataTo: 0,
  };
  const dataFromNeedle = opts.from === null ? null : Buffer.from(`'${opts.from}user_roles'`, "latin1");
  const dataToNeedle = opts.to === null ? null : Buffer.from(`'${opts.to}user_roles'`, "latin1");

  let inCreate = false;
  let inAlter = false;

  function charset(text) {
    let out = text;
    if (opts.collation) {
      out = out.replace(/\butf8mb4_(?:0900|uca1400)_[a-z0-9_]*/gi, () => {
        stats.collations++;
        return opts.collation;
      });
      out = out.replace(/\butf8mb3_uca1400_[a-z0-9_]*/gi, () => {
        stats.collations++;
        return "utf8mb3_unicode_ci";
      });
    }
    if (opts.utf8) {
      out = out.replace(/\butf8mb3(?![a-z0-9])/gi, () => {
        stats.utf8++;
        return "utf8";
      });
    }
    return out;
  }

  function renameAll(text) {
    if (tickFrom === null || !text.includes(tickFrom)) return text;
    const parts = text.split(tickFrom);
    stats.prefixChanged += parts.length - 1;
    return parts.join(tickTo);
  }

  function leftovers(text) {
    if (tickFrom !== null && text.includes(tickFrom)) stats.leftoverPrefix++;
    if ((opts.collation && /0900_|uca1400/i.test(text)) || (opts.utf8 && /utf8mb3/i.test(text))) stats.leftoverCharset++;
  }

  // Returns the bytes to write for one line (without its newline), or null to drop it.
  function fixLine(buf, lineNo) {
    const headText = buf.subarray(0, 64).toString("latin1");

    if (headText.startsWith("/*M!999999")) {
      if (lineNo === 1) {
        if (!opts.sandbox) {
          stats.sandboxKept = true;
          return buf;
        }
        stats.sandboxDropped = true;
        return null;
      }
      stats.sandboxLater++;
      return buf;
    }

    // Row data: only the table name at the start of the line may change.
    if (insertLine.test(headText)) {
      stats.insertLines++;
      if (dataFromNeedle && buf.includes(dataFromNeedle)) stats.dataFrom++;
      if (dataToNeedle && buf.includes(dataToNeedle)) stats.dataTo++;
      if (insertHead === null) return buf;
      const head = buf.subarray(0, 512).toString("latin1");
      const m = insertHead.exec(head);
      if (!m || !head.startsWith(tickFrom, m[1].length)) return buf;
      stats.prefixChanged++;
      const fixed = m[1] + tickTo;
      return Buffer.concat([Buffer.from(fixed, "latin1"), buf.subarray(m[1].length + tickFrom.length)]);
    }

    if (inCreate) {
      let text = buf.toString("latin1");
      // Inside a table definition: foreign key targets and the table options line.
      if (tickFrom !== null && text.includes("REFERENCES " + tickFrom)) {
        const parts = text.split("REFERENCES " + tickFrom);
        stats.prefixChanged += parts.length - 1;
        text = parts.join("REFERENCES " + tickTo);
      }
      text = charset(text);
      if (/^\s*\)/.test(text)) inCreate = false;
      leftovers(text);
      return Buffer.from(text, "latin1");
    }

    if (inAlter) {
      let text = charset(renameAll(buf.toString("latin1")));
      if (/;\s*$/.test(text)) inAlter = false;
      leftovers(text);
      return Buffer.from(text, "latin1");
    }

    if (identifierLine.test(headText)) {
      let text = buf.toString("latin1");
      if (/^\s*CREATE\s+TABLE/i.test(text)) {
        stats.createTables++;
        if (!/;\s*$/.test(text)) inCreate = true;
      } else if (/^\s*ALTER\s+TABLE/i.test(text) && !/;\s*$/.test(text)) {
        inAlter = true;
      }
      text = charset(renameAll(text));
      leftovers(text);
      return Buffer.from(text, "latin1");
    }

    if (setLine.test(headText) && buf.length < 4096) {
      const text = charset(buf.toString("latin1"));
      leftovers(text);
      return Buffer.from(text, "latin1");
    }

    return buf;
  }

  let fd;
  try {
    fd = openSync(outPath, "wx");
  } catch (error) {
    fail(`cannot create ${outPath}: ${error.message}`);
  }
  const out = createWriteStream(outPath, { fd });
  const write = async (chunk) => {
    if (!out.write(chunk)) await once(out, "drain");
  };
  const NL = Buffer.from("\n");

  let pending = [];
  let lineNo = 0;
  const handle = async (buf, newline) => {
    lineNo++;
    stats.lines++;
    const fixed = fixLine(buf, lineNo);
    if (fixed === null) return;
    await write(fixed);
    if (newline) await write(NL);
  };

  try {
    for await (const chunk of createReadStream(inPath)) {
      let start = 0;
      let nl;
      while ((nl = chunk.indexOf(10, start)) !== -1) {
        const piece = chunk.subarray(start, nl);
        const line = pending.length ? Buffer.concat([...pending, piece]) : piece;
        pending = [];
        await handle(line, true);
        start = nl + 1;
      }
      if (start < chunk.length) pending.push(chunk.subarray(start));
    }
    if (pending.length) await handle(Buffer.concat(pending), false);
    out.end();
    await once(out, "finish");
  } catch (error) {
    try {
      out.destroy();
      closeSync(fd);
    } catch {
      // already closed
    }
    console.error(`fix-export: stopped at line ${lineNo}: ${error.message}. ${outPath} is incomplete; delete it.`);
    process.exit(2);
  }

  console.log(`Read:    ${path.resolve(inPath)}`);
  console.log(`Wrote:   ${path.resolve(outPath)} (the input was not changed)`);
  console.log(`Lines: ${stats.lines}   CREATE TABLE: ${stats.createTables}   INSERT lines: ${stats.insertLines} (row data copied as is)`);
  if (opts.from !== null) console.log(`Table names changed from ${opts.from} to ${opts.to}: ${stats.prefixChanged}`);
  if (opts.collation) console.log(`Collations replaced (target ${opts.collation}): ${stats.collations}`);
  if (opts.utf8) console.log(`utf8mb3 renamed to utf8: ${stats.utf8}`);
  if (opts.sandbox) console.log(`MariaDB sandbox line on line 1: ${stats.sandboxDropped ? "removed" : "not present"}`);
  if (stats.sandboxKept) console.log("Note: line 1 is MariaDB's sandbox line and was kept; add --strip-mariadb-sandbox for a MySQL target.");
  if (stats.sandboxLater) console.log(`Note: ${stats.sandboxLater} sandbox line(s) after line 1 were left alone (a dump joined from several files?)`);

  if (opts.from !== null) {
    console.log(`Row data naming '${opts.from}user_roles': ${stats.dataFrom} INSERT line(s); '${opts.to}user_roles': ${stats.dataTo}.`);
    if (stats.dataFrom && !stats.dataTo) {
      console.log(`  The rows use ${opts.from}. WordPress with prefix ${opts.to} will not find its roles or user capabilities; rename`);
      console.log("  those option and usermeta keys with WP-CLI after the import, or keep the old prefix.");
    }
  }
  const problems = [];
  if (stats.leftoverPrefix) problems.push(`${stats.leftoverPrefix} rewritten line(s) still name ${tickFrom}`);
  if (stats.leftoverCharset) problems.push(`${stats.leftoverCharset} rewritten line(s) still hold 0900_, uca1400 or utf8mb3`);
  if (problems.length) {
    console.log(`Check: ${problems.join("; ")}. Search ${outPath} for them before importing.`);
    process.exit(1);
  }
  console.log("Check: no leftovers in the rewritten lines. Test-import into a throwaway database next.");
}

main().catch((error) => {
  console.error(`fix-export: ${error.message}`);
  process.exit(2);
});
