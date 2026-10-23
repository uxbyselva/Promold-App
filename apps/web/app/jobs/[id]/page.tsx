import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { jobFormOptions } from '@/lib/office-data';
import { OfficeShell } from '@/components/office-shell';
import { JobForm } from '@/components/job-form';
import { draftFromJob } from '@/lib/job-draft';
import { JobSidebar } from '@/components/job-sidebar';
import { CrewPay } from '@/components/crew-pay';

export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await supabaseServer();

  const { data: job } = await supabase
    .from('jobs_safe')
    .select(
      // jobs_safe filters deleted jobs out itself and does not carry
      // deleted_at — asking for it fails the whole query. A deleted job is
      // simply not found here; the recycle bin in admin mode is where it
      // lives and where it comes back from.
      'id, job_number, title, description, status, priority, scheduled_start, scheduled_end, quoted_price, site_id, customer_id, template_id',
    )
    .eq('id', id)
    .maybeSingle();

  if (!job) notFound();

  const [{ data: crew }, { data: visits }, { data: blockers }, options] = await Promise.all([
    // Names in a second query, not an embedded join: embedding through
    // profiles_safe asks PostgREST to infer a relationship for a view, which
    // has no foreign key to follow and cannot be tested without a live
    // PostgREST.
    supabase
      .from('job_assignments')
      .select('id, user_id, acceptance_status, responded_at')
      .eq('job_id', id),
    supabase
      .from('job_visits')
      .select('id, seq, scheduled_start, scheduled_end, status')
      .eq('job_id', id)
      .order('seq'),
    supabase.rpc('job_completion_blockers', { p_job_id: id }),
    jobFormOptions(),
  ]);

  const crewIds = [...new Set((crew ?? []).map((c) => c.user_id))];
  const { data: crewNames } = crewIds.length
    ? await supabase.from('profiles_safe').select('id, full_name').in('id', crewIds)
    : { data: [] };
  const nameOf = (userId: string) =>
    (crewNames ?? []).find((p) => p.id === userId)?.full_name ?? 'Someone';

  const canEdit = session.can('job.edit');
  const canSeeCosts = session.can('costing.view');

  /*
   * The cost side of the job. Both come back empty for anyone without
   * costing.view — job_costs filters on the flag itself and job_crew_pay's
   * row policy does the same — so this is asked for rather than guarded, and
   * the panel is only rendered when the flag is there.
   */
  const [{ data: costs }, { data: payments }] = canSeeCosts
    ? await Promise.all([
        supabase
          .from('job_costs')
          .select(
            'contract_price, labour_cost, material_cost, purchase_cost, mileage_cost, equipment_cost, rental_cost, total_cost, margin',
          )
          .eq('job_id', id)
          .maybeSingle(),
        supabase
          .from('job_crew_pay')
          .select('id, user_id, amount, note')
          .eq('job_id', id)
          .order('created_at'),
      ])
    : [{ data: null }, { data: [] }];

  // Everyone active, not just this job's crew: a weekend hand who helped out
  // still has to be nameable.
  const { data: people } = canSeeCosts
    ? await supabase
        .from('profiles_safe')
        .select('id, full_name')
        .eq('is_active', true)
        .order('full_name')
    : { data: [] };

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

      <div
        className="cols aside"
        style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(280px,360px)' }}
      >
        {canEdit ? (
          <JobForm
            mode="edit"
            canSeePrice={session.can('price.view')}
            canAssign={session.can('job.assign')}
            {...options}
            initial={draftFromJob(
              job,
              (crew ?? []).map((c) => c.user_id),
            )}
          />
        ) : (
          <div className="box">
            <header>
              <h3>The job</h3>
            </header>
            <div className="body">
              <p className="sub">{job.description || 'No notes.'}</p>
              <p className="hint">You can see this job but not change it — that is job.edit.</p>
            </div>
          </div>
        )}

        <JobSidebar
          jobId={job.id}
          jobNumber={job.job_number}
          status={job.status}
          crew={(crew ?? []).map((c) => ({
            id: c.id,
            name: nameOf(c.user_id),
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

      {canSeeCosts ? (
        <div
          className="cols aside"
          style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(280px,360px)', marginTop: 14 }}
        >
          <CrewPay
            jobId={job.id}
            orgId={session.orgId}
            userId={session.userId}
            payments={payments ?? []}
            costs={costs ?? null}
            people={people ?? []}
            canEdit={canEdit}
          />
        </div>
      ) : null}
    </OfficeShell>
  );
}
