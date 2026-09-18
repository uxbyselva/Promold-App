import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase-server';

export interface Session {
  userId: string;
  email: string;
  fullName: string;
  orgId: string;
  roleKey: string;
  roleName: string;
  permissions: Record<string, boolean>;
  /** Mirrors has_permission() in SQL. The database still decides; this only
   *  shapes what the UI offers. */
  can: (flag: string) => boolean;
}

/**
 * Who is asking, and what may they do.
 *
 * Returns null when signed in without a profile — a real state worth handling
 * rather than crashing, since it is what a half-finished setup looks like.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await supabaseServer();
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
 * Where this person's day starts.
 *
 * Decided by what they may do, not by their job title and not by their
 * screen size: whoever assigns work gets the dispatch board, everyone else
 * gets the field view. A manager on a phone still wants the board; a crew
 * lead at a desk still wants their own jobs.
 */
export function homeFor(session: Session): string {
  return session.can('job.assign') ? '/dispatch' : '/jobs';
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/no-profile');
  return session;
}
