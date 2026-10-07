/**
 * Job costing.
 *
 * Mirrors the `job_costs` SQL view. The server is authoritative; this exists
 * for optimistic display and for "what will this cost if it runs another day"
 * projections in the UI.
 *
 * This is the payoff for everything the crew is asked to log. Without it the
 * logging reads as surveillance.
 */

export interface JobCostBreakdown {
  labour: number;
  materials: number;
  purchases: number;
  mileage: number;
  equipment: number;
  rentals: number;
  other: number;
}

export interface JobCostSummary extends JobCostBreakdown {
  totalCost: number;
  quotedPrice: number;
  margin: number;
  marginPct: number | null;
}

export function emptyBreakdown(): JobCostBreakdown {
  return { labour: 0, materials: 0, purchases: 0, mileage: 0, equipment: 0, rentals: 0, other: 0 };
}

export function summarise(breakdown: JobCostBreakdown, quotedPrice: number): JobCostSummary {
  const totalCost =
    breakdown.labour +
    breakdown.materials +
    breakdown.purchases +
    breakdown.mileage +
    breakdown.equipment +
    breakdown.rentals +
    breakdown.other;

  const margin = quotedPrice - totalCost;

  return {
    ...breakdown,
    totalCost: round2(totalCost),
    quotedPrice,
    margin: round2(margin),
    // A job with no quoted price has no meaningful margin percentage; null
    // says so rather than dividing by zero and rendering Infinity.
    marginPct: quotedPrice > 0 ? round2((margin / quotedPrice) * 100) : null,
  };
}

/** Hours worked, less breaks. Matches `time_entry_hours()` in SQL. */
export function entryHours(clockIn: Date, clockOut: Date | null, breakMinutes = 0): number {
  if (!clockOut) return 0;
  const hours = (clockOut.getTime() - clockIn.getTime()) / 3_600_000 - breakMinutes / 60;
  return round2(Math.max(0, hours));
}

export function mileageCost(distance: number, ratePerUnit: number): number {
  return round2(distance * ratePerUnit);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
