'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SignOut } from './sign-out';

export type MenuTab = { href: string; label: string; badge?: number };

/**
 * Everything the office header cannot fit on a phone.
 *
 * On a desk the masthead carries the mode switch, who you are and a sign-out
 * button, with a row of tabs underneath. On a phone that row scrolled
 * sideways and the whole right-hand group ate the top of the screen, so half
 * the app was behind a swipe nobody knew to make — including, in one report,
 * the Customers tab, which is where the work starts.
 *
 * The first couple of tabs stay on the bar. The rest come in here, with the
 * mode switch and the sign-out, behind one button. Above the breakpoint this
 * whole component is display:none and the header behaves as it always did.
 */
export function OfficeMenu({
  tabs,
  mode,
  canAdmin,
  who,
  role,
  showCrewView,
}: {
  tabs: MenuTab[];
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

  // A badge on something hidden is a badge nobody sees, so it comes out here.
  const hiddenBadges = tabs.reduce((sum, t) => sum + (t.badge ?? 0), 0);

  return (
    <div className="om">
      <button
        className="om-button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">☰</span>
        <span className="om-button-label">Menu</span>
        {hiddenBadges > 0 && !open ? <span className="nav-badge">{hiddenBadges}</span> : null}
      </button>

      {open ? (
        <>
          <button className="om-scrim" aria-label="Close the menu" onClick={() => setOpen(false)} />
          <div className="om-sheet" role="menu">
            <div className="om-who">
              <b>{who}</b>
              <span>{role}</span>
            </div>

            {canAdmin ? (
              <nav className="modes om-modes" aria-label="Mode">
                <Link
                  href="/calendar"
                  data-mode="office"
                  aria-current={mode === 'office' ? 'page' : undefined}
                >
                  Office
                </Link>
                <Link
                  href="/admin"
                  data-mode="admin"
                  aria-current={mode === 'admin' ? 'page' : undefined}
                >
                  Admin
                </Link>
              </nav>
            ) : null}

            {tabs.length ? (
              <div className="om-links">
                {tabs.map((t) => (
                  <Link key={t.href} href={t.href} role="menuitem">
                    {t.label}
                    {t.badge ? <span className="nav-badge">{t.badge}</span> : null}
                  </Link>
                ))}
              </div>
            ) : null}

            {showCrewView ? (
              <div className="om-links">
                <Link href="/my/jobs" role="menuitem">
                  Crew view ↗
                </Link>
              </div>
            ) : null}

            <div className="om-foot">
              <SignOut />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
