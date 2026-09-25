#!/usr/bin/env node
/**
 * Every database call the apps make, checked against the real schema.
 *
 * TypeScript cannot see Postgres. A mistyped RPC name, a renamed parameter or
 * a column that never existed all compile perfectly and fail only when
 * somebody opens the page — which, for a screen nobody has opened yet, means
 * failing in front of the crew.
 *
 * This reads the call sites out of the source and asks the database whether
 * each one is real. It is not a substitute for running the app; it is the
 * part of running the app that can be automated.
 *
 * Usage: node scripts/check-db-calls.mjs   (needs PG* pointing at a built database)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOTS = ['apps/admin', 'apps/field', 'packages/app-kit'];

function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx)$/.test(path)) out.push(path);
  }
  return out;
}

const files = ROOTS.flatMap((r) => sources(r));

// --- what the code asks for -------------------------------------------------

// Each entry is { what, where } so a finding points at one line, not at every
// file that happens to touch the same table.
const rpcCalls = [];
const columnRefs = [];
const unchecked = [];

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

for (const file of files) {
  const text = readFileSync(file, 'utf8');

  // .rpc('name', { p_a: …, p_b: … })   — the argument object may span lines.
  for (const m of text.matchAll(/\.rpc\(\s*'([a-z0-9_]+)'\s*(?:,\s*\{([\s\S]*?)\})?\s*\)/g)) {
    const [, name, argBlock = ''] = m;
    const args = [...argBlock.matchAll(/^\s*(p_[a-z0-9_]+)\s*:/gm)].map((a) => a[1]);
    rpcCalls.push({ name, args, where: `${file}:${lineOf(text, m.index)}` });
  }

  // .from('table').select('a, b, c')  — only the plain column lists; embedded
  // resource syntax (table!inner(...)) is skipped rather than half-parsed.
  for (const m of text.matchAll(/\.from\(\s*'([a-z0-9_]+)'\s*\)\s*\.select\(\s*'([^']*)'/g)) {
    const [, table, cols] = m;
    const where = `${file}:${lineOf(text, m.index)}`;
    if (cols.includes('(')) {
      // Embedded resource syntax — table!inner(col, col). Parsing it properly
      // means resolving the relationship, so it is reported as unchecked
      // rather than quietly skipped.
      unchecked.push(`${table} select with an embedded join  — ${where}`);
      continue;
    }
    for (const raw of cols.split(',')) {
      const col = raw.trim().split(':')[0].trim();
      if (col && col !== '*' && /^[a-z0-9_]+$/.test(col)) {
        columnRefs.push({ table, col, where });
      }
    }
  }

  // .from('table').insert({...}) / .update({...}) — the keys are columns too.
  for (const m of text.matchAll(
    /\.from\(\s*'([a-z0-9_]+)'\s*\)\s*\.(?:insert|update)\(\s*\{([\s\S]*?)\}\s*\)/g,
  )) {
    const [, table, block] = m;
    const where = `${file}:${lineOf(text, m.index)}`;
    for (const a of block.matchAll(/^\s*([a-z][a-z0-9_]*)\s*:/gm)) {
      columnRefs.push({ table, col: a[1], where });
    }
  }

  // .eq('col', …) / .is('col', …) and friends filter on a column too, and a
  // filter on a column the relation does not have fails exactly like a select
  // on one. This is the bug that got the customers page.
  // The chain runs until the NEXT .from(, which is what keeps a filter with
  // its own query. Reading a fixed number of characters instead spills across
  // the queries inside a Promise.all and blames the wrong table — which is
  // what the first version of this did, loudly and wrongly.
  for (const m of text.matchAll(
    /\.from\(\s*'([a-z0-9_]+)'\s*\)((?:(?!\.from\()[\s\S]){0,700})/g,
  )) {
    const [, table, chain] = m;
    for (const f of chain.matchAll(/\.(?:eq|neq|gt|gte|lt|lte|is|in|like|ilike)\(\s*'([a-z0-9_]+)'/g)) {
      columnRefs.push({ table, col: f[1], where: `${file}:${lineOf(text, m.index + f.index)}` });
    }
  }
}

// --- what the database has --------------------------------------------------

const psql = (sql) =>
  execFileSync('psql', ['-d', process.env.VERIFY_DB || 'promold_verify', '-tAc', sql], {
    encoding: 'utf8',
  }).trim();

const dbFunctions = new Map();
for (const line of psql(
  `select p.proname || '|' || coalesce(array_to_string(p.proargnames, ','), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'`,
).split('\n')) {
  const [name, argnames] = line.split('|');
  if (!dbFunctions.has(name)) dbFunctions.set(name, new Set());
  argnames.split(',').filter(Boolean).forEach((a) => dbFunctions.get(name).add(a));
}

const dbColumns = new Map();
for (const line of psql(
  `select table_name || '|' || column_name from information_schema.columns
    where table_schema = 'public'`,
).split('\n')) {
  const [table, column] = line.split('|');
  if (!dbColumns.has(table)) dbColumns.set(table, new Set());
  dbColumns.get(table).add(column);
}

// --- compare ----------------------------------------------------------------

const problems = [];

for (const { name, args, where } of rpcCalls) {
  if (!dbFunctions.has(name)) {
    problems.push(`${where}  RPC ${name}() does not exist`);
    continue;
  }
  for (const arg of args) {
    if (!dbFunctions.get(name).has(arg)) {
      problems.push(`${where}  RPC ${name}() has no argument ${arg}`);
    }
  }
}

for (const { table, col, where } of columnRefs) {
  if (!dbColumns.has(table)) {
    problems.push(`${where}  relation ${table} does not exist`);
    continue;
  }
  if (!dbColumns.get(table).has(col)) {
    problems.push(`${where}  ${table}.${col} does not exist`);
  }
}

const distinct = (list, key) => new Set(list.map(key)).size;
console.log(
  `Checked ${rpcCalls.length} calls to ${distinct(rpcCalls, (c) => c.name)} database functions ` +
    `and ${columnRefs.length} column references across ` +
    `${distinct(columnRefs, (c) => c.table)} tables/views, in ${files.length} source files.`,
);
if (unchecked.length) {
  console.log(`\n${unchecked.length} not checked (verify these by hand):`);
  [...new Set(unchecked)].sort().forEach((u) => console.log(`  ${u}`));
}

if (problems.length === 0) {
  console.log('Every call the apps make matches the schema.');
  process.exit(0);
}

console.error(`\n${problems.length} problem(s):\n`);
problems.sort().forEach((p) => console.error(`  ${p}`));
process.exit(1);
