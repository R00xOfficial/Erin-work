import { z } from "zod";
import { APPLICATION_ROUTES, EMPLOYMENT_TYPES, QUALIFICATIONS_REQUIRED, SALARY_PERIODS, SENIORITIES, WORKING_ARRANGEMENTS } from "../enums.js";
import { evidenceStatusSchema } from "./evidence.js";

const claimed = <T extends z.ZodTypeAny>(inner: T) => z.object({ value: inner, evidence_status: evidenceStatusSchema, quote: z.string().nullable().optional() });

/** Structured requirements extracted from a vacancy description snapshot. Facts only; quotes required for anything not "unverified". */
export const vacancyExtractionSchema = z.object({
  employment_type: claimed(z.enum(EMPLOYMENT_TYPES)),
  seniority: claimed(z.enum(SENIORITIES)),
  qualification_required: claimed(z.enum(QUALIFICATIONS_REQUIRED)),
  experience_years_min: claimed(z.number().int().min(0).max(40).nullable()),
  experience_years_max: claimed(z.number().int().min(0).max(40).nullable()),
  salary_min: claimed(z.number().nullable()),
  salary_max: claimed(z.number().nullable()),
  salary_period: claimed(z.enum(SALARY_PERIODS)),
  salary_is_estimate: z.boolean(),
  hours_text: claimed(z.string().nullable()),
  benefits: claimed(z.array(z.string())),
  hybrid_policy: claimed(z.enum(WORKING_ARRANGEMENTS)),
  software: claimed(z.array(z.string())),
  skills: claimed(z.array(z.string())),
  sectors: claimed(z.array(z.string())),
  responsibilities: claimed(z.array(z.string())),
  right_to_work_required: claimed(z.boolean().nullable()),
  portfolio_required: claimed(z.boolean().nullable()),
  portfolio_size_limit: claimed(z.string().nullable()),
  application_route: claimed(z.enum(APPLICATION_ROUTES)),
  application_email: claimed(z.string().nullable()),
  closing_date: claimed(z.string().nullable()),
  posted_by_agency: claimed(z.boolean().nullable()),
  employer_name_in_text: claimed(z.string().nullable()),
});
export type VacancyExtraction = z.infer<typeof vacancyExtractionSchema>;
