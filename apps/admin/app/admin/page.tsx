import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { stamp } from '@/lib/format';
import { describeAuditEntry } from '@promold/shared';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const session = await requireSession();
  if (!session.can('audit.view')) redirect('/jobs');

  const supabase = await supabaseServer();
  const [{ data: recent }, { data: deleted }, { data: tables }] = await Promise.all([
    supabase.rpc('audit_feed', { p_limit: 8 }),
    supabase.rpc('deleted_records', { p_limit: 200 }),
    supabase.rpc('audit_tables'),
  ]);

  const bin = (deleted ?? []) as { blocked_by: string | null }[];
  const entries = (recent ?? []) as {
    id: number;
    at: string;
    label: string;
    action: string;
    fields: string[];
    actor_name: string;
  }[];
  const totalEntries = ((tables ?? []) as { entries: number }[]).reduce(
    (a, t) => a + Number(t.entries),
    0,
  );

  return (
    <OfficeShell session={session} mode="admin">
      <div className="page-head">
        <div>
          <h1>Records and history</h1>
          <p>
            What happened to a record, who changed it, and how to get back something that was
            deleted. Nothing in this app erases anything — this is where that promise is cashed.
          </p>
        </div>
      </div>

      <div className="tiles">
        <div className="tile">
          <span className="lbl">Changes recorded</span>
          <span className="fig">{totalEntries.toLocaleString()}</span>
          <Link href="/admin/activity">See the activity →</Link>
        </div>
        <div className="tile">
          <span className="lbl">In the bin</span>
          <span className="fig">{bin.length}</span>
          <Link href="/admin/deleted">Open the bin →</Link>
        </div>
        <div className="tile">
          <span className="lbl">Blocked from restoring</span>
          <span className="fig" style={bin.some((b) => b.blocked_by) ? { color: 'var(--warn)' } : undefined}>
            {bin.filter((b) => b.blocked_by).length}
          </span>
          <span className="sub">Waiting on a deleted parent</span>
        </div>
        <div className="tile">
          <span className="lbl">You can restore</span>
          <span className="fig">{session.can('data.restore') ? 'Yes' : 'No'}</span>
          <span className="sub">
            {session.can('data.restore')
              ? 'data.restore is on your role'
              : 'Only the owner holds data.restore'}
          </span>
        </div>
      </div>

      <div className="box">
        <header>
          <h3>Lately</h3>
          <Link className="sub" href="/admin/activity">
            Everything →
          </Link>
        </header>
        <div className="body">
          <ul className="trail">
            {entries.map((e) => (
              <li key={e.id}>
                <time>{stamp(e.at)}</time>
                <div>
                  <b>{e.label}</b> · {describeAuditEntry({ action: e.action, fields: e.fields })}
                  <br />
                  <span className="sub">{e.actor_name}</span>
                </div>
              </li>
            ))}
          </ul>
          {entries.length === 0 ? <p className="empty">Nothing recorded yet.</p> : null}
        </div>
      </div>
    </OfficeShell>
  );
}
