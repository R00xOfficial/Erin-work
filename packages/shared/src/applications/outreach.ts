export interface PriorApplication { id: string; stage: string; applicationType: string; createdAt: Date; submittedAt: Date | null; vacancyTitle: string | null }
export interface PriorContact { sentAt: Date; subject: string | null }
export interface DuplicateOutreach {
  needsConfirmation: boolean;
  lastContactAt: Date | null;
  reasons: string[];
  applications: PriorApplication[];
  contacts: PriorContact[];
}
const DAY = 86_400_000;

/**
 * Stops accidental repeat outreach. Showing history is always allowed; a deliberate second approach needs Erin's confirmation and a reason.
 * Only real, sent contact counts: a draft or a simulated dry-run send is not contact.
 */
export function duplicateOutreachCheck(i: { now: Date; type: "speculative" | "advertised" | string; applications: PriorApplication[]; contacts: PriorContact[]; cooldownDays: number }): DuplicateOutreach {
  const reasons: string[] = [];
  const last = [...i.contacts.map((c) => c.sentAt), ...i.applications.filter((a) => a.submittedAt).map((a) => a.submittedAt!)].sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const open = i.applications.filter((a) => !["rejected", "withdrawn", "vacancy_closed", "closed_without_response", "offer_declined"].includes(a.stage));
  const recent = last && i.now.getTime() - last.getTime() < i.cooldownDays * DAY;
  if (i.type === "speculative") {
    if (open.some((a) => a.applicationType === "speculative")) reasons.push("There is already an open speculative application to this employer.");
    if (recent) reasons.push(`You contacted this employer on ${last!.toISOString().slice(0, 10)}, within your ${i.cooldownDays}-day gap.`);
    if (!recent && i.applications.some((a) => a.applicationType === "speculative" && a.submittedAt)) reasons.push("You have sent this employer a speculative application before.");
  } else if (recent && open.length > 0) {
    reasons.push(`You are already in contact with this employer (last on ${last!.toISOString().slice(0, 10)}) through ${open.length} other application(s).`);
  }
  return { needsConfirmation: reasons.length > 0, lastContactAt: last, reasons, applications: i.applications, contacts: i.contacts };
}
