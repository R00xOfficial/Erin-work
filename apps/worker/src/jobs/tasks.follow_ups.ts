import { db } from "../lib/db.js";
import type { Job } from "./index.js";

/** Hourly: a follow-up task for each sent email whose follow-up date passed with no reply, bounce or opt-out. */
export async function tasksFollowUps(_job: Job) {
  const now = new Date().toISOString();
  const { data: due } = await db().from("activities").select("id, employer_id, contact_id, subject, provider_thread_id, employers(outreach_stage, is_suppressed, legal_name)").eq("direction", "outbound").in("delivery_result", ["sent", "delivered", "simulated"]).eq("follow_up_done", false).eq("reply_received", false).lte("follow_up_due_at", now).limit(100);
  let created = 0;
  for (const a of due ?? []) {
    const e = a.employers as { outreach_stage: string; is_suppressed: boolean; legal_name: string } | null;
    if (!e || e.is_suppressed || ["closed_no_opportunity", "suppressed", "replied", "conversation_in_progress", "cv_requested", "informal_interview", "opportunity_identified"].includes(e.outreach_stage)) {
      await db().from("activities").update({ follow_up_done: true }).eq("id", a.id);
      continue;
    }
    if (a.provider_thread_id) {
      const { data: t } = await db().from("email_threads").select("status").eq("provider_thread_id", a.provider_thread_id).maybeSingle();
      if (t && t.status !== "awaiting_reply") { await db().from("activities").update({ follow_up_done: true }).eq("id", a.id); continue; }
    }
    const { error } = await db().from("tasks").insert({ title: `Follow up ${e.legal_name}: no reply to "${a.subject ?? "your email"}"`, task_type: "follow_up", entity_type: "activity", entity_id: a.id, employer_id: a.employer_id, auto_generated: true, dedupe_key: `follow_up:${a.id}`, due_at: now, priority: "normal" });
    if (!error) created++;
    await db().from("employers").update({ outreach_stage: "follow_up_due" }).eq("id", a.employer_id!).eq("outreach_stage", "email_sent");
  }
  return { due: due?.length ?? 0, created };
}
