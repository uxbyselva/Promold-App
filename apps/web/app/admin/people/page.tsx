import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { PeopleAdmin } from '@/components/people-admin';

export const dynamic = 'force-dynamic';

export default async function PeoplePage() {
  const session = await requireSession();
  if (!session.can('user.manage')) redirect('/jobs');

  const supabase = await supabaseServer();
  const [{ data: people }, { data: roles }] = await Promise.all([
    // profiles_safe, never profiles: cost_rate is revoked on the base table,
    // so `select *` there fails by design. The view masks it unless the
    // viewer holds user.view_cost_rates.
    supabase
      .from('profiles_safe')
      .select('id, full_name, email, phone, role_id, is_active, cost_rate')
      .order('full_name'),
    supabase.from('roles').select('id, key, name').order('name'),
  ]);

  return (
    <OfficeShell session={session} mode="admin">
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p>
            Who works here and what they may do. Adding somebody takes two steps — their login is
            made in Supabase, and this says who they are at Promold.
          </p>
        </div>
      </div>

      <PeopleAdmin
        people={people ?? []}
        roles={roles ?? []}
        canSeeRates={session.can('user.view_cost_rates')}
        me={session.userId}
      />
    </OfficeShell>
  );
}
