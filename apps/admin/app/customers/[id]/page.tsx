import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { CustomerEditor } from '@/components/customer-editor';

export const dynamic = 'force-dynamic';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!session.can('customer.manage')) redirect('/jobs');

  const supabase = await supabaseServer();
  const { data: customer } = await supabase
    .from('customers')
    .select(
      'id, name, kind, primary_contact, phone, email, billing_address, notes, deleted_at, delete_reason',
    )
    .eq('id', id)
    .maybeSingle();

  if (!customer) notFound();

  const { data: sites } = await supabase
    .from('sites')
    .select(
      'id, label, address_line1, address_line2, city, state, postal_code, access_notes, deleted_at',
    )
    .eq('customer_id', id)
    .is('deleted_at', null)
    .order('label');

  const siteIds = (sites ?? []).map((s) => s.id);
  const { data: jobs } = siteIds.length
    ? await supabase
        .from('jobs_safe')
        .select('id, job_number, title, status, scheduled_start, site_id')
        .in('site_id', siteIds)
        .is('deleted_at', null)
        .order('scheduled_start', { ascending: false })
        .limit(50)
    : { data: [] };

  return (
    <OfficeShell session={session} mode="office">
      <div className="page-head">
        <div>
          <h1>{customer.name}</h1>
          <p>Their sites, and everything done at each address.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn ghost sm" href="/customers">
            All customers
          </Link>
          {session.can('audit.view') ? (
            <Link className="btn ghost sm" href={`/admin/records/customers/${customer.id}`}>
              History
            </Link>
          ) : null}
          <Link className="btn sm" href={`/jobs/new?customer=${customer.id}`}>
            Book a job
          </Link>
        </div>
      </div>

      {customer.deleted_at ? (
        <p className="note">
          <b>This customer is deleted.</b>{' '}
          {customer.delete_reason ? `Reason: ${customer.delete_reason}.` : ''} Admin mode is where
          it goes back.
        </p>
      ) : null}

      <CustomerEditor
        customer={customer}
        sites={sites ?? []}
        jobs={jobs ?? []}
        orgId={session.orgId}
      />
    </OfficeShell>
  );
}
