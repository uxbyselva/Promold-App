#!/usr/bin/env node
/**
 * A Supabase stand-in for a container with no Docker.
 *
 * `supabase start` needs a Docker daemon. Claude Code on the web has none, so
 * for a long time the only way to see the app work was to deploy it, and the
 * only way to find a rendering bug was for somebody to open the page. This
 * serves the two Supabase endpoints the app actually talks to, against the
 * local Postgres that `pnpm db:verify` already uses:
 *
 *   /auth/v1/*    sign-in, the current user, sign-out
 *   /rest/v1/*    the PostgREST subset this app's queries use
 *
 * It is not PostgREST. It is enough of PostgREST to render every page in this
 * repository, which is the job.
 *
 * **It is still the real database, and still the real rules.** Every request
 * runs as `authenticated` with the caller's id in `request.jwt.claim.sub`, so
 * row-level security, the masking views and every permission check apply
 * exactly as they do in production. A bug in a policy shows up here.
 *
 * Any password is accepted. It is a development stand-in and the database it
 * talks to is seed data.
 *
 *   node scripts/dev-stack.mjs --db promold_demo --port 3400
 */
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import pg from 'pg';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const DB = arg('db', 'promold_demo');
const PORT = Number(arg('port', 3400));
const SECRET = 'dev-stack-local-only-never-use-this-anywhere-real';

/*
 * node-postgres hands back `numeric` and `bigint` as strings, to protect
 * precision. PostgREST serialises them as JSON numbers, and the app is
 * written against that: a price compared with `< 0`, a count used in
 * arithmetic. Leaving them as strings produces screens that look right and
 * are quietly wrong, which is the worst kind of stand-in.
 */
pg.types.setTypeParser(1700, Number); // numeric
pg.types.setTypeParser(20, Number); // int8

const pool = new pg.Pool({
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 54322),
  user: process.env.PGUSER ?? 'postgres',
  database: DB,
  max: 8,
});

// --- tokens ----------------------------------------------------------------
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (payload) => {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const mac = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${mac}`;
};
const claims = (token) => {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  } catch {
    return null;
  }
};

/** The caller's user id, from the bearer token. Anonymous when there is none. */
function subject(req) {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const c = claims(auth.slice(7));
  return c?.sub ?? null;
}

/**
 * Run SQL as the signed-in user.
 *
 * `set local role authenticated` plus the jwt claim is exactly how PostgREST
 * does it, which is why the policies behave the same.
 */
async function asUser(sub, run) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [sub ?? '']);
    await client.query(`set local role ${sub ? 'authenticated' : 'anon'}`);
    const out = await run(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// --- the PostgREST subset --------------------------------------------------
const OPS = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'like',
  ilike: 'ilike',
};

const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

/**
 * `select=id,name,other!inner(a,b)` → a column list, with any embedded
 * resource turned into a correlated json sub-select. Only the `!inner` shape
 * this repository uses is handled; anything else is left to fail loudly
 * rather than quietly return the wrong rows.
 */
function selectList(select, table) {
  if (!select || select === '*') return '*';
  const parts = [];
  let depth = 0;
  let buf = '';
  for (const ch of select) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
    } else buf += ch;
  }
  if (buf) parts.push(buf);

  return parts
    .map((raw) => {
      const p = raw.trim();
      const embed = p.match(/^([a-z0-9_]+)(!inner)?\(([^)]*)\)$/i);
      if (!embed) return ident(p);
      const [, child, , cols] = embed;
      // The FK is <child-singular>_id on this table, which is the convention
      // throughout this schema.
      const fk = `${child.replace(/s$/, '')}_id`;
      const inner = cols
        .split(',')
        .map((c) => `'${c.trim()}', c.${ident(c.trim())}`)
        .join(', ');
      return `(select json_build_object(${inner}) from ${ident(child)} c
               where c.id = ${ident(table)}.${ident(fk)}) as ${ident(child)}`;
    })
    .join(', ');
}

function buildQuery(table, params, { count } = {}) {
  const where = [];
  const vals = [];
  let order = '';
  let limit = '';

  for (const [key, value] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
    const m = String(value).match(/^([a-z]+)\.(.*)$/s);
    if (!m) continue;
    const [, op, rest] = m;
    if (op === 'is') {
      where.push(`${ident(key)} is ${rest === 'null' ? 'null' : 'not null'}`);
    } else if (op === 'in') {
      const list = rest.replace(/^\(|\)$/g, '');
      const items = list ? list.split(',').map((x) => x.replace(/^"|"$/g, '')) : [];
      if (items.length === 0) {
        where.push('false');
      } else {
        const ph = items.map((v) => {
          vals.push(v);
          return `$${vals.length}`;
        });
        where.push(`${ident(key)} in (${ph.join(',')})`);
      }
    } else if (OPS[op]) {
      vals.push(rest);
      where.push(`${ident(key)} ${OPS[op]} $${vals.length}`);
    }
  }

  const ord = params.get('order');
  if (ord) {
    order =
      ' order by ' +
      ord
        .split(',')
        .map((o) => {
          const [col, ...mods] = o.split('.');
          const dir = mods.includes('desc') ? 'desc' : 'asc';
          const nulls = mods.includes('nullslast') ? ' nulls last' : '';
          return `${ident(col)} ${dir}${nulls}`;
        })
        .join(', ');
  }
  const lim = params.get('limit');
  if (lim) limit = ` limit ${Number(lim)}`;

  const cols = count ? 'count(*)::int as count' : selectList(params.get('select'), table);
  const sql =
    `select ${cols} from ${ident(table)}` +
    (where.length ? ` where ${where.join(' and ')}` : '') +
    (count ? '' : order + limit);
  return { sql, vals };
}

const json = (res, code, body, headers = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    // Without this the browser assumes GET, POST and HEAD and refuses the
    // preflight for anything else — so every PATCH and DELETE the app makes
    // failed here with a CORS error and never reached the handlers below,
    // which have supported them all along. Editing a job, editing a customer,
    // answering time off and changing a role are all PATCH: none of them
    // could be checked against a running app, by the one tool built to check
    // exactly that.
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'access-control-expose-headers': 'content-range',
    ...headers,
  });
  res.end(payload);
};

const readBody = (req) =>
  new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : null);
      } catch {
        resolve(null);
      }
    });
  });

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, null);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // --- auth ---------------------------------------------------------------
    if (path === '/auth/v1/token') {
      const body = await readBody(req);
      const { rows } = await pool.query('select id, email from auth.users where email = $1', [
        body?.email ?? '',
      ]);
      if (!rows.length) {
        return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      }
      const user = {
        id: rows[0].id,
        email: rows[0].email,
        aud: 'authenticated',
        role: 'authenticated',
        app_metadata: { provider: 'email' },
        user_metadata: {},
      };
      const exp = Math.floor(Date.now() / 1000) + 3600;
      return json(res, 200, {
        access_token: sign({ sub: user.id, email: user.email, role: 'authenticated', exp }),
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: exp,
        refresh_token: `refresh-${user.id}`,
        user,
      });
    }

    if (path === '/auth/v1/user') {
      const sub = subject(req);
      if (!sub) return json(res, 401, { message: 'invalid claim' });
      const { rows } = await pool.query('select id, email from auth.users where id = $1', [sub]);
      if (!rows.length) return json(res, 401, { message: 'user not found' });
      return json(res, 200, {
        id: rows[0].id,
        email: rows[0].email,
        aud: 'authenticated',
        role: 'authenticated',
        app_metadata: { provider: 'email' },
        user_metadata: {},
      });
    }

    if (path === '/auth/v1/logout') return json(res, 204, null);

    // --- rest ---------------------------------------------------------------
    if (path.startsWith('/rest/v1/')) {
      const sub = subject(req);
      const rest = path.slice('/rest/v1/'.length);

      if (rest.startsWith('rpc/')) {
        const fn = rest.slice(4);
        const args = (await readBody(req)) ?? {};
        const names = Object.keys(args);
        const argList = names.length
          ? names.map((n, i) => `${ident(n)} => $${i + 1}`).join(', ')
          : '';

        /*
         * A function that returns a table is called in the FROM clause and
         * answers with an array of rows; a scalar one is called in the SELECT
         * list and answers with a value. PostgREST makes that distinction and
         * so must this, or `audit_feed()` comes back as one composite and the
         * page that maps over it dies with "t.map is not a function".
         */
        const meta = await pool.query(
          'select proretset from pg_proc where proname = $1 order by oid limit 1',
          [fn],
        );
        const setReturning = meta.rows[0]?.proretset === true;
        /*
         * `to_jsonb` on the scalar branch, because a function returning a
         * composite — `create_job` returns a whole `jobs` row — comes back
         * from node-postgres as the Postgres literal "(uuid,...)" while
         * PostgREST serialises it to a JSON object. Without this the app
         * books the job, reads `data.id` as undefined and redirects to
         * /jobs/undefined. It is also right for the simple cases: a text[]
         * becomes a JSON array, a numeric a JSON number.
         */
        const call = setReturning
          ? `select * from ${ident(fn)}(${argList})`
          : `select to_jsonb(${ident(fn)}(${argList})) as r`;

        const out = await asUser(sub, (c) => c.query(call, names.map((n) => args[n])));
        if (setReturning) return json(res, 200, out.rows);
        const value = out.rows[0]?.r ?? null;
        return json(res, 200, value);
      }

      const table = rest;
      const prefer = String(req.headers.prefer ?? '');

      if (req.method === 'GET') {
        const { sql, vals } = buildQuery(table, url.searchParams);
        const out = await asUser(sub, (c) => c.query(sql, vals));
        const single = /vnd\.pgrst\.object/.test(String(req.headers.accept ?? ''));
        if (single) {
          if (out.rows.length === 1) return json(res, 200, out.rows[0]);
          if (out.rows.length === 0) return json(res, 200, null);
          return json(res, 406, { message: 'more than one row returned' });
        }
        return json(res, 200, out.rows, {
          'content-range': `0-${Math.max(out.rows.length - 1, 0)}/${out.rows.length}`,
        });
      }

      if (req.method === 'POST') {
        const body = await readBody(req);
        const rowsIn = Array.isArray(body) ? body : [body];
        const cols = Object.keys(rowsIn[0] ?? {});
        const vals = [];
        const tuples = rowsIn.map(
          (r) =>
            `(${cols
              .map((c) => {
                vals.push(r[c]);
                return `$${vals.length}`;
              })
              .join(', ')})`,
        );
        const sql =
          `insert into ${ident(table)} (${cols.map(ident).join(', ')}) values ${tuples.join(', ')}` +
          (prefer.includes('representation') ? ' returning *' : '');
        const out = await asUser(sub, (c) => c.query(sql, vals));
        return json(res, 201, prefer.includes('representation') ? out.rows : null);
      }

      if (req.method === 'PATCH') {
        const body = (await readBody(req)) ?? {};
        const cols = Object.keys(body);
        const vals = cols.map((c) => body[c]);
        const sets = cols.map((c, i) => `${ident(c)} = $${i + 1}`);
        const { sql: q, vals: wv } = buildQuery(table, url.searchParams);
        const whereClause = q.includes(' where ') ? q.slice(q.indexOf(' where ')) : '';
        const shifted = whereClause.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + cols.length}`);
        const sql =
          `update ${ident(table)} set ${sets.join(', ')}${shifted}` +
          (prefer.includes('representation') ? ' returning *' : '');
        const out = await asUser(sub, (c) => c.query(sql, [...vals, ...wv]));
        return json(res, 200, prefer.includes('representation') ? out.rows : null);
      }

      if (req.method === 'DELETE') {
        const { sql: q, vals } = buildQuery(table, url.searchParams);
        const whereClause = q.includes(' where ') ? q.slice(q.indexOf(' where ')) : '';
        await asUser(sub, (c) => c.query(`delete from ${ident(table)}${whereClause}`, vals));
        return json(res, 204, null);
      }
    }

    return json(res, 404, { message: 'not handled by the dev stack', path });
  } catch (e) {
    // Shaped like a Postgres error so the app's refusal messages still read
    // the way they will in production.
    return json(res, 400, {
      message: e.message,
      code: e.code ?? null,
      details: e.detail ?? null,
      hint: e.hint ?? null,
    });
  }
});

server.listen(PORT, () => {
  console.log(`dev stack on http://127.0.0.1:${PORT}  (database ${DB})`);
  console.log(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${PORT}`);
  console.log(`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_dev_stack`);
});
