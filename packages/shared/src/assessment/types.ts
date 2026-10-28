import type { CandidateQualification, EmploymentType, EvidenceStatus, RoleFamily, WorkingArrangement } from "../enums.js";

export const VACANCY_CRITERIA = ["qualifications", "experience", "skills", "location_practical", "career_relevance", "training_development"] as const;
export type VacancyCriterion = (typeof VACANCY_CRITERIA)[number];
export type VacancyWeights = Record<VacancyCriterion, number>;
export const DEFAULT_VACANCY_WEIGHTS: VacancyWeights = { qualifications: 25, experience: 20, skills: 20, location_practical: 15, career_relevance: 10, training_development: 10 };

export const EMPLOYER_CRITERIA = ["geography", "relevant_work", "recruitment_evidence", "training_development", "speculative_rationale"] as const;
export type EmployerCriterion = (typeof EMPLOYER_CRITERIA)[number];
export type EmployerWeights = Record<EmployerCriterion, number>;
export const DEFAULT_EMPLOYER_WEIGHTS: EmployerWeights = { geography: 30, relevant_work: 20, recruitment_evidence: 20, training_development: 10, speculative_rationale: 20 };

export const CRITERION_LABELS: Record<string, string> = {
  qualifications: "Qualifications and essential requirements",
  experience: "Experience and career-stage fit",
  skills: "Skills match",
  location_practical: "Location and practical suitability",
  career_relevance: "Career relevance",
  training_development: "Training and development potential",
  geography: "Geographical suitability",
  relevant_work: "Relevant architectural work",
  recruitment_evidence: "Graduate / entry-level recruitment evidence",
  speculative_rationale: "Strength of the case for a speculative approach",
};

/** Erin's approved profile as used for assessment. Only what she has supplied. */
export interface AssessmentProfile {
  version: number;
  approved: boolean;
  qualification: CandidateQualification;
  experienceYears: number;
  software: string[];
  skills: string[];
  sectorInterests: string[];
  targetRoleFamilies: RoleFamily[];
  acceptAdjacentEntryRoles: boolean;
  acceptedEmploymentTypes: EmploymentType[];
  workingArrangementPreference: WorkingArrangement;
  maxPublicTransportMinutes: number;
  maxCarMinutes: number | null;
  minSalaryGbp: number | null;
  hasUkRightToWork: boolean;
}

export type RequirementKind = "qualification" | "registration" | "experience" | "skill" | "software" | "other";
export type RequirementNecessity = "essential" | "desirable" | "unclear";
export type RequirementReview = "unreviewed" | "confirmed" | "corrected" | "disputed" | "rejected";

export interface RequirementInput {
  id: string;
  kind: RequirementKind;
  necessity: RequirementNecessity;
  text: string;
  quote: string | null;
  evidenceStatus: EvidenceStatus;
  review: RequirementReview;
}

export interface Conflict { field: string; detail: string }

export interface VacancyAssessmentInput {
  title: string;
  roleFamily: RoleFamily;
  isAdjacent: boolean;
  status: string;
  employmentType: EmploymentType;
  qualificationRequired: "none" | "part1" | "part2" | "part3" | "technician" | "other" | "unknown";
  experienceYearsMin: number | null;
  salaryYearMin: number | null;
  rightToWorkRequired: boolean | null;
  hybridPolicy: WorkingArrangement;
  ptMinutes: number | null;
  carMinutes: number | null;
  closingKnown: boolean;
  applicationRouteKnown: boolean;
  salaryKnown: boolean;
  locationKnown: boolean;
  /** Description text was available and analysed (not just a title). */
  descriptionAnalysed: boolean;
  /** Requirements extraction has run for this vacancy. */
  requirementsExtracted: boolean;
  /** An official page for this vacancy (employer's own site or listing) was read successfully. */
  officialSourceRead: boolean;
  sourcesTried: number;
  sourcesFailed: number;
  entryLevel: { value: "yes" | "no" | "unclear"; quote: string | null } | null;
  requirements: RequirementInput[];
  trainingSignals: { text: string; quote: string | null; origin: "vacancy" | "employer" }[];
  employer: { sectors: string[]; specialisms: string[]; hasGraduateProgramme: boolean | null; suppressed: boolean };
  conflicts: Conflict[];
}

export interface CriterionResult {
  criterion: string;
  label: string;
  weight: number;
  /** 0..100, null when the criterion cannot be assessed from stored evidence. */
  score: number | null;
  /** Points contributed to the total (score * weight / 100), null when unknown. */
  points: number | null;
  known: boolean;
  /** Why points were gained or deducted, in plain language. */
  reasons: string[];
  /** Evidence quotes or references supporting the reasons. */
  evidence: string[];
  /** Items that could not be verified (they neither add nor subtract points). */
  unverified: string[];
}

export interface Blocker { code: string; text: string; evidence: string | null }

export interface AssessmentResult {
  kind: "vacancy" | "employer";
  /** Score over the criteria that could be assessed, rescaled to 100. 0 when nothing could be assessed. */
  total: number;
  /** Share of total weight that could be assessed (0..100). */
  assessedWeight: number;
  /** Lowest/highest total if every unknown criterion turned out to score 0 / 100. */
  range: { low: number; high: number };
  criteria: CriterionResult[];
  blockers: Blocker[];
  strengths: string[];
  missing: string[];
  develop: string[];
  questions: string[];
  nextSteps: string[];
  conflicts: Conflict[];
  completeness: number;
  confidence: number;
  recommendation: string;
  preliminary: boolean;
}

export interface EmployerAssessmentInput {
  name: string;
  suppressed: boolean;
  stage: string;
  doNotContact: boolean;
  isArchitecturePractice: boolean | null;
  practiceType: string;
  sectors: string[];
  specialisms: string[];
  hasProjectEvidence: boolean;
  zoneMaxPtMinutes: number | null;
  zoneCode: string | null;
  ptMinutes: number | null;
  carMinutes: number | null;
  hiresPart1: "yes" | "no" | "unknown";
  hasGraduateProgramme: boolean | null;
  acceptsSpeculative: "yes" | "no" | "unknown";
  historicalEntryRoles: number;
  openVacancies: number;
  signals: { strong: number; moderate: number; weak: number };
  trainingText: string | null;
  recruitmentRouteKnown: boolean;
  namedContactWithRole: boolean;
  relevantProjectCited: boolean;
  officialSourceRead: boolean;
  sourcesTried: number;
  sourcesFailed: number;
  claimsTotal: number;
  claimsSourced: number;
  conflicts: Conflict[];
}
