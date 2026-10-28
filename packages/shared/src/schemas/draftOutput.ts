import { z } from "zod";

/** What Claude returns for a drafted message: paragraphs, each tied to the approved facts it relies on. */
export const draftOutputSchema = z.object({
  subject: z.string().max(200).nullable(),
  paragraphs: z.array(z.object({ text: z.string().min(1).max(2500), factual: z.boolean(), fact_ids: z.array(z.string()).max(12) })).min(1).max(30),
});
export type DraftOutput = z.infer<typeof draftOutputSchema>;
