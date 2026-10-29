'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SignOut } from './sign-out';
import { Icon, type IconName } from './icons';

export type MenuTab = { href: string; label: string; badge?: number; icon: IconName };

/** Same rule as the rail: /admin exactly, everything else by prefix. */
function isCurrent(path: string, href: string) {
  if (href === '/' || href === '/admin') return path === href;
  return path === href || path.startsWith(`${href}/`);
}

/**
 * The office on a phone.
 *
 * On a desk the navigation is the dark rail down the left and nothing here
 * renders. Below the breakpoint the rail is gone and this takes over: four
 * tabs along the bottom where a thumb is, and everything else — the rest of
 * the sections, the admin side, settings, sign out — behind More.
 *
 * It replaced a row of tabs that scrolled sideways, which hid half the app
 * behind a swipe nobody knew to make, including Customers, which is where
 * the work starts.
 */
export function OfficeMenu({
  primary,
  rest,
  mode,
  canAdmin,
  who,
  role,
  showCrewView,
}: {
  primary: MenuTab[];
  rest: MenuTab[];
  mode: 'office' | 'admin';
  canAdmin: boolean;
  who: string;
  role: string;
  showCrewView: boolean;
}) {
  const [open, setOpen] = useState(false);
  const path = usePathname();

  // Close on navigation. Without this the sheet stays over the page you just
  // asked for, which reads as a tap that did nothing.
  useEffect(() => setOpen(false), [path]);

  // A sheet over the page should not leave the page scrolling behind it.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // A badge on something hidden is a badge nobody sees, so it comes out onto
  // the More tab.
  const hiddenBadges = rest.reduce((sum, t) => sum + (t.badge ?? 0), 0);

  return (
    <div className="om">
      <nav className="tabbar wide" aria-label="Sections">
        {primary.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={isCurrent(path, t.href) ? 'page' : undefined}
          >
            <span className="ic">
              <Icon name={t.icon} size={20} />
            </span>
            {t.label}
            {t.badge ? <span className="badge">{t.badge}</span> : null}
          </Link>
        ))}
        <button
          type="button"
          className="om-more"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="ic">
            <Icon name="more" size={20} />
          </span>
          More
          {hiddenBadges > 0 && !open ? <span className="badge">{hiddenBadges}</span> : null}
        </button>
      </nav>

      {open ? (
        <>
          <button className="om-scrim" aria-label="Close the menu" onClick={() => setOpen(false)} />
          <div className="om-sheet" role="menu">
            <div className="om-who">
              <b>{who}</b>
              <span>{role}</span>
            </div>

            {rest.length ? (
              <div className="om-links">
                {rest.map((t) => (
                  <Link
                    key={t.href}
                    href={t.href}
                    role="menuitem"
                    aria-current={isCurrent(path, t.href) ? 'page' : undefined}
                  >
                    <span className="row" style={{ gap: 10 }}>
                      <Icon name={t.icon} />
                      {t.label}
                    </span>
                    {t.badge ? <span className="nav-badge">{t.badge}</span> : null}
                  </Link>
                ))}
              </div>
            ) : null}

            <div className="om-links">
              {canAdmin ? (
                <Link
                  href={mode === 'admin' ? '/' : '/admin'}
                  role="menuitem"
                  aria-current={mode === 'admin' ? 'page' : undefined}
                >
                  <span className="row" style={{ gap: 10 }}>
                    <Icon name="admin" />
                    {mode === 'admin' ? 'Back to the office' : 'Records and history'}
                  </span>
                </Link>
              ) : null}
              <Link href="/settings" role="menuitem">
                <span className="row" style={{ gap: 10 }}>
                  <Icon name="settings" />
                  Settings
                </span>
              </Link>
              {showCrewView ? (
                <Link href="/my" role="menuitem">
                  <span className="row" style={{ gap: 10 }}>
                    <Icon name="today" />
                    Crew view ↗
                  </span>
                </Link>
              ) : null}
            </div>

            <div className="om-foot">
              <SignOut />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
