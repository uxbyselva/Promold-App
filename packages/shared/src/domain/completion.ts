/**
 * Photo phases.
 *
 * The enum in the database is wider — `during`, `damage`, `equipment` all
 * exist — but a shop offers only the phases in
 * `organizations.settings.photo_phases`. Two galleries is the default: what it
 * looked like before the work, and what it looked like after.
 */
export const DEFAULT_PHOTO_PHASES = ['before', 'after'] as const;

/**
 * Job completion gates.
 *
 * Mirrors `job_completion_blockers()` so the mobile completion screen can list
 * what is outstanding before the user taps, and offer a fix for each. The gate
 * should direct, not merely refuse.
 */

export interface CompletionRequirements {
  photos_before?: boolean;
  photos_after?: boolean;
  customer_signature?: boolean;
  materials_logged?: boolean;
  forms?: string[];
}

export interface CompletionState {
  /**
   * Photo counts by phase. Each photo is its own `job_photos` row, so a phase
   * holds as many as the job needs — the gate only asks for at least one.
   */
  beforePhotoCount: number;
  afterPhotoCount: number;
  hasCompletionSignature: boolean;
  materialsLoggedOrNoneUsed: boolean;
  completedFormKeys: string[];
  openTimeEntryCount: number;
  equipmentStagedWithoutPickup: number;
  rentalsOutstandingWithoutReturnDate: number;
  unsettledChangeOrders: number;
}

export interface Blocker {
  key: string;
  message: string;
  /** What the completion screen should offer to resolve it. */
  action:
    | 'add_photos'
    | 'sign'
    | 'log_materials'
    | 'fill_form'
    | 'clock_out'
    | 'schedule_pickup'
    | 'settle_change_order';
}

export function completionBlockers(
  requirements: CompletionRequirements,
  state: CompletionState,
): Blocker[] {
  const blockers: Blocker[] = [];

  if (requirements.photos_before && state.beforePhotoCount === 0) {
    blockers.push({ key: 'photos_before', message: 'Before photos required', action: 'add_photos' });
  }

  if (requirements.photos_after && state.afterPhotoCount === 0) {
    blockers.push({ key: 'photos_after', message: 'After photos required', action: 'add_photos' });
  }

  if (requirements.customer_signature && !state.hasCompletionSignature) {
    blockers.push({
      key: 'signature',
      message: 'Customer completion signature required',
      action: 'sign',
    });
  }

  if (requirements.materials_logged && !state.materialsLoggedOrNoneUsed) {
    blockers.push({
      key: 'materials',
      message: 'Log materials used, or confirm none were used',
      action: 'log_materials',
    });
  }

  for (const key of requirements.forms ?? []) {
    if (!state.completedFormKeys.includes(key)) {
      blockers.push({ key: `form:${key}`, message: `Form not complete: ${key}`, action: 'fill_form' });
    }
  }

  if (state.openTimeEntryCount > 0) {
    blockers.push({
      key: 'time',
      message: `${state.openTimeEntryCount} person(s) still clocked in`,
      action: 'clock_out',
    });
  }

  // The gate that stops air scrubbers being forgotten at finished jobs.
  // Equipment may stay on site — that is normal — but only if a collection is
  // actually scheduled.
  if (state.equipmentStagedWithoutPickup > 0) {
    blockers.push({
      key: 'equipment',
      message: `${state.equipmentStagedWithoutPickup} item(s) still at site with no pickup scheduled`,
      action: 'schedule_pickup',
    });
  }

  if (state.rentalsOutstandingWithoutReturnDate > 0) {
    blockers.push({
      key: 'rentals',
      message: `${state.rentalsOutstandingWithoutReturnDate} rental(s) outstanding with no return date`,
      action: 'schedule_pickup',
    });
  }

  // Billed flat and direct to the customer: extra work still waiting on an
  // answer is money the job will never collect once the crew drives away.
  if (state.unsettledChangeOrders > 0) {
    blockers.push({
      key: 'change_orders',
      message: `${state.unsettledChangeOrders} change order(s) not yet agreed with the customer`,
      action: 'settle_change_order',
    });
  }

  return blockers;
}

export function canComplete(
  requirements: CompletionRequirements,
  state: CompletionState,
): boolean {
  return completionBlockers(requirements, state).length === 0;
}
