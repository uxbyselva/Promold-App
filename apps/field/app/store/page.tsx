import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { Shell } from '@/components/shell';
import { StoreView } from '@/components/store-view';

export const dynamic = 'force-dynamic';

export default async function StorePage() {
  const session = await requireSession();
  const supabase = await supabaseServer();

  // The jobs I am on, so everything on this screen can be pinned to one.
  const { data: assignments } = await supabase
    .from('job_assignments')
    .select('job_id')
    .eq('user_id', session.userId);
  const jobIds = [...new Set((assignments ?? []).map((a) => a.job_id))];

  const { data: jobs } = jobIds.length
    ? await supabase
        .from('jobs_safe')
        .select('id, job_number, title, status, site_id')
        .in('id', jobIds)
        .not('status', 'in', '("closed","cancelled")')
        .order('scheduled_start', { ascending: false })
        .limit(20)
    : { data: [] };

  const [{ data: kit }, { data: locations }, { data: items }, { data: levels }, { data: packs }] =
    await Promise.all([
      // Every unit that is out, whoever has it. Knowing a scrubber is on
      // another crew's site is the difference between driving there and
      // driving to the warehouse.
      supabase
        .from('equipment_current')
        .select('equipment_id, asset_tag, name, category, location_status, job_id, site_id, assigned_to_user_id, assignment_id, expected_end_at'),
      supabase.from('stock_locations').select('id, name, kind').eq('is_active', true).order('name'),
      supabase
        .from('inventory_items')
        .select('id, sku, name, unit_of_measure, consumption_mode, min_level, average_cost')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name'),
      supabase.from('stock_levels').select('item_id, location_id, quantity'),
      supabase
        .from('open_packs')
        .select('pack_id, item_id, sku, name, location_id, location_name, opened_at, unit_cost, jobs_served'),
    ]);

  // What this person has asked the office to buy, and who can say yes.
  const [{ data: requests }, { data: approvers }] = await Promise.all([
    supabase
      .from('purchase_requests')
      .select('id, request_number, status, created_at, job_id, decision_reason')
      .eq('requested_by', session.userId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.from('profiles_safe').select('id, full_name').eq('is_active', true).order('full_name'),
  ]);

  const siteIds = [...new Set((jobs ?? []).map((j) => j.site_id).filter(Boolean))];
  const { data: sites } = siteIds.length
    ? await supabase.from('sites').select('id, label').in('id', siteIds)
    : { data: [] };

  return (
    <Shell title="Store" who={`${session.fullName} · ${session.roleName}`}>
      <StoreView
        jobs={jobs ?? []}
        sites={sites ?? []}
        kit={kit ?? []}
        locations={locations ?? []}
        items={items ?? []}
        levels={levels ?? []}
        packs={packs ?? []}
        requests={requests ?? []}
        approvers={approvers ?? []}
        userId={session.userId}
        orgId={session.orgId}
        canPlace={session.can('equipment.place')}
        canLogUsage={session.can('inventory.log_usage')}
        canTransfer={session.can('inventory.transfer')}
      />
    </Shell>
  );
}
