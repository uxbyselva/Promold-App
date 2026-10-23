import { supabaseServer } from '@/lib/supabase-server';
import { SignOut } from '@/components/sign-out';

export const dynamic = 'force-dynamic';

export default async function NoProfile() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  return (
    <main style={{ padding: 24, display: 'grid', placeItems: 'center', minHeight: '100%' }}>
      <div className="card" style={{ padding: 22, maxWidth: 540 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 19, fontWeight: 600 }}>
          No profile for this login
        </h1>
        <p className="note">
          You are signed in as <b>{data.user?.email}</b>, but there is no matching row in{' '}
          <span className="mono">profiles</span>. Signing in and being known here are two different
          things: row-level security scopes every screen to an organisation, and the profile row is
          where that comes from — so until one exists, every page is empty.
        </p>
        <p className="note">
          Whoever set the system up fixes this by running{' '}
          <span className="mono">supabase/add-a-person.sql</span> with this email. If that is you,
          edit the three values at the top of it and run it in the Supabase SQL editor. Do not
          re-run the owner step from the setup guide — that makes a second organisation, which gives
          you a login that shares nothing with anybody.
        </p>
        <div style={{ marginTop: 14 }}>
          <SignOut />
        </div>
      </div>
    </main>
  );
}
