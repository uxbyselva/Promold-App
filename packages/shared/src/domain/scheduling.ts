/**
 * Scheduling conflicts.
 *
 * Mirrors `scheduling_conflicts()` in SQL so the dispatch board can warn while
 * the manager is still dragging, before the save round trip. The server
 * re-checks on write; this is for feedback, not enforcement.
 */

export interface Interval {
  start: Date;
  end: Date;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export interface ExistingAssignment extends Interval {
  jobId: string;
  jobNumber: string;
  title: string;
}

export interface ApprovedTimeOff extends Interval {
  kind: string;
}

export interface ConflictInput {
  window: Interval;
  assignments: ExistingAssignment[];
  timeOff: ApprovedTimeOff[];
  excludeJobId?: string;
}

export interface Conflict {
  kind: 'time_off' | 'double_booked';
  message: string;
}

export function findConflicts(input: ConflictInput): Conflict[] {
  const conflicts: Conflict[] = [];

  for (const t of input.timeOff) {
    if (overlaps(input.window, t)) {
      conflicts.push({
        kind: 'time_off',
        message: `Approved time off (${t.kind}) ${formatRange(t)}`,
      });
    }
  }

  for (const a of input.assignments) {
    if (input.excludeJobId && a.jobId === input.excludeJobId) continue;
    if (overlaps(input.window, a)) {
      conflicts.push({
        kind: 'double_booked',
        message: `Already assigned to ${a.jobNumber} (${a.title})`,
      });
    }
  }

  return conflicts;
}

/**
 * Splits a multi-day job into one visit per working day.
 *
 * A three-day remediation is one job with one price and three visits; the
 * dispatch board plots the visits.
 */
export function generateVisits(
  jobStart: Date,
  jobEnd: Date,
  dailyStartHour: number,
  dailyHours: number,
): Interval[] {
  const visits: Interval[] = [];
  const cursor = new Date(jobStart);
  cursor.setHours(0, 0, 0, 0);

  const last = new Date(jobEnd);
  last.setHours(0, 0, 0, 0);

  // Guard against an inverted range producing an unbounded loop.
  if (last < cursor) return visits;

  while (cursor <= last) {
    const start = new Date(cursor);
    start.setHours(dailyStartHour, 0, 0, 0);
    const end = new Date(start.getTime() + dailyHours * 3_600_000);
    visits.push({ start, end });
    cursor.setDate(cursor.getDate() + 1);
  }

  return visits;
}

/** Hours before a job starts at which an unaccepted assignment escalates. */
export const DEFAULT_ESCALATION_HOURS = 12;

export function shouldEscalate(
  jobStart: Date,
  acceptanceStatus: string,
  escalationHours = DEFAULT_ESCALATION_HOURS,
  now: Date = new Date(),
): boolean {
  if (acceptanceStatus !== 'pending') return false;
  const threshold = new Date(jobStart.getTime() - escalationHours * 3_600_000);
  return now >= threshold;
}

function formatRange(i: Interval): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return `${fmt(i.start)} to ${fmt(i.end)}`;
}
