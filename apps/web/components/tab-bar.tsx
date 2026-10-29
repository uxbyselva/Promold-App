'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/my', icon: '◉', label: 'Today' },
  { href: '/my/jobs', icon: '▦', label: 'Jobs' },
  { href: '/my/store', icon: '◈', label: 'Store' },
  { href: '/my/mileage', icon: '⇝', label: 'Mileage' },
  { href: '/my/time-off', icon: '⚑', label: 'Time off' },
];

export function TabBar({ needsAnswer = 0 }: { needsAnswer?: number }) {
  const path = usePathname();
  return (
    <nav className="tabbar" aria-label="Sections">
      {TABS.map((t) => {
        // '/my' is the parent of every other tab, so it matches exactly and
        // never by prefix — otherwise Today lights up on all of them.
        const active =
          t.href === '/my' ? path === '/my' : path === t.href || path.startsWith(`${t.href}/`);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined}>
            <span className="ic" aria-hidden="true">
              {t.icon}
            </span>
            {t.label}
            {t.href === '/my/jobs' && needsAnswer > 0 ? (
              <span className="badge">{needsAnswer}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
