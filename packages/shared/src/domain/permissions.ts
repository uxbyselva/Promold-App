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

  // Administration
  'user.manage': 'Invite, edit and deactivate users',
  'user.view_cost_rates': 'See internal cost rates',
  'role.manage': 'Change roles and permission flags',
  'org.manage_settings': 'Change org settings and thresholds',
  'audit.view': 'Read the audit log',
  'costing.view': 'See job cost and margin',
  'export.run': 'Run exports',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLE_KEYS = [
  'owner',
  'manager',
  'crew_lead',
  'technician',
  'bookkeeper',
] as const;

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
