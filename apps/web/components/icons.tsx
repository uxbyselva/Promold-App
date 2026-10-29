import type { ReactNode } from 'react';

/*
 * The line icons from the screen set, traced once.
 *
 * Every one is a 24-unit box drawn with a 1.8 stroke in `currentColor`, so an
 * icon takes the colour of whatever it sits in — the rail's grey, the tab
 * bar's teal when a tab is current — without a second rule per place.
 *
 * No icon font and no package: a dozen paths are smaller than either, and
 * they cannot arrive late and shift the layout.
 */
function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export type IconName =
  | 'today'
  | 'calendar'
  | 'board'
  | 'jobs'
  | 'inbox'
  | 'customers'
  | 'stock'
  | 'equipment'
  | 'people'
  | 'reports'
  | 'admin'
  | 'mileage'
  | 'store'
  | 'timeoff'
  | 'settings'
  | 'search'
  | 'plus'
  | 'more'
  | 'bell';

const PATHS: Record<IconName, ReactNode> = {
  today: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="11" rx="1.5" />
      <rect x="17" y="4" width="4" height="7" rx="1.5" />
    </>
  ),
  jobs: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5h6v2" />
    </>
  ),
  inbox: <path d="M3 13l3-8h12l3 8v6H3zM3 13h5l1 2h6l1-2h5" />,
  customers: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5 6.5-5s5.7 1.5 6.5 5M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .5 3.2 2 3.5 5" />
    </>
  ),
  stock: <path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" />,
  equipment: <path d="M15 4a5 5 0 0 0-4.6 7L4 17.4V20h2.6l6.4-6.4A5 5 0 0 0 20 9l-3 1-2-2 1-3z" />,
  people: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1-4 4-6 8-6s7 2 8 6" />
    </>
  ),
  reports: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  admin: <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />,
  mileage: (
    <>
      <rect x="2" y="7" width="12" height="9" rx="1.5" />
      <path d="M14 10h4l3 3v3h-7z" />
      <circle cx="6" cy="18" r="1.8" />
      <circle cx="17.5" cy="18" r="1.8" />
    </>
  ),
  store: (
    <>
      <circle cx="9.5" cy="20" r="1.6" />
      <circle cx="17.5" cy="20" r="1.6" />
      <path d="M2.5 4h2.2l2.6 11h11L21 7.5H7" />
    </>
  ),
  timeoff: <path d="M6 21V3M6 4h11l-2 4 2 4H6" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </>
  ),
  bell: <path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0" />,
};

export function Icon({ name, size }: { name: IconName; size?: number }) {
  return <Svg size={size}>{PATHS[name]}</Svg>;
}
