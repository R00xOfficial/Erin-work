import type { EmployerOutreachStage, YesNoUnknown } from "../enums.js";
import type { ScoreFactor } from "./weights.js";

/** Evidence-derived inputs for one employer (optionally against one vacancy). Nulls mean "unknown". */
export interface ScoringInput {
  /** Count of open, eligible vacancies at this employer. */
  openEligibleVacancies: number | null;
  /** Count of open vacancies that are ineligible (still a hiring signal, weaker). */
  openIneligibleVacancies: number;
  /** Days since the newest open vacancy was first seen. */
  newestVacancyAgeDays: number | null;
  hiresPart1: YesNoUnknown;
  /** Historical entry-level roles observed (vacancies with entry role families, any status). */
  historicalEntryRoles: number;
  hasGraduateProgramme: boolean | null;
  acceptsSpeculative: YesNoUnknown;
  /** 0..1 overlap between vacancy/employer requested skills and candidate skills. Null if no skills known. */
  skillOverlap: number | null;
  /** 0..1 overlap between employer sectors and candidate interests. */
  sectorOverlap: number | null;
  /** Hiring signals in the last 180 days, by strength. */
  signals: { strong: number; moderate: number; weak: number };
  /** Best contact relevance. */
  contact: { exists: boolean; hasEmail: boolean; verified: boolean; hiringAuthority: boolean; applicationsEmailKnown: boolean };
  /** Best public-transport minutes across offices (null if none computed). */
  bestPublicTransportMinutes: number | null;
  bestCarMinutes: number | null;
  maxPublicTransportMinutes: number;
  workingArrangement: "office" | "hybrid" | "remote" | "unknown";
  /** Research quality. */
  confidenceScore: number; // 0..100
  daysSinceLastChecked: number | null;
  claimsWithSources: number;
  claimsTotal: number;
  outreachStage: EmployerOutreachStage;
}

export interface FactorResult {
  score: number; // 0..100
  reason: string;
  unknown: boolean;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export function scoreVacancyEvidence(i: ScoringInput): FactorResult {
  if (i.openEligibleVacancies == null) return { score: 0, reason: "No vacancy data gathered yet.", unknown: true };
  if (i.openEligibleVacancies > 0) {
    const fresh = i.newestVacancyAgeDays != null && i.newestVacancyAgeDays <= 14;
    const base = fresh ? 100 : i.newestVacancyAgeDays != null && i.newestVacancyAgeDays <= 45 ? 85 : 70;
    return { score: base, reason: `${i.openEligibleVacancies} open eligible vacanc${i.openEligibleVacancies === 1 ? "y" : "ies"}${fresh ? " (posted in last 14 days)" : ""}.`, unknown: false };
  }
  if (i.openIneligibleVacancies > 0) return { score: 35, reason: `${i.openIneligibleVacancies} open vacanc${i.openIneligibleVacancies === 1 ? "y" : "ies"} but none eligible — the practice is hiring.`, unknown: false };
  if (i.acceptsSpeculative === "yes") return { score: 25, reason: "No open vacancy; employer states speculative applications are welcome.", unknown: false };
  return { score: 10, reason: "No current vacancy evidence.", unknown: false };
}

export function scoreEntryLevelSuitability(i: ScoringInput): FactorResult {
  let s = 0;
  const parts: string[] = [];
  let unknown = true;
  if (i.hiresPart1 === "yes") { s += 50; parts.push("employs Part 1 / assistants"); unknown = false; }
  else if (i.hiresPart1 === "no") { s -= 30; parts.push("no evidence of junior staff"); unknown = false; }
  if (i.historicalEntryRoles > 0) { s += Math.min(30, 10 * i.historicalEntryRoles); parts.push(`${i.historicalEntryRoles} past entry-level role(s) seen`); unknown = false; }
  if (i.hasGraduateProgramme === true) { s += 25; parts.push("graduate programme"); unknown = false; }
  if (i.acceptsSpeculative === "yes") { s += 10; parts.push("welcomes speculative CVs"); unknown = false; }
  if (unknown) return { score: 0, reason: "Entry-level hiring suitability not yet researched.", unknown: true };
  return { score: clamp(s), reason: parts.join("; ") + ".", unknown: false };
}

export function scoreSkillsFit(i: ScoringInput): FactorResult {
  if (i.skillOverlap == null && i.sectorOverlap == null) return { score: 0, reason: "No skills or sector information gathered.", unknown: true };
  const skill = i.skillOverlap ?? 0.5;
  const sector = i.sectorOverlap ?? 0.5;
  const s = clamp(Math.round((skill * 0.65 + sector * 0.35) * 100));
  return { score: s, reason: `Skill overlap ${Math.round(skill * 100)}%, sector overlap ${Math.round(sector * 100)}%.`, unknown: false };
}

export function scoreGrowthSignals(i: ScoringInput): FactorResult {
  const n = i.signals.strong * 3 + i.signals.moderate * 2 + i.signals.weak;
  if (n === 0) return { score: 15, reason: "No hiring or growth signals in the last 180 days.", unknown: false };
  return { score: clamp(15 + n * 15), reason: `${i.signals.strong} strong, ${i.signals.moderate} moderate, ${i.signals.weak} weak signal(s) in 180 days.`, unknown: false };
}

export function scoreContactAccess(i: ScoringInput): FactorResult {
  const c = i.contact;
  if (!c.exists && !c.applicationsEmailKnown) return { score: 0, reason: "No contact or applications route identified.", unknown: true };
  let s = 0;
  const parts: string[] = [];
  if (c.applicationsEmailKnown) { s += 40; parts.push("applications email known"); }
  if (c.exists) { s += 20; parts.push("named contact"); }
  if (c.hasEmail) { s += 15; parts.push("contact email"); }
  if (c.verified) { s += 15; parts.push("verified"); }
  if (c.hiringAuthority) { s += 10; parts.push("hiring authority"); }
  return { score: clamp(s), reason: parts.join(", ") + ".", unknown: false };
}

export function scoreCommute(i: ScoringInput): FactorResult {
  if (i.workingArrangement === "remote") return { score: 90, reason: "Remote role; commute largely irrelevant.", unknown: false };
  const pt = i.bestPublicTransportMinutes;
  if (pt == null && i.bestCarMinutes == null) return { score: 0, reason: "Travel time not yet computed.", unknown: true };
  const limit = i.maxPublicTransportMinutes;
  let s: number;
  const m = pt ?? i.bestCarMinutes!;
  if (m <= limit * 0.5) s = 100;
  else if (m <= limit * 0.75) s = 80;
  else if (m <= limit) s = 55;
  else if (m <= limit * 1.25) s = 20;
  else s = 0;
  if (i.workingArrangement === "hybrid") s = clamp(s + 10);
  return { score: s, reason: `${m} min ${pt != null ? "by public transport" : "by car"} vs ${limit} min limit${i.workingArrangement === "hybrid" ? ", hybrid" : ""}.`, unknown: false };
}

export function scoreResearchFreshness(i: ScoringInput): FactorResult {
  if (i.daysSinceLastChecked == null) return { score: 0, reason: "Never checked.", unknown: true };
  const sourced = i.claimsTotal > 0 ? i.claimsWithSources / i.claimsTotal : 0;
  let s = i.daysSinceLastChecked <= 14 ? 100 : i.daysSinceLastChecked <= 45 ? 70 : i.daysSinceLastChecked <= 120 ? 40 : 10;
  s = Math.round(s * (0.5 + 0.5 * sourced));
  return { score: clamp(s), reason: `Checked ${i.daysSinceLastChecked} days ago; ${Math.round(sourced * 100)}% of claims have sources.`, unknown: false };
}

export const FACTOR_FUNCTIONS: Record<ScoreFactor, (i: ScoringInput) => FactorResult> = {
  vacancy_evidence: scoreVacancyEvidence,
  entry_level_suitability: scoreEntryLevelSuitability,
  skills_fit: scoreSkillsFit,
  growth_signals: scoreGrowthSignals,
  contact_access: scoreContactAccess,
  commute: scoreCommute,
  research_freshness: scoreResearchFreshness,
};
