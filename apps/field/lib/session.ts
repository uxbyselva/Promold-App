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
