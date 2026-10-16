import { db } from "../lib/db.js";
import type { Job } from "./index.js";

/**
 * Daily housekeeping: review tasks for stale employers, closing-soon / closed vacancy transitions,
 * verification tasks for vacancies unverified for 14+ days, and expiry of old hiring signals.
 */
export async function reviewStaleRecords(_job: Job) {
  const now = new Date();
  const iso = now.toISOString();
  let reviewTasks = 0, closingSoon = 0, closed = 0, verifyTasks = 0;

  const { data: stale } = await db().from("employers").select("id, legal_name").is("deleted_at", null).lte("next_review_at", iso).not("outreach_stage", "in", "(closed_no_opportunity,suppressed)").limit(200);
  for (const e of stale ?? []) {
    const { error } = await db().from("tasks").insert({ title: `Review ${e.legal_name}: re-check website, vacancies and contacts (record is stale)`, task_type: "review_stale", entity_type: "employer", entity_id: e.id, employer_id: e.id, auto_generated: true, dedupe_key: `review_stale:employer:${e.id}`, due_at: iso, priority: "low" });
    if (!error) reviewTasks++;
  }

  const soon = new Date(now.getTime() + 5 * 86_400_000).toISOString();
  const { data: cs } = await db().from("vacancies").update({ status: "closing_soon" }).eq("status", "open").gt("closing_at", iso).lte("closing_at", soon).select("id");
  closingSoon = cs?.length ?? 0;
  const { data: cl } = await db().from("vacancies").update({ status: "closed" }).in("status", ["open", "closing_soon", "unverified"]).lt("closing_at", iso).select("id");
  closed = cl?.length ?? 0;

  const cutoff = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const { data: unverified } = await db().from("vacancies").select("id, title, employer_id").is("deleted_at", null).in("status", ["open", "unverified", "closing_soon"]).or(`last_verified_at.is.null,last_verified_at.lt.${cutoff}`).limit(200);
  for (const v of unverified ?? []) {
    const { error } = await db().from("tasks").insert({ title: `Verify vacancy still live: ${v.title}`, task_type: "verify_vacancy", entity_type: "vacancy", entity_id: v.id, employer_id: v.employer_id, auto_generated: true, dedupe_key: `verify_vacancy:${v.id}`, due_at: iso, priority: "normal" });
    if (!error) verifyTasks++;
  }

  // Applications with no response 30 days after submission get a nudge task.
  const month = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const { data: silent } = await db().from("applications").select("id, employer_id").is("deleted_at", null).eq("stage", "submitted").lt("submitted_at", month);
  for (const a of silent ?? []) {
    await db().from("tasks").insert({ title: "Application unanswered for 30 days: chase or close", task_type: "follow_up", entity_type: "application", entity_id: a.id, employer_id: a.employer_id, auto_generated: true, dedupe_key: `app_silent:${a.id}`, due_at: iso, priority: "normal" });
  }
  return { reviewTasks, closingSoon, closed, verifyTasks, silentApplications: silent?.length ?? 0 };
}
