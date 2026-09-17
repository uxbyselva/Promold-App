import type { Permission } from './permissions.js';

export const PURCHASE_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'ordered',
  'partially_received',
  'received',
  'closed',
  'cancelled',
] as const;

export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export type PurchaseLineStatus = 'pending' | 'approved' | 'rejected';

export interface PurchaseTransition {
  from: PurchaseStatus;
  to: PurchaseStatus;
  permission: Permission | 'requester';
  label: string;
  reasonRequired?: boolean;
}

export const PURCHASE_TRANSITIONS: readonly PurchaseTransition[] = [
  { from: 'draft', to: 'submitted', permission: 'requester', label: 'Submit' },
  // Recall is available only while no approver has picked the request up.
  { from: 'submitted', to: 'draft', permission: 'requester', label: 'Recall to draft' },
  { from: 'submitted', to: 'under_review', permission: 'purchase.approve', label: 'Start review' },
  { from: 'submitted', to: 'approved', permission: 'purchase.approve', label: 'Approve' },
  { from: 'submitted', to: 'rejected', permission: 'purchase.approve', label: 'Reject', reasonRequired: true },
  { from: 'under_review', to: 'approved', permission: 'purchase.approve', label: 'Approve' },
  { from: 'under_review', to: 'rejected', permission: 'purchase.approve', label: 'Reject', reasonRequired: true },
  { from: 'approved', to: 'ordered', permission: 'purchase.approve', label: 'Mark ordered' },
  { from: 'received', to: 'closed', permission: 'purchase.approve', label: 'Close' },
];

/** Editing is locked on submit, not on approval. */
export function isEditable(status: PurchaseStatus, isRequester: boolean, canApprove: boolean): boolean {
  if (status === 'draft') return isRequester;
  if (status === 'under_review') return canApprove;
  return false;
}

export function canRecall(status: PurchaseStatus, isRequester: boolean): boolean {
  return status === 'submitted' && isRequester;
}

/**
 * Whether this request needs owner sign-off rather than a manager's.
 * The server re-checks against org settings; this only drives the UI hint.
 */
export function needsOwnerApproval(total: number, threshold: number): boolean {
  return total > threshold;
}
