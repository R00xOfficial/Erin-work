import { z } from "zod";
import { EVIDENCE_STATUSES } from "../enums.js";

export const evidenceStatusSchema = z.enum(EVIDENCE_STATUSES);

/** Every AI-produced field is a claim: value + evidence status + the source ids that support it. */
export const claimedStringSchema = z.object({
  value: z.string().nullable(),
  evidence_status: evidenceStatusSchema,
  source_ids: z.array(z.string()).default([]),
  note: z.string().nullable().optional(),
});
export type ClaimedString = z.infer<typeof claimedStringSchema>;

export const claimedStringListSchema = z.object({
  value: z.array(z.string()),
  evidence_status: evidenceStatusSchema,
  source_ids: z.array(z.string()).default([]),
  note: z.string().nullable().optional(),
});
