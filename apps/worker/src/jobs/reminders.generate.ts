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
  const notify = async (n: { kind: string; urgency: "urgent" | "routine"; title: string; body?: string; item_id?: string; action_id?: string; task_id?: string; application_id?: string; followup_id?: string; due_at?: string | null; dedupe_key: string }) => {
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

  // Applications: closing dates, prepared-but-not-submitted, follow-ups, interviews and assessments. Reminders only; nothing is ever sent.
  const { data: p4 } = await db().from("planner_preferences").select("prepared_not_submitted_days, interview_remind_hours").eq("id", true).maybeSingle();
  const { data: apps } = await db().from("applications").select("id, stage, deadline_at, stage_changed_at, vacancy_id, submission_confirmed_at, employers(legal_name, display_name), vacancies(status)").is("deleted_at", null).not("stage", "in", "(offer_accepted,offer_declined,rejected,withdrawn,vacancy_closed,closed_without_response)");
  const appName = (a: { employers: unknown }) => { const e = a.employers as { legal_name: string; display_name: string | null } | null; return e?.display_name ?? e?.legal_name ?? "an employer"; };
  for (const a of apps ?? []) {
    const unsubmitted = !a.submission_confirmed_at;
    if (unsubmitted && a.deadline_at) {
      const left = Math.floor((new Date(a.deadline_at).getTime() - now.getTime()) / DAY);
      const t = left >= 0 ? thresholds.find((x) => left <= x) : undefined;
      if (t != null) await notify({ kind: "application_deadline", urgency: left <= 1 ? "urgent" : "routine", title: `Application to ${appName(a)} closes ${left === 0 ? "today" : left === 1 ? "tomorrow" : `in ${left} days`}`, body: `Closing date on record: ${fmtDate(a.deadline_at)}. It has not been submitted.`, application_id: a.id, due_at: a.deadline_at, dedupe_key: `appdl:${a.id}:${t}:${fmtDate(a.deadline_at)}` } as never);
    }
    if (a.stage === "ready_to_submit" && Date.now() - new Date(a.stage_changed_at).getTime() > (p4?.prepared_not_submitted_days ?? 3) * DAY)
      await notify({ kind: "prepared_not_submitted", urgency: "routine", title: `Prepared but not submitted: ${appName(a)}`, body: `It has been ready for review since ${fmtDate(a.stage_changed_at)}. Nothing is sent until you submit it yourself.`, application_id: a.id, dedupe_key: `prep:${a.id}:${fmtDate(a.stage_changed_at)}` } as never);
    const vs = (a.vacancies as { status: string } | null)?.status;
    if (unsubmitted && vs && ["closed", "filled", "withdrawn"].includes(vs) && prefs.remindStatusChanges)
      await notify({ kind: "status_changed", urgency: "routine", title: `The vacancy for your application to ${appName(a)} is now ${vs}`, body: "Check whether it is still worth sending. The application and your drafts are kept.", application_id: a.id, dedupe_key: `listing:${a.id}:${vs}` } as never);
  }
  const { data: fus } = await db().from("application_followups").select("id, application_id, kind, title, due_at, snoozed_until, status, basis").in("status", ["open", "snoozed"]).lte("due_at", new Date(now.getTime() + DAY).toISOString());
  const fuKind: Record<string, string> = { awaiting_response: "follow_up_due", thank_you: "thank_you_due", info_requested: "info_requested", offer_decision: "offer_decision", custom: "follow_up_due" };
  for (const f of fus ?? []) {
    if (f.status === "snoozed" && f.snoozed_until && new Date(f.snoozed_until) > now) continue;
    const late = new Date(f.due_at) < now;
    await notify({ kind: fuKind[f.kind] ?? "follow_up_due", urgency: f.kind === "offer_decision" && late ? "urgent" : "routine", title: `${f.title}${late ? "" : " (due soon)"}`, body: `${f.basis === "rule_suggestion" ? "A suggested date" : f.basis === "employer_stated" ? "Based on a timeframe the employer gave" : "A date you set"}: ${fmtDate(f.due_at)}. Nothing is sent automatically.`, application_id: f.application_id, followup_id: f.id, due_at: f.due_at, dedupe_key: `fu:${f.id}:${fmtDate(f.due_at)}:${f.snoozed_until ? fmtDate(f.snoozed_until) : ""}` } as never);
  }
  const ahead = new Date(now.getTime() + (p4?.interview_remind_hours ?? 24) * 3_600_000).toISOString();
  const { data: ivs } = await db().from("interviews").select("id, application_id, kind, title, scheduled_at, deadline_at, outcome").eq("outcome", "pending").or(`and(scheduled_at.gt.${now.toISOString()},scheduled_at.lte.${ahead}),and(deadline_at.gt.${now.toISOString()},deadline_at.lte.${ahead})`);
  for (const iv of ivs ?? []) {
    const when = iv.scheduled_at && new Date(iv.scheduled_at) > now ? iv.scheduled_at : iv.deadline_at!;
    await notify({ kind: "interview_upcoming", urgency: "urgent", title: `${iv.kind === "assessment" ? "Assessment" : "Interview"} ${iv.scheduled_at && new Date(iv.scheduled_at) > now ? "coming up" : "deadline coming up"}${iv.title ? `: ${iv.title}` : ""}`, body: `On record: ${when.slice(0, 16).replace("T", " ")}.`, application_id: iv.application_id, due_at: when, dedupe_key: `iv:${iv.id}:${when.slice(0, 16)}` } as never);
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
