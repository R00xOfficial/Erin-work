import type { EffortEstimate, EffortItem } from "./types.js";

/** Rough, labelled estimates of the work still needed. They are guides, never facts, and the UI says so. */
export function estimateVacancyEffort(i: {
  assessmentReviewed: boolean; blockerCount: number; missingCount: number; employerResearchComplete: boolean; routeKnown: boolean;
  applicationRoute: string; portfolioRequired: boolean | null; done?: ReadonlySet<string>;
}): EffortEstimate {
  const items: EffortItem[] = [];
  const add = (task: string, minutes: number, basis: string) => { if (minutes > 0 && !i.done?.has(task)) items.push({ task, minutes, basis }); };
  add("review_job", i.assessmentReviewed ? 0 : 15, "Read the full advert and the Stage 2 findings");
  add("confirm_eligibility", i.blockerCount ? 20 : i.missingCount ? 10 : 0, i.blockerCount ? "Resolve or dispute the blockers" : "Check the unverified items");
  add("research_employer", i.employerResearchComplete ? 0 : 45, "Employer research is not yet complete");
  add("find_route", i.routeKnown ? 0 : 15, "The application route is not recorded");
  add("tailor_cv", 45, "Tailor your CV to the role");
  add("portfolio", i.portfolioRequired === true ? 60 : i.portfolioRequired === null ? 30 : 0, i.portfolioRequired === true ? "The advert asks for a portfolio" : "It is not stated whether a portfolio is needed");
  add("cover_letter", 40, "Most applications want a cover letter; not confirmed for this role");
  add("application_answers", ["portal", "ats"].includes(i.applicationRoute) ? 30 : 0, "Online application form questions");
  return { items, totalMinutes: items.reduce((a, b) => a + b.minutes, 0), isEstimate: true };
}

export function estimateEmployerEffort(i: { employerResearchComplete: boolean; routeKnown: boolean; namedContact: boolean; done?: ReadonlySet<string> }): EffortEstimate {
  const items: EffortItem[] = [];
  const add = (task: string, minutes: number, basis: string) => { if (minutes > 0 && !i.done?.has(task)) items.push({ task, minutes, basis }); };
  add("research_employer", i.employerResearchComplete ? 0 : 45, "Employer research is not yet complete");
  add("identify_contact", i.routeKnown || i.namedContact ? 0 : 20, "No recruitment route or named contact recorded");
  add("prepare_outreach", 60, "Personalise a speculative approach (CV, portfolio link and a specific reason to get in touch)");
  return { items, totalMinutes: items.reduce((a, b) => a + b.minutes, 0), isEstimate: true };
}
