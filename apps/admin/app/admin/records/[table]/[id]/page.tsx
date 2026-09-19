import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { RecordHistory } from '@/components/record-history';

export const dynamic = 'force-dynamic';

export default async function RecordPage({
  params,
}: {
  params: Promise<{ table: string; id: string }>;
}) {
  const { table, id } = await params;
  const session = await requireSession();
  if (!session.can('audit.view')) redirect('/jobs');

  const supabase = await supabaseServer();
  const [{ data: history, error }, { data: kind }] = await Promise.all([
    supabase.rpc('record_history', { p_table: table, p_id: id }),
    supabase.from('deletable_tables').select('label').eq('table_name', table).maybeSingle(),
  ]);

  const rows = (history ?? []) as { action: string; diff: Record<string, unknown> | null }[];
  // The insert carries the whole row, which is the only place a name survives
  // once the record itself is gone.
  const created = rows.find((r) => r.action === 'insert');
  const name =
    created && created.diff && typeof created.diff.new === 'object'
      ? ((created.diff.new as Record<string, unknown>).title ??
        (created.diff.new as Record<string, unknown>).name ??
        (created.diff.new as Record<string, unknown>).label ??
        null)
      : null;

  const backTo = table === 'jobs' ? `/jobs/${id}` : table === 'customers' ? `/customers/${id}` : null;

  return (
    <OfficeShell session={session} mode="admin">
      <div className="page-head">
        <div>
          <h1>
            {kind?.label ?? table}
            {name ? ` · ${String(name)}` : ''}
          </h1>
          <p className="mono" style={{ fontSize: 12.5 }}>
            {table} · {id}
          </p>
        </div>
        {backTo ? (
          <Link className="btn ghost sm" href={backTo}>
            Open the record
          </Link>
        ) : null}
      </div>

      {error ? <p className="err">{error.message}</p> : null}
      <RecordHistory rows={(history ?? []) as never[]} />
    </OfficeShell>
  );
}
