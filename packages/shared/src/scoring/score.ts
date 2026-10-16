import type { ScoreBand } from "../enums.js";
import type { HardFlag } from "./eligibility.js";
import { FACTOR_FUNCTIONS, type FactorResult, type ScoringInput } from "./factors.js";
import { bandFor, DEFAULT_BAND_THRESHOLDS, DEFAULT_WEIGHTS, SCORE_FACTORS, type BandThresholds, type ScoreFactor, type ScoringWeights } from "./weights.js";

export interface ScoreResult {
  total: number;
  band: ScoreBand;
  factors: Record<ScoreFactor, FactorResult>;
  unknownFactors: ScoreFactor[];
  hardFlags: HardFlag[];
  weightsUsed: ScoringWeights;
}

/**
 * Opportunity Priority Score (0-100). Hard flags are reported alongside the score and the UI must
 * show them; they do not zero the employer score because an employer can still be a good
 * speculative target even if one of its vacancies is ineligible.
 */
export function computeScore(
  input: ScoringInput,
  hardFlags: HardFlag[] = [],
  weights: ScoringWeights = DEFAULT_WEIGHTS,
  thresholds: BandThresholds = DEFAULT_BAND_THRESHOLDS,
): ScoreResult {
  const factors = {} as Record<ScoreFactor, FactorResult>;
  const unknownFactors: ScoreFactor[] = [];
  let total = 0;
  for (const f of SCORE_FACTORS) {
    const r = FACTOR_FUNCTIONS[f](input);
    factors[f] = r;
    if (r.unknown) unknownFactors.push(f);
    total += (r.score * weights[f]) / 100;
  }
  total = Math.round(total * 100) / 100;
  let band = bandFor(total, input.confidenceScore, unknownFactors.length, thresholds);
  // An employer that is suppressed can never be a priority target.
  if (hardFlags.includes("employer_suppressed")) band = "C";
  return { total, band, factors, unknownFactors, hardFlags, weightsUsed: weights };
}
