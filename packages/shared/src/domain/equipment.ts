/**
 * Equipment.
 *
 * Three flows that must not collapse into one:
 *   checkout      goes out with a crew and comes back the same visit
 *   site_staging  left running at an address for days, unattended
 *   rental        rented in from a vendor, with a return deadline and a cost
 *
 * Billing is flat per job, so equipment days add no revenue. This exists to
 * know where a unit physically is, and to load real cost onto the job.
 */

export const EQUIPMENT_CATEGORIES = [
  'air_scrubber',
  'dehumidifier',
  'air_mover',
  'meter',
  'hepa_vacuum',
  'negative_air',
  'generator',
  'tool',
  'other',
] as const;

export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  air_scrubber: 'Air scrubber',
  dehumidifier: 'Dehumidifier',
  air_mover: 'Air mover',
  meter: 'Meter',
  hepa_vacuum: 'HEPA vacuum',
  negative_air: 'Negative air machine',
  generator: 'Generator',
  tool: 'Tool',
  other: 'Other',
};

/** Categories normally left running at a site rather than carried back. */
export const STAGED_CATEGORIES: readonly EquipmentCategory[] = [
  'air_scrubber',
  'dehumidifier',
  'air_mover',
  'negative_air',
];

export type PlacementKind = 'checkout' | 'site_staging';

export type LocationStatus =
  'available' | 'in_use' | 'staged_at_site' | 'in_maintenance' | 'retired' | 'lost';

export type EquipmentCondition = 'ok' | 'damaged' | 'needs_service';

export interface Placement {
  startedAt: Date;
  expectedEndAt: Date | null;
  endedAt: Date | null;
}

/**
 * Days a placement contributes to a job's cost. Part days round up: a scrubber
 * collected the morning after it was dropped cost a day of availability.
 */
export function placementDays(placement: Placement, now: Date = new Date()): number {
  const end = placement.endedAt ?? now;
  const ms = end.getTime() - placement.startedAt.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

export function placementCost(
  placement: Placement,
  internalDayRate: number,
  now: Date = new Date(),
): number {
  return placementDays(placement, now) * internalDayRate;
}

export function isPickupOverdue(placement: Placement, now: Date = new Date()): boolean {
  return (
    placement.endedAt === null &&
    placement.expectedEndAt !== null &&
    placement.expectedEndAt.getTime() < now.getTime()
  );
}

export function daysOverdue(placement: Placement, now: Date = new Date()): number {
  if (!isPickupOverdue(placement, now)) return 0;
  return Math.floor((now.getTime() - placement.expectedEndAt!.getTime()) / 86_400_000);
}

/**
 * Whether a unit is free for a window.
 *
 * Planning uses the EXPECTED end while the database's exclusion constraint
 * uses the ACTUAL one: a scrubber due back tomorrow can be scheduled for next
 * week, but it stays in custody at the site until someone collects it. The
 * overdue register reconciles the two when reality lags the plan.
 */
export function isAvailableForWindow(
  placements: Placement[],
  windowStart: Date,
  windowEnd: Date,
): boolean {
  return !placements.some((p) => {
    const end = p.endedAt ?? p.expectedEndAt ?? new Date(8.64e15);
    return p.startedAt < windowEnd && end > windowStart;
  });
}
