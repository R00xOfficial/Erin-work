import type { ApplicationStage } from "../enums.js";
import { isPostSubmission } from "./lifecycle.js";

export interface NextActionInput {
  now: Date;
  stage: ApplicationStage;
  deadline: Date | null;
  openRequiredChecklist: number;
  nextInterviewAt: Date | null;
  nextFollowUp: { dueAt: Date; title: string } | null;
  offerDecisionDeadline: Date | null;
  listingClosed: boolean;
  submitted: boolean;
}
export interface NextAction { label: string; dueAt: Date | null; urgency: "overdue" | "soon" | "normal" | "none"; reason: string }
const DAY = 86_400_000;
const urgencyFor = (due: Date | null, now: Date): NextAction["urgency"] => (!due ? "normal" : due.getTime() < now.getTime() ? "overdue" : due.getTime() - now.getTime() <= 3 * DAY ? "soon" : "normal");

/**
 * The single most useful next step for an application, from dates that are actually stored. "Overdue" is only ever used for a stored date in the
 * past; an application without a date is never called late, and not everything is marked urgent.
 */
export function nextAction(i: NextActionInput): NextAction {
  const candidates: NextAction[] = [];
  const add = (label: string, dueAt: Date | null, reason: string) => candidates.push({ label, dueAt, urgency: urgencyFor(dueAt, i.now), reason });
  if (i.stage === "offer_received") add("Decide on the offer", i.offerDecisionDeadline, i.offerDecisionDeadline ? `Decision needed by ${i.offerDecisionDeadline.toISOString().slice(0, 10)}.` : "No decision deadline is recorded.");
  if (i.nextInterviewAt) add("Prepare for the interview or assessment", i.nextInterviewAt, `Scheduled for ${i.nextInterviewAt.toISOString().slice(0, 16).replace("T", " ")}.`);
  if (i.nextFollowUp) add(i.nextFollowUp.title, i.nextFollowUp.dueAt, `Planned for ${i.nextFollowUp.dueAt.toISOString().slice(0, 10)}.`);
  if (!i.submitted && !isPostSubmission(i.stage) && !["rejected", "withdrawn", "vacancy_closed", "closed_without_response", "offer_accepted", "offer_declined"].includes(i.stage)) {
    if (i.stage === "ready_to_submit") add("Review and submit", i.deadline, i.deadline ? `Closes ${i.deadline.toISOString().slice(0, 10)}.` : "No closing date is recorded.");
    else add(i.openRequiredChecklist > 0 ? `Finish preparing (${i.openRequiredChecklist} checklist item${i.openRequiredChecklist === 1 ? "" : "s"} left)` : "Mark as ready for review", i.deadline, i.deadline ? `Closes ${i.deadline.toISOString().slice(0, 10)}.` : "No closing date is recorded.");
  }
  if (i.submitted && i.listingClosed && ["submitted", "awaiting_response", "acknowledged"].includes(i.stage)) add("Check whether you have heard back: the listing has closed", null, "A closed listing is not an outcome. Record one only when you know it.");
  if (candidates.length === 0) return { label: i.submitted ? "Waiting for the employer" : "No action needed", dueAt: null, urgency: "none", reason: "Nothing is scheduled." };
  const order = { overdue: 0, soon: 1, normal: 2, none: 3 } as const;
  candidates.sort((a, b) => order[a.urgency] - order[b.urgency] || (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));
  return candidates[0]!;
}
