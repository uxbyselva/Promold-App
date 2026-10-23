/**
 * Dates, the same way everywhere in the app.
 *
 * Two rules, both learned the hard way.
 *
 * **Everything is formatted in the company's timezone, not the viewer's.** A
 * job booked for 08:00 in Springfield reads 08:00 whoever is looking. A crew
 * lead checking the schedule from a hotel in another state should not see the
 * day shift under him.
 *
 * **Nothing is formatted using the machine's locale or zone.** These run on
 * the server first and in the browser second, and if the two disagree by so
 * much as a space React throws out the server's HTML and re-renders — which
 * is what a hydration error is, and what the first version of this file
 * caused.
 */

// The company's zone. Overridable per deployment; the default is where the
// work is.
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
export const dayOf = (iso: string | null | undefined) => {
  if (!iso) return '';
  // en-CA gives YYYY-MM-DD, which is the shape the rest of the app compares.
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: ZONE });
};

export const clock = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleTimeString(LOCALE, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: ZONE,
      })
    : '';

/*
 * A date-only string has no time and no zone, so it is read as noon UTC and
 * printed as UTC. Reading it as local midnight would put it on the day before
 * for anyone west of Greenwich.
 */
const dateOnly = (iso: string) => new Date(`${iso}T12:00:00Z`);

export const shortDate = (iso: string) =>
  dateOnly(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const longDate = (iso: string) =>
  dateOnly(iso).toLocaleDateString(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export const monthName = (month: string) =>
  dateOnly(`${month}-01`).toLocaleDateString(LOCALE, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export const miles = (n: number) =>
  n.toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

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

export const daysBetween = (from: string, to: string) =>
  Math.round((dateOnly(to).getTime() - dateOnly(from).getTime()) / 86_400_000) + 1;

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

/* ---------------------------------------------------------------------
 * The office needs three more: a full timestamp for the audit trail, month
 * arithmetic for the calendar, and the value shape a datetime-local input
 * wants. The crew screens never show any of them.
 * ------------------------------------------------------------------- */

export const stamp = (iso: string) =>
  new Date(iso).toLocaleString(LOCALE, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: ZONE,
  });

/** `2026-09` plus a delta, for the calendar's month links. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The instant a `datetime-local` box means, read in the company's zone.
 *
 * The inverse of `localInput`, and it has to exist because the two halves
 * disagreed: the box was filled from company-zone parts and read back with
 * `new Date(value)`, which interprets the wall-clock text in whatever zone
 * the browser is in. For anyone outside Springfield that meant opening a job,
 * pressing Save without touching anything, and silently moving it — by five
 * hours from London, by nine and a half from Chennai.
 *
 * The text is read as if it were UTC and then corrected by the zone's offset
 * at that moment. Twice, because on the two days a year the clocks move the
 * correction can land on the other side of the change.
 */
export const fromLocalInput = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  const naive = Date.parse(`${withSeconds}Z`);
  if (Number.isNaN(naive)) return null;
  const offsetAt = (ms: number) =>
    new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'UTC' })).getTime() -
    new Date(new Date(ms).toLocaleString('en-US', { timeZone: ZONE })).getTime();
  const once = naive + offsetAt(naive);
  return new Date(naive + offsetAt(once)).toISOString();
};

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
