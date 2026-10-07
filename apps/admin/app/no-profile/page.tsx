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
          <span className="mono">profiles</span>. Every screen will be empty until there is, because
          row-level security scopes all data to your organisation and that link is missing. Run the
          owner step in <span className="mono">docs/SUPABASE-SETUP.md</span> with this email, or ask
          whoever set the system up to add you.
        </p>
        <div style={{ marginTop: 14 }}>
          <SignOut />
        </div>
      </div>
    </main>
  );
}
