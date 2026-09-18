import { supabaseServer } from '@/lib/supabase-server';
import { SignOut } from '@/components/sign-out';
import { Board } from '@/components/board';

export const dynamic = 'force-dynamic';

export default async function Dispatch({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const day = date ?? new Date().toISOString().slice(0, 10);
  const supabase = await supabaseServer();

  const { data: auth } = await supabase.auth.getUser();

  // profiles_safe masks cost_rate unless the caller may see it, and is scoped
  // to the caller's organisation by the view itself.
  const { data: me } = await supabase
    .from('profiles_safe')
    .select('id, full_name, org_id, role_id')
    .eq('id', auth.user?.id ?? '')
    .maybeSingle();

  if (!me) {
    return (
      <main style={{ padding: 24, display: 'grid', placeItems: 'center', minHeight: '100%' }}>
        <div className="card" style={{ padding: 22, maxWidth: 520 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 19, fontWeight: 600 }}>
            No profile for this login
          </h1>
          <p className="note">
            You are signed in as <b>{auth.user?.email}</b>, but there is no matching row in{' '}
            <span className="mono">profiles</span>. Every screen will be empty until there is,
            because row-level security scopes all data to your organisation and that link is
            missing. Run step 4 of <span className="mono">docs/SUPABASE-SETUP.md</span> with this
            email.
          </p>
          <div style={{ marginTop: 14 }}>
            <SignOut />
          </div>
        </div>
      </main>
    );
  }

  const [{ data: crew }, { data: jobs }, { data: off }] = await Promise.all([
    supabase.from('profiles_safe').select('id, full_name').eq('is_active', true).order('full_name'),
    // jobs_safe rather than jobs: the price columns are revoked on the base
    // table, so `select *` there would fail by design.
    supabase
      .from('jobs_safe')
      .select('id, job_number, title, status, scheduled_start, scheduled_end, quoted_price')
      .gte('scheduled_start', `${day}T00:00:00`)
      .lte('scheduled_start', `${day}T23:59:59`)
      .order('scheduled_start'),
    supabase
      .from('time_off')
      .select('user_id, kind, starts_at, ends_at')
      .eq('status', 'approved')
      .lte('starts_at', `${day}T23:59:59`)
      .gte('ends_at', `${day}T00:00:00`),
  ]);

  const jobIds = (jobs ?? []).map((j) => j.id);
  const { data: assignments } = jobIds.length
    ? await supabase
        .from('job_assignments')
        .select('job_id, user_id, acceptance_status')
        .in('job_id', jobIds)
    : { data: [] };

  return (
    <Board
      day={day}
      me={{ name: me.full_name }}
      crew={crew ?? []}
      jobs={jobs ?? []}
      assignments={assignments ?? []}
      timeOff={off ?? []}
    />
  );
}
