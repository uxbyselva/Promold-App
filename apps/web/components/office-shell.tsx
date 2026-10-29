import type { ReactNode } from 'react';
import Link from 'next/link';
import { SignOut } from './sign-out';
import { NavLink, ModeLink } from './nav-link';
import { OfficeMenu } from './office-menu';
import { supabaseServer } from '@/lib/supabase-server';
import { decisionCount } from '@/lib/dashboard';
import type { Session } from '@/lib/session';

interface Tab {
  href: string;
  label: string;
  when: boolean;
  badge?: number;
}

/**
 * Two modes, one login.
 *
 * Office is the day job: put work on the calendar, edit it, look after
 * customers. Admin is the other question — what happened to this record, who
 * changed it, and can I get back the thing I deleted. Keeping them apart means
 * the everyday screens are not cluttered with forensics, and the forensics are
 * somewhere deliberate rather than hidden behind a long-press.
 */
export async function OfficeShell({
  session,
  mode,
  children,
}: {
  session: Session;
  mode: 'office' | 'admin';
  children: ReactNode;
}) {
  const canAdmin = session.can('audit.view');
  const waiting = await decisionCount(session);

  const office: Tab[] = [
    { href: '/', label: 'Today', when: true },
    { href: '/calendar', label: 'Calendar', when: session.can('job.assign') },
    { href: '/dispatch', label: 'Board', when: session.can('job.assign') },
    { href: '/jobs', label: 'Jobs', when: true },
    {
      href: '/approvals',
      label: 'Waiting on you',
      when:
        session.can('reschedule.decide') ||
        session.can('timeoff.manage') ||
        session.can('purchase.approve') ||
        session.can('changeorder.manage'),
      badge: waiting,
    },
    { href: '/customers', label: 'Customers', when: session.can('customer.manage') },
    {
      href: '/equipment',
      label: 'Equipment',
      when: session.can('equipment.manage') || session.can('equipment.place'),
    },
    {
      href: '/stock',
      label: 'Stock',
      when: session.can('inventory.manage') || session.can('inventory.log_usage'),
    },
    { href: '/mileage', label: 'Mileage', when: session.can('mileage.view_all') },
  ];
  const admin: Tab[] = [
    { href: '/admin', label: 'Overview', when: true },
    { href: '/admin/activity', label: 'Activity', when: true },
    { href: '/admin/deleted', label: 'Deleted', when: true },
    { href: '/admin/roles', label: 'Roles', when: true },
    { href: '/admin/people', label: 'People', when: session.can('user.manage') },
    {
      href: '/admin/registers',
      label: 'Registers',
      when:
        session.can('inventory.manage') ||
        session.can('vehicle.manage') ||
        session.can('equipment.manage'),
    },
    {
      href: '/admin/checklists',
      label: 'Checklists',
      when: session.can('job.manage_templates'),
    },
    { href: '/admin/settings', label: 'Settings', when: session.can('org.manage_settings') },
  ];
  const tabs = (mode === 'admin' ? admin : office).filter((t) => t.when);
  /*
   * What stays on the bar on a phone, and what goes behind the menu button.
   *
   * Two, because that is what fits beside the button at 390px without the row
   * scrolling. Taken off the front of the list rather than named, so it does
   * the right thing for a bookkeeper — who has no calendar and no board, and
   * whose first two are Jobs and Waiting on you.
   */
  // Three now that Today exists, so the phone bar still carries Today,
  // Calendar and Board — the three asked for on page one. Everything else
  // lives behind the menu.
  const PRIMARY_ON_PHONE = 3;
  const overflow = tabs.slice(PRIMARY_ON_PHONE);

  return (
    <div className="office">
      <header className="masthead">
        <div className="masthead-row">
          <div className="brand">
            <b>Promold</b>
            <span>{mode === 'admin' ? 'Records and history' : 'The office'}</span>
          </div>

          <OfficeMenu
            tabs={overflow.map((t) => ({ href: t.href, label: t.label, badge: t.badge }))}
            mode={mode}
            canAdmin={canAdmin}
            who={session.fullName}
            role={session.roleName}
            showCrewView={mode === 'office'}
          />

          <div className="row masthead-wide" style={{ gap: 14 }}>
            {canAdmin ? (
              <nav className="modes" aria-label="Mode">
                <ModeLink href="/calendar" mode="office" active={mode === 'office'}>
                  Office
                </ModeLink>
                <ModeLink href="/admin" mode="admin" active={mode === 'admin'}>
                  Admin
                </ModeLink>
              </nav>
            ) : null}
            <span className="sub">
              {session.fullName} · {session.roleName}
            </span>
            <SignOut />
          </div>
        </div>

        <nav className="nav" aria-label={mode === 'admin' ? 'Admin' : 'Office'}>
          {tabs.map((t, i) => (
            <span key={t.href} className={i < PRIMARY_ON_PHONE ? undefined : 'nav-wide'}>
              <NavLink href={t.href} badge={t.badge}>
                {t.label}
              </NavLink>
            </span>
          ))}
          {mode === 'office' ? (
            <Link
              className="nav-field nav-wide"
              // The crew's half of the same app, not a second deployment.
              href="/my/jobs"
              style={{
                marginLeft: 'auto',
                alignSelf: 'center',
                fontSize: 12.5,
                color: 'var(--muted)',
                textDecoration: 'none',
                paddingBottom: 8,
              }}
            >
              Crew view ↗
            </Link>
          ) : null}
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
