import {
  DEFAULT_PRIORITY_CONFIG, DEFAULT_VACANCY_PRIORITY_WEIGHTS, PRIORITY_LABELS, VACANCY_PRIORITY_KEYS,
  type PriorityComponent, type PriorityConfig, type PriorityResult, type PriorityStatus, type PriorityWarning, type SuitabilityInput, type VacancyPriorityWeights,
} from "./types.js";

const DAY = 86_400_000;
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Constraints that make an opportunity unworkable as it stands, whatever the suitability score says. */
export const PRACTICAL_BLOCKERS = new Set(["commute_exceeds_limit", "outside_travel_range", "salary_below_minimum", "employment_type_excluded", "no_right_to_work"]);

export interface VacancyPriorityInput {
  now: Date;
  vacancyStatus: string;
  /** The vacancy's real closing date. Null means unknown: it is never treated as open-ended. */
  closingAt: Date | null;
  suitability: SuitabilityInput;
  applicationRouteKnown: boolean;
  effortMinutes: number | null;
}

function weighted(parts: [number | null, number][]): number | null {
  const known = parts.filter(([s]) => s != null) as [number, number][];
  const w = known.reduce((a, [, x]) => a + x, 0);
  return w ? known.reduce((a, [s, x]) => a + s * x, 0) / w : null;
}

/**
 * Priority = what to act on first. It complements Stage 2 suitability and never replaces it:
 * - an approaching deadline raises priority only in proportion to suitability, so it cannot make an unsuitable role look suitable;
 * - blockers and practical constraints put the item on hold with the reason, whatever the score;
 * - closed or expired vacancies are not live and are never recommended;
 * - unknown values stay unknown (excluded from the score and flagged), and incomplete research gives no score at all.
 */
export function computeVacancyPriority(i: VacancyPriorityInput, weights: VacancyPriorityWeights = DEFAULT_VACANCY_PRIORITY_WEIGHTS, cfg: PriorityConfig = DEFAULT_PRIORITY_CONFIG): PriorityResult {
  const warnings: PriorityWarning[] = [];
  const rationale: string[] = [];
  const s = i.suitability;
  const closed = ["closed", "filled", "withdrawn"].includes(i.vacancyStatus);
  const expired = !!i.closingAt && i.closingAt.getTime() < i.now.getTime();
  const daysLeft = i.closingAt ? Math.floor((i.closingAt.getTime() - i.now.getTime()) / DAY) : null;
  const deadline = { at: i.closingAt ? i.closingAt.toISOString() : null, daysLeft, known: !!i.closingAt };
  const base = { components: [] as PriorityComponent[], warnings, rationale, deadline, holdReason: null as string | null, holdCondition: null as string | null, holdUntil: null as string | null };

  if (closed || expired) {
    warnings.push({ code: closed ? "vacancy_closed" : "deadline_passed", text: closed ? `The vacancy is ${i.vacancyStatus}.` : `The closing date (${i.closingAt!.toISOString().slice(0, 10)}) has passed.`, severity: "blocker" });
    rationale.push("Not a live opportunity: it is not recommended for application.");
    return { ...base, score: null, recommended: "dismissed", live: false };
  }

  for (const b of s.blockers) warnings.push({ code: b.code, text: b.text, severity: "blocker" });
  const practical = s.blockers.filter((b) => PRACTICAL_BLOCKERS.has(b.code));
  const essential = s.blockers.filter((b) => !PRACTICAL_BLOCKERS.has(b.code));
  if (!s.profileApproved) warnings.push({ code: "profile_unapproved", text: "Your candidate profile is not approved, so suitability is provisional.", severity: "warning" });
  if (s.conflictCount) warnings.push({ code: "sources_conflict", text: `${s.conflictCount} source conflict(s) need resolving before relying on this.`, severity: "warning" });

  const researched = s.exists && s.total != null && s.assessedWeight >= cfg.min_assessed_weight;
  if (!researched) {
    warnings.push({ code: "research_incomplete", text: s.exists ? `Only ${Math.round(s.assessedWeight)}% of the suitability model could be assessed.` : "No Stage 2 assessment exists yet.", severity: "warning" });
    if (!i.closingAt) warnings.push({ code: "deadline_unknown", text: "No closing date is recorded: verify it rather than assuming the vacancy is open.", severity: "warning" });
    rationale.push("No priority score yet: complete the research first rather than guessing.");
    return { ...base, score: null, recommended: "on_hold", live: true, holdReason: "Research incomplete", holdCondition: "Complete the Stage 2 research and review it", };
  }

  const suitabilityUsed = s.preliminary ? (s.total! + s.rangeLow) / 2 : s.total!;
  const comps: PriorityComponent[] = [];
  const add = (key: string, weight: number, score: number | null, reasons: string[]) => comps.push({ key, label: PRIORITY_LABELS[key] ?? key, weight, score: score == null ? null : Math.round(score), points: null, known: score != null, reasons });

  add("suitability", weights.suitability, suitabilityUsed, [`Stage 2 suitability ${Math.round(s.total!)}/100${s.preliminary ? `; research is preliminary, so ${Math.round(suitabilityUsed)} is used (the unassessed part counts for nothing)` : ""}.`]);

  if (i.closingAt && daysLeft != null) {
    const raw = daysLeft <= 2 ? 100 : daysLeft <= 7 ? 90 : daysLeft <= 14 ? 70 : daysLeft <= 30 ? 45 : daysLeft <= 60 ? 25 : 10;
    const gate = clamp((suitabilityUsed - cfg.gate_low) / (cfg.gate_high - cfg.gate_low), 0, 1);
    add("deadline", weights.deadline, raw * gate, [`Closes in ${daysLeft} day(s) (${i.closingAt.toISOString().slice(0, 10)}).`, gate < 1 ? `Urgency counts for ${Math.round(gate * 100)}% because suitability is ${Math.round(suitabilityUsed)}: a deadline does not make a weaker match more suitable.` : "Suitability is high enough for the deadline to count in full."]);
  } else {
    add("deadline", weights.deadline, null, ["Closing date unknown: not assumed to be open-ended. Verify it."]);
    warnings.push({ code: "deadline_unknown", text: "No closing date is recorded: verify it rather than assuming the vacancy is open.", severity: "warning" });
  }

  add("career_value", weights.career_value, weighted([[s.criteria.career_relevance ?? null, 2], [s.criteria.training_development ?? null, 1]]), ["Role relevance to your goals and the training or development on offer (from Stage 2)."]);

  const effortScore = i.effortMinutes == null ? null : i.effortMinutes <= 90 ? 100 : i.effortMinutes <= 180 ? 85 : i.effortMinutes <= 300 ? 65 : 45;
  const feas = practical.length ? 0 : weighted([[s.criteria.location_practical ?? null, 2], [i.applicationRouteKnown ? 100 : 50, 1], [effortScore, 1]]);
  add("feasibility", weights.feasibility, feas, practical.length ? [`Unworkable as stated: ${practical.map((p) => p.text).join(" ")}`] : [`Location and practical fit${i.applicationRouteKnown ? "" : "; the application route is not recorded"}${i.effortMinutes != null ? `; about ${i.effortMinutes} min of work remaining (estimate)` : ""}.`]);

  add("evidence", weights.evidence, clamp(s.completeness * 0.6 + s.confidence * 0.4 - 15 * s.conflictCount), [`Research ${Math.round(s.completeness)}% complete, evidence confidence ${Math.round(s.confidence)}%${s.conflictCount ? `, reduced for ${s.conflictCount} conflict(s)` : ""}.`]);

  const knownW = comps.filter((c) => c.known).reduce((a, c) => a + c.weight, 0);
  for (const c of comps) c.points = c.known ? round1(((c.score ?? 0) * c.weight) / knownW) : null;
  const score = round1(comps.reduce((a, c) => a + (c.points ?? 0), 0));

  let recommended: PriorityStatus;
  let holdReason: string | null = null, holdCondition: string | null = null;
  if (practical.length) { recommended = "on_hold"; holdReason = `Practical constraint: ${practical[0]!.text}`; holdCondition = "Resolve the constraint (or dismiss the opportunity)"; }
  else if (essential.length) { recommended = "on_hold"; holdReason = `Blocked: ${essential[0]!.text}`; holdCondition = "Correct or dispute the requirement if it is wrong, otherwise dismiss"; }
  else {
    const strong = score >= cfg.high_score && !s.preliminary && s.completeness >= cfg.min_completeness_for_high;
    const urgent = daysLeft != null && daysLeft <= cfg.high_deadline_days && suitabilityUsed >= cfg.gate_high - 10 && !s.preliminary;
    recommended = strong || urgent ? "high" : score >= cfg.recommended_score ? "recommended" : "backlog";
    if (recommended === "high" && (s.conflictCount > 0 || !s.profileApproved)) recommended = "recommended";
    rationale.push(`Priority ${score}/100 from suitability ${Math.round(suitabilityUsed)} and the factors below.`);
    if (urgent) rationale.push(`Closes in ${daysLeft} day(s) and the role is a good enough match to act on now.`);
    else if (strong) rationale.push("Strong, well-evidenced match.");
    if (recommended === "backlog") rationale.push("Worth keeping, but not ahead of stronger options.");
    if (s.preliminary) rationale.push("Research is incomplete, so this cannot rank as high priority until it is verified.");
  }
  if (holdReason) rationale.push(holdReason);
  return { ...base, components: comps, score, recommended, live: true, holdReason, holdCondition };
}
