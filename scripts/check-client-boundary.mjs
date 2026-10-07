#!/usr/bin/env node
/**
 * Does a server page call a function that lives in a client component?
 *
 * This exists for the same reason `check-db-calls.mjs` does: TypeScript cannot
 * see it. A server component importing a function from a `'use client'` module
 * typechecks, builds, and then fails the moment somebody opens the page with
 *
 *   Error: Attempted to call draftFromJob() from the server but draftFromJob
 *   is on the client.
 *
 * It happened. `app/jobs/[id]/page.tsx` called `draftFromJob()` out of
 * `components/job-form.tsx`, and the office job editor — the screen for
 * editing a job, shown only to the people who can edit jobs — rendered
 * nothing for any of them. Nothing in the check suite noticed, because the
 * types crossing that boundary are erased at compile time and were never the
 * problem.
 *
 * What is allowed across the boundary, and what this ignores:
 *
 *   - Rendering a client Component. That is the whole point of them, and a
 *     capitalised binding is taken to be one.
 *   - `import type`, and named type imports inside a braced list. Erased.
 *
 * What it flags: a lowercase value imported from a `'use client'` module into
 * a file that is not itself a client component. Move it to `lib/`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const APPS = ['apps/admin', 'apps/field'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const isClient = (file) => {
  try {
    return /^\s*['"]use client['"]/.test(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
};

/** `@/x` and `./x` to a real file, trying the extensions Next resolves. */
function resolveImport(spec, fromFile, appDir) {
  const base = spec.startsWith('@/')
    ? join(appDir, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(dirname(fromFile), spec)
      : null;
  if (!base) return null;
  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, 'index.tsx'),
    join(base, 'index.ts'),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep trying */
    }
  }
  return null;
}

const problems = [];
let checked = 0;

for (const app of APPS) {
  const appDir = join(ROOT, app);
  for (const file of walk(appDir)) {
    if (isClient(file)) continue;
    const src = readFileSync(file, 'utf8');

    for (const m of src.matchAll(/import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
      const [, clause, spec] = m;
      if (clause.trimStart().startsWith('type ')) continue;

      const target = resolveImport(spec, file, appDir);
      if (!target || !isClient(target)) continue;
      checked++;

      const braced = clause.match(/\{([^}]*)\}/);
      if (!braced) continue;
      for (const raw of braced[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (!name || name.startsWith('type ')) continue;
        // A component is legal to import and render; a plain function is not.
        if (/^[A-Z]/.test(name)) continue;
        problems.push(
          `${file.replace(`${ROOT}/`, '')}: imports ${name}() from ${spec}, ` +
            `which is a client component. Calling it while rendering on the ` +
            `server throws. Move ${name} to lib/.`,
        );
      }
    }
  }
}

if (problems.length) {
  console.error(`\nServer code calling into client components:\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('');
  process.exit(1);
}

console.log(
  `Checked ${checked} import${checked === 1 ? '' : 's'} from server files into client components. ` +
    `None of them pull a function across.`,
);
