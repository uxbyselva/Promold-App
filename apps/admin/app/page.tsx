import { redirect } from 'next/navigation';
import { getSession, homeFor } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await getSession();
  if (!session) redirect('/no-profile');
  redirect(homeFor(session));
}
