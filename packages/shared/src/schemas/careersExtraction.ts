import { z } from "zod";
import { EMPLOYMENT_TYPES } from "../enums.js";

/**
 * What Claude returns for an employer careers page. Everything is checked in code against the page text before it is stored:
 * titles and context must be quoted verbatim, links must be ones that were actually on the page.
 */
export const careersExtractionSchema = z.object({
  page_lists_current_vacancies: z.enum(["yes", "no", "unclear"]),
  vacancies: z.array(z.object({
    title: z.string().min(3).max(200),
    title_quote: z.string().min(3).max(300),
    context_quote: z.string().max(800).nullable(),
    url: z.string().nullable(),
    location: z.string().max(200).nullable(),
    employment_type: z.enum(EMPLOYMENT_TYPES),
    salary_text: z.string().max(200).nullable(),
    closing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  })).max(40),
});
export type CareersExtraction = z.infer<typeof careersExtractionSchema>;
