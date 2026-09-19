/** Dates the way a crew reads them, in the browser's own locale rules. */

export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const today = () => isoDay(new Date());

/** The calendar day a timestamp falls on, in local time — not the UTC slice,
 *  which puts an 8pm job on tomorrow for anyone west of Greenwich. */
export const dayOf = (iso: string | null | undefined) => (iso ? isoDay(new Date(iso)) : '');

export const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

export const shortDate = (iso: string) =>
  new Date(`${iso}T00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' });

export const longDate = (iso: string) =>
  new Date(`${iso}T00:00`).toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export const miles = (n: number) =>
  n.toLocaleString([], { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const initials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

export const daysBetween = (from: string, to: string) =>
  Math.round(
    (new Date(`${to}T00:00`).getTime() - new Date(`${from}T00:00`).getTime()) / 86_400_000,
  ) + 1;
