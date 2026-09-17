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
}

export const JOB_TRANSITIONS: readonly JobTransition[] = [
  { from: 'draft', to: 'scheduled', permission: 'job.edit', guard: 'scheduled', label: 'Schedule' },
  { from: 'scheduled', to: 'assigned', permission: 'job.assign', guard: 'assigned', label: 'Assign' },
  { from: 'scheduled', to: 'cancelled', permission: 'job.edit', guard: 'reason', label: 'Cancel' },
  { from: 'assigned', to: 'accepted', permission: 'job.accept', guard: 'all_accepted', label: 'Accept' },
  { from: 'assigned', to: 'scheduled', permission: 'job.assign', label: 'Unassign' },
  { from: 'assigned', to: 'cancelled', permission: 'job.edit', guard: 'reason', label: 'Cancel' },
  { from: 'accepted', to: 'en_route', permission: 'job.accept', label: 'On my way' },
  { from: 'accepted', to: 'cancelled', permission: 'job.edit', guard: 'reason', label: 'Cancel' },
  { from: 'en_route', to: 'on_site', permission: 'job.accept', label: 'Arrived' },
  { from: 'en_route', to: 'cancelled', permission: 'job.edit', guard: 'reason', label: 'Cancel' },
  { from: 'on_site', to: 'in_progress', permission: 'job.accept', label: 'Start work' },
  { from: 'on_site', to: 'blocked', permission: 'job.accept', guard: 'reason', label: 'Blocked' },
  { from: 'in_progress', to: 'blocked', permission: 'job.accept', guard: 'reason', label: 'Blocked' },
  { from: 'in_progress', to: 'work_complete', permission: 'job.complete', guard: 'completion', label: 'Mark complete' },
  { from: 'in_progress', to: 'cancelled', permission: 'job.edit', guard: 'reason', label: 'Cancel' },
  { from: 'blocked', to: 'in_progress', permission: 'job.accept', label: 'Resume' },
  { from: 'blocked', to: 'cancelled', permission: 'job.edit', guard: 'reason', label: 'Cancel' },
  { from: 'work_complete', to: 'in_progress', permission: 'job.review', guard: 'reason', label: 'Send back' },
  { from: 'work_complete', to: 'approved', permission: 'job.review', label: 'Approve' },
  { from: 'approved', to: 'closed', permission: 'job.close', label: 'Close' },
];

export function transitionsFrom(status: JobStatus): JobTransition[] {
  return JOB_TRANSITIONS.filter((t) => t.from === status);
}

export function isLegalTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

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
