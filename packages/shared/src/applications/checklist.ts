export interface ChecklistTemplateItem { kind: string; label: string; required: boolean; sort: number }

/** A starting checklist for an application. Erin can add, remove, reorder (by editing) and mark items optional. */
export function defaultChecklist(i: { speculative: boolean; hasVacancy: boolean; applicationRoute: string; portfolioRequired: boolean | null }): ChecklistTemplateItem[] {
  const items: ChecklistTemplateItem[] = [];
  const add = (kind: string, label: string, required = true) => items.push({ kind, label, required, sort: (items.length + 1) * 10 });
  add("review_requirements", i.hasVacancy ? "Review the application requirements and the Stage 2 research" : "Review the Stage 2 employer research and the reason for approaching");
  if (i.hasVacancy) add("eligibility_deadline", "Check the closing date and eligibility requirements");
  add("cv", "Choose or prepare the CV version to send");
  add("portfolio", "Select the relevant portfolio projects", i.portfolioRequired !== false);
  add(i.speculative ? "intro_email" : "cover_letter", i.speculative ? "Draft the introductory email" : "Draft the cover letter", true);
  if (["portal", "ats"].includes(i.applicationRoute)) add("answers", "Prepare answers to the application questions");
  add("recipient_method", "Confirm the recipient and how to submit");
  add("final_review", "Final read-through of everything that will be sent");
  return items;
}

export function interviewChecklist(kind: "interview" | "assessment"): ChecklistTemplateItem[] {
  const items: ChecklistTemplateItem[] = [];
  const add = (k: string, label: string, required = true) => items.push({ kind: k, label, required, sort: (items.length + 1) * 10 });
  if (kind === "assessment") { add("assessment_instructions", "Read the assessment instructions and deadline"); add("assessment_complete", "Complete and submit the assessment"); }
  else { add("research_employer", "Re-read the employer research and recent projects"); add("projects", "Choose the portfolio projects to talk about"); add("questions", "Prepare questions to ask"); add("logistics", "Confirm time, place or link, and travel"); }
  add("thank_you", "Send a thank-you or follow-up message (only after you have approved it)", false);
  return items;
}
