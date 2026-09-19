/**
 * Change orders.
 *
 * Every job is billed flat, direct to the customer, with no insurer absorbing
 * overruns. When scope grows mid-job — more rooms affected than the inspection
 * found, rot behind a wall — the extra work is either agreed and priced, or it
 * is done for free.
 *
 * The contract price is derived: base quote plus approved change orders. The
 * original quote stays visible so the growth is auditable.
 */

export const CHANGE_ORDER_STATUSES = [
  'draft',
  'presented',
  'approved',
  'rejected',
  'cancelled',
] as const;

export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number];

/**
 * How the customer's agreement was captured. Residential work is often agreed
 * verbally on site; recording which is which matters if the final bill is ever
 * questioned.
 */
export type ApprovalMethod = 'signature' | 'verbal' | 'written';

export interface ChangeOrder {
  id: string;
  seq: number;
  title: string;
  amount: number | null;
  status: ChangeOrderStatus;
  customerName?: string | null;
  approvalMethod?: ApprovalMethod | null;
}

export const STATUS_LABELS: Record<ChangeOrderStatus, string> = {
  draft: 'Draft',
  presented: 'With customer',
  approved: 'Approved',
  rejected: 'Declined',
  cancelled: 'Cancelled',
};

/** Only a priced change order can be put in front of a customer. */
export function canPresent(co: ChangeOrder, canManage: boolean): boolean {
  return canManage && co.status === 'draft' && co.amount !== null;
}

export function canDecide(co: ChangeOrder, canManage: boolean): boolean {
  return canManage && co.status === 'presented';
}

export function canEdit(co: ChangeOrder, isAuthor: boolean, canManage: boolean): boolean {
  if (co.status === 'draft') return isAuthor || canManage;
  if (co.status === 'presented') return canManage;
  return false;
}

/**
 * What the approval form must collect before it can be submitted. Returns null
 * when the input is complete.
 */
export function approvalGap(
  method: ApprovalMethod,
  input: { customerName?: string | null; signatureId?: string | null },
): string | null {
  if (method === 'signature') {
    return input.signatureId ? null : 'Capture the customer signature';
  }
  return input.customerName && input.customerName.trim().length > 0
    ? null
    : 'Record who agreed on the customer side';
}

export interface ContractPrice {
  basePrice: number;
  approvedTotal: number;
  contractPrice: number;
  /** Presented but not yet decided — money the job may or may not collect. */
  pendingTotal: number;
}

export function contractPrice(basePrice: number, changeOrders: ChangeOrder[]): ContractPrice {
  const sum = (status: ChangeOrderStatus) =>
    changeOrders
      .filter((c) => c.status === status)
      .reduce((total, c) => total + (c.amount ?? 0), 0);

  // A descope credit is a change order too, so approved totals may be negative.
  const approvedTotal = sum('approved');

  return {
    basePrice,
    approvedTotal,
    contractPrice: basePrice + approvedTotal,
    pendingTotal: sum('presented'),
  };
}

/**
 * Change orders that must be settled before the job can be completed. Once the
 * crew drives away, unagreed extra work is never collected.
 */
export function unsettled(changeOrders: ChangeOrder[]): ChangeOrder[] {
  return changeOrders.filter((c) => c.status === 'draft' || c.status === 'presented');
}
