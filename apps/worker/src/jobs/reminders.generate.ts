import { db } from "../lib/db.js";
import { londonDate, londonHour, loadPrefs } from "../priority/store.js";
import type { Job } from "./index.js";

const DAY = 86_400_000;
const fmtDate = (iso: string) => iso.slice(0, 10);

/**
 * In-app reminders built only from dates that are actually stored (a vacancy's closing date, a task's due date, a day Erin planned an
 * action for, a hold date). Nothing is created for an unknown date, each reminder is created once, and routine items are summed up in a digest.
 */
export async function remindersGenerate(_job: Job) {
  const prefs = await loadPrefs();
  const now = new Date();
  const today = londonDate(now);
  const startOfToday = new Date(`${today}T00:00:00Z`).getTime();
  let created = 0;
  const notify = async (n: { kind: string; urgency: "urgent" | "routine"; title: string; body?: string; item_id?: string; action_id?: string; task_id?: string; due_at?: string | null; dedupe_key: string }) => {
    const { error } = await db().from("notifications").insert({ ...n, kind: n.kind as never });
    if (!error) created++;
  };

  // Deadlines: one reminder per threshold, the tightest that applies, for opportunities Erin is actually working on.
  const thresholds = [...prefs.reminderDeadlineDays].sort((a, b) => a - b);
  const { data: items } = await db().from("priority_items").select("id, kind, vacancy_id, deadline_at, status, pinned, favourite, live, needs_review_reason, hold_until, manual_status").not("deadline_at", "is", null).eq("live", true).neq("status", "dismissed");
  const names = new Map<string, string>();
  const vIds = (items ?? []).filter((i) => i.vacancy_id).map((i) => i.vacancy_id!);
  if (vIds.length) for (const v of (await db().from("vacancies").select("id, title").in("id", vIds)).data ?? []) names.set(v.id, v.title);
  for (const it of items ?? []) {
    if (!["high", "recommended"].includes(String(it.status)) && !it.pinned && !it.favourite) continue;
    const daysLeft = Math.floor((new Date(it.deadline_at!).getTime() - now.getTime()) / DAY);
    if (daysLeft < 0) continue;
    const t = thresholds.find((x) => daysLeft <= x);
    if (t == null) continue;
    const name = names.get(it.vacancy_id ?? "") ?? "Vacancy";
    await notify({ kind: "deadline_approaching", urgency: daysLeft <= 1 ? "urgent" : "routine", title: `${name} closes ${daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`}`, body: `Closing date on record: ${fmtDate(it.deadline_at!)}.`, item_id: it.id, due_at: it.deadline_at, dedupe_key: `deadline:${it.id}:${t}:${fmtDate(it.deadline_at!)}` });
  }

  // Tasks that carry a real due date.
  const { data: tasks } = await db().from("tasks").select("id, title, due_at, task_type").in("status", ["open", "in_progress"]).not("due_at", "is", null).lte("due_at", new Date(startOfToday + DAY - 1).toISOString());
  for (const t of tasks ?? []) {
    const dueDay = fmtDate(t.due_at!);
    const overdue = new Date(t.due_at!).getTime() < startOfToday;
    if (overdue && prefs.remindOverdue) await notify({ kind: "overdue_preparation", urgency: "routine", title: `Overdue: ${t.title}`, body: `It was due on ${dueDay}.`, task_id: t.id, due_at: t.due_at, dedupe_key: `task-overdue:${t.id}:${dueDay}` });
    else if (!overdue && prefs.remindTasksDue) await notify({ kind: "task_due", urgency: "routine", title: `Due today: ${t.title}`, task_id: t.id, due_at: t.due_at, dedupe_key: `task-due:${t.id}:${dueDay}` });
  }

  // Actions Erin accepted for a day.
  const { data: acts } = await db().from("plan_actions").select("id, title, kind, planned_for, due_at").eq("status", "accepted").not("planned_for", "is", null).lte("planned_for", today);
  for (const a of acts ?? []) {
    if (a.planned_for === today) {
      const outreach = a.kind === "prepare_outreach";
      if (!outreach || prefs.remindOutreach) await notify({ kind: "action_planned", urgency: "routine", title: `Planned for today: ${a.title}`, action_id: a.id, due_at: a.due_at, dedupe_key: `action-today:${a.id}:${today}` });
    } else if (prefs.remindOverdue) await notify({ kind: "overdue_preparation", urgency: "routine", title: `Not done yet: ${a.title}`, body: `You planned this for ${a.planned_for}. Reschedule it, complete it or dismiss it.`, action_id: a.id, dedupe_key: `action-late:${a.id}:${a.planned_for}` });
  }

  // Decisions and status changes the algorithm has flagged.
  if (prefs.remindDecisions || prefs.remindStatusChanges) {
    const { data: review } = await db().from("priority_items").select("id, kind, vacancy_id, employer_id, needs_review_reason, needs_review_since, live").not("needs_review_reason", "is", null).neq("status", "dismissed");
    for (const r of review ?? []) {
      const closed = !r.live;
      if (closed ? !prefs.remindStatusChanges : !prefs.remindDecisions) continue;
      await notify({ kind: closed ? "status_changed" : "decision_needed", urgency: "routine", title: closed ? "A vacancy you were tracking is no longer live" : "A recommendation changed and needs your decision", body: r.needs_review_reason, item_id: r.id, dedupe_key: `review:${r.id}:${r.needs_review_since}` });
    }
  }

  // Holds that have run out.
  if (prefs.remindReconsider) {
    const { data: holds } = await db().from("priority_items").select("id, hold_until, hold_condition").lte("hold_until", today).eq("status", "on_hold");
    for (const h of holds ?? []) await notify({ kind: "reconsider", urgency: "routine", title: "Time to reconsider an opportunity on hold", body: `The hold ran until ${h.hold_until}.${h.hold_condition ? ` Condition: ${h.hold_condition}` : ""}`, item_id: h.id, dedupe_key: `reconsider:${h.id}:${h.hold_until}` });
  }

  // One digest a day (or week) instead of many small nudges.
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (prefs.digestFrequency !== "off" && londonHour(now) >= prefs.digestHour && (prefs.digestFrequency === "daily" || dow === 1)) {
    const week = new Date(startOfToday + 7 * DAY).toISOString();
    const [{ count: high }, { count: dl }, { count: todayActs }, { count: review }] = await Promise.all([
      db().from("priority_items").select("id", { count: "exact", head: true }).eq("status", "high").eq("live", true),
      db().from("priority_items").select("id", { count: "exact", head: true }).eq("live", true).neq("status", "dismissed").gte("deadline_at", now.toISOString()).lte("deadline_at", week),
      db().from("plan_actions").select("id", { count: "exact", head: true }).eq("status", "accepted").eq("planned_for", today),
      db().from("priority_items").select("id", { count: "exact", head: true }).not("needs_review_reason", "is", null).neq("status", "dismissed"),
    ]);
    await notify({ kind: "digest", urgency: "routine", title: prefs.digestFrequency === "weekly" ? "Your week ahead" : "Your day ahead", body: `${high ?? 0} high-priority; ${dl ?? 0} closing within a week; ${todayActs ?? 0} action(s) planned today; ${review ?? 0} decision(s) waiting.`, dedupe_key: `digest:${prefs.digestFrequency}:${today}` });
  }
  return { created };
}
