import { z } from "zod";
import { APPLICATION_STAGES, APPLICATION_TYPES, EMPLOYER_OUTREACH_STAGES, EMPLOYMENT_TYPES, PRACTICE_TYPES, SIZE_BANDS, VACANCY_STATUSES, TASK_TYPES, TASK_PRIORITIES, SUPPRESSION_REASONS, SUPPRESSION_SCOPES, ROLE_CATEGORIES, HIRING_AUTHORITY, OFFICE_TYPES, WORKING_ARRANGEMENTS, DOCUMENT_KINDS } from "../enums.js";

const optionalUrl = z.string().trim().url().nullable().or(z.literal("").transform(() => null));
const optionalText = (max = 500) => z.string().trim().max(max).nullable().or(z.literal("").transform(() => null));

export const employerInputSchema = z.object({
  legal_name: z.string().trim().min(2).max(200),
  display_name: optionalText(200),
  website: optionalUrl,
  careers_url: optionalUrl,
  linkedin_url: optionalUrl,
  companies_house_number: z.string().trim().regex(/^[A-Z0-9]{2,8}$/i).nullable().or(z.literal("").transform(() => null)),
  practice_type: z.enum(PRACTICE_TYPES).default("architecture_practice"),
  size_band: z.enum(SIZE_BANDS).default("unknown"),
  sectors: z.array(z.string().max(60)).default([]),
  generic_email: z.string().trim().email().nullable().or(z.literal("").transform(() => null)),
  applications_email: z.string().trim().email().nullable().or(z.literal("").transform(() => null)),
  notes: optionalText(4000),
  source_url: optionalUrl,
  town: optionalText(100),
  postcode: optionalText(10),
});
export type EmployerInput = z.infer<typeof employerInputSchema>;

export const officeInputSchema = z.object({
  employer_id: z.string().uuid(),
  label: optionalText(100),
  address_line1: optionalText(200),
  address_line2: optionalText(200),
  town: optionalText(100),
  county: optionalText(100),
  postcode: optionalText(10),
  office_type: z.enum(OFFICE_TYPES).default("studio"),
  working_arrangement: z.enum(WORKING_ARRANGEMENTS).default("unknown"),
  phone: optionalText(40),
  email: z.string().trim().email().nullable().or(z.literal("").transform(() => null)),
  is_primary: z.boolean().default(false),
});

export const contactInputSchema = z.object({
  employer_id: z.string().uuid(),
  office_id: z.string().uuid().nullable().optional(),
  full_name: z.string().trim().min(2).max(120),
  role_title: optionalText(150),
  role_category: z.enum(ROLE_CATEGORIES).default("other"),
  hiring_authority: z.enum(HIRING_AUTHORITY).default("unknown"),
  relevance_rank: z.number().int().min(1).max(10).default(5),
  email: z.string().trim().email().nullable().or(z.literal("").transform(() => null)),
  linkedin_url: optionalUrl,
  phone: optionalText(40),
  official_profile_url: optionalUrl,
  source_url: optionalUrl,
  notes: optionalText(2000),
});

export const vacancyInputSchema = z.object({
  employer_id: z.string().uuid().nullable().optional(),
  employer_name: optionalText(200),
  title: z.string().trim().min(2).max(200),
  url: z.string().trim().url(),
  description: optionalText(50000),
  location_text: optionalText(200),
  postcode: optionalText(10),
  employment_type: z.enum(EMPLOYMENT_TYPES).default("unknown"),
  closing_at: z.string().nullable().optional(),
  salary_text: optionalText(100),
  application_email: z.string().trim().email().nullable().or(z.literal("").transform(() => null)),
  source_label: optionalText(100),
});
export type VacancyInput = z.infer<typeof vacancyInputSchema>;

export const applicationInputSchema = z.object({
  employer_id: z.string().uuid(),
  vacancy_id: z.string().uuid().nullable().optional(),
  application_type: z.enum(APPLICATION_TYPES),
  stage: z.enum(APPLICATION_STAGES).default("vacancy_discovered"),
  cv_document_id: z.string().uuid().nullable().optional(),
  portfolio_document_id: z.string().uuid().nullable().optional(),
  cover_letter_document_id: z.string().uuid().nullable().optional(),
  cover_letter_text: optionalText(20000),
  notes: optionalText(4000),
  next_action: optionalText(300),
  next_action_due: z.string().nullable().optional(),
  salary_expectation: optionalText(100),
  availability_stated: optionalText(100),
});

export const stageChangeSchema = z.object({
  id: z.string().uuid(),
  stage: z.enum(EMPLOYER_OUTREACH_STAGES),
  note: optionalText(1000),
});
export const applicationStageChangeSchema = z.object({
  id: z.string().uuid(),
  stage: z.enum(APPLICATION_STAGES),
  note: optionalText(1000),
});

export const taskInputSchema = z.object({
  title: z.string().trim().min(2).max(200),
  task_type: z.enum(TASK_TYPES).default("other"),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  due_at: z.string().nullable().optional(),
  entity_type: z.string().nullable().optional(),
  entity_id: z.string().uuid().nullable().optional(),
  notes: optionalText(2000),
});

export const suppressionInputSchema = z.object({
  scope: z.enum(SUPPRESSION_SCOPES),
  value: z.string().trim().min(1).max(320),
  reason: z.enum(SUPPRESSION_REASONS),
  employer_id: z.string().uuid().nullable().optional(),
  contact_id: z.string().uuid().nullable().optional(),
  lawful_basis_note: optionalText(1000),
});

export const documentInputSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  version_label: z.string().trim().min(1).max(60),
  notes: optionalText(1000),
});

export const vacancyStatusSchema = z.enum(VACANCY_STATUSES);
