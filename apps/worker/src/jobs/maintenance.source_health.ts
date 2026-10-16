import { db } from "../lib/db.js";
import { hasEnv } from "../lib/env.js";
import type { Job } from "./index.js";

/** Disables sources after 3 consecutive failures (with a task), re-enables key-dependent sources when keys appear, resets daily request counters. */
export async function maintenanceSourceHealth(_job: Job) {
  const { data: defs } = await db().from("source_definitions").select("*");
  let disabled = 0, keyMissing = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const d of defs ?? []) {
    if (d.enabled && d.consecutive_failures >= 3) {
      await db().from("source_definitions").update({ enabled: false, disabled_reason: `Disabled automatically after ${d.consecutive_failures} consecutive failures` }).eq("id", d.id);
      await db().from("tasks").insert({ title: `Source ${d.label} disabled after repeated failures — check /sources`, task_type: "data_quality", entity_type: "source_definition", entity_id: d.id, auto_generated: true, dedupe_key: `source_disabled:${d.code}`, priority: "normal" });
      disabled++;
    }
    if (d.requires_env.length && !hasEnv(d.requires_env)) {
      keyMissing++;
      if (d.enabled) await db().from("source_definitions").update({ enabled: false, disabled_reason: `Missing environment: ${d.requires_env.join(", ")}` }).eq("id", d.id);
    } else if (!d.enabled && d.disabled_reason?.startsWith("Missing environment")) {
      await db().from("source_definitions").update({ enabled: true, disabled_reason: null }).eq("id", d.id);
    }
    if (d.requests_today_date !== today) await db().from("source_definitions").update({ requests_today: 0, requests_today_date: today }).eq("id", d.id);
  }
  // Expire old pending job requests (never picked up for 2 days = worker was down; let the user know).
  const { data: stuck } = await db().from("job_requests").update({ status: "failed", error: "expired: not picked up within 48 h" }).eq("status", "pending").lt("requested_at", new Date(Date.now() - 48 * 3600_000).toISOString()).select("id");
  return { disabled, keyMissing, expiredRequests: stuck?.length ?? 0 };
}
