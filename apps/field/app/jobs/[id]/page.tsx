import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { Shell } from '@/components/shell';
import { JobDetail } from '@/components/job-detail';

export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await supabaseServer();

  const { data: job } = await supabase
    .from('jobs_safe')
    .select(
      'id, job_number, title, description, status, scheduled_start, scheduled_end, site_id, customer_id',
    )
    .eq('id', id)
    .maybeSingle();

  // Not found and not-mine are the same answer here: row-level security means
  // a job I have no stake in simply does not come back.
  if (!job) notFound();

  const [{ data: site }, { data: customer }, { data: crew }, { data: photos }, { data: kit }] =
    await Promise.all([
      supabase
        .from('sites')
        .select('id, label, address_line1, address_line2, city, state, postal_code, access_notes')
        .eq('id', job.site_id)
        .maybeSingle(),
      supabase.from('customers').select('id, name, phone').eq('id', job.customer_id).maybeSingle(),
      supabase
        .from('job_assignments')
        .select('id, user_id, acceptance_status, profiles_safe!inner(full_name)')
        .eq('job_id', id),
      supabase
        .from('job_photos')
        .select('id, phase, storage_path, room_label, taken_at')
        .eq('job_id', id)
        .is('deleted_at', null)
        .order('taken_at', { ascending: false }),
      supabase
        .from('equipment_assignments')
        .select('id, started_at, expected_end_at, equipment!inner(asset_tag, name, category)')
        .eq('job_id', id)
        .is('ended_at', null),
    ]);

  // The gate, and the things worth saying that are not the crew's to fix.
  // Both come from the database so the button and the server agree.
  const [{ data: blockers }, { data: warnings }, { data: decided }] = await Promise.all([
    supabase.rpc('job_completion_blockers', { p_job_id: id }),
    supabase.rpc('job_completion_warnings', { p_job_id: id }),
    // What came back from asking to move it. Row-level security limits this
    // to their own requests, so it is safe to ask for the latest one.
    supabase
      .from('reschedule_requests')
      .select('id, status, reason, decision_reason, decided_at, decided_by')
      .eq('job_id', id)
      .eq('requested_by', session.userId)
      .neq('status', 'pending')
      .order('decided_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // Change orders raised on this job. change_orders_safe masks the amount for
  // anyone without price.view, so the crew see their own words and the
  // outcome but never the number.
  const { data: changeOrders } = await supabase
    .from('change_orders_safe')
    .select('id, seq, title, description, status, amount, decided_at, decision_reason')
    .eq('job_id', id)
    .order('seq');

  const { data: decider } = decided?.decided_by
    ? await supabase
        .from('profiles_safe')
        .select('full_name')
        .eq('id', decided.decided_by)
        .maybeSingle()
    : { data: null };

  // The bucket is private, so display needs short-lived signed links. If it
  // has not been created yet the gallery degrades to counts rather than
  // taking the page down.
  const paths = (photos ?? []).map((p) => p.storage_path);
  let urls: Record<string, string> = {};
  if (paths.length) {
    const { data: signed } = await supabase.storage
      .from('job-photos')
      .createSignedUrls(paths, 60 * 60);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
    }
  }

  const mine = (crew ?? []).find((a) => a.user_id === session.userId);

  return (
    <Shell title={job.job_number} who={job.title}>
      <JobDetail
        job={job}
        site={site ?? null}
        customer={customer ?? null}
        crew={(crew ?? []).map((a) => ({
          id: a.id,
          userId: a.user_id,
          name: (a.profiles_safe as unknown as { full_name: string }).full_name,
          acceptance: a.acceptance_status,
        }))}
        myAssignment={mine ? { id: mine.id, acceptance: mine.acceptance_status } : null}
        photos={(photos ?? []).map((p) => ({ ...p, url: urls[p.storage_path] ?? null }))}
        equipment={(kit ?? []).map((k) => ({
          id: k.id,
          startedAt: k.started_at,
          expectedEnd: k.expected_end_at,
          ...(k.equipment as unknown as { asset_tag: string; name: string; category: string }),
        }))}
        decision={
          decided
            ? {
                status: decided.status,
                reason: decided.reason,
                decisionReason: decided.decision_reason,
                decidedAt: decided.decided_at,
                decidedBy: decider?.full_name ?? 'The office',
              }
            : null
        }
        changeOrders={changeOrders ?? []}
        canDraftChangeOrder={session.can('changeorder.draft')}
        blockers={(blockers as string[] | null) ?? []}
        warnings={(warnings as string[] | null) ?? []}
        canComplete={session.can('job.complete')}
        orgId={session.orgId}
        userId={session.userId}
      />
    </Shell>
  );
}
