import { z } from 'zod';
import { EQUIPMENT_CATEGORIES } from '../domain/equipment.js';

/**
 * Input validation shared by both clients and the Edge Functions.
 *
 * Only the fields a user actually supplies; server-assigned fields (ids,
 * timestamps, org scoping) are not accepted from the client.
 */

export const uuid = z.string().uuid();

export const customerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  kind: z.enum(['residential', 'commercial', 'insurance', 'property_manager']),
  primaryContact: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  billingAddress: z.string().optional(),
  notes: z.string().optional(),
});

export const siteSchema = z.object({
  customerId: uuid,
  label: z.string().min(1, 'Label is required'),
  addressLine1: z.string().min(1, 'Address is required'),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accessNotes: z.string().optional(),
});

export const jobSchema = z
  .object({
    customerId: uuid,
    siteId: uuid,
    templateId: uuid.optional(),
    title: z.string().min(1, 'Title is required'),
    description: z.string().optional(),
    priority: z.enum(['low', 'normal', 'high', 'emergency']).default('normal'),
    scheduledStart: z.coerce.date().optional(),
    scheduledEnd: z.coerce.date().optional(),
    quotedPrice: z.number().nonnegative().optional(),
    insuranceClaimNo: z.string().optional(),
    adjusterContact: z.string().optional(),
  })
  .refine(
    (v) => !v.scheduledStart || !v.scheduledEnd || v.scheduledEnd >= v.scheduledStart,
    { message: 'End must be after start', path: ['scheduledEnd'] },
  );

export const rescheduleRequestSchema = z
  .object({
    assignmentId: uuid,
    reason: z.string().min(1, 'A reason is required'),
    proposedStart: z.coerce.date().optional(),
    proposedEnd: z.coerce.date().optional(),
  })
  .refine((v) => !v.proposedStart || !v.proposedEnd || v.proposedEnd > v.proposedStart, {
    message: 'Proposed end must be after proposed start',
    path: ['proposedEnd'],
  });

export const purchaseLineSchema = z.object({
  itemId: uuid.optional(),
  description: z.string().min(1, 'Describe what is needed'),
  quantity: z.number().positive('Quantity must be more than zero'),
  unit: z.string().default('each'),
  estimatedUnitCost: z.number().nonnegative().optional(),
});

export const purchaseRequestSchema = z.object({
  assignedTo: uuid.optional(),
  jobId: uuid.optional(),
  neededBy: z.coerce.date().optional(),
  notes: z.string().optional(),
  supplierId: uuid.optional(),
  lines: z.array(purchaseLineSchema).min(1, 'Add at least one line'),
});

export const purchaseDecisionSchema = z
  .object({
    requestId: uuid,
    approve: z.boolean(),
    reason: z.string().optional(),
    approvedLineIds: z.array(uuid).optional(),
  })
  .refine((v) => v.approve || (v.reason && v.reason.trim().length > 0), {
    message: 'A reason is required to reject',
    path: ['reason'],
  });

export const materialUsageSchema = z.object({
  jobId: uuid,
  itemId: uuid,
  locationId: uuid,
  quantity: z.number().positive('Quantity must be more than zero'),
});

export const mileageLogSchema = z
  .object({
    vehicleId: uuid,
    jobId: uuid.optional(),
    tripDate: z.coerce.date(),
    odometerStart: z.number().nonnegative(),
    odometerEnd: z.number().nonnegative(),
    purpose: z.string().optional(),
    isBusiness: z.boolean().default(true),
  })
  .refine((v) => v.odometerEnd >= v.odometerStart, {
    message: 'Closing reading cannot be lower than the opening reading',
    path: ['odometerEnd'],
  });

export const stageEquipmentSchema = z.object({
  equipmentId: uuid,
  jobId: uuid,
  siteId: uuid,
  // Optional at the API boundary, but leaving it empty is what blocks job
  // completion later. The UI should push hard for a date here.
  expectedEndAt: z.coerce.date().optional(),
  notes: z.string().optional(),
});

export const collectEquipmentSchema = z.object({
  equipmentId: uuid,
  condition: z.enum(['ok', 'damaged', 'needs_service']).default('ok'),
  runtimeHours: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

export const rentalSchema = z
  .object({
    supplierId: uuid,
    jobId: uuid,
    siteId: uuid.optional(),
    description: z.string().min(1),
    category: z.enum(EQUIPMENT_CATEGORIES),
    quantity: z.number().int().positive().default(1),
    rate: z.number().nonnegative().optional(),
    rateUnit: z.enum(['day', 'week']).default('day'),
    pickedUpAt: z.coerce.date().optional(),
    returnDueAt: z.coerce.date().optional(),
    estimatedCost: z.number().nonnegative().optional(),
    agreementNo: z.string().optional(),
  })
  .refine((v) => !v.pickedUpAt || !v.returnDueAt || v.returnDueAt > v.pickedUpAt, {
    message: 'Return due must be after pickup',
    path: ['returnDueAt'],
  });

export const clockInSchema = z.object({
  jobId: uuid,
  visitId: uuid.optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

export const timeOffSchema = z
  .object({
    kind: z.enum(['vacation', 'sick', 'unavailable', 'other']),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    reason: z.string().optional(),
  })
  .refine((v) => v.endsAt > v.startsAt, {
    message: 'End must be after start',
    path: ['endsAt'],
  });

export type CustomerInput = z.infer<typeof customerSchema>;
export type SiteInput = z.infer<typeof siteSchema>;
export type JobInput = z.infer<typeof jobSchema>;
export type RescheduleRequestInput = z.infer<typeof rescheduleRequestSchema>;
export type PurchaseRequestInput = z.infer<typeof purchaseRequestSchema>;
export type PurchaseDecisionInput = z.infer<typeof purchaseDecisionSchema>;
export type MaterialUsageInput = z.infer<typeof materialUsageSchema>;
export type MileageLogInput = z.infer<typeof mileageLogSchema>;
export type StageEquipmentInput = z.infer<typeof stageEquipmentSchema>;
export type CollectEquipmentInput = z.infer<typeof collectEquipmentSchema>;
export type RentalInput = z.infer<typeof rentalSchema>;
export type ClockInInput = z.infer<typeof clockInSchema>;
export type TimeOffInput = z.infer<typeof timeOffSchema>;
