import {
  DEFAULT_EMPLOYER_PRIORITY_WEIGHTS, DEFAULT_PRIORITY_CONFIG, PRIORITY_LABELS,
  type EmployerPriorityWeights, type PriorityComponent, type PriorityConfig, type PriorityResult, type PriorityStatus, type PriorityWarning, type SuitabilityInput,
} from "./types.js";

const DAY = 86_400_000;
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface EmployerPriorityInput {
  now: Date;
  /** Stage 2 speculative-priority assessment for the employer. */
  suitability: SuitabilityInput;
  suppressed: boolean;
  doNotContact: boolean;
  stage: string;
  /** Real, sent messages only. */
  outboundCount: number;
  lastOutboundAt: Date | null;
  replied: boolean;
  cooldownDays: number;
  /** A reason Erin has recorded for approaching again before the cooldown ends. */
  recontactApproved: boolean;
  openVacancies: number;
  acceptsSpeculative: "yes" | "no" | "unknown";
  acceptsSpeculativeVerified: boolean;
  hiresPart1Verified: boolean;
  graduateProgramme: boolean | null;
  historicalEntryRoles: number;
  recentSignals: number;
  routeKnown: boolean;
  namedContact: boolean;
  effortMinutes: number | null;
}

const IN_CONVERSATION = new Set(["replied", "conversation_in_progress", "cv_requested", "informal_interview", "opportunity_identified", "offer_received"]);
const CONTACTED = new Set(["email_sent", "follow_up_due", ...IN_CONVERSATION]);

function weighted(parts: [number | null, number][]): number | null {
  const known = parts.filter(([s]) => s != null) as [number, number][];
  const w = known.reduce((a, [, x]) => a + x, 0);
  return w ? known.reduce((a, [s, x]) => a + s * x, 0) / w : null;
}

/**
 * Separate model for employers with no advertised role. It distinguishes confirmed recruitment activity from a hypothesis, never says an
 * employer is hiring because it is in the database, and holds off employers who have already been approached unless Erin has recorded a reason.
 */
export function computeEmployerPriority(i: EmployerPriorityInput, weights: EmployerPriorityWeights = DEFAULT_EMPLOYER_PRIORITY_WEIGHTS, cfg: PriorityConfig = DEFAULT_PRIORITY_CONFIG): PriorityResult {
  const s = i.suitability;
  const warnings: PriorityWarning[] = [];
  const rationale: string[] = [];
  const base = { components: [] as PriorityComponent[], warnings, rationale, deadline: { at: null, daysLeft: null, known: false }, holdReason: null as string | null, holdCondition: null as string | null, holdUntil: null as string | null };

  if (i.suppressed || i.doNotContact) {
    warnings.push({ code: i.suppressed ? "employer_suppressed" : "do_not_contact", text: i.suppressed ? "The employer is on your suppression list." : "A contact has asked not to be contacted.", severity: "blocker" });
    rationale.push("Must not be approached.");
    return { ...base, score: null, recommended: "dismissed", live: false };
  }
  const contacted = i.outboundCount > 0 || CONTACTED.has(i.stage);
  if (i.replied || IN_CONVERSATION.has(i.stage)) {
    rationale.push("A conversation is already under way: it belongs in Stage 4, not in the speculative queue.");
    return { ...base, score: null, recommended: "on_hold", live: true, holdReason: "Already in conversation", holdCondition: "Managed in Stage 4 (follow up)" };
  }
  let holdUntil: string | null = null;
  if (contacted && !i.recontactApproved) {
    const last = i.lastOutboundAt;
    const until = last ? new Date(last.getTime() + i.cooldownDays * DAY) : null;
    if (!until || until.getTime() > i.now.getTime()) {
      holdUntil = until ? until.toISOString().slice(0, 10) : null;
      warnings.push({ code: "already_contacted", text: last ? `Already approached on ${last.toISOString().slice(0, 10)} (${i.outboundCount} message(s)).` : "Marked as contacted.", severity: "warning" });
      rationale.push("Not recommended again so soon: repeat approaches need a recorded reason.");
      return { ...base, score: null, recommended: "on_hold", live: true, holdReason: last ? `Already approached on ${last.toISOString().slice(0, 10)}` : "Already contacted", holdCondition: holdUntil ? `Reconsider after ${holdUntil}, or record a reason to approach sooner` : "Record a reason to approach again", holdUntil };
    }
    warnings.push({ code: "previously_contacted", text: `Approached before (${last!.toISOString().slice(0, 10)}); the ${i.cooldownDays}-day gap has passed.`, severity: "info" });
  }
  for (const b of s.blockers) warnings.push({ code: b.code, text: b.text, severity: "blocker" });
  if (!s.profileApproved) warnings.push({ code: "profile_unapproved", text: "Your candidate profile is not approved, so this is provisional.", severity: "warning" });

  if (!(s.exists && s.total != null && s.assessedWeight >= cfg.min_assessed_weight)) {
    warnings.push({ code: "research_incomplete", text: s.exists ? `Only ${Math.round(s.assessedWeight)}% of the model could be assessed.` : "No Stage 2 assessment exists yet.", severity: "warning" });
    rationale.push("No priority score yet: complete the research first rather than guessing.");
    return { ...base, score: null, recommended: "on_hold", live: true, holdReason: "Research incomplete", holdCondition: "Complete the Stage 2 research and review it" };
  }

  const used = s.preliminary ? (s.total + s.rangeLow) / 2 : s.total;
  const comps: PriorityComponent[] = [];
  const add = (key: string, weight: number, score: number | null, reasons: string[]) => comps.push({ key, label: PRIORITY_LABELS[key] ?? key, weight, score: score == null ? null : Math.round(score), points: null, known: score != null, reasons });
  add("suitability", weights.suitability, used, [`Stage 2 speculative-priority assessment ${Math.round(s.total)}/100${s.preliminary ? `; preliminary, so ${Math.round(used)} is used` : ""}.`]);

  // Confirmed recruitment activity is very different from a plausible guess; the score and the wording both say which it is.
  const confirmed = i.openVacancies > 0 || (i.acceptsSpeculative === "yes" && i.acceptsSpeculativeVerified) || i.graduateProgramme === true;
  const hypothesis = i.hiresPart1Verified || i.historicalEntryRoles > 0 || i.recentSignals > 0 || i.acceptsSpeculative === "yes";
  const basis = confirmed ? "confirmed" : hypothesis ? "hypothesis" : "none";
  add("receptiveness", weights.receptiveness, confirmed ? 100 : hypothesis ? 50 : 10, [
    confirmed ? `Confirmed recruitment activity: ${[i.openVacancies > 0 ? `${i.openVacancies} open vacancy(ies)` : null, i.acceptsSpeculative === "yes" && i.acceptsSpeculativeVerified ? "states it welcomes speculative applications" : null, i.graduateProgramme ? "graduate programme" : null].filter(Boolean).join(", ")}.`
    : hypothesis ? "A reasonable hypothesis only: signs it employs junior staff or may recruit, but no confirmed recruitment. This is not evidence that it is hiring."
    : "No evidence of recruitment of any kind.",
  ]);
  if (basis !== "confirmed") warnings.push({ code: "hiring_unconfirmed", text: "No confirmed recruitment activity: any approach is a speculative hypothesis.", severity: "info" });

  add("career_value", weights.career_value, weighted([[s.criteria.relevant_work ?? null, 2], [s.criteria.training_development ?? null, 1]]), ["Relevance of its work to your interests and the training offered (from Stage 2)."]);
  const effortScore = i.effortMinutes == null ? null : i.effortMinutes <= 60 ? 100 : i.effortMinutes <= 120 ? 80 : 60;
  const outside = s.blockers.some((b) => b.code === "outside_travel_range");
  add("feasibility", weights.feasibility, outside ? 0 : weighted([[s.criteria.geography ?? null, 2], [i.routeKnown || i.namedContact ? 100 : 30, 1], [effortScore, 1]]), [outside ? "Outside your travel range." : `Location${i.routeKnown || i.namedContact ? ", a recruitment route or contact is known" : ", but no recruitment route or contact is recorded"}.`]);
  add("evidence", weights.evidence, clamp(s.completeness * 0.6 + s.confidence * 0.4 - 15 * s.conflictCount), [`Research ${Math.round(s.completeness)}% complete, confidence ${Math.round(s.confidence)}%.`]);

  const knownW = comps.filter((c) => c.known).reduce((a, c) => a + c.weight, 0);
  for (const c of comps) c.points = c.known ? round1(((c.score ?? 0) * c.weight) / knownW) : null;
  const score = round1(comps.reduce((a, c) => a + (c.points ?? 0), 0));

  let recommended: PriorityStatus;
  let holdReason: string | null = null, holdCondition: string | null = null;
  const blocker = s.blockers[0];
  if (blocker) { recommended = "on_hold"; holdReason = `Blocked: ${blocker.text}`; holdCondition = "Resolve it, or dismiss the employer"; rationale.push(holdReason); }
  else {
    const strong = score >= cfg.high_score && !s.preliminary && s.completeness >= cfg.min_completeness_for_high;
    recommended = strong ? "high" : score >= cfg.recommended_score ? "recommended" : "backlog";
    if (recommended === "high" && (basis !== "confirmed" && !i.routeKnown && !i.namedContact || !s.profileApproved)) recommended = "recommended";
    rationale.push(`Speculative priority ${score}/100. Basis: ${basis === "confirmed" ? "confirmed recruitment activity" : basis === "hypothesis" ? "a hypothesis, not evidence of hiring" : "no recruitment evidence"}.`);
    if (!i.routeKnown && !i.namedContact) rationale.push("No legitimate application route or contact recorded yet: find one before approaching.");
  }
  return { ...base, components: comps, score, recommended, live: true, holdReason, holdCondition, holdUntil };
}
