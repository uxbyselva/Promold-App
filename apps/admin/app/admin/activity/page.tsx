import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { ActivityFeed } from '@/components/activity-feed';

export const dynamic = 'force-dynamic';

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; actor?: string; action?: string; before?: string }>;
}) {
  const session = await requireSession();
  if (!session.can('audit.view')) redirect('/jobs');

  const { table, actor, action, before } = await searchParams;
  const supabase = await supabaseServer();

  const [{ data: entries, error }, { data: tables }, { data: people }] = await Promise.all([
    supabase.rpc('audit_feed', {
      p_table: table || null,
      p_actor: actor || null,
      p_action: action || null,
      p_before_id: before ? Number(before) : null,
      p_limit: 100,
    }),
    supabase.rpc('audit_tables'),
    supabase.from('profiles_safe').select('id, full_name').order('full_name'),
  ]);

  return (
    <OfficeShell session={session} mode="admin">
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p>
            Every insert, edit and delete, with the fields that actually changed. Written by a
            trigger in the database, so it records what happened rather than what a screen
            intended.
          </p>
        </div>
      </div>

      {error ? <p className="err">{error.message}</p> : null}

      <ActivityFeed
        entries={(entries ?? []) as never[]}
        tables={(tables ?? []) as never[]}
        people={people ?? []}
        filters={{ table: table ?? '', actor: actor ?? '', action: action ?? '' }}
      />
    </OfficeShell>
  );
}
