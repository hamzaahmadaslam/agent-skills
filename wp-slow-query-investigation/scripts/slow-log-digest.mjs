#!/usr/bin/env node
// Read-only helper. Summarizes MySQL 8.x and MariaDB slow query log files (plain or .gz): groups entries by statement
// shape, with numbers and quoted strings replaced by ?, and prints per group the count, total and share of query time,
// median, 95th percentile and maximum, lock time, rows examined and sent, MariaDB plan flags and MySQL extra counters
// when present, and the tables named.
//
// It only reads the files you give it. It writes nothing and makes no network requests. It prints no user names,
// hosts, IP addresses or literal values from the statements; the statement shapes can still name tables and columns.
// Entry formats: references/slow-query-log.md (MySQL 8.4 sql/log.cc, MariaDB 11.4 sql/log.cc).
//
// Usage:
//   node slow-log-digest.mjs <slow log file> [more files] [options]
// Options:
//   --top=N          groups to print (default 20)
//   --sort=KEY       total (default), count, avg, max, p95 or examined
//   --since=DATE     keep entries from this UTC date (YYYY-MM-DD), by each entry's SET timestamp
//   --until=DATE     keep entries before this UTC date (YYYY-MM-DD)
//   --min-time=S     ignore entries faster than S seconds
//   --width=N        characters of each statement shape to print (default 600)
//   --json           print JSON instead of text

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const USAGE = 'Usage: node slow-log-digest.mjs <slow log file> [more files] [--top=N] [--sort=total|count|avg|max|p95|examined] [--since=YYYY-MM-DD] [--until=YYYY-MM-DD] [--min-time=S] [--width=N] [--json]';

function parseArgs(argv) {
  const opts = { files: [], top: 20, sort: 'total', since: null, until: null, minTime: 0, width: 600, json: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--json') opts.json = true;
    else if (arg.startsWith('--top=')) opts.top = Number(arg.slice(6));
    else if (arg.startsWith('--sort=')) opts.sort = arg.slice(7);
    else if (arg.startsWith('--since=')) opts.since = arg.slice(8);
    else if (arg.startsWith('--until=')) opts.until = arg.slice(8);
    else if (arg.startsWith('--min-time=')) opts.minTime = Number(arg.slice(11));
    else if (arg.startsWith('--width=')) opts.width = Number(arg.slice(8));
    else if (arg.startsWith('--')) return { error: `Unknown option ${arg}` };
    else opts.files.push(arg);
  }
  if (!opts.files.length) return { error: 'Give at least one slow log file.' };
  if (!Number.isInteger(opts.top) || opts.top < 1) return { error: '--top must be a positive whole number.' };
  if (!['total', 'count', 'avg', 'max', 'p95', 'examined'].includes(opts.sort)) return { error: `Unknown --sort value ${opts.sort}` };
  if (!Number.isFinite(opts.minTime) || opts.minTime < 0) return { error: '--min-time must be a number of seconds.' };
  if (!Number.isInteger(opts.width) || opts.width < 40) return { error: '--width must be 40 or more.' };
  for (const key of ['since', 'until']) {
    if (opts[key] !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(opts[key])) return { error: `--${key} must be YYYY-MM-DD.` };
      opts[key] = Date.parse(`${opts[key]}T00:00:00Z`) / 1000;
    }
  }
  return opts;
}

// Replace quoted strings with ?, drop comments, keep identifiers, then mask numbers and collapse value lists.
export function fingerprint(sql) {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "'" || c === '"') {
      i += 1;
      while (i < n) {
        if (sql[i] === '\\') { i += 2; continue; }
        if (sql[i] === c) {
          if (sql[i + 1] === c) { i += 2; continue; }
          break;
        }
        i += 1;
      }
      i += 1;
      out += ' ? ';
      continue;
    }
    if (c === '`') {
      const end = sql.indexOf('`', i + 1);
      out += end === -1 ? sql.slice(i + 1) : sql.slice(i + 1, end);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      out += ' ';
      continue;
    }
    if (c === '#' || (c === '-' && next === '-' && (i + 2 >= n || /\s/.test(sql[i + 2])))) {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    out += c;
    i += 1;
  }
  return out
    .replace(/\b0x[0-9a-f]+\b/gi, '?')
    .replace(/(^|[^\w.])-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(?![\w])/gi, '$1?')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\(\s*\?\s*(?:,\s*\?\s*)+\)/g, '(?+)')
    .replace(/(?:\(\?\+\)\s*,\s*)+\(\?\+\)/g, '(?+)')
    .replace(/;$/, '')
    .trim();
}

function tablesIn(shape) {
  const tables = new Set();
  const re = /\b(?:from|join|update|into)\s+([a-z0-9_$.]+)/g;
  let m;
  while ((m = re.exec(shape)) !== null) {
    const name = m[1].split('.').pop();
    if (name && name !== '?' && !/^(select|dual)$/.test(name)) tables.add(name);
  }
  return [...tables];
}

function newEntry() {
  return { fields: {}, lines: [], admin: null, ts: null, schema: null, hasQueryTime: false };
}

async function readFile(file, onLine) {
  const input = createReadStream(file);
  const stream = file.endsWith('.gz') ? input.pipe(createGunzip()) : input;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let count = 0;
  for await (const raw of rl) {
    count += 1;
    onLine(raw.replace(/\r$/, ''));
  }
  return count;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

const FLAG_FIELDS = ['Full_scan', 'Full_join', 'Tmp_table_on_disk', 'Filesort', 'Filesort_on_disk'];

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(USAGE); return 0; }
  if (opts.error) { console.error(`${opts.error}\n${USAGE}`); return 1; }
  for (const file of opts.files) {
    if (!existsSync(file) || !statSync(file).isFile()) { console.error(`No such file: ${file}`); return 1; }
  }

  const groups = new Map();
  const totals = { parsed: 0, skippedNoTime: 0, skippedFilter: 0, noTimestamp: 0, lines: 0, first: null, last: null, seconds: 0 };
  let entry = newEntry();

  const finish = () => {
    const e = entry;
    entry = newEntry();
    const statement = e.admin !== null ? `administrator command: ${e.admin}` : e.lines.join('\n').trim();
    if (!statement && !e.hasQueryTime) return;
    if (!e.hasQueryTime || !statement) { totals.skippedNoTime += 1; return; }
    const qt = Number(e.fields.Query_time);
    if (!Number.isFinite(qt)) { totals.skippedNoTime += 1; return; }
    if (qt < opts.minTime) { totals.skippedFilter += 1; return; }
    if (e.ts === null) totals.noTimestamp += 1;
    if (e.ts !== null && ((opts.since !== null && e.ts < opts.since) || (opts.until !== null && e.ts >= opts.until))) {
      totals.skippedFilter += 1;
      return;
    }
    totals.parsed += 1;
    totals.seconds += qt;
    if (e.ts !== null) {
      totals.first = totals.first === null ? e.ts : Math.min(totals.first, e.ts);
      totals.last = totals.last === null ? e.ts : Math.max(totals.last, e.ts);
    }
    const shape = fingerprint(statement);
    let g = groups.get(shape);
    if (!g) {
      g = { shape, times: [], lock: 0, examined: 0, examinedMax: 0, sent: 0, affected: 0, flags: {}, extra: { Read_rnd_next: 0, Created_tmp_disk_tables: 0, Sort_merge_passes: 0 }, schemas: new Set(), first: null, last: null };
      groups.set(shape, g);
    }
    const num = (k) => (Number.isFinite(Number(e.fields[k])) ? Number(e.fields[k]) : 0);
    g.times.push(qt);
    g.lock += num('Lock_time');
    g.examined += num('Rows_examined');
    g.examinedMax = Math.max(g.examinedMax, num('Rows_examined'));
    g.sent += num('Rows_sent');
    g.affected += num('Rows_affected');
    for (const f of FLAG_FIELDS) if (e.fields[f] === 'Yes') g.flags[f] = (g.flags[f] || 0) + 1;
    for (const k of Object.keys(g.extra)) if (num(k) > 0) g.extra[k] += 1;
    const schema = e.schema || e.fields.Schema;
    if (schema) g.schemas.add(schema);
    if (e.ts !== null) {
      g.first = g.first === null ? e.ts : Math.min(g.first, e.ts);
      g.last = g.last === null ? e.ts : Math.max(g.last, e.ts);
    }
  };

  let lastSchema = null;
  const onLine = (line) => {
    if (/^\S.*, Version: .*started with:\s*$/.test(line) || /^(Tcp port|TCP Port): /.test(line) || /^Time\s+Id\s+Command\s+Argument\s*$/.test(line)) {
      finish();
      return;
    }
    if (line.startsWith('#')) {
      const isStart = /^# (Time|User@Host|Query_time):/.test(line);
      // Inside a statement, only the header of the next entry ends it; other # lines are part of the statement.
      if (entry.lines.length && !isStart) { entry.lines.push(line); return; }
      if (entry.lines.length || entry.admin !== null || (isStart && entry.hasQueryTime)) finish();
      if (/^# (Time|User@Host):/.test(line)) return; // time comes from SET timestamp; user and host are never kept
      const admin = line.match(/^# administrator command: (.*?);?\s*$/);
      if (admin) { entry.admin = admin[1]; return; }
      if (/^# explain:/.test(line) || /^# Warnings/.test(line)) return;
      for (const m of line.matchAll(/([A-Za-z_]+):\s+(\S+)/g)) entry.fields[m[1]] = m[2];
      if (entry.fields.Query_time !== undefined) entry.hasQueryTime = true;
      return;
    }
    const use = line.match(/^use\s+`?([^`;]+)`?;\s*$/i);
    if (use && !entry.lines.length) { lastSchema = use[1]; entry.schema = use[1]; return; }
    const ts = line.match(/^SET\s+(?:last_insert_id=\d+,)?(?:insert_id=\d+,)?timestamp=(\d+);\s*$/i);
    if (ts && !entry.lines.length) { entry.ts = Number(ts[1]); if (!entry.schema) entry.schema = lastSchema; return; }
    if (!entry.hasQueryTime && !entry.lines.length && !line.trim()) return;
    entry.lines.push(line);
  };

  const fileInfo = [];
  for (const file of opts.files) {
    lastSchema = null;
    const lines = await readFile(file, onLine);
    finish();
    totals.lines += lines;
    fileInfo.push({ file, lines });
  }

  const list = [...groups.values()].map((g) => {
    const sorted = [...g.times].sort((a, b) => a - b);
    const count = sorted.length;
    const total = sorted.reduce((s, t) => s + t, 0);
    return {
      shape: g.shape,
      count,
      total_s: total,
      share: totals.seconds ? total / totals.seconds : 0,
      avg_s: total / count,
      median_s: percentile(sorted, 50),
      p95_s: percentile(sorted, 95),
      max_s: sorted[count - 1],
      lock_avg_ms: (g.lock / count) * 1000,
      rows_examined_avg: g.examined / count,
      rows_examined_max: g.examinedMax,
      rows_examined_total: g.examined,
      rows_sent_avg: g.sent / count,
      rows_affected_total: g.affected,
      plan_flags: g.flags,
      mysql_extra_entries: Object.fromEntries(Object.entries(g.extra).filter(([, v]) => v > 0)),
      tables: tablesIn(g.shape),
      schemas: [...g.schemas],
      first: g.first,
      last: g.last,
    };
  });
  const key = { total: 'total_s', count: 'count', avg: 'avg_s', max: 'max_s', p95: 'p95_s', examined: 'rows_examined_total' }[opts.sort];
  list.sort((a, b) => b[key] - a[key] || b.total_s - a.total_s);
  const top = list.slice(0, opts.top);
  const iso = (t) => (t === null ? null : new Date(t * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''));

  if (opts.json) {
    console.log(JSON.stringify({
      files: fileInfo,
      entries: totals.parsed,
      skipped_without_query_time: totals.skippedNoTime,
      skipped_by_filters: totals.skippedFilter,
      entries_without_timestamp: totals.noTimestamp,
      first_utc: iso(totals.first),
      last_utc: iso(totals.last),
      total_query_s: Number(totals.seconds.toFixed(6)),
      groups: list.length,
      sort: opts.sort,
      top: top.map((g, i) => ({ rank: i + 1, ...g, first: iso(g.first), last: iso(g.last) })),
    }, null, 2));
    return 0;
  }

  const fmtS = (s) => (s >= 10 ? s.toFixed(1) : s >= 1 ? s.toFixed(2) : s.toFixed(3));
  const fmtN = (v) => Math.round(v).toLocaleString('en-US');
  const out = [];
  out.push('Slow query digest (read-only; literals masked, no users or hosts)');
  out.push(`Files: ${fileInfo.map((f) => `${f.file} (${f.lines} lines)`).join(', ')}`);
  out.push(`Entries: ${totals.parsed} summarized, ${totals.skippedNoTime} without a Query_time line, ${totals.skippedFilter} left out by filters, ${totals.noTimestamp} without SET timestamp`);
  out.push(`Time span (UTC, from SET timestamp): ${iso(totals.first) || 'unknown'} to ${iso(totals.last) || 'unknown'}`);
  out.push(`Total query time: ${fmtS(totals.seconds)} s in ${list.length} statement shapes; sorted by ${opts.sort}, top ${top.length}`);
  top.forEach((g, i) => {
    out.push('');
    out.push(`#${i + 1}  total ${fmtS(g.total_s)} s (${(g.share * 100).toFixed(1)}%)  count ${g.count}  median ${fmtS(g.median_s)} s  p95 ${fmtS(g.p95_s)} s  max ${fmtS(g.max_s)} s  lock avg ${g.lock_avg_ms.toFixed(1)} ms`);
    const ratio = g.rows_sent_avg > 0 ? `  examined per row sent ${fmtN(g.rows_examined_avg / g.rows_sent_avg)}` : '';
    out.push(`    rows examined avg ${fmtN(g.rows_examined_avg)} (max ${fmtN(g.rows_examined_max)})  rows sent avg ${fmtN(g.rows_sent_avg)}${ratio}${g.rows_affected_total ? `  rows affected total ${fmtN(g.rows_affected_total)}` : ''}`);
    const flags = [
      ...Object.entries(g.plan_flags).map(([k, v]) => `${k} ${v}`),
      ...Object.entries(g.mysql_extra_entries).map(([k, v]) => `${k}>0 in ${v}`),
    ];
    if (flags.length) out.push(`    flags (entries): ${flags.join(', ')}`);
    out.push(`    tables: ${g.tables.join(', ') || '-'}  schema: ${g.schemas.join(', ') || '-'}  first ${iso(g.first) || '-'}  last ${iso(g.last) || '-'}`);
    const text = g.shape.length > opts.width ? `${g.shape.slice(0, opts.width)} ...` : g.shape;
    out.push(`    ${text}`);
  });
  console.log(out.join('\n'));
  return 0;
}

main().then((code) => { process.exitCode = code; }).catch((err) => {
  console.error(`Could not read the log: ${err.message}`);
  process.exitCode = 1;
});
