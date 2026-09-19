import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { RecycleBin } from '@/components/recycle-bin';

export const dynamic = 'force-dynamic';

export default async function DeletedPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string }>;
}) {
  const session = await requireSession();
  if (!session.can('audit.view')) redirect('/jobs');

  const { table } = await searchParams;
  const supabase = await supabaseServer();

  const [{ data: rows, error }, { data: kinds }] = await Promise.all([
    supabase.rpc('deleted_records', { p_table: table || null, p_limit: 300 }),
    supabase.from('deletable_tables').select('table_name, label, sort').order('sort'),
  ]);

  return (
    <OfficeShell session={session} mode="admin">
      <div className="page-head">
        <div>
          <h1>Deleted</h1>
          <p>
            Everything taken off the books, newest first. Nothing was erased — a delete sets a
            date and a reason, and this is where it comes back from.
          </p>
        </div>
      </div>

      {error ? <p className="err">{error.message}</p> : null}

      <RecycleBin
        rows={(rows ?? []) as never[]}
        kinds={kinds ?? []}
        selected={table ?? ''}
        canRestore={session.can('data.restore')}
      />
    </OfficeShell>
  );
}
