import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { ChecklistEditor } from '@/components/checklist-editor';

export const dynamic = 'force-dynamic';

export default async function ChecklistsPage() {
  const session = await requireSession();
  if (!session.can('job.manage_templates')) redirect('/jobs');

  const supabase = await supabaseServer();
  const [{ data: templates }, { data: forms }] = await Promise.all([
    supabase
      .from('job_templates')
      .select(
        'id, name, category, default_duration_hours, default_crew_size, is_active, completion_requirements',
      )
      .order('name'),
    supabase.from('form_templates').select('key, name').order('name'),
  ]);

  return (
    <OfficeShell session={session} mode="admin">
      <div className="page-head">
        <div>
          <h1>Checklists</h1>
          <p>
            What a kind of work needs doing before the crew may call it finished. A job picks one
            when it is booked — or none, which is fine and means the gate asks for nothing.
          </p>
        </div>
      </div>

      <ChecklistEditor
        templates={templates ?? []}
        forms={forms ?? []}
        canEdit={session.can('job.manage_templates')}
        orgId={session.orgId}
      />
    </OfficeShell>
  );
}
