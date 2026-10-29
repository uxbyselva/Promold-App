import type { ReactNode } from 'react';
import Link from 'next/link';
import { SignOut } from './sign-out';
import { NavLink } from './nav-link';
import { OfficeMenu, type MenuTab } from './office-menu';
import { Icon } from './icons';
import { decisionCount } from '@/lib/dashboard';
import type { Session } from '@/lib/session';

type Tab = MenuTab & { when: boolean };

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Two modes, one login.
 *
 * Office is the day job: put work on the calendar, edit it, look after
 * customers. Admin is the other question — what happened to this record, who
 * changed it, and can I get back the thing I deleted. Keeping them apart means
 * the everyday screens are not cluttered with forensics, and the forensics are
 * somewhere deliberate rather than hidden behind a long-press.
 *
 * On a desk both live in the dark rail down the left: the sections at the top,
 * Records and history at the bottom, who you are under that. On a phone the
 * rail is gone and `OfficeMenu` puts four tabs along the bottom and the rest
 * behind More.
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
    { href: '/', label: 'Today', icon: 'today', when: true },
    { href: '/calendar', label: 'Calendar', icon: 'calendar', when: session.can('job.assign') },
    { href: '/dispatch', label: 'Board', icon: 'board', when: session.can('job.assign') },
    { href: '/jobs', label: 'Jobs', icon: 'jobs', when: true },
    {
      href: '/approvals',
      label: 'Waiting on you',
      icon: 'inbox',
      when:
        session.can('reschedule.decide') ||
        session.can('timeoff.manage') ||
        session.can('purchase.approve') ||
        session.can('changeorder.manage'),
      badge: waiting,
    },
    {
      href: '/customers',
      label: 'Customers',
      icon: 'customers',
      when: session.can('customer.manage'),
    },
    {
      href: '/equipment',
      label: 'Equipment',
      icon: 'equipment',
      when: session.can('equipment.manage') || session.can('equipment.place'),
    },
    {
      href: '/stock',
      label: 'Stock',
      icon: 'stock',
      when: session.can('inventory.manage') || session.can('inventory.log_usage'),
    },
    {
      href: '/mileage',
      label: 'Mileage',
      icon: 'mileage',
      when: session.can('mileage.view_all'),
    },
  ];
  const admin: Tab[] = [
    { href: '/admin', label: 'Overview', icon: 'reports', when: true },
    { href: '/admin/activity', label: 'Activity', icon: 'history', when: true },
    { href: '/admin/deleted', label: 'Deleted', icon: 'trash', when: true },
    { href: '/admin/roles', label: 'Roles', icon: 'admin', when: true },
    { href: '/admin/people', label: 'People', icon: 'people', when: session.can('user.manage') },
    {
      href: '/admin/registers',
      label: 'Registers',
      icon: 'equipment',
      when:
        session.can('inventory.manage') ||
        session.can('vehicle.manage') ||
        session.can('equipment.manage'),
    },
    {
      href: '/admin/checklists',
      label: 'Checklists',
      icon: 'jobs',
      when: session.can('job.manage_templates'),
    },
    {
      href: '/admin/settings',
      label: 'The company',
      icon: 'settings',
      when: session.can('org.manage_settings'),
    },
  ];
  const tabs = (mode === 'admin' ? admin : office).filter((t) => t.when);
  /*
   * What a thumb gets, and what goes behind More.
   *
   * Four, because that is what fits beside the More button at 390px. Taken
   * off the front of the list rather than named, so it does the right thing
   * for a bookkeeper — who has no calendar and no board, and whose first
   * four are Today, Jobs, Waiting on you and Customers.
   */
  const PRIMARY_ON_PHONE = 4;

  return (
    <div className="office">
      <nav className="rail" aria-label={mode === 'admin' ? 'Admin' : 'Office'}>
        <Link className="rail-brand" href="/">
          <span className="rail-mark" aria-hidden="true">
            P
          </span>
          <b>Promold</b>
        </Link>

        <div className="rail-links">
          {tabs.map((t) => (
            <NavLink key={t.href} href={t.href} badge={t.badge}>
              <span className="ic">
                <Icon name={t.icon} />
              </span>
              {t.label}
            </NavLink>
          ))}
        </div>

        <div className="rail-links rail-extra">
          {canAdmin ? (
            <NavLink href={mode === 'admin' ? '/' : '/admin'}>
              <span className="ic">
                <Icon name={mode === 'admin' ? 'today' : 'admin'} />
              </span>
              {mode === 'admin' ? 'Back to the office' : 'Records and history'}
            </NavLink>
          ) : null}
          <NavLink href="/settings">
            <span className="ic">
              <Icon name="settings" />
            </span>
            Settings
          </NavLink>
          {mode === 'office' ? (
            // The crew's half of the same app, not a second deployment.
            <NavLink href="/my">
              <span className="ic">
                <Icon name="today" />
              </span>
              Crew view ↗
            </NavLink>
          ) : null}
        </div>

        <div className="rail-foot">
          <span className="av" aria-hidden="true">
            {initials(session.fullName)}
          </span>
          <span className="grow truncate">
            <b className="truncate">{session.fullName}</b>
            <span>{session.roleName}</span>
          </span>
        </div>
      </nav>

      <div className="office-body">
        <header className="masthead">
          <span className="masthead-mark" aria-hidden="true">
            P
          </span>
          <div className="grow truncate">
            <b>{mode === 'admin' ? 'Records and history' : 'The office'}</b>
            {/* Who you are is in the rail's foot on a desk. On a phone the
                rail is gone, so it comes back here. */}
            <span className="masthead-who">
              {session.fullName} · {session.roleName}
            </span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {session.can('job.edit') ? (
              <Link className="btn sm" href="/jobs/new">
                <Icon name="plus" size={16} />
                New job
              </Link>
            ) : null}
            <span className="masthead-wide">
              <SignOut />
            </span>
          </div>
        </header>
        <main>{children}</main>
      </div>

      <OfficeMenu
        primary={tabs.slice(0, PRIMARY_ON_PHONE)}
        rest={tabs.slice(PRIMARY_ON_PHONE)}
        mode={mode}
        canAdmin={canAdmin}
        who={session.fullName}
        role={session.roleName}
        showCrewView={mode === 'office'}
      />
    </div>
  );
}
