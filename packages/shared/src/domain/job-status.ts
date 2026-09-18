import type { Permission } from './permissions.js';

/**
 * Job lifecycle.
 *
 * The authoritative transition table lives in the `job_transitions` table and
 * is enforced by `transition_job()`. This mirror exists so the clients can
 * render the right buttons without a round trip; it is never the enforcement
 * point.
 */
export const JOB_STATUSES = [
  'draft',
  'scheduled',
  'assigned',
  'accepted',
  'en_route',
  'on_site',
  'in_progress',
  'blocked',
  'work_complete',
  'approved',
  'closed',
  'cancelled',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/** Guards that cannot be evaluated on the client; the server always re-checks. */
export type TransitionGuard =
  | 'scheduled'
  | 'assigned'
  | 'all_accepted'
  | 'completion'
  | 'reason';

export interface JobTransition {
  from: JobStatus;
  to: JobStatus;
  permission: Permission;
  guard?: TransitionGuard;
  /** Button label in the UI. */
  label: string;
  /**
   * Whether this org offers the move. Mirrors `job_transitions.enabled`, and
   * like the rest of this file it is only a mirror — the server refuses a
   * disabled move whether or not the client offered it.
   *
   * The longer flow is switched off rather than deleted, so restoring it is
   * an UPDATE rather than a migration and an app release.
   */
  enabled?: boolean;
}

export const JOB_TRANSITIONS: readonly JobTransition[] = [
  { from: 'draft', to: 'scheduled', permission: 'job.edit', guard: 'scheduled', label: 'Schedule' },
  { from: 'scheduled', to: 'assigned', permission: 'job.assign', guard: 'assigned', label: 'Assign' },
  { from: 'scheduled', to: 'cancelled', permission: 'job.edit', guard: 'reason', label: 'Cancel' },
  { from: 'assigned', to: 'accepted', permission: 'job.accept', guard: 'all_accepted', label: 'Accept' },
  { from: 'assigned', to: 'scheduled', permission: 'job.assign', label: 'Unassign' },
  { from: 'assigned', to: 'cancelled', permission: 'job.edit', guard: 'reason', label: 'Cancel' },
  { from: 'accepted', to: 'in_progress', permission: 'job.accept', label: 'Start work' },
  { from: 'accepted', to: 'en_route', permission: 'job.accept', label: 'On my way', enabled: false },
  { from: 'accepted', to: 'cancelled', permission: 'job.edit', guard: 'reason', label: 'Cancel' },
  { from: 'en_route', to: 'on_site', permission: 'job.accept', label: 'Arrived', enabled: false },
  { from: 'en_route', to: 'cancelled', permission: 'job.edit', guard: 'reason', label: 'Cancel', enabled: false },
  { from: 'on_site', to: 'in_progress', permission: 'job.accept', label: 'Start work', enabled: false },
  { from: 'on_site', to: 'blocked', permission: 'job.accept', guard: 'reason', label: 'Blocked', enabled: false },
  { from: 'in_progress', to: 'blocked', permission: 'job.accept', guard: 'reason', label: 'Blocked', enabled: false },
  { from: 'in_progress', to: 'work_complete', permission: 'job.complete', guard: 'completion', label: 'Mark complete' },
  { from: 'in_progress', to: 'cancelled', permission: 'job.edit', guard: 'reason', label: 'Cancel' },
  { from: 'blocked', to: 'in_progress', permission: 'job.accept', label: 'Resume', enabled: false },
  { from: 'blocked', to: 'cancelled', permission: 'job.edit', guard: 'reason', label: 'Cancel', enabled: false },
  { from: 'work_complete', to: 'in_progress', permission: 'job.review', guard: 'reason', label: 'Send back' },
  { from: 'work_complete', to: 'approved', permission: 'job.review', label: 'Approve' },
  { from: 'approved', to: 'closed', permission: 'job.close', label: 'Close' },
];

/** Every move defined from this status, switched on or not. */
export function transitionsFrom(status: JobStatus): JobTransition[] {
  return JOB_TRANSITIONS.filter((t) => t.from === status);
}

/** The moves to actually offer. This is what a screen should render. */
export function enabledTransitionsFrom(status: JobStatus): JobTransition[] {
  return transitionsFrom(status).filter((t) => t.enabled !== false);
}

export function isLegalTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS.some((t) => t.from === from && t.to === to && t.enabled !== false);
}

/**
 * The steps a crew sees on the progress track.
 *
 * The authoritative list is `organizations.settings.job_steps`, so a shop can
 * run the longer flow without a code change. This is the fallback.
 */
export const DEFAULT_JOB_STEPS: readonly JobStatus[] = [
  'accepted',
  'in_progress',
  'work_complete',
];

export const STEP_LABELS: Record<string, string> = {
  accepted: 'Accepted',
  en_route: 'En route',
  on_site: 'On site',
  in_progress: 'On site / working',
  work_complete: 'Done',
};

/** Statuses a field user sees as "on my plate today". */
export const ACTIVE_FIELD_STATUSES: readonly JobStatus[] = [
  'assigned',
  'accepted',
  'en_route',
  'on_site',
  'in_progress',
  'blocked',
];

export const TERMINAL_STATUSES: readonly JobStatus[] = ['closed', 'cancelled'];

/** Kanban column grouping for the field app's board view. */
export const KANBAN_COLUMNS: { key: string; label: string; statuses: JobStatus[] }[] = [
  { key: 'todo', label: 'To do', statuses: ['assigned', 'accepted'] },
  { key: 'today', label: 'In progress', statuses: ['en_route', 'on_site', 'in_progress'] },
  { key: 'blocked', label: 'Blocked', statuses: ['blocked'] },
  { key: 'done', label: 'Done', statuses: ['work_complete', 'approved', 'closed'] },
];
