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
 * Where this person's day starts in the office app.
 *
 * Whoever assigns work gets the calendar. Everyone else who can still open
 * this app at all — a bookkeeper, say — starts at the job list, and the field
 * app is where the crew belongs.
 */
export function homeFor(session: Session): string {
  return session.can('job.assign') ? '/calendar' : '/jobs';
}
