import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import type { Job } from "./index.js";

/** Dead-letter handler: every job that exhausted its retries lands here and becomes a data-quality task. */
export async function deadLetter(job: Job) {
  const data = job.data as { requestId?: string; __originalQueue?: string } & Record<string, unknown>;
  logger.error({ data }, "job dead-lettered");
  await db().from("tasks").insert({
    title: `Background job failed repeatedly: ${String(data.__originalQueue ?? "unknown job")}`,
    task_type: "data_quality", entity_type: "job", auto_generated: true, priority: "low",
    notes: JSON.stringify(data).slice(0, 1500),
    dedupe_key: `dlq:${String(data.__originalQueue ?? "job")}:${JSON.stringify(data).slice(0, 80)}`,
  });
  return { recorded: true };
}
