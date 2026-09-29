/**
 * Dates the way the office reads them.
 *
 * Formatted in the company's timezone rather than the viewer's — a job booked
 * for 08:00 in Springfield reads 08:00 whoever is looking — and never using
 * the machine's own locale or zone, because these render on the server first
 * and in the browser second. If those two disagree, React throws out the
 * server's HTML and re-renders. That is a hydration error, and it is what the
 * first version of this file caused.
 */

const ZONE = process.env.NEXT_PUBLIC_ORG_TIMEZONE || 'America/New_York';
const LOCALE = 'en-GB';

/**
 * The y-m-d of a `Date` built from calendar fields — `new Date(y, m, d)` — for
 * laying out a month grid. It reads the machine's calendar, so it is only
 * correct for a Date whose fields were set locally in the first place. Never
 * pass it a timestamp off the database: use `dayOf` or `daySpan`, which count
 * days in the company's zone.
 */
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/*
 * The company's today. `isoDay(new Date())` read the machine's calendar: UTC
 * on the server, the viewer's zone in the browser. After 20:00 in Springfield
 * those are different dates, so the page rendered one day and hydrated
 * another.
 */
export const today = () => dayOf(new Date().toISOString());

/** The calendar day a timestamp falls on, in the company's zone. */
export const dayOf = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: ZONE }) : '';

export const clock = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleTimeString(LOCALE, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: ZONE,
      })
    : '';

/* Date-only strings carry no zone: read them as noon UTC and print as UTC, so
   they never land on the day before. */
const dateOnly = (iso: string) => new Date(`${iso}T12:00:00Z`);

export const longDate = (iso: string) =>
  dateOnly(iso).toLocaleDateString(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export const shortDate = (iso: string) =>
  dateOnly(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const stamp = (iso: string) =>
  new Date(iso).toLocaleString(LOCALE, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: ZONE,
  });

export const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

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
  const d = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const monthName = (month: string) =>
  dateOnly(`${month}-01`).toLocaleDateString(LOCALE, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** A `datetime-local` value from a timestamp, for an edit form. */
export const localInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  // Built from the company-zone parts, so the box shows the time the office
  // booked rather than the time the browser happens to be in.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
};

/**
 * Every company-zone day a job touches, from its start to its end.
 *
 * The old version walked a `Date` with `setDate` and read the day off the
 * machine's calendar. On a server that is UTC, so a job running 22:13 Monday
 * to 04:13 Tuesday in Springfield was 02:13 to 08:13 Tuesday in UTC and lost
 * its Monday entirely — the crew's calendar had no dot on the day they were
 * actually booked. Days are counted in the zone the work happens in.
 */
export const daySpan = (startIso: string, endIso?: string | null) => {
  const first = dayOf(startIso);
  if (!first) return [];
  const last = dayOf(endIso ?? startIso) || first;
  const days: string[] = [];
  let d = first;
  // The guard is the same 90-day one as before: a bad range must not spin.
  for (let i = 0; i < 90 && d <= last; i++) {
    days.push(d);
    const next = dateOnly(d);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  return days;
};

/**
 * The UTC instants a company-zone day begins and ends at.
 *
 * A filter like `gte('scheduled_start', '2026-09-21T00:00:00')` carries no
 * zone, so Postgres reads it in the database's timezone — UTC on Supabase.
 * A job at 20:00 in Springfield is 00:00 the next day in UTC, so it landed on
 * the wrong day's board. Bounding the query in real instants fixes that
 * wherever the database happens to be set.
 */
export const dayWindow = (day: string) => {
  const probe = new Date(`${day}T12:00:00Z`);
  // How far the zone is from UTC on that date, daylight saving included.
  const offset =
    new Date(probe.toLocaleString('en-US', { timeZone: 'UTC' })).getTime() -
    new Date(probe.toLocaleString('en-US', { timeZone: ZONE })).getTime();
  const midnight = Date.parse(`${day}T00:00:00Z`) + offset;
  return {
    from: new Date(midnight).toISOString(),
    to: new Date(midnight + 86_400_000 - 1).toISOString(),
  };
};
