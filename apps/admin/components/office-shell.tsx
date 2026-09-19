import type { ReactNode } from 'react';
import Link from 'next/link';
import { SignOut } from './sign-out';
import { NavLink, ModeLink } from './nav-link';
import type { Session } from '@/lib/session';

/**
 * Two modes, one login.
 *
 * Office is the day job: put work on the calendar, edit it, look after
 * customers. Admin is the other question — what happened to this record, who
 * changed it, and can I get back the thing I deleted. Keeping them apart means
 * the everyday screens are not cluttered with forensics, and the forensics are
 * somewhere deliberate rather than hidden behind a long-press.
 */
export function OfficeShell({
  session,
  mode,
  children,
}: {
  session: Session;
  mode: 'office' | 'admin';
  children: ReactNode;
}) {
  const canAdmin = session.can('audit.view');
  const office = [
    { href: '/calendar', label: 'Calendar', when: session.can('job.assign') },
    { href: '/dispatch', label: 'Board', when: session.can('job.assign') },
    { href: '/jobs', label: 'Jobs', when: true },
    { href: '/customers', label: 'Customers', when: session.can('customer.manage') },
  ];
  const admin = [
    { href: '/admin', label: 'Overview', when: true },
    { href: '/admin/activity', label: 'Activity', when: true },
    { href: '/admin/deleted', label: 'Deleted', when: true },
    { href: '/admin/roles', label: 'Roles', when: true },
  ];
  const tabs = (mode === 'admin' ? admin : office).filter((t) => t.when);

  return (
    <div className="office">
      <header className="masthead">
        <div className="masthead-row">
          <div className="brand">
            <b>Promold</b>
            <span>{mode === 'admin' ? 'Records and history' : 'The office'}</span>
          </div>

          <div className="row" style={{ gap: 14 }}>
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
          {tabs.map((t) => (
            <NavLink key={t.href} href={t.href}>
              {t.label}
            </NavLink>
          ))}
          {mode === 'office' ? (
            <Link
              className="nav-field"
              href="/field-app"
              style={{
                marginLeft: 'auto',
                alignSelf: 'center',
                fontSize: 12.5,
                color: 'var(--muted)',
                textDecoration: 'none',
                paddingBottom: 8,
              }}
            >
              Crew app ↗
            </Link>
          ) : null}
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
