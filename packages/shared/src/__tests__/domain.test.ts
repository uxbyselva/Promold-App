import { describe, expect, it } from 'vitest';
import {
  can,
  modeLabel,
  isPack,
  packShare,
  describePackShare,
  isLow,
  canSeeAdmin,
  auditActionLabel,
  fieldLabel,
  fieldChanges,
  wholeRow,
  describeAuditEntry,
  canRestore,
  recordTitle,
  isLegalTransition,
  transitionsFrom,
  enabledTransitionsFrom,
  DEFAULT_JOB_STEPS,
  placementDays,
  placementCost,
  isAvailableForWindow,
  isPickupOverdue,
  daysOverdue,
  completionBlockers,
  completionWarnings,
  canComplete,
  findConflicts,
  generateVisits,
  shouldEscalate,
  summarise,
  entryHours,
  isEditable,
  canRecall,
  needsOwnerApproval,
  mileageLogSchema,
  purchaseRequestSchema,
  rescheduleRequestSchema,
  contractPrice,
  unsettled,
  canPresent,
  canDecide,
  canEdit,
  approvalGap,
  type ChangeOrder,
  canSeePrice,
  canSeeMargin,
} from '../index.js';

const day = 86_400_000;
const at = (isoDay: number, hour = 0) =>
  new Date(Date.UTC(2026, 0, isoDay, hour, 0, 0));

describe('permissions', () => {
  const tech = { permissions: { 'equipment.place': true } as const };

  it('grants what the role grants', () => {
    expect(can(tech, 'equipment.place')).toBe(true);
  });

  it('denies what the role does not grant', () => {
    expect(can(tech, 'purchase.approve')).toBe(false);
  });

  it('honours a per-user override, which is the point of flags over role names', () => {
    const senior = { ...tech, permissionOverrides: { 'purchase.approve': true } as const };
    expect(can(senior, 'purchase.approve')).toBe(true);
  });

  it('denies everything to a deactivated user', () => {
    expect(can({ ...tech, isActive: false }, 'equipment.place')).toBe(false);
  });

  it('denies everything when there is no user', () => {
    expect(can(null, 'equipment.place')).toBe(false);
  });
});

describe('money visibility', () => {
  const crew = { permissions: { 'job.accept': true, 'changeorder.draft': true } as const };
  const manager = { permissions: { 'price.view': true, 'costing.view': true } as const };
  const bookkeeper = { permissions: { 'price.view': true, 'costing.view': true } as const };

  it('keeps the price away from the crew', () => {
    expect(canSeePrice(crew)).toBe(false);
    expect(canSeeMargin(crew)).toBe(false);
  });

  it('shows the price to a manager', () => {
    expect(canSeePrice(manager)).toBe(true);
  });

  it('shows the price to whoever keeps the books', () => {
    expect(canSeePrice(bookkeeper)).toBe(true);
  });

  it('treats price and margin as separate grants', () => {
    // Seeing what the customer pays and seeing what the job cost us are
    // different questions; a role can hold one without the other.
    const priceOnly = { permissions: { 'price.view': true } as const };
    expect(canSeePrice(priceOnly)).toBe(true);
    expect(canSeeMargin(priceOnly)).toBe(false);
  });

  it('still lets the crew raise a change order without seeing its value', () => {
    expect(can(crew, 'changeorder.draft')).toBe(true);
    expect(canSeePrice(crew)).toBe(false);
  });
});

describe('job transitions', () => {
  it('permits the normal path', () => {
    expect(isLegalTransition('in_progress', 'work_complete')).toBe(true);
  });

  it('refuses a jump that skips the work', () => {
    expect(isLegalTransition('draft', 'closed')).toBe(false);
    expect(isLegalTransition('scheduled', 'work_complete')).toBe(false);
  });

  it('allows rework from work_complete back to in_progress', () => {
    expect(isLegalTransition('work_complete', 'in_progress')).toBe(true);
  });

  it('offers no moves out of a closed job', () => {
    expect(transitionsFrom('closed')).toHaveLength(0);
  });

  it('runs accept straight into work, with no separate arrival step', () => {
    expect(isLegalTransition('accepted', 'in_progress')).toBe(true);
  });

  it('treats a switched-off step as not legal, though it still exists', () => {
    // Disabled rather than deleted: restoring the longer flow is an UPDATE,
    // not a migration and an app release.
    expect(isLegalTransition('accepted', 'en_route')).toBe(false);
    expect(transitionsFrom('accepted').some((t) => t.to === 'en_route')).toBe(true);
  });

  it('offers only enabled moves to a screen', () => {
    const offered = enabledTransitionsFrom('accepted').map((t) => t.to);
    expect(offered).toContain('in_progress');
    expect(offered).not.toContain('en_route');
  });

  it('shows the crew three steps', () => {
    expect(DEFAULT_JOB_STEPS).toEqual(['accepted', 'in_progress', 'work_complete']);
  });

  it('requires a reason to cancel', () => {
    const cancel = transitionsFrom('in_progress').find((t) => t.to === 'cancelled');
    expect(cancel?.guard).toBe('reason');
  });
});

describe('equipment placement', () => {
  it('rounds part days up, because availability is consumed by the day', () => {
    const p = { startedAt: at(1, 9), expectedEndAt: null, endedAt: at(1, 17) };
    expect(placementDays(p)).toBe(1);
  });

  it('counts a multi-day staging', () => {
    const p = { startedAt: at(1), expectedEndAt: null, endedAt: at(4) };
    expect(placementDays(p)).toBe(3);
  });

  it('keeps accruing cost while a unit is still out', () => {
    const p = { startedAt: at(1), expectedEndAt: at(2), endedAt: null };
    expect(placementCost(p, 18, at(4))).toBe(3 * 18);
  });

  it('flags an uncollected unit past its expected date', () => {
    const p = { startedAt: at(1), expectedEndAt: at(2), endedAt: null };
    expect(isPickupOverdue(p, at(5))).toBe(true);
    expect(daysOverdue(p, at(5))).toBe(3);
  });

  it('does not flag a unit that came back on time', () => {
    const p = { startedAt: at(1), expectedEndAt: at(3), endedAt: at(2) };
    expect(isPickupOverdue(p, at(5))).toBe(false);
  });

  describe('availability', () => {
    // Planning uses the expected end; custody uses the actual one.
    const staged = { startedAt: at(1), expectedEndAt: at(3), endedAt: null };

    it('refuses a window that overlaps the planned deployment', () => {
      expect(isAvailableForWindow([staged], at(2), at(2, 12))).toBe(false);
    });

    it('allows a window after the planned return, even before collection', () => {
      expect(isAvailableForWindow([staged], at(10), at(11))).toBe(true);
    });

    it('treats an open-ended placement as occupied indefinitely', () => {
      const openEnded = { startedAt: at(1), expectedEndAt: null, endedAt: null };
      expect(isAvailableForWindow([openEnded], at(100), at(101))).toBe(false);
    });

    it('frees a unit once its placement actually closed', () => {
      const returned = { startedAt: at(1), expectedEndAt: at(9), endedAt: at(2) };
      expect(isAvailableForWindow([returned], at(3), at(4))).toBe(true);
    });
  });
});

describe('completion gates', () => {
  const requirements = {
    photos_before: true,
    photos_after: true,
    customer_signature: true,
    materials_logged: true,
    forms: ['ppe_safety'],
  };

  const clean = {
    beforePhotoCount: 6,
    afterPhotoCount: 4,
    hasCompletionSignature: true,
    materialsLoggedOrNoneUsed: true,
    completedFormKeys: ['ppe_safety'],
    openTimeEntryCount: 0,
    equipmentStagedWithoutPickup: 0,
    rentalsOutstanding: 0,
    unsettledChangeOrders: 0,
  };

  it('passes when everything is in place', () => {
    expect(canComplete(requirements, clean)).toBe(true);
  });

  it('asks only for at least one photo per required phase, never a cap', () => {
    expect(canComplete(requirements, { ...clean, beforePhotoCount: 1, afterPhotoCount: 1 })).toBe(true);
    expect(canComplete(requirements, { ...clean, beforePhotoCount: 240, afterPhotoCount: 180 })).toBe(true);
  });

  it('names each missing item rather than failing opaquely', () => {
    const blockers = completionBlockers(requirements, {
      ...clean,
      afterPhotoCount: 0,
      completedFormKeys: [],
    });
    expect(blockers.map((b) => b.key)).toEqual(['photos_after', 'form:ppe_safety']);
  });

  it('blocks on equipment left at site with no pickup scheduled', () => {
    const blockers = completionBlockers(requirements, {
      ...clean,
      equipmentStagedWithoutPickup: 2,
    });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]!.action).toBe('schedule_pickup');
  });

  it('allows equipment to stay on site when a pickup is scheduled', () => {
    // Equipment staying put between visits is normal; only the unscheduled
    // case is a problem.
    expect(canComplete(requirements, { ...clean, equipmentStagedWithoutPickup: 0 })).toBe(true);
  });

  it('does not block on open clocks — finishing the job is the clock-out', () => {
    // Demanding a clock-out before allowing completion was a loop, and it made
    // a crew lead wait on two colleagues tapping buttons on their own phones.
    expect(canComplete(requirements, { ...clean, openTimeEntryCount: 2 })).toBe(true);
  });

  it('tells the crew their clocks are about to close', () => {
    const w = completionWarnings({ ...clean, openTimeEntryCount: 2 });
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toMatch(/clocked out/);
  });

  it('does not block on a rental the office has not chased', () => {
    expect(canComplete(requirements, { ...clean, rentalsOutstanding: 1 })).toBe(true);
    expect(completionWarnings({ ...clean, rentalsOutstanding: 1 })[0]!.message)
      .toMatch(/office will be told/);
  });

  it('stays silent when there is nothing to say', () => {
    expect(completionWarnings(clean)).toHaveLength(0);
  });

  it('blocks while a change order is still unagreed', () => {
    const blockers = completionBlockers(requirements, { ...clean, unsettledChangeOrders: 1 });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]!.action).toBe('settle_change_order');
  });

  it('skips requirements the template does not ask for', () => {
    expect(canComplete({ photos_before: true }, { ...clean, afterPhotoCount: 0 })).toBe(true);
  });
});

describe('scheduling', () => {
  it('reports approved time off as a conflict', () => {
    const conflicts = findConflicts({
      window: { start: at(5, 8), end: at(5, 16) },
      assignments: [],
      timeOff: [{ start: at(4), end: at(7), kind: 'vacation' }],
    });
    expect(conflicts[0]!.kind).toBe('time_off');
  });

  it('reports a double booking', () => {
    const conflicts = findConflicts({
      window: { start: at(5, 8), end: at(5, 16) },
      assignments: [
        { start: at(5, 12), end: at(5, 18), jobId: 'j1', jobNumber: 'J00101', title: 'Inspection' },
      ],
      timeOff: [],
    });
    expect(conflicts[0]!.kind).toBe('double_booked');
  });

  it('ignores the job being rescheduled', () => {
    const conflicts = findConflicts({
      window: { start: at(5, 8), end: at(5, 16) },
      assignments: [
        { start: at(5, 12), end: at(5, 18), jobId: 'j1', jobNumber: 'J00101', title: 'Inspection' },
      ],
      timeOff: [],
      excludeJobId: 'j1',
    });
    expect(conflicts).toHaveLength(0);
  });

  it('treats back-to-back bookings as no conflict', () => {
    const conflicts = findConflicts({
      window: { start: at(5, 16), end: at(5, 20) },
      assignments: [
        { start: at(5, 8), end: at(5, 16), jobId: 'j1', jobNumber: 'J00101', title: 'Inspection' },
      ],
      timeOff: [],
    });
    expect(conflicts).toHaveLength(0);
  });

  it('splits a multi-day job into one visit per day', () => {
    const visits = generateVisits(at(1), at(3), 8, 8);
    expect(visits).toHaveLength(3);
    expect(visits[0]!.start.getHours()).toBe(8);
  });

  it('returns no visits for an inverted range rather than looping', () => {
    expect(generateVisits(at(5), at(1), 8, 8)).toHaveLength(0);
  });

  it('escalates an unaccepted assignment inside the window', () => {
    const start = at(5, 8);
    expect(shouldEscalate(start, 'pending', 12, new Date(start.getTime() - 6 * 3_600_000))).toBe(true);
  });

  it('does not escalate once accepted', () => {
    const start = at(5, 8);
    expect(shouldEscalate(start, 'accepted', 12, new Date(start.getTime() - 1 * 3_600_000))).toBe(false);
  });

  it('does not escalate while there is still time', () => {
    const start = at(5, 8);
    expect(shouldEscalate(start, 'pending', 12, new Date(start.getTime() - 2 * day))).toBe(false);
  });
});

describe('costing', () => {
  it('sums the components and derives margin', () => {
    const s = summarise(
      { labour: 660, materials: 300, purchases: 100, mileage: 40, equipment: 192, rentals: 270, other: 0 },
      8600,
    );
    expect(s.totalCost).toBe(1562);
    expect(s.margin).toBe(7038);
    expect(s.marginPct).toBeCloseTo(81.84, 1);
  });

  it('reports a loss as a negative margin rather than hiding it', () => {
    const s = summarise(
      { labour: 5000, materials: 0, purchases: 0, mileage: 0, equipment: 0, rentals: 0, other: 0 },
      4000,
    );
    expect(s.margin).toBe(-1000);
  });

  it('returns a null margin percentage when nothing was quoted', () => {
    const s = summarise(
      { labour: 100, materials: 0, purchases: 0, mileage: 0, equipment: 0, rentals: 0, other: 0 },
      0,
    );
    expect(s.marginPct).toBeNull();
  });

  it('deducts breaks from clocked hours', () => {
    expect(entryHours(at(1, 8), at(1, 16), 30)).toBe(7.5);
  });

  it('counts an open entry as zero hours', () => {
    expect(entryHours(at(1, 8), null)).toBe(0);
  });
});

describe('purchase requests', () => {
  it('lets the requester edit a draft', () => {
    expect(isEditable('draft', true, false)).toBe(true);
  });

  it('locks the requester out once submitted', () => {
    expect(isEditable('submitted', true, false)).toBe(false);
  });

  it('lets an approver edit under review', () => {
    expect(isEditable('under_review', false, true)).toBe(true);
  });

  it('allows recall while submitted and untouched', () => {
    expect(canRecall('submitted', true)).toBe(true);
    expect(canRecall('under_review', true)).toBe(false);
  });

  it('routes above-threshold spend to the owner', () => {
    expect(needsOwnerApproval(750, 500)).toBe(true);
    expect(needsOwnerApproval(500, 500)).toBe(false);
  });
});

describe('change orders', () => {
  const co = (over: Partial<ChangeOrder> = {}): ChangeOrder => ({
    id: 'co1',
    seq: 1,
    title: 'Rot behind north wall',
    amount: 1250,
    status: 'draft',
    ...over,
  });

  it('adds approved change orders to the base quote', () => {
    const p = contractPrice(8600, [co({ status: 'approved' })]);
    expect(p.contractPrice).toBe(9850);
    expect(p.basePrice).toBe(8600);
  });

  it('ignores a declined change order', () => {
    const p = contractPrice(8600, [co({ status: 'rejected' })]);
    expect(p.contractPrice).toBe(8600);
  });

  it('treats a descope as a credit', () => {
    const p = contractPrice(8600, [co({ status: 'approved', amount: -400 })]);
    expect(p.contractPrice).toBe(8200);
  });

  it('reports presented work separately as money not yet won', () => {
    const p = contractPrice(8600, [co({ status: 'presented' })]);
    expect(p.contractPrice).toBe(8600);
    expect(p.pendingTotal).toBe(1250);
  });

  it('counts drafts and presented as unsettled', () => {
    const list = [co({ status: 'draft' }), co({ status: 'presented' }), co({ status: 'approved' })];
    expect(unsettled(list)).toHaveLength(2);
  });

  it('refuses to present an unpriced change order', () => {
    expect(canPresent(co({ amount: null }), true)).toBe(false);
    expect(canPresent(co(), true)).toBe(true);
  });

  it('keeps pricing and presenting away from the crew', () => {
    expect(canPresent(co(), false)).toBe(false);
    expect(canDecide(co({ status: 'presented' }), false)).toBe(false);
  });

  it('lets the author edit their own draft', () => {
    expect(canEdit(co(), true, false)).toBe(true);
    expect(canEdit(co({ status: 'presented' }), true, false)).toBe(false);
  });

  it('locks an approved change order for everyone', () => {
    expect(canEdit(co({ status: 'approved' }), true, true)).toBe(false);
  });

  it('requires a signature for a signed approval', () => {
    expect(approvalGap('signature', {})).toMatch(/signature/i);
    expect(approvalGap('signature', { signatureId: 's1' })).toBeNull();
  });

  it('requires a named person for a verbal approval', () => {
    expect(approvalGap('verbal', {})).toMatch(/who agreed/i);
    expect(approvalGap('verbal', { customerName: 'Helen Brooks' })).toBeNull();
  });
});

describe('validation', () => {
  it('rejects a closing odometer below the opening one', () => {
    const r = mileageLogSchema.safeParse({
      vehicleId: '00000000-0000-0000-0000-000000000001',
      tripDate: '2026-01-05',
      odometerStart: 500,
      odometerEnd: 400,
    });
    expect(r.success).toBe(false);
  });

  it('accepts a valid mileage log', () => {
    const r = mileageLogSchema.safeParse({
      vehicleId: '00000000-0000-0000-0000-000000000001',
      tripDate: '2026-01-05',
      odometerStart: 400,
      odometerEnd: 428,
    });
    expect(r.success).toBe(true);
  });

  it('requires at least one line on a purchase request', () => {
    const r = purchaseRequestSchema.safeParse({ lines: [] });
    expect(r.success).toBe(false);
  });

  it('requires a reason on a reschedule request', () => {
    const r = rescheduleRequestSchema.safeParse({
      assignmentId: '00000000-0000-0000-0000-000000000001',
      reason: '',
    });
    expect(r.success).toBe(false);
  });

  it('accepts a reschedule request with a proposed time', () => {
    const r = rescheduleRequestSchema.safeParse({
      assignmentId: '00000000-0000-0000-0000-000000000001',
      reason: 'Van in the shop',
      proposedStart: '2026-01-06T08:00:00Z',
      proposedEnd: '2026-01-06T16:00:00Z',
    });
    expect(r.success).toBe(true);
  });
});

describe('admin mode', () => {
  const owner = { permissions: { 'audit.view': true, 'data.restore': true } };
  const manager = { permissions: { 'audit.view': true } };
  const lead = { permissions: { 'job.accept': true } };

  it('opens the admin area to whoever reads the audit log', () => {
    expect(canSeeAdmin(owner)).toBe(true);
    expect(canSeeAdmin(manager)).toBe(true);
    expect(canSeeAdmin(lead)).toBe(false);
  });

  it('names the actions in words', () => {
    expect(auditActionLabel('soft_delete')).toBe('Deleted');
    expect(auditActionLabel('restore')).toBe('Restored');
    // Anything the database grows later still renders, just unprettified.
    expect(auditActionLabel('merged')).toBe('merged');
  });

  it('labels columns without keeping a second copy of the schema', () => {
    expect(fieldLabel('scheduled_start')).toBe('Start');
    expect(fieldLabel('make_model')).toBe('Make model');
    expect(fieldLabel('site_id')).toBe('Site');
    expect(fieldLabel('supplier_id')).toBe('Supplier');
  });

  it('reads an edit diff as a list of changes', () => {
    const changes = fieldChanges({
      quoted_price: { old: 8600, new: 9200 },
      scheduled_start: { old: '2026-01-05T08:00:00Z', new: '2026-01-06T08:00:00Z' },
    });
    expect(changes.map((c) => c.label)).toEqual(['Quoted price', 'Start']);
    expect(changes[0]?.from).toBe(8600);
    expect(changes[0]?.to).toBe(9200);
  });

  it('does not force an insert into a change list', () => {
    const diff = { new: { id: 'x', title: 'Basement remediation' } };
    expect(fieldChanges(diff)).toEqual([]);
    expect(wholeRow(diff)).toEqual({ id: 'x', title: 'Basement remediation' });
    expect(wholeRow({ quoted_price: { old: 1, new: 2 } })).toBeNull();
  });

  it('says what changed, not merely that something did', () => {
    expect(describeAuditEntry({ action: 'update', fields: ['scheduled_start', 'quoted_price'] }))
      .toBe('Edited — Start, Quoted price');
    expect(describeAuditEntry({ action: 'insert', fields: [] })).toBe('Created');
    expect(
      describeAuditEntry({
        action: 'update',
        fields: ['title', 'quoted_price', 'scheduled_start', 'scheduled_end', 'priority'],
      }),
    ).toBe('Edited — Title, Quoted price, Start and 2 more');
  });

  it('withholds restore from someone who can only look', () => {
    const free = { blockedBy: null };
    expect(canRestore(free, owner)).toBe(true);
    expect(canRestore(free, manager)).toBe(false);
    expect(canRestore(free, null)).toBe(false);
  });

  it('withholds restore while the parent is still deleted', () => {
    expect(canRestore({ blockedBy: 'Customer - Helen Brooks' }, owner)).toBe(false);
  });

  it('falls back through ref to the id for a row with no name', () => {
    expect(recordTitle({ title: 'Basement', ref: 'J00102', recordId: 'abcdef12-0000' }))
      .toBe('Basement');
    expect(recordTitle({ title: null, ref: 'J00102', recordId: 'abcdef12-0000' })).toBe('J00102');
    expect(recordTitle({ title: null, ref: null, recordId: 'abcdef12-0000' })).toBe('abcdef12');
  });
});

describe('consumables', () => {
  it('names the three modes', () => {
    expect(modeLabel('bulk')).toBe('Opened as a pack');
    expect(modeLabel('single_use')).toBe('Counted out');
    expect(isPack('bulk')).toBe(true);
    expect(isPack('single_use')).toBe(false);
  });

  it('splits a pack evenly across what it served', () => {
    expect(packShare(62, 2)).toEqual({ total: 62, jobs: 2, each: 31 });
    expect(packShare(38.5, 3).each).toBe(12.83);
  });

  it('puts a pack nobody logged on the business, not on a job', () => {
    expect(packShare(62, 0)).toEqual({ total: 62, jobs: 0, each: null });
    expect(describePackShare(62, 0)).toMatch(/lands on the business/);
  });

  it('says what finishing it will cost each job, before the button', () => {
    expect(describePackShare(62, 2)).toBe('Splits $62.00 across 2 jobs — $31.00 each.');
    expect(describePackShare(62, 1)).toBe('Splits $62.00 across 1 job — $62.00 each.');
  });

  it('flags stock at or below its reorder level', () => {
    expect(isLow(4, 4)).toBe(true);
    expect(isLow(5, 4)).toBe(false);
    // No reorder level set means nothing to be below.
    expect(isLow(0, 0)).toBe(false);
  });
});
