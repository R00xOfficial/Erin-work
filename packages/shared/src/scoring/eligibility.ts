import type { CandidateQualification, EligibilityStatus, EmploymentType, QualificationRequired, VacancyStatus } from "../enums.js";
import { classifyTitle } from "./roleFamily.js";

/**
 * Hard eligibility flags. These are evaluated BEFORE scoring and are never masked by a high
 * employer score: a Priority-A employer with a Part 2-only vacancy is still ineligible for that vacancy.
 */
export const HARD_FLAGS = [
  "requires_part2",
  "requires_part3",
  "requires_experience_years",
  "senior_role",
  "commute_exceeds_limit",
  "no_right_to_work",
  "vacancy_closed",
  "employer_suppressed",
  "employment_type_excluded",
  "salary_below_minimum",
] as const;
export type HardFlag = (typeof HARD_FLAGS)[number];

export interface CandidateEligibilityProfile {
  qualification: CandidateQualification;
  /** Years of relevant practice experience the candidate can evidence. */
  experienceYears: number;
  hasUkRightToWork: boolean;
  maxPublicTransportMinutes: number;
  maxCarMinutes: number | null;
  acceptedEmploymentTypes: EmploymentType[];
  minSalaryGbp: number | null;
  /** Broad mode: any genuine entry route is acceptable (technician, BIM, planning, etc.). */
  acceptAdjacentEntryRoles: boolean;
}

export interface VacancyEligibilityInput {
  title: string | null;
  status: VacancyStatus;
  qualificationRequired: QualificationRequired;
  experienceYearsMin: number | null;
  employmentType: EmploymentType;
  salaryMinGbpPerYear: number | null;
  /** Explicit statement that sponsorship is unavailable AND candidate lacks right to work. */
  requiresExistingRightToWork: boolean;
  publicTransportMinutes: number | null;
  carMinutes: number | null;
  isRemote: boolean;
  employerSuppressed: boolean;
}

export interface EligibilityResult {
  status: EligibilityStatus;
  hardFlags: HardFlag[];
  reasons: string[];
  /** Which items could not be assessed because data is missing. */
  unknowns: string[];
}

const QUALIFICATION_RANK: Record<CandidateQualification, number> = {
  student: 0,
  other: 0,
  part1_equivalent: 1,
  part1: 1,
  architectural_technology: 1,
  part2: 2,
  part3: 3,
};

export function evaluateEligibility(v: VacancyEligibilityInput, c: CandidateEligibilityProfile): EligibilityResult {
  const flags: HardFlag[] = [];
  const reasons: string[] = [];
  const unknowns: string[] = [];
  const rank = QUALIFICATION_RANK[c.qualification];
  const cls = classifyTitle(v.title);

  if (v.employerSuppressed) {
    flags.push("employer_suppressed");
    reasons.push("Employer is on the suppression list.");
  }
  if (["closed", "filled", "withdrawn"].includes(v.status)) {
    flags.push("vacancy_closed");
    reasons.push(`Vacancy status is ${v.status}.`);
  }

  const required = v.qualificationRequired !== "unknown" ? v.qualificationRequired : cls.impliedQualification;
  if (required === "part3" && rank < 3) {
    flags.push("requires_part3");
    reasons.push("Role requires Part 3 / registered architect.");
  } else if (required === "part2" && rank < 2) {
    flags.push("requires_part2");
    reasons.push("Role requires Part 2.");
  } else if (required === "unknown") {
    unknowns.push("qualification_required");
  }

  if (cls.family === "senior_or_unsuitable") {
    flags.push("senior_role");
    reasons.push("Title indicates a senior or fully qualified role.");
  } else if (cls.family === "unknown") {
    unknowns.push("role_family");
  } else if (!cls.entryLevel && !flags.includes("requires_part2") && !flags.includes("requires_part3")) {
    // Part 2 family without explicit requirement text still gets flagged via impliedQualification above.
  }
  if (!c.acceptAdjacentEntryRoles && cls.entryLevel && !["part1_assistant", "graduate_assistant", "placement_internship"].includes(cls.family)) {
    flags.push("employment_type_excluded");
    reasons.push("Adjacent entry roles are excluded by your profile.");
  }

  if (v.experienceYearsMin != null) {
    if (v.experienceYearsMin > Math.max(c.experienceYears, 2)) {
      flags.push("requires_experience_years");
      reasons.push(`Requires ${v.experienceYearsMin}+ years of experience.`);
    }
  } else {
    unknowns.push("experience_years");
  }

  if (!c.acceptedEmploymentTypes.includes(v.employmentType) && v.employmentType !== "unknown") {
    flags.push("employment_type_excluded");
    reasons.push(`Employment type ${v.employmentType} is outside your accepted types.`);
  } else if (v.employmentType === "unknown") {
    unknowns.push("employment_type");
  }

  if (c.minSalaryGbp != null && v.salaryMinGbpPerYear != null && v.salaryMinGbpPerYear < c.minSalaryGbp) {
    flags.push("salary_below_minimum");
    reasons.push(`Advertised salary (£${v.salaryMinGbpPerYear}) is below your minimum (£${c.minSalaryGbp}).`);
  }

  if (v.requiresExistingRightToWork && !c.hasUkRightToWork) {
    flags.push("no_right_to_work");
    reasons.push("Role requires existing UK right to work without sponsorship.");
  }

  if (!v.isRemote) {
    const pt = v.publicTransportMinutes;
    const car = v.carMinutes;
    if (pt == null && car == null) {
      unknowns.push("commute");
    } else {
      const ptOk = pt != null && pt <= c.maxPublicTransportMinutes;
      const carOk = car != null && c.maxCarMinutes != null && car <= c.maxCarMinutes;
      if (!ptOk && !carOk) {
        flags.push("commute_exceeds_limit");
        reasons.push(`Commute (${pt ?? "?"} min public transport / ${car ?? "?"} min car) exceeds your limit.`);
      }
    }
  }

  const uniqueFlags = [...new Set(flags)];
  let status: EligibilityStatus = "eligible";
  if (uniqueFlags.length > 0) status = "ineligible";
  else if (unknowns.includes("qualification_required") && unknowns.includes("role_family")) status = "needs_review";
  return { status, hardFlags: uniqueFlags, reasons, unknowns };
}
