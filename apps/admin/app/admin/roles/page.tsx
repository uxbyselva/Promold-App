import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { PERMISSIONS } from '@promold/shared';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const session = await requireSession();
  if (!session.can('audit.view')) redirect('/jobs');

  const supabase = await supabaseServer();
  const [{ data: roles }, { data: people }] = await Promise.all([
    supabase.from('roles').select('id, key, name, permissions').order('name'),
    supabase.from('profiles_safe').select('id, full_name, role_id, is_active'),
  ]);

  const flags = Object.entries(PERMISSIONS) as [string, string][];
  const order = (roles ?? []).slice().sort((a, b) => {
    const rank = ['owner', 'manager', 'crew_lead', 'technician', 'bookkeeper'];
    return rank.indexOf(a.key) - rank.indexOf(b.key);
  });
  const holders = (roleId: string) =>
    (people ?? []).filter((p) => p.role_id === roleId && p.is_active);

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

      <div className="box">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 280 }}>Permission</th>
                {order.map((r) => (
                  <th key={r.id} className="r">
                    {r.name}
                    <br />
                    <span className="sub" style={{ fontWeight: 400 }}>
                      {holders(r.id).length} {holders(r.id).length === 1 ? 'person' : 'people'}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flags.map(([flag, description]) => (
                <tr key={flag}>
                  <td>
                    <span className="mono" style={{ fontSize: 12.5 }}>
                      {flag}
                    </span>
                    <br />
                    <span className="sub">{description}</span>
                  </td>
                  {order.map((r) => {
                    const on = (r.permissions as Record<string, boolean>)[flag] === true;
                    return (
                      <td key={r.id} className="r">
                        {on ? (
                          <span style={{ color: 'var(--ok)', fontWeight: 700 }}>✓</span>
                        ) : (
                          <span className="faint">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="hint">
        Changing these is <code>role.manage</code> and is not wired up yet — it is a data change in
        Supabase, not a release, and it is the kind of change worth making on purpose rather than by
        clicking.
      </p>
    </OfficeShell>
  );
}
