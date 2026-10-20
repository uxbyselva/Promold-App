import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { NewCustomer } from '@/components/customer-editor';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  residential: 'Residential',
  commercial: 'Commercial',
  insurance: 'Insurance',
  property_manager: 'Property manager',
};

export default async function CustomersPage() {
  const session = await requireSession();
  if (!session.can('customer.manage')) redirect('/jobs');

  const supabase = await supabaseServer();
  const [{ data: customers }, { data: sites }] = await Promise.all([
    supabase
      .from('customers')
      .select('id, name, kind, phone, email')
      .is('deleted_at', null)
      .order('name'),
    supabase.from('sites').select('id, customer_id').is('deleted_at', null),
  ]);

  const siteCount = (id: string) => (sites ?? []).filter((s) => s.customer_id === id).length;

  return (
    <OfficeShell session={session} mode="office">
      <div className="page-head">
        <div>
          <h1>Customers</h1>
          <p>
            A job is never free-floating: it belongs to a customer at a property. What is owed and
            what has been paid live in the other system, not here.
          </p>
        </div>
      </div>

      <div className="cols aside">
        <div className="box">
          <header>
            <h3>{(customers ?? []).length} customers</h3>
          </header>
          <div>
            {(customers ?? []).map((c) => (
              <Link key={c.id} className="pickrow" href={`/customers/${c.id}`}>
                <span className="grow">
                  <b>{c.name}</b>
                  <span>
                    {KIND_LABEL[c.kind] ?? c.kind} · {siteCount(c.id)}{' '}
                    {siteCount(c.id) === 1 ? 'site' : 'sites'}
                  </span>
                </span>
              </Link>
            ))}
            {(customers ?? []).length === 0 ? (
              <p className="empty">Nobody on the books yet.</p>
            ) : null}
          </div>
        </div>

        <NewCustomer orgId={session.orgId} />
      </div>
    </OfficeShell>
  );
}
