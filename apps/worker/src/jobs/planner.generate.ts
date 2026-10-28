import { planWeek, type PlanItem, type PriorityStatus } from "@ajis/shared";
import { db } from "../lib/db.js";
import { loadPrefs, londonDate } from "../priority/store.js";
import type { Job } from "./index.js";

const DAY = 86_400_000;
interface Payload { reason?: string }

/**
 * Suggests a realistic week from the current priorities, within Erin's stated time and weekly limits. Suggestions are only ever created or
 * refreshed here; anything Erin has accepted, edited, completed or dismissed is left exactly as she left it.
 */
export async function plannerGenerate(job: Job<Payload>) {
  const prefs = await loadPrefs();
  const today = londonDate();
  const horizon = 7;
  const end = londonDate(new Date(Date.now() + (horizon - 1) * DAY));
  const { data: rows } = await db().from("priority_items").select("id, kind, employer_id, vacancy_id, status, score, override_score, pinned, favourite, live, deadline_at, needs_review_reason, hold_until, components, warnings, effort").neq("status", "dismissed");
  const { data: apps } = await db().from("applications").select("vacancy_id, stage").is("deleted_at", null).not("vacancy_id", "is", null);
  const inProgress = new Set((apps ?? []).filter((a) => !["vacancy_discovered", "eligibility_checked"].includes(a.stage)).map((a) => a.vacancy_id!));
  const names = new Map<string, string>();
  const vIds = (rows ?? []).filter((r) => r.vacancy_id).map((r) => r.vacancy_id!), eIds = (rows ?? []).filter((r) => r.kind === "employer").map((r) => r.employer_id!);
  if (vIds.length) for (const v of (await db().from("vacancies").select("id, title").in("id", vIds)).data ?? []) names.set(v.id, v.title);
  if (eIds.length) for (const e of (await db().from("employers").select("id, legal_name, display_name").in("id", eIds)).data ?? []) names.set(e.id, e.display_name ?? e.legal_name);

  const items: PlanItem[] = (rows ?? []).map((r) => {
    const hold = ((r.components ?? {}) as { hold?: { reason: string | null } }).hold;
    const warnings = (r.warnings ?? []) as { code: string; severity: string }[];
    const eff = r.effort as { totalMinutes?: number; items?: { task: string }[] } | null;
    return {
      id: r.id, kind: r.kind, name: names.get((r.kind === "vacancy" ? r.vacancy_id : r.employer_id)!) ?? "Opportunity", status: r.status as PriorityStatus, score: r.override_score ?? r.score, pinned: r.pinned, favourite: r.favourite, live: r.live,
      deadlineAt: r.deadline_at ? new Date(r.deadline_at) : null, needsReview: !!r.needs_review_reason, holdReason: hold?.reason ?? null, holdUntil: r.hold_until, researchIncomplete: hold?.reason === "Research incomplete",
      hasBlockers: warnings.some((w) => w.severity === "blocker"), inProgress: !!r.vacancy_id && inProgress.has(r.vacancy_id), effortMinutes: eff?.totalMinutes ?? null,
      effortBasis: eff?.items?.length ? `Still to do (estimate): ${eff.items.map((i) => i.task.replace(/_/g, " ")).join(", ")}.` : "No breakdown available.", employerId: r.employer_id, vacancyId: r.vacancy_id,
    };
  });

  const { data: accepted } = await db().from("plan_actions").select("kind, planned_for, estimated_minutes").eq("status", "accepted").gte("planned_for", today).lte("planned_for", end);
  const booked: Record<string, number> = {}; const counts = { applications: 0, outreach: 0, research: 0 };
  for (const a of accepted ?? []) {
    if (a.planned_for) booked[a.planned_for] = (booked[a.planned_for] ?? 0) + (a.estimated_minutes ?? 0);
    if (a.kind === "prepare_application") counts.applications++; else if (a.kind === "prepare_outreach") counts.outreach++; else if (a.kind === "research") counts.research++;
  }
  const { actions, unscheduled } = planWeek({ today, items, prefs, booked, bookedCounts: counts, horizonDays: horizon });
  const all = [...actions, ...unscheduled];

  const { data: current } = await db().from("plan_actions").select("id, dedupe_key, status, user_edited").in("status", ["suggested", "accepted"]).not("dedupe_key", "is", null);
  const byKey = new Map((current ?? []).map((c) => [c.dedupe_key!, c]));
  const keep = new Set<string>();
  let created = 0, updated = 0;
  for (const a of all) {
    keep.add(a.dedupeKey);
    const row = { item_id: a.itemId, employer_id: a.employerId, vacancy_id: a.vacancyId, kind: a.kind, title: a.title, reason: a.reason, estimated_minutes: a.minutes, effort_basis: a.basis, planned_for: a.plannedFor, due_at: a.dueAt, warning: a.warning };
    const cur = byKey.get(a.dedupeKey);
    if (!cur) { const { error } = await db().from("plan_actions").insert({ ...row, dedupe_key: a.dedupeKey, status: "suggested", source: "suggested" }); if (!error) created++; }
    else if (cur.status === "suggested" && !cur.user_edited) { await db().from("plan_actions").update(row).eq("id", cur.id); updated++; }
  }
  // Suggestions that no longer make sense (item moved, dismissed, hold, capacity) are withdrawn; Erin's own choices never are.
  let withdrawn = 0;
  for (const c of current ?? []) if (c.status === "suggested" && !c.user_edited && !keep.has(c.dedupe_key!)) { await db().from("plan_actions").update({ status: "dismissed", dismissed_at: new Date().toISOString(), dismissed_reason: "No longer suggested" }).eq("id", c.id); withdrawn++; }
  return { items: items.length, scheduled: actions.length, unscheduled: unscheduled.length, created, updated, withdrawn, reason: job.data.reason ?? "scheduled" };
}
