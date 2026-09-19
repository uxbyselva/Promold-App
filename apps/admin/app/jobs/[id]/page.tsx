import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { jobFormOptions } from '@/lib/office-data';
import { OfficeShell } from '@/components/office-shell';
import { JobForm, draftFromJob } from '@/components/job-form';
import { JobSidebar } from '@/components/job-sidebar';

export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await supabaseServer();

  const { data: job } = await supabase
    .from('jobs_safe')
    .select(
      'id, job_number, title, description, status, priority, scheduled_start, scheduled_end, quoted_price, site_id, customer_id, template_id, deleted_at, delete_reason',
    )
    .eq('id', id)
    .maybeSingle();

  if (!job) notFound();

  const [{ data: crew }, { data: visits }, { data: blockers }, options] = await Promise.all([
    supabase
      .from('job_assignments')
      .select('id, user_id, acceptance_status, responded_at, profiles_safe!inner(full_name)')
      .eq('job_id', id),
    supabase
      .from('job_visits')
      .select('id, seq, scheduled_start, scheduled_end, status')
      .eq('job_id', id)
      .order('seq'),
    supabase.rpc('job_completion_blockers', { p_job_id: id }),
    jobFormOptions(),
  ]);

  const canEdit = session.can('job.edit') && !job.deleted_at;

  return (
    <OfficeShell session={session} mode="office">
      <div className="page-head">
        <div>
          <h1>
            <span className="mono">{job.job_number}</span> · {job.title}
          </h1>
          <p>
            {options.customers.find((c) => c.id === job.customer_id)?.name ?? 'Unknown customer'} ·{' '}
            {options.sites.find((s) => s.id === job.site_id)?.label ?? 'Unknown site'}
          </p>
        </div>
        {session.can('audit.view') ? (
          <Link className="btn ghost sm" href={`/admin/records/jobs/${job.id}`}>
            History
          </Link>
        ) : null}
      </div>

      {job.deleted_at ? (
        <p className="note">
          <b>This job is deleted.</b> {job.delete_reason ? `Reason: ${job.delete_reason}. ` : ''}
          It is read-only here. Admin mode is where it goes back.
        </p>
      ) : null}

      <div className="cols aside" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(280px,360px)' }}>
        {canEdit ? (
          <JobForm
            mode="edit"
            canSeePrice={session.can('price.view')}
            canAssign={session.can('job.assign')}
            {...options}
            initial={draftFromJob(job, (crew ?? []).map((c) => c.user_id))}
          />
        ) : (
          <div className="box">
            <header>
              <h3>The job</h3>
            </header>
            <div className="body">
              <p className="sub">{job.description || 'No notes.'}</p>
              <p className="hint">
                {job.deleted_at
                  ? 'Deleted jobs are not editable.'
                  : 'You can see this job but not change it — that is job.edit.'}
              </p>
            </div>
          </div>
        )}

        <JobSidebar
          jobId={job.id}
          jobNumber={job.job_number}
          status={job.status}
          deleted={Boolean(job.deleted_at)}
          crew={(crew ?? []).map((c) => ({
            id: c.id,
            name: (c.profiles_safe as unknown as { full_name: string }).full_name,
            acceptance: c.acceptance_status,
            respondedAt: c.responded_at,
          }))}
          visits={visits ?? []}
          blockers={(blockers as string[] | null) ?? []}
          canReview={session.can('job.review')}
          canClose={session.can('job.close')}
          canEdit={session.can('job.edit')}
        />
      </div>
    </OfficeShell>
  );
}
