import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase-server';
import { OfficeShell } from '@/components/office-shell';
import { Shell } from '@/components/shell';
import { MySettings } from '@/components/my-settings';
import { SignOut } from '@/components/sign-out';

export const dynamic = 'force-dynamic';

/**
 * Settings, for everybody.
 *
 * One page, two frames. The office reaches it from the bottom of the rail and
 * gets it inside the office shell; the crew reach it from the Me tab and get
 * it inside their own. Nothing on it is gated — it is your own name, your own
 * number and which theme you want — so there is no redirect and no flag to
 * check. The company's own settings are a different screen behind
 * `org.manage_settings`, linked from here when you hold it.
 */
export default async function MyAccountPage() {
  const session = await requireSession();
  const supabase = await supabaseServer();

  // profiles_safe, never the base table: `select *` on profiles fails by
  // design because cost_rate is revoked.
  const { data: me } = await supabase
    .from('profiles_safe')
    .select('full_name, phone')
    .eq('id', session.userId)
    .maybeSingle();

  const initial = {
    fullName: me?.full_name ?? session.fullName,
    phone: me?.phone ?? '',
  };

  const body = (
    <>
      <MySettings initial={initial} email={session.email} role={session.roleName} />

      <div className="box">
        <header>
          <h3>Elsewhere</h3>
        </header>
        <div className="body">
          {session.can('org.manage_settings') ? (
            <Link className="row between" href="/admin/settings">
              <span>
                <b>The company</b>
                <span className="sub" style={{ display: 'block' }}>
                  Name, time zone, the spend limit and the mileage rate
                </span>
              </span>
              <span aria-hidden="true">›</span>
            </Link>
          ) : null}
          <Link className="row between" href="/my/time-off">
            <span>
              <b>Time off</b>
              <span className="sub" style={{ display: 'block' }}>
                Ask for a day, and see what was decided
              </span>
            </span>
            <span aria-hidden="true">›</span>
          </Link>
          <Link className="row between" href="/my/mileage">
            <span>
              <b>Mileage</b>
              <span className="sub" style={{ display: 'block' }}>
                The kilometres you have logged
              </span>
            </span>
            <span aria-hidden="true">›</span>
          </Link>
        </div>
      </div>

      <div className="box">
        <div className="body">
          <SignOut />
        </div>
      </div>
    </>
  );

  // The same rule as homeFor(): whoever can see the whole board is at a desk.
  if (session.can('job.view_all')) {
    return (
      <OfficeShell session={session} mode="office">
        <div className="page-head">
          <div>
            <h1>Settings</h1>
            <p>Your own details and how the app looks on this device.</p>
          </div>
        </div>
        <div className="cols two">{body}</div>
      </OfficeShell>
    );
  }

  return (
    <Shell title="Me" who={`${session.fullName} · ${session.roleName}`}>
      {body}
    </Shell>
  );
}
