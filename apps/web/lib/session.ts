import { redirect } from 'next/navigation';
import { loadSession, type Session } from '@promold/app-kit/server';
import { supabaseServer } from './supabase-server';

export type { Session };

export async function getSession(): Promise<Session | null> {
  return loadSession(await supabaseServer());
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/no-profile');
  return session;
}

/**
 * Where this person's day starts.
 *
 * One app serves the office and the crew, so the front door has to know which
 * one you are. Whoever assigns work gets the calendar. A bookkeeper, who sees
 * everything and schedules nothing, gets the job list. Everyone else is on
 * site, and starts at their own jobs.
 *
 * This is a courtesy, not a rule: nothing stops a technician typing /calendar,
 * and nothing needs to — the database sends them the same three rows either
 * way. It just means nobody has to learn a URL.
 */
export function homeFor(session: Session): string {
  if (session.can('job.assign')) return '/calendar';
  if (session.can('job.view_all')) return '/jobs';
  return '/my/jobs';
}
