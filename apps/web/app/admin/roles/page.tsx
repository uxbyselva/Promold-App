import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { RoleMatrix } from '@/components/role-matrix';
import { PERMISSIONS } from '@promold/shared';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const session = await requireSession();
  if (!session.can('audit.view')) redirect('/jobs');

  const supabase = await supabaseServer();
  const [{ data: roles }, { data: people }] = await Promise.all([
    supabase.from('roles').select('id, key, name, permissions').order('name'),
    supabase.from('profiles_safe').select('id, role_id, is_active'),
  ]);

  const flags = Object.entries(PERMISSIONS) as [string, string][];
  const rank = ['owner', 'manager', 'crew_lead', 'technician', 'bookkeeper'];
  const order = (roles ?? [])
    .slice()
    .sort((a, b) => rank.indexOf(a.key) - rank.indexOf(b.key))
    .map((r) => ({ ...r, permissions: (r.permissions ?? {}) as Record<string, boolean> }));

  const holders: Record<string, number> = {};
  for (const p of people ?? []) {
    if (p.is_active) holders[p.role_id] = (holders[p.role_id] ?? 0) + 1;
  }

  return (
    <OfficeShell session={session} mode="admin">
      <div className="page-head">
        <div>
          <h1>Who can do what</h1>
          <p>
            The flags on each role, exactly as the database holds them. Every one of these is
            checked in Postgres on every read and write — the apps only use them to hide what
            somebody cannot do, never to decide it.
          </p>
        </div>
      </div>

      <RoleMatrix
        roles={order}
        flags={flags}
        holders={holders}
        canEdit={session.can('role.manage')}
      />
    </OfficeShell>
  );
}
