#!/usr/bin/env node
// Read-only helper. Reads CREATE TABLE statements (from `wp db export - --no-data=true --tables=...`, from
// collation-report.sh in DDL mode, or from SHOW CREATE TABLE output) and prints, as text for the owner to review, the
// narrowest ALTER TABLE statements that bring the chosen tables or columns to one target collation, with read-only
// checks to run first, the backup command, checks to run after, and the rollback statements that restore the saved
// definitions.
//
// It only reads the file you give it. It connects to no database, runs no statement, writes no file and makes no
// network requests. Every statement it prints is a proposal: the owner approves each one, staging first
// (references/changes-and-rollback.md).
//
// Usage:
//   node propose-alters.mjs <ddl file> --target=<collation> [options]
// Options:
//   --target=COLLATION        the collation to converge on, normally WordPress's $wpdb->collate (required)
//   --table=T1,T2             only these tables (default: every table in the file)
//   --column=T.C,T.C          only these columns; the table default is then left as it is
//   --server=mysql|mariadb    lock clause for the change (default mysql)
//   --row-format-default=F    row format for tables whose definition names none (default dynamic, the InnoDB default
//                             on MySQL 8.4 and MariaDB; check ROW_FORMAT in the report)
//   --assume-collation=CS=COLL  default collation of a character set, for definitions that name only a character set
//                             (repeatable, for example --assume-collation=utf8mb4=utf8mb4_0900_ai_ci)
//   --lock-wait=N             seconds for SET SESSION lock_wait_timeout in the proposal (default 5)
// Facts behind each check: references/fixes.md and references/changes-and-rollback.md.

import { readFileSync, existsSync } from 'node:fs';

const USAGE = 'Usage: node propose-alters.mjs <ddl file> --target=<collation> [--table=T1,T2] [--column=T.C] [--server=mysql|mariadb] [--row-format-default=dynamic|compact|redundant|compressed] [--assume-collation=CS=COLL] [--lock-wait=N]';
const NAME = /^[A-Za-z0-9_$]+$/;
const COLLATION = /^[a-z0-9]+_[a-z0-9_]+$/;
// Bytes per character: MySQL 8.4 manual, Unicode support and character sets; binary-safe single-byte sets listed.
const MAXLEN = { utf8mb4: 4, utf8mb3: 3, utf8: 3, latin1: 1, ascii: 1, latin2: 1, cp1250: 1, cp1251: 1, cp1256: 1, cp1257: 1, greek: 1, hebrew: 1, binary: 1, ucs2: 2, utf16: 4, utf16le: 4, utf32: 4 };
const TEXT_TYPE = /^(char|varchar|tinytext|text|mediumtext|longtext|enum|set)\b/i;

function parseArgs(argv) {
  const opts = { file: null, target: null, tables: null, columns: null, server: 'mysql', rowFormat: 'dynamic', assume: {}, lockWait: 5 };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { help: true };
    const [key, ...rest] = arg.split('=');
    const value = rest.join('=');
    if (key === '--target') opts.target = value;
    else if (key === '--table') opts.tables = value.split(',').filter(Boolean);
    else if (key === '--column') opts.columns = value.split(',').filter(Boolean);
    else if (key === '--server') opts.server = value;
    else if (key === '--row-format-default') opts.rowFormat = value.toLowerCase();
    else if (key === '--lock-wait') opts.lockWait = Number(value);
    else if (key === '--assume-collation') {
      const [cs, coll] = value.split('=');
      if (!cs || !COLLATION.test(coll || '')) return { error: `--assume-collation needs CHARSET=COLLATION, got ${value}` };
      opts.assume[cs.toLowerCase()] = coll.toLowerCase();
    } else if (arg.startsWith('--')) return { error: `Unknown option ${arg}` };
    else if (!opts.file) opts.file = arg;
    else return { error: `Unexpected argument ${arg}` };
  }
  if (!opts.file) return { error: 'Give the file with the CREATE TABLE statements.' };
  if (!opts.target || !COLLATION.test(opts.target)) return { error: '--target must be a collation name such as utf8mb4_unicode_520_ci.' };
  if (!['mysql', 'mariadb'].includes(opts.server)) return { error: '--server must be mysql or mariadb.' };
  if (!['dynamic', 'compact', 'redundant', 'compressed'].includes(opts.rowFormat)) return { error: 'Unknown --row-format-default.' };
  if (!Number.isInteger(opts.lockWait) || opts.lockWait < 1) return { error: '--lock-wait must be a whole number of seconds.' };
  for (const t of opts.tables || []) if (!NAME.test(t)) return { error: `Unexpected table name ${t}` };
  for (const c of opts.columns || []) if (!/^[A-Za-z0-9_$]+\.[A-Za-z0-9_$]+$/.test(c)) return { error: `--column takes table.column, got ${c}` };
  return opts;
}

const charsetOf = (collation) => collation.split('_')[0];
const q = (name) => '`' + name.replace(/`/g, '``') + '`';
const sqlString = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";

// Split "a, b(1,2), 'x,y'" on top-level commas.
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (ch === '\\') { cur += text[i + 1] ?? ''; i += 1; } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; cur += ch; continue; }
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Key parts such as `meta_key`(191) or `a` DESC; functional parts are kept as null columns.
function parseKeyParts(inner) {
  return splitTop(inner).map((part) => {
    const m = part.match(/^`((?:[^`]|``)+)`(?:\((\d+)\))?/);
    return m ? { column: m[1].replace(/``/g, '`'), prefix: m[2] ? Number(m[2]) : null } : { column: null, prefix: null, expression: part };
  });
}

function parseColumn(name, def) {
  const typeMatch = def.match(/^([a-z]+)(\((?:[^()']|'(?:[^'\\]|\\.|'')*')*\))?(\s+unsigned)?/i);
  const type = typeMatch ? typeMatch[0] : def.split(/\s+/)[0];
  let rest = def.slice(type.length);
  let charset = null;
  let collation = null;
  for (;;) {
    const cs = rest.match(/^\s+(?:CHARACTER SET|CHARSET)\s+([A-Za-z0-9_]+)/i);
    if (cs) { charset = cs[1].toLowerCase(); rest = rest.slice(cs[0].length); continue; }
    const co = rest.match(/^\s+COLLATE\s+([A-Za-z0-9_]+)/i);
    if (co) { collation = co[1].toLowerCase(); rest = rest.slice(co[0].length); continue; }
    break;
  }
  const len = type.match(/^(?:var)?char\((\d+)\)/i);
  return {
    name,
    def,
    type,
    rest,
    isText: TEXT_TYPE.test(type),
    baseType: type.split('(')[0].toLowerCase(),
    length: len ? Number(len[1]) : null,
    explicitCharset: charset,
    explicitCollation: collation,
    generated: /\bGENERATED ALWAYS\b|\bAS \(/i.test(rest),
  };
}

export function parseTables(text) {
  const tables = [];
  const re = /CREATE TABLE (?:IF NOT EXISTS )?`((?:[^`]|``)+)` \(\r?\n([\s\S]*?)\r?\n\)([^;\r\n]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const table = { name: m[1].replace(/``/g, '`'), columns: [], keys: [], foreignKeys: [], options: m[3].trim() };
    for (let line of m[2].split(/\r?\n/)) {
      line = line.trim().replace(/,$/, '');
      const col = line.match(/^`((?:[^`]|``)+)`\s+(.*)$/);
      if (col) { table.columns.push(parseColumn(col[1].replace(/``/g, '`'), col[2])); continue; }
      const key = line.match(/^(PRIMARY KEY|UNIQUE KEY|UNIQUE INDEX|KEY|INDEX|FULLTEXT KEY|FULLTEXT INDEX|SPATIAL KEY|SPATIAL INDEX)\s*(?:`((?:[^`]|``)+)`\s*)?\((.*)\)/i);
      if (key) {
        const kind = key[1].toUpperCase();
        table.keys.push({ kind, name: key[2] ? key[2].replace(/``/g, '`') : 'PRIMARY', unique: kind === 'PRIMARY KEY' || kind.startsWith('UNIQUE'), fulltext: kind.startsWith('FULLTEXT') || kind.startsWith('SPATIAL'), parts: parseKeyParts(key[3]) });
        continue;
      }
      const fk = line.match(/^CONSTRAINT `((?:[^`]|``)+)` FOREIGN KEY \(([^)]*)\) REFERENCES `((?:[^`]|``)+)` \(([^)]*)\)/i);
      if (fk) table.foreignKeys.push({ name: fk[1], columns: parseKeyParts(fk[2]).map((p) => p.column), refTable: fk[3], refColumns: parseKeyParts(fk[4]).map((p) => p.column) });
    }
    const opt = (re2) => { const x = table.options.match(re2); return x ? x[1].toLowerCase() : null; };
    table.engine = opt(/ENGINE=(\w+)/i) || 'unknown';
    table.charset = opt(/(?:DEFAULT )?(?:CHARSET|CHARACTER SET)=(\w+)/i);
    table.collation = opt(/COLLATE=(\w+)/i);
    table.rowFormat = opt(/ROW_FORMAT=(\w+)/i);
    tables.push(table);
  }
  return tables;
}

function effective(table, col, assume) {
  if (col.explicitCollation) return { collation: col.explicitCollation, charset: col.explicitCharset || charsetOf(col.explicitCollation) };
  if (col.explicitCharset) return { collation: assume[col.explicitCharset] || null, charset: col.explicitCharset };
  const tCollation = table.collation || (table.charset ? assume[table.charset] : null) || null;
  return { collation: tCollation, charset: table.charset || (tCollation ? charsetOf(tCollation) : null) };
}

function keyLimit(table, rowFormatDefault) {
  if (table.engine === 'myisam') return { bytes: 1000, basis: 'MyISAM maximum key length' };
  if (table.engine === 'innodb') {
    const rf = table.rowFormat || rowFormatDefault;
    const assumed = table.rowFormat ? '' : ', row format assumed';
    return ['dynamic', 'compressed'].includes(rf)
      ? { bytes: 3072, basis: `InnoDB ${rf.toUpperCase()} key prefix limit${assumed}` }
      : { bytes: 767, basis: `InnoDB ${rf.toUpperCase()} key prefix limit${assumed}` };
  }
  return { bytes: null, basis: `engine ${table.engine}: limit not known to this script` };
}

function withCharset(col, charset, collation) {
  return `${q(col.name)} ${col.type} CHARACTER SET ${charset} COLLATE ${collation}${col.rest}`;
}

// MySQL: character set and collation changes use ALGORITHM=COPY, which allows reads and blocks writes (LOCK=SHARED).
const LOCK_CLAUSE = 'ALGORITHM=COPY, LOCK=SHARED';

function propose(table, all, opts) {
  const out = [];
  const targetCs = charsetOf(opts.target);
  const colFilter = opts.columns ? new Set(opts.columns.filter((c) => c.split('.')[0] === table.name).map((c) => c.split('.')[1])) : null;
  const tableScope = !colFilter;
  const tableEff = { collation: table.collation || (table.charset ? opts.assume[table.charset] : null) || null, charset: table.charset };
  const warnings = [];
  const changes = [];
  const skipped = [];

  for (const col of table.columns) {
    if (!col.isText) continue;
    if (colFilter && !colFilter.has(col.name)) continue;
    const eff = effective(table, col, opts.assume);
    if (eff.collation === opts.target) continue;
    if (col.generated) { skipped.push(`${col.name}: generated column, change it by hand after reading its expression`); continue; }
    if (eff.charset === 'utf8mb4' && targetCs !== 'utf8mb4') { skipped.push(`${col.name}: ${eff.charset} to ${targetCs} would lose 4-byte characters; not proposed`); continue; }
    if (eff.charset && eff.charset !== 'utf8mb4' && eff.charset !== targetCs && !['utf8', 'utf8mb3', 'ascii'].includes(eff.charset)) {
      warnings.push(`${col.name} is ${eff.charset}: before converting, confirm on staging that its bytes are ${eff.charset} text and not UTF-8 stored under the wrong label (references/fixes.md, "Data stored under the wrong label")`);
    }
    if (col.baseType === 'tinytext' && targetCs === 'utf8mb4') warnings.push(`${col.name} is TINYTEXT: 255 bytes hold at most 63 four-byte characters`);
    changes.push({ col, eff });
  }
  if (colFilter) for (const name of colFilter) if (!table.columns.some((c) => c.name === name)) skipped.push(`${name}: not in this table's definition`);

  const narrowingDefault = tableEff.charset === 'utf8mb4' && targetCs !== 'utf8mb4';
  if (tableScope && narrowingDefault) skipped.push(`table default: utf8mb4 to ${targetCs} would lose 4-byte characters; not proposed`);
  const tableDefaultChange = tableScope && !narrowingDefault && tableEff.collation !== opts.target;
  if (!changes.length && !tableDefaultChange) {
    out.push(skipped.length ? `-- ${table.name}: no change proposed toward ${opts.target}.` : `-- ${table.name}: already on ${opts.target} for the columns in scope; nothing to propose.`);
    if (skipped.length) out.push(...skipped.map((s) => `--   skipped ${s}`));
    return out.join('\n');
  }

  const limit = keyLimit(table, opts.rowFormat);
  const changedNames = new Set(changes.map((c) => c.col.name));
  const keyNotes = [];
  const uniqueChecks = [];
  const keyChanges = [];
  const keyRollbacks = [];
  for (const key of table.keys) {
    if (key.fulltext || !key.parts.some((p) => changedNames.has(p.column))) continue;
    let total = 0;
    const partNotes = [];
    const newPrefix = new Map();
    for (const part of key.parts) {
      const col = table.columns.find((c) => c.name === part.column);
      if (!col || !col.isText) continue;
      const chars = part.prefix ?? col.length;
      if (chars == null) continue;
      const cs = changedNames.has(col.name) ? targetCs : effective(table, col, opts.assume).charset;
      const bytes = chars * (MAXLEN[cs] ?? 4);
      total += bytes;
      const over = limit.bytes !== null && bytes > limit.bytes;
      partNotes.push(`${col.name}${part.prefix ? `(${part.prefix})` : ''} ${bytes} bytes${over ? ' OVER THE LIMIT' : ''}`);
      if (over) newPrefix.set(col.name, Math.floor(limit.bytes / (MAXLEN[cs] ?? 4)));
    }
    if (limit.bytes === 1000 && total > 1000) warnings.push(`key ${key.name}: ${total} bytes in total, over the MyISAM key length of 1000 bytes`);
    keyNotes.push(`--   ${key.kind} ${key.name}: ${partNotes.join(', ')} (limit ${limit.bytes ?? 'unknown'}: ${limit.basis})`);
    if (newPrefix.size) {
      const render = (parts, prefixes) => parts.map((p) => `${q(p.column)}${prefixes.has(p.column) ? `(${prefixes.get(p.column)})` : p.prefix ? `(${p.prefix})` : ''}`).join(', ');
      if (key.unique || key.parts.some((p) => !p.column)) {
        warnings.push(`${key.kind} ${key.name} would exceed the key limit; a shorter prefix on a unique key changes what counts as a duplicate, so this is the owner's decision (references/fixes.md); the ALTER below fails with error 1071 until it is decided`);
      } else {
        keyChanges.push(`  DROP INDEX ${q(key.name)}, ADD KEY ${q(key.name)} (${render(key.parts, newPrefix)})`);
        keyRollbacks.push(`  DROP INDEX ${q(key.name)}, ADD KEY ${q(key.name)} (${render(key.parts, new Map())})`);
        warnings.push(`KEY ${key.name} goes over the ${limit.bytes}-byte ${limit.basis}; the change below re-creates it with a prefix of ${[...newPrefix.values()].join(', ')} characters, as WordPress did for its own keys in 4.2 (references/fixes.md)`);
      }
    }
    if (key.unique) {
      const exprs = key.parts.map((p) => {
        if (!p.column) return null;
        const col = table.columns.find((c) => c.name === p.column);
        let e = p.prefix ? `LEFT(${q(p.column)}, ${p.prefix})` : q(p.column);
        if (col && changedNames.has(col.name)) e = `CONVERT(${e} USING ${targetCs}) COLLATE ${opts.target}`;
        return e;
      });
      if (exprs.includes(null)) { warnings.push(`key ${key.name} has an expression part; check it for duplicates by hand`); continue; }
      const notNull = key.parts.map((p) => `${q(p.column)} IS NOT NULL`).join(' AND ');
      uniqueChecks.push(`SELECT COUNT(*) AS ${key.name.replace(/[^A-Za-z0-9_]/g, '_')}_values_that_would_collide FROM (SELECT 1 FROM ${q(table.name)} WHERE ${notNull} GROUP BY ${exprs.join(', ')} HAVING COUNT(*) > 1) AS d;`);
    }
  }
  for (const fk of table.foreignKeys) if (fk.columns.some((c) => changedNames.has(c))) warnings.push(`foreign key ${fk.name} (${fk.columns.join(', ')}) references ${fk.refTable}: both sides need the same character set and collation; change them in one window`);
  for (const other of all) for (const fk of other.foreignKeys) if (fk.refTable === table.name && fk.refColumns.some((c) => changedNames.has(c))) warnings.push(`${other.name}.${fk.name} references a changed column; change the referencing column in the same window`);
  if (/_0900_/.test(opts.target)) warnings.push(`${opts.target} is a MySQL 8 name; MariaDB accepts it only from 11.4.5, as an alias (references/mysql-mariadb-differences.md)`);
  if (/uca1400/.test(opts.target)) warnings.push(`${opts.target} exists on MariaDB 10.10 and later only; a dump of this table will not load into MySQL or older MariaDB as it is`);

  out.push(`-- ==== ${table.name} ====`);
  out.push(`-- Now: engine ${table.engine}, default ${tableEff.charset ?? 'unknown'} / ${tableEff.collation ?? 'unknown (pass --assume-collation)'}, row format ${table.rowFormat ?? `${opts.rowFormat} (assumed)`}`);
  out.push(`-- Target: ${targetCs} / ${opts.target}; scope: ${tableScope ? 'whole table' : 'listed columns only, table default unchanged'}`);
  out.push(`-- Columns to change: ${changes.length}`);
  for (const { col, eff } of changes) out.push(`--   ${col.name} ${col.type}: ${eff.collation ?? `${eff.charset ?? 'unknown'} default (unknown collation)`} -> ${opts.target}`);
  if (keyNotes.length) { out.push('-- Keys that hold a changed column, bytes per key part after the change:'); out.push(...keyNotes); }
  for (const w of warnings) out.push(`-- WARNING: ${w}`);
  for (const s of skipped) out.push(`-- skipped ${s}`);
  out.push('');
  out.push('-- 1. Read-only checks before the change (staging first; the collision checks read the whole table):');
  out.push(`SELECT COLUMN_NAME, COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${sqlString(table.name)} AND COLLATION_NAME IS NOT NULL ORDER BY ORDINAL_POSITION;`);
  out.push(`SELECT TABLE_ROWS AS approx_rows, ROUND((DATA_LENGTH + INDEX_LENGTH) / 1048576, 1) AS size_mb FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${sqlString(table.name)};`);
  out.push(...uniqueChecks);
  out.push('');
  out.push('-- 2. Backup of this table, outside the web root, restore tested on staging (references/changes-and-rollback.md):');
  out.push(`--    wp db export /path/outside/webroot/${table.name}-before.sql --tables=${table.name} --single-transaction --add-drop-table --default-character-set=utf8mb4`);
  out.push(`--    COLLATION_REPORT_DDL_TABLES=${table.name} bash scripts/collation-report.sh --path=... > ${table.name}-definition.sql`);
  out.push('');
  out.push('-- 3. The change, after the owner approves it (the table is rebuilt; writes wait while it copies):');
  const specs = [];
  if (tableDefaultChange) specs.push(`  DEFAULT CHARACTER SET ${targetCs} COLLATE ${opts.target}`);
  for (const { col } of changes) specs.push(`  MODIFY COLUMN ${withCharset(col, targetCs, opts.target)}`);
  specs.push(...keyChanges);
  out.push(`SET SESSION lock_wait_timeout = ${opts.lockWait};`);
  out.push(`ALTER TABLE ${q(table.name)}\n${specs.join(',\n')},\n  ${LOCK_CLAUSE};`);
  if (opts.server === 'mariadb') out.push('-- MariaDB 11.2 and later: LOCK=NONE in place of LOCK=SHARED lets writes continue during the copy; the server refuses the statement if it cannot.');
  out.push('');
  out.push('-- 4. Checks after the change:');
  out.push(`SELECT COLUMN_NAME, CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${sqlString(table.name)} AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME <> ${sqlString(opts.target)};`);
  out.push(`SELECT TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${sqlString(table.name)};`);
  out.push('--    Then run the statement that failed, through WordPress (references/finding-the-query.md), and compare row counts with step 1.');
  out.push('');
  out.push('-- 5. Rollback: restores the saved definitions. If rows written after the change hold characters the old character');
  out.push('--    set cannot store, this loses them or fails; restore the table from the step 2 backup instead.');
  const back = [];
  if (tableDefaultChange && tableEff.charset) back.push(`  DEFAULT CHARACTER SET ${tableEff.charset}${tableEff.collation ? ` COLLATE ${tableEff.collation}` : ''}`);
  for (const { col, eff } of changes) {
    back.push(eff.charset && eff.collation ? `  MODIFY COLUMN ${withCharset(col, eff.charset, eff.collation)}` : `  MODIFY COLUMN ${q(col.name)} ${col.def}`);
  }
  back.push(...keyRollbacks);
  out.push(`SET SESSION lock_wait_timeout = ${opts.lockWait};`);
  out.push(`ALTER TABLE ${q(table.name)}\n${back.join(',\n')},\n  ${LOCK_CLAUSE};`);
  return out.join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(USAGE); return 0; }
  if (opts.error) { console.error(`${opts.error}\n${USAGE}`); return 2; }
  if (!existsSync(opts.file)) { console.error(`No such file: ${opts.file}`); return 2; }
  const all = parseTables(readFileSync(opts.file, 'utf8'));
  if (!all.length) { console.error('No CREATE TABLE statements found in the file.'); return 1; }
  const chosen = all.filter((t) => (!opts.tables || opts.tables.includes(t.name)) && (!opts.columns || opts.columns.some((c) => c.split('.')[0] === t.name)));
  if (!chosen.length) { console.error('None of the requested tables is in the file.'); return 1; }
  console.log('-- Proposed statements for review. Nothing has been run. Each change needs the owner\'s approval, a tested');
  console.log('-- backup, and a run on staging first (references/changes-and-rollback.md).');
  console.log(`-- Source file: ${opts.file}; tables in file: ${all.length}; tables proposed: ${chosen.length}; server: ${opts.server}`);
  for (const table of chosen) {
    console.log('');
    console.log(propose(table, all, opts));
  }
  return 0;
}

process.exitCode = main();
