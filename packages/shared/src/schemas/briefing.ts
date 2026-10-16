import { z } from "zod";
import { YES_NO_UNKNOWN, PRACTICE_TYPES, SIZE_BANDS } from "../enums.js";
import { claimedStringListSchema, claimedStringSchema, evidenceStatusSchema } from "./evidence.js";

/**
 * Structured employer briefing produced by ai.employer_briefing. The prompt only receives page
 * text we fetched (with source ids); the model must cite those ids. Nothing here can create a
 * vacancy row — "hiring_signals" are claims, not vacancies.
 */
export const briefingProjectSchema = z.object({
  name: z.string(),
  project_type: z.string().nullable(),
  location: z.string().nullable(),
  client: z.string().nullable(),
  stage: z.string().nullable(),
  relevance: z.string(),
  evidence_status: evidenceStatusSchema,
  source_ids: z.array(z.string()).default([]),
});

export const briefingContactSchema = z.object({
  full_name: z.string(),
  role_title: z.string().nullable(),
  why_relevant: z.string(),
  official_profile_url: z.string().nullable(),
  evidence_status: evidenceStatusSchema,
  source_ids: z.array(z.string()).default([]),
});

export const employerBriefingSchema = z.object({
  business_overview: claimedStringSchema,
  design_identity_and_vision: claimedStringSchema,
  practice_type: z.object({ value: z.enum(PRACTICE_TYPES).nullable(), evidence_status: evidenceStatusSchema, source_ids: z.array(z.string()).default([]) }),
  size_band: z.object({ value: z.enum(SIZE_BANDS).nullable(), evidence_status: evidenceStatusSchema, source_ids: z.array(z.string()).default([]) }),
  sectors: claimedStringListSchema,
  software: claimedStringListSchema,
  projects: z.array(briefingProjectSchema).max(5),
  hiring_signals: z.array(
    z.object({
      summary: z.string(),
      signal_type: z.string(),
      strength: z.enum(["weak", "moderate", "strong"]),
      evidence_status: evidenceStatusSchema,
      source_ids: z.array(z.string()).default([]),
    }),
  ),
  hires_part1: z.object({ value: z.enum(YES_NO_UNKNOWN), evidence_status: evidenceStatusSchema, source_ids: z.array(z.string()).default([]) }),
  accepts_speculative: z.object({ value: z.enum(YES_NO_UNKNOWN), evidence_status: evidenceStatusSchema, source_ids: z.array(z.string()).default([]) }),
  graduate_programme: z.object({ value: z.enum(YES_NO_UNKNOWN), evidence_status: evidenceStatusSchema, source_ids: z.array(z.string()).default([]) }),
  applications_email: claimedStringSchema,
  contacts: z.array(briefingContactSchema).max(5),
  potential_role_fit: claimedStringSchema,
  outreach_recommendation: z.object({
    worth_approaching: z.boolean(),
    best_route: z.string(),
    personalised_opener: z.string(),
    proposed_ask: z.enum(["vacancy_enquiry", "speculative_cv", "portfolio_review", "informal_conversation", "do_not_approach_yet"]),
    rationale: z.string(),
  }),
  fit_notes: z.object({
    why_fit: z.string(),
    most_relevant_project: z.string().nullable(),
    matching_skills: z.array(z.string()),
    gaps: z.array(z.string()),
  }),
  unresolved_questions: z.array(z.string()),
});
export type EmployerBriefing = z.infer<typeof employerBriefingSchema>;
