import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseConfig, Session } from './index.js';

export type { SupabaseConfig, Session };

/**
 * Server-side client bound to the request's cookies, so queries run as the
 * signed-in user and row-level security applies to them exactly as it does in
 * the browser.
 */
export async function serverClient(config: SupabaseConfig) {
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session instead, so this is not a problem.
        }
      },
    },
  });
}

type AnyClient = {
  auth: { getUser: () => Promise<{ data: { user: { id: string; email?: string } | null } }> };
  from: (table: string) => any;
};

/**
 * Who is asking, and what may they do.
 *
 * Returns null when signed in without a profile — a real state worth handling
 * rather than crashing, since it is what a half-finished setup looks like.
 *
 * Reads `profiles_safe`, never `profiles`: the cost rate column is revoked on
 * the base table, so `select *` there fails by design.
 */
export async function loadSession(supabase: AnyClient): Promise<Session | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data: profile } = await supabase
    .from('profiles_safe')
    .select('id, full_name, email, org_id, role_id')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (!profile) return null;

  const { data: role } = await supabase
    .from('roles')
    .select('key, name, permissions')
    .eq('id', profile.role_id)
    .maybeSingle();

  const permissions = (role?.permissions ?? {}) as Record<string, boolean>;

  return {
    userId: profile.id,
    email: profile.email ?? auth.user.email ?? '',
    fullName: profile.full_name,
    orgId: profile.org_id,
    roleKey: role?.key ?? 'unknown',
    roleName: role?.name ?? 'No role',
    permissions,
    can: (flag: string) => permissions[flag] === true,
  };
}

/**
 * Refreshes the auth session on every request and keeps signed-out traffic off
 * the app.
 *
 * The real protection is row-level security in Postgres; this only saves a
 * signed-out user from staring at empty screens.
 */
/** How long the session check may take before the sign-in page wins instead. */
const AUTH_TIMEOUT_MS = 5000;

export async function authMiddleware(
  request: NextRequest,
  config: SupabaseConfig,
  options: { publicPaths?: string[] } = {},
) {
  const publicPaths = options.publicPaths ?? ['/login'];
  const path = request.nextUrl.pathname;
  const isPublic = publicPaths.some((p) => path === p || path.startsWith(`${p}/`));
  let response = NextResponse.next({ request });

  /*
   * A public path never asks Supabase anything.
   *
   * This used to call getUser() first and check the path afterwards, so every
   * request — including the sign-in page — made a network call before it could
   * render. When the Supabase project was paused, that call never came back,
   * Vercel killed the middleware at its limit, and the whole site answered
   * MIDDLEWARE_INVOCATION_TIMEOUT. Not even /login would load, which is the
   * one page that could have explained the problem. A signed-in user visiting
   * /login now misses a token refresh, which costs nothing: the page they go
   * to next will do it.
   */
  if (isPublic) return response;

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options: o }) => response.cookies.set(name, value, o));
      },
    },
  });

  /*
   * And it is given a deadline.
   *
   * `getUser()` has no timeout of its own, so an unreachable backend — a
   * paused project, a DNS change, an outage — hangs until the platform gives
   * up on the whole middleware. That produces a 504 with no indication of
   * which dependency is at fault. Five seconds is far longer than this call
   * takes when the backend is healthy, and far shorter than the platform's
   * patience.
   */
  const user = await Promise.race([
    supabase.auth
      .getUser()
      .then((r) => r.data.user)
      .catch(() => null),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), AUTH_TIMEOUT_MS)),
  ]);

  if (!user || user === 'timeout') {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Come back to where they were trying to go once they are in.
    url.searchParams.set('next', path);
    // Signed out and "we cannot reach the database" look identical from here
    // otherwise, and they need completely different things done about them.
    if (user === 'timeout') url.searchParams.set('unreachable', '1');
    return NextResponse.redirect(url);
  }

  return response;
}

/*
 * The matcher is deliberately NOT exported from here.
 *
 * Next.js reads `config.matcher` out of middleware.ts statically, at build
 * time, without running the module — so an imported constant fails the build
 * with "Unknown identifier". Each app writes the literal out itself; the
 * canonical pattern is:
 *
 *   '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)'
 */
