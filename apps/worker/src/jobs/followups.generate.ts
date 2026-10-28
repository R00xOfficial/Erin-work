import { suggestFollowUp, thankYouDueAt } from "@ajis/shared";
import { db } from "../lib/db.js";
import { loadPrefs } from "../priority/store.js";
import type { Job } from "./index.js";

/**
 * Plans follow-ups for submitted applications. It only schedules reminders: it never writes or sends a message. Each date says where it came
 * from (Erin's choice, a timeframe the employer gave, or a configurable rule), and rule-based ones are labelled as suggestions.
 */
export async function followupsGenerate(_job: Job) {
  const prefs = await loadPrefs();
  const { data: p } = await db().from("planner_preferences").select("application_follow_up_days, max_follow_ups, thank_you_hours").eq("id", true).maybeSingle();
  const defaultDays = p?.application_follow_up_days ?? 14, maxFollowUps = p?.max_follow_ups ?? 2, thankHours = p?.thank_you_hours ?? 24;
  let created = 0, exhausted = 0, moved = 0;

  const { data: apps } = await db().from("applications").select("id, stage, submitted_at, response_expected_by, offer_decision_deadline").is("deleted_at", null).not("submission_confirmed_at", "is", null)
    .in("stage", ["submitted", "awaiting_response", "acknowledged", "shortlisted", "offer_received"]);
  for (const a of apps ?? []) {
    if (a.stage === "offer_received" && a.offer_decision_deadline) {
      const { error } = await db().from("application_followups").insert({ application_id: a.id, kind: "offer_decision", title: "Decide on the offer", due_at: a.offer_decision_deadline, basis: "employer_stated", basis_note: "The offer's decision deadline you recorded.", dedupe_key: `offer:${a.id}:${a.offer_decision_deadline.slice(0, 10)}` });
      if (!error) created++;
      continue;
    }
    if (!["submitted", "awaiting_response"].includes(a.stage) || !a.submitted_at) continue;
    const { data: open } = await db().from("application_followups").select("id").eq("application_id", a.id).eq("kind", "awaiting_response").in("status", ["open", "snoozed"]).limit(1);
    if ((open ?? []).length > 0) continue;
    const { data: doneRows } = await db().from("application_followups").select("attempt, completed_at").eq("application_id", a.id).eq("kind", "awaiting_response").eq("status", "done").order("completed_at", { ascending: false });
    const sug = suggestFollowUp({ submittedAt: new Date(a.submitted_at), responseExpectedBy: a.response_expected_by ? new Date(`${a.response_expected_by}T00:00:00Z`) : null, defaultDays, followUpsDone: (doneRows ?? []).length, maxFollowUps, lastFollowUpAt: doneRows?.[0]?.completed_at ? new Date(doneRows[0].completed_at) : null });
    if ("exhausted" in sug) {
      exhausted++;
      await db().from("notifications").insert({ kind: "decision_needed", urgency: "routine", title: "No reply after your follow-ups", body: sug.note, application_id: a.id, dedupe_key: `exhausted:${a.id}:${(doneRows ?? []).length}` });
      continue;
    }
    const attempt = (doneRows ?? []).length + 1;
    const { error } = await db().from("application_followups").insert({ application_id: a.id, kind: "awaiting_response", title: attempt === 1 ? "Follow up on your application" : `Follow up again (${attempt})`, due_at: sug.dueAt.toISOString(), basis: sug.basis, basis_note: sug.note, attempt, dedupe_key: `resp:${a.id}:${attempt}` });
    if (!error) created++;
    // The response clock is now running: record that it is waiting. This is bookkeeping, not an outcome.
    if (a.stage === "submitted") {
      const { error: e2 } = await db().from("applications").update({ stage: "awaiting_response" }).eq("id", a.id).eq("stage", "submitted");
      if (!e2) moved++;
    }
  }

  // Thank-you reminders after interviews that have taken place.
  const { data: ivs } = await db().from("interviews").select("id, application_id, scheduled_at, duration_minutes, kind, title").is("thank_you_sent_at", null).eq("kind", "interview").lte("scheduled_at", new Date().toISOString()).gte("scheduled_at", new Date(Date.now() - 14 * 86_400_000).toISOString());
  for (const iv of ivs ?? []) {
    const { error } = await db().from("application_followups").insert({ application_id: iv.application_id, interview_id: iv.id, kind: "thank_you", title: "Send a thank-you after the interview", due_at: thankYouDueAt(new Date(iv.scheduled_at!), iv.duration_minutes, thankHours).toISOString(), basis: "rule_suggestion", basis_note: `Suggested: ${thankHours} hours after the interview ended. Nothing is sent until you approve a message.`, dedupe_key: `thanks:${iv.id}` });
    if (!error) created++;
  }
  void prefs;
  return { created, exhausted, movedToAwaiting: moved };
}
