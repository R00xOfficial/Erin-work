import type { ApplicationStage } from "../enums.js";

export const POST_SUBMISSION_STAGES: readonly ApplicationStage[] = ["submitted", "awaiting_response", "acknowledged", "shortlisted", "interview_1", "further_interview", "assessment", "offer_received", "offer_accepted", "offer_declined"];
export const isPostSubmission = (s: ApplicationStage) => POST_SUBMISSION_STAGES.includes(s);

export const PIPELINE_COLUMNS = [
  { key: "preparing", label: "Preparing", stages: ["vacancy_discovered", "eligibility_checked", "selected", "preparing"] },
  { key: "ready", label: "Ready for review", stages: ["ready_to_submit"] },
  { key: "submitted", label: "Submitted", stages: ["submitted"] },
  { key: "awaiting", label: "Awaiting response", stages: ["awaiting_response", "acknowledged", "shortlisted"] },
  { key: "interviews", label: "Interviews and assessments", stages: ["interview_1", "further_interview", "assessment"] },
  { key: "offers", label: "Offers and decisions", stages: ["offer_received"] },
  { key: "closed", label: "Closed", stages: ["offer_accepted", "offer_declined", "rejected", "withdrawn", "vacancy_closed", "closed_without_response"] },
] as const;
export type PipelineColumnKey = (typeof PIPELINE_COLUMNS)[number]["key"];
export const columnFor = (stage: ApplicationStage): PipelineColumnKey => PIPELINE_COLUMNS.find((c) => (c.stages as readonly string[]).includes(stage))!.key;

export const OUTCOME_STAGES: readonly ApplicationStage[] = ["offer_accepted", "offer_declined", "rejected", "withdrawn", "vacancy_closed", "closed_without_response"];
export const OUTCOME_LABELS: Partial<Record<ApplicationStage, string>> = {
  offer_received: "Offer received", offer_accepted: "Offer accepted", offer_declined: "Offer declined", rejected: "Rejected by the employer", withdrawn: "Withdrawn by me",
  vacancy_closed: "Vacancy closed, no known individual outcome", closed_without_response: "No response after my follow-ups",
};
/** Outcomes that only Erin can decide: the system never moves an application into them by itself. */
export const USER_ONLY_STAGES: readonly ApplicationStage[] = ["submitted", "offer_accepted", "offer_declined", "withdrawn", "rejected", "vacancy_closed", "closed_without_response"];

/**
 * Stages the generic "change stage" control may offer. Submission is excluded because it needs the confirmation form; a stage that implies the
 * application was sent is only offered once the submission has been confirmed.
 */
export function selectableStages(current: ApplicationStage, submissionConfirmed: boolean, all: readonly ApplicationStage[]): ApplicationStage[] {
  return all.filter((s) => s === current || (s !== "submitted" && (submissionConfirmed || !isPostSubmission(s))));
}
