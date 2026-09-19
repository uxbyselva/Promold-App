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
export async function authMiddleware(
  request: NextRequest,
  config: SupabaseConfig,
  options: { publicPaths?: string[] } = {},
) {
  const publicPaths = options.publicPaths ?? ['/login'];
  let response = NextResponse.next({ request });

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

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = publicPaths.some((p) => path === p || path.startsWith(`${p}/`));

  if (!data.user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Come back to where they were trying to go once they are in.
    url.searchParams.set('next', path);
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
