'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './icons';

const TABS: { href: string; icon: IconName; label: string }[] = [
  { href: '/my', icon: 'today', label: 'Today' },
  { href: '/my/jobs', icon: 'jobs', label: 'Jobs' },
  { href: '/my/store', icon: 'store', label: 'Store' },
  { href: '/my/mileage', icon: 'mileage', label: 'Mileage' },
  // Time off, the theme and your own phone number all live behind Me, which
  // is where the screen set puts them and where a phone app usually keeps
  // them.
  { href: '/settings', icon: 'people', label: 'Me' },
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
            <span className="ic">
              <Icon name={t.icon} size={20} />
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
