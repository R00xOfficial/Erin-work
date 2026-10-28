export interface FollowUpSuggestion {
  dueAt: Date;
  basis: "employer_stated" | "user_set" | "rule_suggestion";
  note: string;
}
const DAY = 86_400_000;

/**
 * When to chase an application. An explicit date from Erin wins, then a timeframe the employer published, and only then a configurable rule,
 * which is labelled as a suggestion and never as something the employer asked for. After the allowed number of follow-ups it stops suggesting more.
 */
export function suggestFollowUp(i: { submittedAt: Date; explicit?: Date | null; responseExpectedBy?: Date | null; defaultDays: number; followUpsDone: number; maxFollowUps: number; lastFollowUpAt?: Date | null }):
  FollowUpSuggestion | { exhausted: true; note: string } {
  if (i.explicit) return { dueAt: i.explicit, basis: "user_set", note: "A date you chose." };
  if (i.followUpsDone >= i.maxFollowUps) return { exhausted: true, note: `You have followed up ${i.followUpsDone} time(s), your limit. Decide whether to close the application as "no response".` };
  if (i.responseExpectedBy && i.followUpsDone === 0) return { dueAt: new Date(i.responseExpectedBy.getTime() + DAY), basis: "employer_stated", note: `The employer said to expect a response by ${i.responseExpectedBy.toISOString().slice(0, 10)}; this is the day after.` };
  const from = i.lastFollowUpAt ?? i.submittedAt;
  return { dueAt: new Date(from.getTime() + i.defaultDays * DAY), basis: "rule_suggestion", note: `Suggested only: no response time was given, so your default of ${i.defaultDays} days after ${i.lastFollowUpAt ? "your last follow-up" : "submission"} applies. It is not an employer requirement.` };
}

export const thankYouDueAt = (interviewStart: Date, durationMinutes: number | null, hoursAfter: number) => new Date(interviewStart.getTime() + (durationMinutes ?? 60) * 60_000 + hoursAfter * 3_600_000);
