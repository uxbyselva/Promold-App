import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { OrgSettings } from '@/components/org-settings';

export const dynamic = 'force-dynamic';

/**
 * The zones a Canadian contractor might plausibly want, rather than the six
 * hundred the database knows. `update_org_settings()` checks the name against
 * pg_timezone_names whatever this list says, so the list is a convenience and
 * not the rule.
 */
const ZONES = [
  'America/Toronto',
  'America/Winnipeg',
  'America/Regina',
  'America/Edmonton',
  'America/Vancouver',
  'America/Halifax',
  'America/St_Johns',
  'UTC',
];

export default async function SettingsPage() {
  const session = await requireSession();
  // The flag, not the mode: a bookkeeper reaches admin mode through
  // audit.view and has no business here.
  if (!session.can('org.manage_settings')) redirect('/jobs');

  const supabase = await supabaseServer();
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, timezone, settings')
    .eq('id', session.orgId)
    .maybeSingle();

  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  const zone = org?.timezone ?? 'America/Toronto';

  return (
    <OfficeShell session={session} mode="admin">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>
            What the company is called, what time it keeps, and the two numbers that decide what a
            manager may approve and what a kilometre is worth.
          </p>
        </div>
      </div>

      <div className="cols aside flip">
        <OrgSettings
          zones={ZONES.includes(zone) ? ZONES : [zone, ...ZONES]}
          initial={{
            name: org?.name ?? '',
            timezone: zone,
            mileageRate: String(settings.mileage_rate ?? ''),
            threshold: String(settings.approval_threshold ?? ''),
          }}
        />

        <div className="box">
          <header>
            <h3>Set elsewhere</h3>
          </header>
          <div className="body">
            <p className="sub">
              Two more settings exist and are not shown here, because nothing reads them yet: the
              geofence radius and how long to wait before chasing an unanswered assignment. They are
              kept against the day those features arrive.
            </p>
            <p className="hint">
              Who may do what is on the Roles screen. Who works here is on People.
            </p>
          </div>
        </div>
      </div>
    </OfficeShell>
  );
}
