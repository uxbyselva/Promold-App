/**
 * Admin mode: the audit trail, record history and the recycle bin.
 *
 * Mirrors `audit_feed()`, `record_history()` and `deleted_records()`. The
 * database decides who may read any of it — every one of those functions
 * refuses without `audit.view`, and `restore_record()` refuses without
 * `data.restore`. What lives here is presentation: turning a column name and a
 * jsonb diff into something an owner can read at a glance.
 */

export type AuditAction =
  | 'insert'
  | 'update'
  | 'delete'
  | 'soft_delete'
  | 'restore';

export interface AuditEntry {
  id: number;
  at: string;
  tableName: string;
  label: string;
  recordId: string | null;
  action: AuditAction | string;
  actorId: string | null;
  actorName: string;
  fields: string[];
  diff: Record<string, unknown> | null;
}

export interface DeletedRecord {
  tableName: string;
  label: string;
  recordId: string;
  title: string | null;
  ref: string | null;
  deletedAt: string;
  deletedBy: string | null;
  deletedByName: string | null;
  deleteReason: string | null;
  /** The deleted parent standing in the way, or null when it can go back. */
  blockedBy: string | null;
}

/** One changed field, as `record_history` hands it over. */
export interface FieldChange {
  field: string;
  label: string;
  from: unknown;
  to: unknown;
}

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  insert: 'Created',
  update: 'Edited',
  delete: 'Removed',
  soft_delete: 'Deleted',
  restore: 'Restored',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action;
}

/**
 * Column names that do not read as themselves.
 *
 * Everything else falls through to the generic rule below, so this stays a
 * list of exceptions rather than a second copy of the schema that goes stale.
 */
const FIELD_LABELS: Record<string, string> = {
  job_number: 'Job number',
  quoted_price: 'Quoted price',
  scheduled_start: 'Start',
  scheduled_end: 'End',
  actual_start: 'Actual start',
  actual_end: 'Actual end',
  site_id: 'Site',
  customer_id: 'Customer',
  template_id: 'Template',
  parent_job_id: 'Parent job',
  user_id: 'Person',
  assigned_by: 'Assigned by',
  acceptance_status: 'Acceptance',
  blocked_reason: 'Blocked because',
  cancelled_reason: 'Cancelled because',
  delete_reason: 'Reason for deleting',
  deleted_at: 'Deleted',
  deleted_by: 'Deleted by',
  odometer_start: 'Odometer start',
  odometer_end: 'Odometer end',
  continuity_gap: 'Continuity gap',
  is_business: 'Business trip',
  access_notes: 'Getting in',
  address_line1: 'Address',
  address_line2: 'Address, line 2',
  postal_code: 'Postcode',
  cost_rate: 'Cost rate',
  day_rate: 'Day rate',
  internal_day_rate: 'Internal day rate',
  min_level: 'Reorder level',
  is_active: 'Active',
  org_id: 'Organisation',
};

/** `scheduled_start` → `Start`; `make_model` → `Make model`. */
export function fieldLabel(field: string): string {
  const known = FIELD_LABELS[field];
  if (known) return known;
  const words = field.replace(/_id$/, '').replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Pulls the `{field: {old, new}}` shape `audit_row()` writes into a list.
 *
 * An insert or delete stores the whole row under `new` / `old` instead, which
 * is not a change list and is deliberately not forced into one — the caller
 * shows those differently.
 */
export function fieldChanges(diff: Record<string, unknown> | null | undefined): FieldChange[] {
  if (!diff) return [];
  const out: FieldChange[] = [];
  for (const [field, value] of Object.entries(diff)) {
    if (field === 'new' || field === 'old') continue;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const pair = value as Record<string, unknown>;
    if (!('old' in pair) && !('new' in pair)) continue;
    out.push({ field, label: fieldLabel(field), from: pair.old ?? null, to: pair.new ?? null });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** The whole row an insert or delete carries, or null for an edit. */
export function wholeRow(
  diff: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!diff) return null;
  const row = diff.new ?? diff.old;
  return row && typeof row === 'object' && !Array.isArray(row)
    ? (row as Record<string, unknown>)
    : null;
}

/**
 * A one-line summary of an entry, for a feed row.
 *
 * Says what changed rather than that something changed: "Edited — Start,
 * Quoted price" is worth reading, "Edited" is not.
 */
export function describeAuditEntry(entry: Pick<AuditEntry, 'action' | 'fields'>): string {
  const verb = auditActionLabel(entry.action);
  if (entry.action !== 'update' || entry.fields.length === 0) return verb;
  const names = entry.fields.map(fieldLabel);
  if (names.length <= 3) return `${verb} — ${names.join(', ')}`;
  return `${verb} — ${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

/**
 * Whether the recycle bin row can go back right now.
 *
 * `restore_record()` is the enforcement point and refuses on its own; this is
 * so the button can say why before it is pressed.
 */
export function canRestore(
  record: Pick<DeletedRecord, 'blockedBy'>,
  holder: { permissions: Record<string, boolean | undefined> } | null | undefined,
): boolean {
  if (!holder || holder.permissions['data.restore'] !== true) return false;
  return record.blockedBy === null;
}

/** What a row is called in a list, falling back through ref to the id. */
export function recordTitle(
  record: Pick<DeletedRecord, 'title' | 'ref' | 'recordId'>,
): string {
  return record.title ?? record.ref ?? record.recordId.slice(0, 8);
}

/*
 * The database speaks snake_case and these types do not, so the translation
 * happens once, here, rather than in every screen that reads one of these
 * functions. Changing a column name then breaks in one place.
 */

export interface DeletedRecordRow {
  table_name: string;
  label: string;
  record_id: string;
  title: string | null;
  ref: string | null;
  deleted_at: string;
  deleted_by: string | null;
  deleted_by_name: string | null;
  delete_reason: string | null;
  blocked_by: string | null;
}

export function toDeletedRecord(row: DeletedRecordRow): DeletedRecord {
  return {
    tableName: row.table_name,
    label: row.label,
    recordId: row.record_id,
    title: row.title,
    ref: row.ref,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deletedByName: row.deleted_by_name,
    deleteReason: row.delete_reason,
    blockedBy: row.blocked_by,
  };
}

export interface AuditEntryRow {
  id: number;
  at: string;
  table_name: string;
  label: string;
  record_id: string | null;
  action: string;
  actor_id: string | null;
  actor_name: string;
  fields: string[] | null;
  diff: Record<string, unknown> | null;
}

export function toAuditEntry(row: AuditEntryRow): AuditEntry {
  return {
    id: row.id,
    at: row.at,
    tableName: row.table_name,
    label: row.label,
    recordId: row.record_id,
    action: row.action,
    actorId: row.actor_id,
    actorName: row.actor_name,
    fields: row.fields ?? [],
    diff: row.diff,
  };
}
