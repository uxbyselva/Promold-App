import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { StockBoard } from '@/components/stock-board';

export const dynamic = 'force-dynamic';

export default async function StockPage() {
  const session = await requireSession();
  if (!session.can('inventory.manage') && !session.can('inventory.log_usage')) redirect('/jobs');

  const supabase = await supabaseServer();

  const [
    { data: items },
    { data: locations },
    { data: levels },
    { data: packs },
    { data: recent },
  ] = await Promise.all([
    supabase
      .from('inventory_items')
      .select(
        'id, sku, name, category, unit_of_measure, consumption_mode, min_level, reorder_quantity, average_cost',
      )
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name'),
    supabase.from('stock_locations').select('id, name, kind').eq('is_active', true).order('name'),
    supabase.from('stock_levels').select('item_id, location_id, quantity'),
    supabase
      .from('open_packs')
      .select(
        'pack_id, item_id, sku, name, location_id, location_name, opened_at, opened_by, unit_cost, jobs_served',
      )
      .order('opened_at'),
    // What has moved lately. The ledger is the whole truth about stock, so
    // the office should be able to see it rather than only its total.
    supabase
      .from('stock_movements')
      .select(
        'id, item_id, kind, from_location_id, to_location_id, quantity, job_id, reason, created_at, created_by',
      )
      .order('created_at', { ascending: false })
      .limit(40),
  ]);

  const jobIds = [...new Set((recent ?? []).map((m) => m.job_id).filter(Boolean))];
  const { data: jobs } = jobIds.length
    ? await supabase.from('jobs_safe').select('id, job_number').in('id', jobIds)
    : { data: [] };

  const { data: people } = await supabase.from('profiles_safe').select('id, full_name');

  return (
    <OfficeShell session={session} mode="office">
      <div className="page-head">
        <div>
          <h1>Stock</h1>
          <p>
            Levels are derived from the movement ledger and are never typed in. A level somebody can
            edit is a level nobody trusts by month three.
          </p>
        </div>
        {session.can('audit.view') ? (
          <Link className="btn ghost sm" href="/admin/activity?table=inventory_items">
            History
          </Link>
        ) : null}
      </div>

      <StockBoard
        items={items ?? []}
        locations={locations ?? []}
        levels={levels ?? []}
        packs={packs ?? []}
        movements={recent ?? []}
        jobs={jobs ?? []}
        people={people ?? []}
        canTransfer={session.can('inventory.transfer')}
      />
    </OfficeShell>
  );
}
