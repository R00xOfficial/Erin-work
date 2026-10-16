import type { ScoreBand } from "../enums.js";

export const SCORE_FACTORS = [
  "vacancy_evidence",
  "entry_level_suitability",
  "skills_fit",
  "growth_signals",
  "contact_access",
  "commute",
  "research_freshness",
] as const;
export type ScoreFactor = (typeof SCORE_FACTORS)[number];

export type ScoringWeights = Record<ScoreFactor, number>;

/** Proposed starting weights from the brief (sum to 100). Not validated hiring probabilities. */
export const DEFAULT_WEIGHTS: ScoringWeights = {
  vacancy_evidence: 25,
  entry_level_suitability: 20,
  skills_fit: 20,
  growth_signals: 10,
  contact_access: 10,
  commute: 10,
  research_freshness: 5,
};

export interface BandThresholds {
  A: number;
  B: number;
  /** Below this confidence (0-100) the record is "research_further" regardless of score. */
  minConfidence: number;
  /** If at least this many factors are unknown, the record is "research_further". */
  maxUnknownFactors: number;
}

export const DEFAULT_BAND_THRESHOLDS: BandThresholds = { A: 70, B: 50, minConfidence: 40, maxUnknownFactors: 3 };

export const FACTOR_LABELS: Record<ScoreFactor, string> = {
  vacancy_evidence: "Current vacancy evidence",
  entry_level_suitability: "Entry-level hiring suitability",
  skills_fit: "Fit with your skills and portfolio",
  growth_signals: "Growth and recruitment signals",
  contact_access: "Access to an appropriate contact",
  commute: "Commute and working arrangement",
  research_freshness: "Quality and freshness of research",
};

export function validateWeights(w: Partial<Record<string, number>>): ScoringWeights {
  const out = { ...DEFAULT_WEIGHTS };
  let total = 0;
  for (const f of SCORE_FACTORS) {
    const v = w[f];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`Invalid weight for ${f}`);
    out[f] = v;
    total += v;
  }
  if (Math.abs(total - 100) > 0.001) throw new Error(`Weights must sum to 100 (got ${total})`);
  return out;
}

export function bandFor(total: number, confidence: number, unknownFactors: number, t: BandThresholds = DEFAULT_BAND_THRESHOLDS): ScoreBand {
  if (confidence < t.minConfidence || unknownFactors >= t.maxUnknownFactors) return "research_further";
  if (total >= t.A) return "A";
  if (total >= t.B) return "B";
  return "C";
}
