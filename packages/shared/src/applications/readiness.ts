export interface ReadinessInput {
  now: Date;
  deadline: Date | null;
  openRequiredChecklist: string[];
  cvSelected: boolean;
  recipientKnown: boolean;
  methodKnown: boolean;
  messageFinal: boolean;
  messageRequired: boolean;
  unacknowledgedDraftFlags: number;
  stage2Blockers: string[];
  listingClosed: boolean;
}
export interface ReadinessIssue { code: string; text: string; severity: "blocker" | "warning" }

/**
 * What stands between "drafted" and "ready for review". Blockers must be cleared; warnings are shown so Erin decides knowingly.
 * Being ready never means submitted: only Erin's confirmation does that.
 */
export function applicationReadiness(i: ReadinessInput): { ready: boolean; issues: ReadinessIssue[] } {
  const issues: ReadinessIssue[] = [];
  const add = (code: string, text: string, severity: ReadinessIssue["severity"]) => issues.push({ code, text, severity });
  if (i.deadline && i.deadline.getTime() < i.now.getTime()) add("deadline_passed", `The closing date (${i.deadline.toISOString().slice(0, 10)}) has passed.`, "blocker");
  if (i.listingClosed) add("listing_closed", "The vacancy is recorded as closed. Check before applying.", "warning");
  if (!i.cvSelected) add("no_cv", "No CV version is selected.", "blocker");
  if (!i.recipientKnown) add("no_recipient", "The recipient or portal is not recorded.", "blocker");
  if (!i.methodKnown) add("no_method", "The submission method is not recorded.", "blocker");
  for (const t of i.openRequiredChecklist) add("checklist", `Checklist item not done: ${t}`, "blocker");
  if (i.messageRequired && !i.messageFinal) add("no_final_message", "No cover letter or message has been marked final.", "warning");
  if (i.unacknowledgedDraftFlags > 0) add("draft_flags", `${i.unacknowledgedDraftFlags} unsupported or unverified claim(s) in the drafts still need your check.`, "blocker");
  for (const b of i.stage2Blockers) add("stage2_blocker", `Research blocker: ${b}`, "warning");
  if (!i.deadline) add("deadline_unknown", "No closing date is recorded.", "warning");
  return { ready: !issues.some((x) => x.severity === "blocker"), issues };
}
