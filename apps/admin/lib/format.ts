export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const today = () => isoDay(new Date());

/** The calendar day a timestamp falls on, in local time. */
export const dayOf = (iso: string | null | undefined) => (iso ? isoDay(new Date(iso)) : '');

export const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

export const longDate = (iso: string) =>
  new Date(`${iso}T00:00`).toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export const shortDate = (iso: string) =>
  new Date(`${iso}T00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' });

export const stamp = (iso: string) =>
  new Date(iso).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : Number(n).toLocaleString([], { style: 'currency', currency: 'USD' });

export const initials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** `2026-09` plus a delta, for the calendar's month links. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y ?? 2026, (m ?? 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const monthName = (month: string) =>
  new Date(`${month}-01T00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' });

/** A `datetime-local` value from a timestamp, for an edit form. */
export const localInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${isoDay(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
