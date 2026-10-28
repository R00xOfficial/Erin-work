import { z } from "zod";

/**
 * What Claude returns for one vacancy's own text. Every item carries a quote; the worker keeps an item only when the quote
 * is found verbatim in that vacancy's text, so nothing here can come from a different vacancy or from the model's own knowledge.
 */
export const vacancyResearchSchema = z.object({
  requirements: z.array(z.object({
    kind: z.enum(["qualification", "registration", "experience", "skill", "software", "other"]),
    necessity: z.enum(["essential", "desirable", "unclear"]),
    text: z.string().min(2).max(300),
    quote: z.string().min(3).max(500),
  })).max(40),
  entry_level: z.object({ value: z.enum(["yes", "no", "unclear"]), quote: z.string().max(500).nullable() }),
  training_statements: z.array(z.object({ text: z.string().min(3).max(300), quote: z.string().min(3).max(500) })).max(6),
  working_pattern: z.object({ value: z.enum(["office", "hybrid", "remote", "unknown"]), quote: z.string().max(500).nullable() }),
  material_notes: z.array(z.object({ text: z.string().min(3).max(300), quote: z.string().min(3).max(500) })).max(6),
});
export type VacancyResearch = z.infer<typeof vacancyResearchSchema>;
