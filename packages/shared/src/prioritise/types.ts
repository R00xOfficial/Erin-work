export type PriorityStatus = "high" | "recommended" | "backlog" | "on_hold" | "dismissed";
export const PRIORITY_STATUSES: readonly PriorityStatus[] = ["high", "recommended", "backlog", "on_hold", "dismissed"];

export const VACANCY_PRIORITY_KEYS = ["suitability", "deadline", "career_value", "feasibility", "evidence"] as const;
export const EMPLOYER_PRIORITY_KEYS = ["suitability", "receptiveness", "career_value", "feasibility", "evidence"] as const;
export type VacancyPriorityWeights = Record<(typeof VACANCY_PRIORITY_KEYS)[number], number>;
export type EmployerPriorityWeights = Record<(typeof EMPLOYER_PRIORITY_KEYS)[number], number>;
export const DEFAULT_VACANCY_PRIORITY_WEIGHTS: VacancyPriorityWeights = { suitability: 40, deadline: 20, career_value: 15, feasibility: 15, evidence: 10 };
export const DEFAULT_EMPLOYER_PRIORITY_WEIGHTS: EmployerPriorityWeights = { suitability: 40, receptiveness: 20, career_value: 15, feasibility: 15, evidence: 10 };

export const PRIORITY_LABELS: Record<string, string> = {
  suitability: "Suitability (Stage 2)", deadline: "Deadline and time sensitivity", career_value: "Career value and relevance",
  feasibility: "Practical feasibility", evidence: "Confidence and completeness of evidence", receptiveness: "Evidence the employer may be receptive",
};

export interface PriorityConfig {
  high_score: number;
  recommended_score: number;
  high_deadline_days: number;
  min_assessed_weight: number;
  min_completeness_for_high: number;
  gate_low: number;
  gate_high: number;
}
export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = { high_score: 70, recommended_score: 50, high_deadline_days: 7, min_assessed_weight: 40, min_completeness_for_high: 60, gate_low: 40, gate_high: 70 };

/** The parts of a Stage 2 assessment that Stage 3 uses. Stage 3 never recomputes suitability itself. */
export interface SuitabilityInput {
  exists: boolean;
  total: number | null;
  assessedWeight: number;
  rangeLow: number;
  preliminary: boolean;
  completeness: number;
  confidence: number;
  blockers: { code: string; text: string }[];
  conflictCount: number;
  profileApproved: boolean;
  /** Score per Stage 2 criterion, null where it could not be assessed. */
  criteria: Record<string, number | null>;
}

export interface PriorityComponent { key: string; label: string; weight: number; score: number | null; points: number | null; known: boolean; reasons: string[] }
export interface PriorityWarning { code: string; text: string; severity: "blocker" | "warning" | "info" }

export interface PriorityResult {
  /** Null when no honest score can be given (research incomplete, or the opportunity is not live). */
  score: number | null;
  components: PriorityComponent[];
  recommended: PriorityStatus;
  live: boolean;
  warnings: PriorityWarning[];
  rationale: string[];
  deadline: { at: string | null; daysLeft: number | null; known: boolean };
  holdReason: string | null;
  holdCondition: string | null;
  holdUntil: string | null;
}

export interface EffortItem { task: string; minutes: number; basis: string }
export interface EffortEstimate { items: EffortItem[]; totalMinutes: number; isEstimate: true }
