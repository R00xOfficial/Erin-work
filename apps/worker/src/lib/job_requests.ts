import type { PgBoss } from "pg-boss";
import { db } from "./db.js";
import { logger } from "./logger.js";
import { KNOWN_QUEUES } from "../queues.js";

/**
 * Drain job_requests (inserted by the web app) into pg-boss. Runs every 30 s via the
 * `maintenance.drain_requests` queue so the web app never needs a queue connection.
 */
export async function drainJobRequests(boss: PgBoss) {
  const { data: rows, error } = await db().from("job_requests").select("*").eq("status", "pending").order("requested_at").limit(100);
  if (error) throw new Error(error.message);
  for (const r of rows ?? []) {
    const name = r.job_name;
    if (!KNOWN_QUEUES.has(name)) {
      await db().from("job_requests").update({ status: "failed", error: `Unknown job ${name}`, finished_at: new Date().toISOString() }).eq("id", r.id);
      continue;
    }
    try {
      const id = await boss.send(name, { ...(r.payload as Record<string, unknown>), requestId: r.id }, { singletonKey: r.singleton_key ?? undefined });
      await db().from("job_requests").update({ status: "picked_up", picked_up_at: new Date().toISOString(), error: id ? null : "deduplicated by singleton key" }).eq("id", r.id);
    } catch (e) {
      logger.error({ err: (e as Error).message, job: name }, "failed to enqueue job request");
      await db().from("job_requests").update({ status: "failed", error: (e as Error).message, finished_at: new Date().toISOString() }).eq("id", r.id);
    }
  }
  return rows?.length ?? 0;
}

export async function completeJobRequest(requestId: string | undefined, error?: string) {
  if (!requestId) return;
  await db().from("job_requests").update({ status: error ? "failed" : "done", error: error ?? null, finished_at: new Date().toISOString() }).eq("id", requestId);
}
