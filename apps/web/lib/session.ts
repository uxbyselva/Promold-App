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
 * one you are. The office gets the dashboard — what is waiting on a decision
 * and what has gone quiet. The crew get their own day, in their own shell.
 *
 * This is a courtesy, not a rule: nothing stops a technician typing /calendar,
 * and nothing needs to — the database sends them the same three rows either
 * way. It just means nobody has to learn a URL.
 */
export function homeFor(session: Session): string {
  // Anybody who can see the whole board gets the dashboard: what needs them
  // today, with the calendar and the board one tap away. Everyone else is on
  // site, and starts on their own day.
  if (session.can('job.view_all')) return '/';
  return '/my';
}
