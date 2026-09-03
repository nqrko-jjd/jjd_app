import { z } from 'zod';
import {
  ROLES, ENTITIES, WORKSITE_STATUSES, WORKSITE_PRIORITIES, CRM_STAGES, CRM_LOST_REASONS,
  CONTACT_TYPES, CLIENT_KINDS, WORKER_CONTRACT_TYPES, LEGAL_DOC_TYPES,
  BUILDING_CONTACT_ROLES, OCCUPANT_KINDS,
} from './enums.js';

const nonEmpty = z.string().trim().min(1);

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export const contactInput = z.object({
  name: nonEmpty,
  type: z.enum(CONTACT_TYPES).default('client'),
  kind: z.enum(CLIENT_KINDS).nullish(),
  email: z.string().trim().email().nullish().or(z.literal('')),
  phone: z.string().trim().nullish(),
  vat: z.string().trim().nullish(),
  address: z.string().trim().nullish(),
  postalCode: z.string().trim().nullish(),
  city: z.string().trim().nullish(),
  syndicId: z.string().nullish(),
  note: z.string().nullish(),
});

export const buildingInput = z.object({
  name: nonEmpty,
  address: z.string().trim().nullish(),
  postalCode: z.string().trim().nullish(),
  city: z.string().trim().nullish(),
  syndicId: z.string().nullish(),
  clientId: z.string().nullish(),
  reference: z.string().trim().nullish(),
  lotCount: z.coerce.number().int().nonnegative().nullish(),
  digicode: z.string().trim().nullish(),
  accessNote: z.string().trim().nullish(),
  note: z.string().nullish(),
});

export const buildingContactInput = z.object({
  role: z.enum(BUILDING_CONTACT_ROLES).default('contact'),
  name: nonEmpty,
  phone: z.string().trim().nullish(),
  email: z.string().trim().email().nullish().or(z.literal('')),
  note: z.string().trim().nullish(),
  contactId: z.string().nullish(),
});

export const buildingUnitInput = z.object({
  label: nonEmpty,
  floor: z.string().trim().nullish(),
  door: z.string().trim().nullish(),
  occupantName: z.string().trim().nullish(),
  occupantPhone: z.string().trim().nullish(),
  occupantEmail: z.string().trim().email().nullish().or(z.literal('')),
  occupantKind: z.enum(OCCUPANT_KINDS).nullish(),
  note: z.string().trim().nullish(),
});

export type BuildingContactInput = z.infer<typeof buildingContactInput>;
export type BuildingUnitInput = z.infer<typeof buildingUnitInput>;

export const worksiteInput = z.object({
  title: nonEmpty,
  entity: z.enum(ENTITIES).default('jjd'),
  status: z.enum(WORKSITE_STATUSES).default('to_plan'),
  priority: z.enum(WORKSITE_PRIORITIES).default('normal'),
  statusTags: z.array(z.string()).default([]),
  clientId: z.string().nullish(),
  buildingId: z.string().nullish(),
  managerId: z.string().nullish(),
  address: z.string().trim().nullish(),
  postalCode: z.string().trim().nullish(),
  city: z.string().trim().nullish(),
  startedOn: z.coerce.date().nullish(),
  endedOn: z.coerce.date().nullish(),
  quotedHt: z.number().nonnegative().nullish(),
  description: z.string().nullish(),
});

export const personInput = z.object({
  firstName: nonEmpty,
  lastName: z.string().trim().nullish(),
  displayName: z.string().trim().nullish(),
  role: z.enum(ROLES).default('worker'),
  contractType: z.enum(WORKER_CONTRACT_TYPES).default('employee'),
  hourlyRate: z.number().nonnegative().nullish(),
  phone: z.string().trim().nullish(),
  email: z.string().trim().email().nullish().or(z.literal('')),
  address: z.string().trim().nullish(),
  languages: z.array(z.string()).default([]),
  emergencyContact: z.string().trim().nullish(),
  active: z.boolean().default(true),
  note: z.string().nullish(),
});

export const legalDocInput = z.object({
  personId: nonEmpty,
  type: z.enum(LEGAL_DOC_TYPES),
  label: z.string().trim().nullish(),
  number: z.string().trim().nullish(),
  issuedOn: z.coerce.date().nullish(),
  expiresOn: z.coerce.date().nullish(),
});

export const crmOpportunityInput = z.object({
  title: nonEmpty,
  stage: z.enum(CRM_STAGES).default('new'),
  contactId: z.string().nullish(),
  buildingId: z.string().nullish(),
  worksiteId: z.string().nullish(),
  estimatedValue: z.number().nonnegative().nullish(),
  source: z.string().trim().nullish(),
  nextActionOn: z.coerce.date().nullish(),
  nextActionNote: z.string().trim().nullish(),
  lostReason: z.enum(CRM_LOST_REASONS).nullish(),
  note: z.string().nullish(),
});

export const planningEventInput = z.object({
  worksiteId: nonEmpty,
  title: z.string().trim().nullish(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  allDay: z.boolean().default(false),
  teamId: z.string().nullish(),
  vehicleId: z.string().nullish(),
  personIds: z.array(z.string()).default([]),
  materialsNote: z.string().trim().nullish(),
  note: z.string().trim().nullish(),
});

export const teamInput = z.object({
  name: nonEmpty,
  color: z.string().trim().nullish(),
  memberIds: z.array(z.string()).default([]),
});

export const timeEntryInput = z.object({
  personId: nonEmpty,
  worksiteId: z.string().nullish(),
  date: z.coerce.date(),
  hours: z.number().positive().nullish(),
  amount: z.number().nonnegative().nullish(),
  task: z.string().trim().nullish(),
  note: z.string().trim().nullish(),
});

/** Démarrage du compteur mobile (l'app envoie l'heure locale de début). */
export const timerStartInput = z.object({
  worksiteId: nonEmpty,
  startedAt: z.coerce.date().optional(),
  task: z.string().trim().nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
});

export const timerStopInput = z.object({
  endedAt: z.coerce.date().optional(),
  note: z.string().trim().nullish(),
});

export const documentLineInput = z.object({
  id: z.string().optional(),
  kind: z.enum(['item', 'section', 'text']).default('item'),
  label: z.string().trim().min(1),
  description: z.string().trim().nullish(),
  qty: z.number().default(1),
  unit: z.string().trim().nullish(),
  unitPriceHt: z.number().default(0),
  discountPct: z.number().min(0).max(100).default(0),
  vatRate: z.number().default(0.21),
  priceItemId: z.string().nullish(),
});

export const documentInput = z.object({
  kind: z.enum(['quote', 'invoice', 'credit_note', 'deposit_invoice']).default('quote'),
  worksiteId: z.string().nullish(),
  contactId: z.string().nullish(),
  title: z.string().trim().nullish(),
  intro: z.string().trim().nullish(),
  terms: z.string().trim().nullish(),
  issuedOn: z.coerce.date().nullish(),
  dueOn: z.coerce.date().nullish(),
  validUntil: z.coerce.date().nullish(),
  note: z.string().trim().nullish(),
  parentId: z.string().nullish(),
  lines: z.array(documentLineInput).default([]),
});

export const worksiteReportInput = z.object({
  eventId: z.string().nullish(),
  date: z.coerce.date().optional(),
  workDone: z.string().trim().nullish(),
  notes: z.string().trim().nullish(),
});

export const worksiteTaskInput = z.object({
  title: nonEmpty,
  description: z.string().trim().nullish(),
  status: z.enum(['todo', 'doing', 'done']).default('todo'),
  assigneeId: z.string().nullish(),
  dueOn: z.coerce.date().nullish(),
});
export type WorksiteTaskInput = z.infer<typeof worksiteTaskInput>;

export const reportSignInput = z.object({
  clientName: z.string().trim().min(2),
  signature: z.string().min(20), // data URL PNG
});

export type WorksiteReportInput = z.infer<typeof worksiteReportInput>;

export const priceItemInput = z.object({
  ref: z.string().trim().nullish(),
  label: nonEmpty,
  description: z.string().trim().nullish(),
  unit: z.string().trim().nullish(),
  unitPriceHt: z.number().nonnegative().default(0),
  vatRate: z.number().default(0.21),
  category: z.string().trim().nullish(),
  active: z.boolean().default(true),
});

export type DocumentLineInput = z.infer<typeof documentLineInput>;
export type DocumentInput = z.infer<typeof documentInput>;
export type PriceItemInput = z.infer<typeof priceItemInput>;

export type ContactInput = z.infer<typeof contactInput>;
export type BuildingInput = z.infer<typeof buildingInput>;
export type WorksiteInput = z.infer<typeof worksiteInput>;
export type PersonInput = z.infer<typeof personInput>;
export type CrmOpportunityInput = z.infer<typeof crmOpportunityInput>;
export type PlanningEventInput = z.infer<typeof planningEventInput>;
export type TeamInput = z.infer<typeof teamInput>;
export type TimeEntryInput = z.infer<typeof timeEntryInput>;
