'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({
  href,
  badge,
  children,
}: {
  href: string;
  badge?: number;
  children: React.ReactNode;
}) {
  const path = usePathname();
  // /admin must not light up for /admin/activity, but /jobs should for
  // /jobs/new — so the root of each section matches exactly and the rest by
  // prefix. '/' is the root of everything, so it is exact-only too.
  const active =
    href === '/' || href === '/admin'
      ? path === href
      : path === href || path.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}>
      {children}
      {badge ? <span className="nav-badge">{badge}</span> : null}
    </Link>
  );
}
