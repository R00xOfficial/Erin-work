"use server";
import { revalidatePath } from "next/cache";
import { EMPLOYER_PRIORITY_KEYS, VACANCY_PRIORITY_KEYS } from "@ajis/shared";
import type { Json, TablesUpdate } from "@ajis/db";
import { requireUser } from "@/lib/supabase/server";
import { requestJob } from "@/server/actions/jobs";

// Stage 3 decisions. Everything here records Erin's choice and the reason; none of it contacts an employer or submits anything.

type Client = Awaited<ReturnType<typeof requireUser>>["supabase"];
type Status = "high" | "recommended" | "backlog" | "on_hold" | "dismissed";
const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" && v.trim() !== "" ? v.trim() : null; };
const nowIso = () => new Date().toISOString();
const refresh = (id?: string) => { for (const p of ["/priorities", "/"]) revalidatePath(p); if (id) revalidatePath(`/priorities/${id}`); };

async function getItem(supabase: Client, id: string) {
  const { data, error } = await supabase.from("priority_items").select("id, kind, employer_id, vacancy_id, status, recommended_status, manual_status, score").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data;
}
async function logEvent(supabase: Client, item: { id: string; status: string | null; score: number | null }, event: string, o: { to?: Status | null; reason?: string | null; detail?: Record<string, unknown> } = {}) {
  const { error } = await supabase.from("priority_events").insert({ item_id: item.id, event, actor: "user", from_status: item.status as Status | null, to_status: o.to ?? null, score_before: item.score, reason: o.reason ?? null, detail: (o.detail ?? {}) as Json });
  if (error) throw new Error(`Saved, but the decision history could not be written: ${error.message}`);
}
async function replan(reason: string) { await requestJob("planner.generate", { reason }, "planner:now"); }

/** Erin's decision always wins over the recommendation, and acknowledges any pending "something changed" notice. */
async function decide(id: string, to: Status, event: string, patch: Record<string, unknown>, reason: string | null) {
  const { supabase } = await requireUser();
  const item = await getItem(supabase, id);
  const { error } = await supabase.from("priority_items").update({ manual_status: to, manual_reason: reason, manual_at: nowIso(), needs_review_reason: null, needs_review_since: null, ...patch }).eq("id", id);
  if (error) throw new Error(`Could not save the decision: ${error.message}`);
  await logEvent(supabase, item, event, { to, reason });
  await replan(event);
  refresh(id);
}

export async function promoteItem(id: string, formData: FormData) { await decide(id, "high", "promoted", { hold_until: null, hold_condition: null, dismissed_reason: null }, s(formData, "reason")); }
export async function moveToBacklog(id: string, formData: FormData) { await decide(id, "backlog", "moved_to_backlog", { hold_until: null, hold_condition: null, dismissed_reason: null }, s(formData, "reason")); }
export async function markRecommended(id: string, formData: FormData) { await decide(id, "recommended", "marked_recommended", { hold_until: null, hold_condition: null, dismissed_reason: null }, s(formData, "reason")); }

export async function putOnHold(id: string, formData: FormData) {
  const reason = s(formData, "reason");
  if (!reason) throw new Error("A reason is required to put an opportunity on hold.");
  await decide(id, "on_hold", "put_on_hold", { hold_until: s(formData, "until"), hold_condition: s(formData, "condition"), dismissed_reason: null }, reason);
}

export async function dismissItem(id: string, formData: FormData) {
  const reason = s(formData, "reason") ?? s(formData, "reason_other");
  await decide(id, "dismissed", "dismissed", { dismissed_reason: reason, hold_until: null, hold_condition: null }, reason);
}

/** Hand the decision back to the system: the manual status, hold and dismissal are cleared and the recommendation applies again. */
export async function followRecommendation(id: string) {
  const { supabase } = await requireUser();
  const item = await getItem(supabase, id);
  const { error } = await supabase.from("priority_items").update({ manual_status: null, manual_reason: null, manual_at: null, hold_until: null, hold_condition: null, dismissed_reason: null, needs_review_reason: null, needs_review_since: null }).eq("id", id);
  if (error) throw new Error(`Could not save: ${error.message}`);
  await logEvent(supabase, item, "returned_to_recommendation", { to: item.recommended_status as Status });
  await requestJob("priorities.recompute", item.kind === "vacancy" ? { vacancyId: item.vacancy_id } : { employerId: item.employer_id }, `prio:${id}`);
  await replan("returned to recommendation");
  refresh(id);
}

export async function respondToRecommendation(id: string, response: "accepted" | "rejected", formData: FormData) {
  const { supabase } = await requireUser();
  const item = await getItem(supabase, id);
  const reason = s(formData, "reason");
  const { error } = await supabase.from("priority_items").update({ recommendation_response: response, recommendation_response_reason: reason, recommendation_response_at: nowIso(), responded_to_status: item.recommended_status as Status, needs_review_reason: null, needs_review_since: null }).eq("id", id);
  if (error) throw new Error(`Could not save: ${error.message}`);
  await logEvent(supabase, item, response === "accepted" ? "recommendation_accepted" : "recommendation_rejected", { to: item.recommended_status as Status, reason });
  refresh(id);
}

export async function acknowledgeChange(id: string) {
  const { supabase } = await requireUser();
  const item = await getItem(supabase, id);
  const { error } = await supabase.from("priority_items").update({ needs_review_reason: null, needs_review_since: null }).eq("id", id);
  if (error) throw new Error(`Could not save: ${error.message}`);
  await logEvent(supabase, item, "change_acknowledged");
  refresh(id);
}

export async function overrideScore(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  const item = await getItem(supabase, id);
  const score = Number(s(formData, "score"));
  const reason = s(formData, "reason");
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error("The override must be a number from 0 to 100.");
  if (!reason) throw new Error("A reason is required to override the ranking.");
  const { error } = await supabase.from("priority_items").update({ override_score: score, override_reason: reason }).eq("id", id);
  if (error) throw new Error(`Could not save: ${error.message}`);
  await logEvent(supabase, item, "override_set", { reason, detail: { score, calculated: item.score } });
  await replan("override");
  refresh(id);
}
export async function clearOverride(id: string) {
  const { supabase } = await requireUser();
  const item = await getItem(supabase, id);
  const { error } = await supabase.from("priority_items").update({ override_score: null, override_reason: null }).eq("id", id);
  if (error) throw new Error(`Could not save: ${error.message}`);
  await logEvent(supabase, item, "override_cleared");
  refresh(id);
}

export async function togglePin(id: string) {
  const { supabase } = await requireUser();
  const { data: cur, error } = await supabase.from("priority_items").select("id, status, score, pinned").eq("id", id).single();
  if (error) throw new Error(error.message);
  const { error: e2 } = await supabase.from("priority_items").update({ pinned: !cur.pinned, pinned_at: cur.pinned ? null : nowIso() }).eq("id", id);
  if (e2) throw new Error(`Could not save: ${e2.message}`);
  await logEvent(supabase, cur, cur.pinned ? "unpinned" : "pinned");
  await replan("pin");
  refresh(id);
}
export async function toggleFavourite(id: string) {
  const { supabase } = await requireUser();
  const { data: cur, error } = await supabase.from("priority_items").select("id, status, score, favourite").eq("id", id).single();
  if (error) throw new Error(error.message);
  const { error: e2 } = await supabase.from("priority_items").update({ favourite: !cur.favourite }).eq("id", id);
  if (e2) throw new Error(`Could not save: ${e2.message}`);
  await logEvent(supabase, cur, cur.favourite ? "unfavourited" : "favourited");
  refresh(id);
}

/** Records a reason to approach an employer again before the cooldown ends; without one, repeat outreach is held back. */
export async function recordRecontactReason(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  const item = await getItem(supabase, id);
  const reason = s(formData, "reason");
  if (!reason) throw new Error("Say why another contact is justified.");
  const { error } = await supabase.from("priority_items").update({ recontact_reason: reason, recontact_at: nowIso() }).eq("id", id);
  if (error) throw new Error(`Could not save: ${error.message}`);
  await logEvent(supabase, item, "recontact_reason_recorded", { reason });
  await requestJob("priorities.recompute", { employerId: item.employer_id }, `prio:${id}`);
  refresh(id);
}

// ---- Plan actions ------------------------------------------------------------------------------------------------

async function updateAction(id: string, patch: TablesUpdate<"plan_actions">) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("plan_actions").update(patch).eq("id", id);
  if (error) throw new Error(`Could not save: ${error.message}`);
  refresh();
}
export async function acceptAction(id: string) { await updateAction(id, { status: "accepted", accepted_at: nowIso() }); }
export async function completeAction(id: string) { await updateAction(id, { status: "done", completed_at: nowIso() }); await requestJob("priorities.recompute", { all: true, reason: "action completed" }, "prio:all"); }
export async function dismissAction(id: string, formData: FormData) { await updateAction(id, { status: "dismissed", dismissed_at: nowIso(), dismissed_reason: s(formData, "reason") }); }
export async function rescheduleAction(id: string, formData: FormData) {
  const d = s(formData, "planned_for");
  await updateAction(id, { planned_for: d, user_edited: true, warning: null, status: "accepted", accepted_at: nowIso() });
}
export async function editAction(id: string, formData: FormData) {
  const title = s(formData, "title");
  if (!title) throw new Error("An action needs a title.");
  const mins = s(formData, "minutes");
  await updateAction(id, { title, estimated_minutes: mins ? Math.max(0, Number(mins)) : null, effort_basis: "Your own estimate", planned_for: s(formData, "planned_for"), user_edited: true, status: "accepted", accepted_at: nowIso(), warning: null });
}
export async function addAction(formData: FormData) {
  const { supabase } = await requireUser();
  const title = s(formData, "title");
  if (!title) throw new Error("An action needs a title.");
  const mins = s(formData, "minutes");
  const { error } = await supabase.from("plan_actions").insert({ title, kind: "custom", reason: s(formData, "reason"), estimated_minutes: mins ? Math.max(0, Number(mins)) : null, effort_basis: mins ? "Your own estimate" : null, planned_for: s(formData, "planned_for"), status: "accepted", source: "manual", user_edited: true, accepted_at: nowIso(), item_id: s(formData, "item_id") });
  if (error) throw new Error(`Could not save: ${error.message}`);
  refresh();
}
export async function refreshPlan() { await requestJob("planner.generate", { reason: "requested" }, "planner:now"); refresh(); }

// ---- Notifications -----------------------------------------------------------------------------------------------

export async function markNotificationRead(id: string) { const { supabase } = await requireUser(); await supabase.from("notifications").update({ read_at: nowIso() }).eq("id", id); refresh(); }
export async function dismissNotification(id: string) { const { supabase } = await requireUser(); await supabase.from("notifications").update({ dismissed_at: nowIso(), read_at: nowIso() }).eq("id", id); refresh(); }
export async function dismissAllNotifications() { const { supabase } = await requireUser(); await supabase.from("notifications").update({ dismissed_at: nowIso(), read_at: nowIso() }).is("dismissed_at", null); refresh(); }

// ---- Settings ----------------------------------------------------------------------------------------------------

export async function savePlannerPrefs(formData: FormData) {
  const { supabase } = await requireUser();
  const num = (k: string, lo: number, hi: number) => { const v = Number(formData.get(k)); if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${k.replace(/_/g, " ")} must be between ${lo} and ${hi}.`); return v; };
  const days = formData.getAll("working_days").map(Number).filter((d) => d >= 1 && d <= 7);
  const deadlineDays = (s(formData, "reminder_deadline_days") ?? "").split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 60);
  const { error } = await supabase.from("planner_preferences").update({
    hours_per_day: num("hours_per_day", 0, 16), working_days: days, max_applications_per_week: num("max_applications_per_week", 0, 50), max_outreach_per_week: num("max_outreach_per_week", 0, 50),
    max_research_per_week: num("max_research_per_week", 0, 50), recontact_cooldown_days: num("recontact_cooldown_days", 0, 730), reminder_deadline_days: deadlineDays.length ? deadlineDays : [7, 3, 1],
    remind_tasks_due: formData.get("remind_tasks_due") === "on", remind_overdue: formData.get("remind_overdue") === "on", remind_decisions: formData.get("remind_decisions") === "on",
    remind_status_changes: formData.get("remind_status_changes") === "on", remind_reconsider: formData.get("remind_reconsider") === "on", remind_outreach: formData.get("remind_outreach") === "on",
    digest_frequency: ["daily", "weekly", "off"].includes(s(formData, "digest_frequency") ?? "") ? s(formData, "digest_frequency")! : "daily", digest_hour: num("digest_hour", 0, 23),
  }).eq("id", true);
  if (error) throw new Error(`Could not save: ${error.message}`);
  await requestJob("priorities.recompute", { all: true, reason: "planner preferences changed" }, "prio:all");
  await replan("preferences changed");
  revalidatePath("/settings/planner");
  refresh();
}

export async function savePriorityModel(kind: "vacancy" | "employer", formData: FormData) {
  const { supabase } = await requireUser();
  const keys = kind === "vacancy" ? VACANCY_PRIORITY_KEYS : EMPLOYER_PRIORITY_KEYS;
  const weights: Record<string, number> = {}; let total = 0;
  for (const k of keys) { const v = Number(formData.get(k) ?? 0); if (!Number.isFinite(v) || v < 0) throw new Error(`Invalid weight for ${k}`); weights[k] = v; total += v; }
  if (Math.abs(total - 100) > 0.001) throw new Error(`Weights must sum to 100 (got ${total}).`);
  const { data: cur } = await supabase.from("prioritisation_models").select("config").eq("kind", kind).eq("is_active", true).maybeSingle();
  const cfg = { ...((cur?.config ?? {}) as Record<string, number>) };
  for (const k of ["high_score", "recommended_score", "high_deadline_days"]) { const v = formData.get(k); if (v != null && v !== "" && Number.isFinite(Number(v))) cfg[k] = Number(v); }
  await supabase.from("prioritisation_models").update({ is_active: false }).eq("kind", kind).eq("is_active", true);
  const { error } = await supabase.from("prioritisation_models").insert({ kind, weights, config: cfg as Json, is_active: true, notes: s(formData, "notes") });
  if (error) throw new Error(`Could not save: ${error.message}`);
  await requestJob("priorities.recompute", { all: true, reason: `${kind} priority model changed` }, "prio:all");
  revalidatePath("/settings/planner");
  refresh();
}
