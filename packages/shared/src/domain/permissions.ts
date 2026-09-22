/**
 * Permission flags.
 *
 * A role is a bundle of these, stored as jsonb on the `roles` row. Code checks
 * a flag, never a role name — within six months someone needs an exception (a
 * senior tech who can approve small purchases, a foreman who can adjust van
 * stock) and a flag makes that a data change rather than a refactor.
 *
 * This list is the contract with `roles.permissions` and the `has_permission()`
 * SQL function. Adding a flag here means adding it to a role in
 * `provision_org_roles()` too.
 */
export const PERMISSIONS = {
  // Jobs and scheduling
  'job.view_all': 'See every job, not only your own assignments',
  'job.edit': 'Create, edit, reschedule and cancel jobs',
  'job.assign': 'Assign jobs to people and crews',
  'job.accept': 'Accept an assignment and move a job through its work states',
  'job.complete': 'Mark work complete (subject to the completion gates)',
  'job.review': 'Approve completed work or send it back for rework',
  'job.close': 'Close an approved job',
  'job.manage_templates': 'Manage job templates and form templates',
  'reschedule.decide': 'Approve or decline reschedule requests',

  // Change orders
  // Split deliberately: the crew lead who opens a wall and finds rot is the
  // person who knows, but pricing it is the manager's.
  'changeorder.draft': 'Raise a change order describing extra work found',
  'changeorder.manage': 'Price, present and record the decision on a change order',

  // Customers
  'customer.manage': 'Manage customers and sites',

  // Inventory
  'inventory.manage': 'Manage the item catalogue, locations and suppliers',
  'inventory.log_usage': 'Log material used on a job',
  'inventory.transfer': 'Move stock between locations',
  'inventory.adjust': 'Stock adjustments and cycle counts',

  // Purchasing
  'purchase.approve': 'Approve purchase requests up to the org threshold',
  'purchase.approve_unlimited': 'Approve above the threshold',
  'purchase.view_all': 'See every purchase request',
  'purchase.view_history': 'See the edit history of a request',

  // Vehicles
  'vehicle.manage': 'Manage the vehicle register and maintenance',
  'mileage.view_all': 'See everyone’s mileage',
  'mileage.edit_all': 'Edit a submitted mileage log',

  // Equipment
  'equipment.manage': 'Manage the equipment register',
  'equipment.place': 'Stage, check out and collect equipment',
  'equipment.rental_manage': 'Create rental agreements and enter rental cost',

  // Time
  'time.view_all': 'See everyone’s time entries',
  'time.log_others': 'Clock other people in and out',
  'time.edit_all': 'Edit a submitted time entry',
  'timeoff.manage': 'Approve or decline time off',

  // Money
  // Two separate questions: what the customer pays, and what the job cost us.
  // A role can reasonably hold one without the other — a bookkeeper needs the
  // price, and so does a crew lead, who has to recognise when the work has
  // outgrown the quote. Neither of them sees the margin.
  'price.view': 'See the quoted and contract price of a job',
  'costing.view': 'See job cost and margin',

  // Administration
  'user.manage': 'Invite, edit and deactivate users',
  'user.view_cost_rates': 'See internal cost rates',
  'role.manage': 'Change roles and permission flags',
  'org.manage_settings': 'Change org settings and thresholds',
  'audit.view': 'Read the audit log, the record history and the recycle bin',
  // Deliberately not implied by any delete permission. Whoever can remove a
  // customer is not automatically the person who decides it comes back.
  'data.restore': 'Restore a soft-deleted record',
  'export.run': 'Run exports',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLE_KEYS = ['owner', 'manager', 'crew_lead', 'technician', 'bookkeeper'] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export interface PermissionHolder {
  permissions: Partial<Record<Permission, boolean>>;
  permissionOverrides?: Partial<Record<Permission, boolean>>;
  isActive?: boolean;
}

/**
 * Mirrors the SQL `has_permission()`. The database is the enforcement point;
 * this exists so the UI can hide what the user cannot do, not to decide it.
 */
export function can(holder: PermissionHolder | null | undefined, flag: Permission): boolean {
  if (!holder) return false;
  if (holder.isActive === false) return false;
  return holder.permissionOverrides?.[flag] === true || holder.permissions[flag] === true;
}

export function canAny(holder: PermissionHolder | null | undefined, flags: Permission[]): boolean {
  return flags.some((f) => can(holder, f));
}

export function canAll(holder: PermissionHolder | null | undefined, flags: Permission[]): boolean {
  return flags.every((f) => can(holder, f));
}

/**
 * Whether this user may see what a job is worth.
 *
 * The database is the enforcement point: `jobs_safe` and `change_orders_safe`
 * null the money columns for anyone without the flag, and the columns are
 * revoked outright on the base tables. This is only so the UI does not render
 * an empty price panel.
 */
export function canSeePrice(holder: PermissionHolder | null | undefined): boolean {
  return can(holder, 'price.view');
}

/** Whether this user may see what a job cost and what it earned. */
export function canSeeMargin(holder: PermissionHolder | null | undefined): boolean {
  return can(holder, 'costing.view');
}

/**
 * Whether the admin area — history, the audit trail, the recycle bin — is open
 * to this user at all. Reading it and acting on it are separate questions;
 * `data.restore` answers the second.
 */
export function canSeeAdmin(holder: PermissionHolder | null | undefined): boolean {
  return can(holder, 'audit.view');
}
