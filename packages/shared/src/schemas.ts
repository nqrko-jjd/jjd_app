import { z } from 'zod';
import {
  ROLES, ENTITIES, WORKSITE_STATUSES, CRM_STAGES, CRM_LOST_REASONS,
  CONTACT_TYPES, CLIENT_KINDS, WORKER_CONTRACT_TYPES, LEGAL_DOC_TYPES,
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
  note: z.string().nullish(),
});

export const worksiteInput = z.object({
  title: nonEmpty,
  entity: z.enum(ENTITIES).default('jjd'),
  status: z.enum(WORKSITE_STATUSES).default('to_plan'),
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

export type ContactInput = z.infer<typeof contactInput>;
export type BuildingInput = z.infer<typeof buildingInput>;
export type WorksiteInput = z.infer<typeof worksiteInput>;
export type PersonInput = z.infer<typeof personInput>;
export type CrmOpportunityInput = z.infer<typeof crmOpportunityInput>;
