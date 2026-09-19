import type { ReactNode } from 'react';
import Link from 'next/link';
import { SignOut } from './sign-out';
import { NavLink, ModeLink } from './nav-link';
import { supabaseServer } from '@/lib/supabase-server';
import type { Session } from '@/lib/session';

/**
 * How many requests are sitting unanswered.
 *
 * Counted on every page rather than only on the approvals page: the point of
 * the badge is that somebody notices without going to look.
 */
async function waitingCount(session: Session): Promise<number> {
  if (!session.can('reschedule.decide') && !session.can('timeoff.manage')) return 0;
  const supabase = await supabaseServer();
  const [moves, off] = await Promise.all([
    session.can('reschedule.decide')
      ? supabase
          .from('reschedule_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
      : Promise.resolve({ count: 0 }),
    session.can('timeoff.manage')
      ? supabase.from('time_off').select('id', { count: 'exact', head: true }).eq('status', 'requested')
      : Promise.resolve({ count: 0 }),
  ]);
  return (moves.count ?? 0) + (off.count ?? 0);
}

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
  const waiting = await waitingCount(session);

  const office: Tab[] = [
    { href: '/calendar', label: 'Calendar', when: session.can('job.assign') },
    { href: '/dispatch', label: 'Board', when: session.can('job.assign') },
    { href: '/jobs', label: 'Jobs', when: true },
    {
      href: '/approvals',
      label: 'Waiting on you',
      when: session.can('reschedule.decide') || session.can('timeoff.manage'),
      badge: waiting,
    },
    { href: '/customers', label: 'Customers', when: session.can('customer.manage') },
  ];
  const admin: Tab[] = [
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
            <NavLink key={t.href} href={t.href} badge={t.badge}>
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
