/**
 * Consumables: the three ways a stocked thing gets used up.
 *
 * Mirrors `consumption_mode` and the pack functions in SQL. The database
 * decides — `open_pack()` refuses a non-bulk item, `job_pack_cost()` does the
 * real split. This exists so the UI can offer the right verb and show the
 * share before anyone commits to it.
 */

export const CONSUMPTION_MODES = {
  single_use: {
    label: 'Counted out',
    examples: 'Masks, gloves, coveralls, filters',
    verb: 'Log what was used',
    costs: 'The job it was used on',
  },
  bulk: {
    label: 'Opened as a pack',
    examples: 'Bags, poly sheeting, chemical drums',
    verb: 'Open a pack',
    costs: 'Split across every job the pack served',
  },
  returnable: {
    label: 'Goes out and comes back',
    examples: 'Cords, buckets, hand tools',
    verb: 'Take it out',
    costs: 'Nothing — it comes home',
  },
} as const;

export type ConsumptionMode = keyof typeof CONSUMPTION_MODES;

export function modeLabel(mode: string): string {
  return CONSUMPTION_MODES[mode as ConsumptionMode]?.label ?? mode;
}

/** Whether this item is opened rather than counted. */
export function isPack(mode: string): mode is 'bulk' {
  return mode === 'bulk';
}

export interface PackShare {
  /** The whole pack, as it cost when it came off the shelf. */
  total: number;
  jobs: number;
  /** What each job carries, or null when nothing has been logged against it. */
  each: number | null;
}

/**
 * What one job will carry once a pack is finished.
 *
 * Even split, because the alternative is asking a technician what fraction of
 * a box of bags a job used — which produces a number, but not a true one.
 * A pack logged against no job lands on the business rather than being
 * quietly spread over unrelated work.
 */
export function packShare(unitCost: number, jobsServed: number): PackShare {
  if (jobsServed <= 0) return { total: unitCost, jobs: 0, each: null };
  return {
    total: unitCost,
    jobs: jobsServed,
    each: Math.round((unitCost / jobsServed) * 100) / 100,
  };
}

/**
 * What finishing this pack right now would put on each job.
 *
 * Shown before the button is pressed, because "this costs every job $31" is
 * the sentence that makes someone check they logged the right jobs.
 */
export function describePackShare(unitCost: number, jobsServed: number): string {
  const share = packShare(unitCost, jobsServed);
  if (share.each === null) {
    return 'No job logged against it — this one lands on the business.';
  }
  return `Splits ${money(share.total)} across ${share.jobs} ${
    share.jobs === 1 ? 'job' : 'jobs'
  } — ${money(share.each)} each.`;
}

/** Whether a counted item has dropped to the point of reordering. */
export function isLow(onHand: number, minLevel: number): boolean {
  return minLevel > 0 && onHand <= minLevel;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}
