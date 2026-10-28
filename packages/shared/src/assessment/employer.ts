import { termMatches } from "./vacancy.js";
import {
  CRITERION_LABELS, DEFAULT_EMPLOYER_WEIGHTS, EMPLOYER_CRITERIA,
  type AssessmentProfile, type AssessmentResult, type Blocker, type CriterionResult, type EmployerAssessmentInput, type EmployerCriterion, type EmployerWeights,
} from "./types.js";

const round1 = (n: number) => Math.round(n * 10) / 10;
type Partial = { score: number | null; reasons: string[]; evidence: string[]; unverified: string[] };

function geography(i: EmployerAssessmentInput, p: AssessmentProfile): Partial {
  const out: Partial = { score: null, reasons: [], evidence: [], unverified: [] };
  const lim = p.maxPublicTransportMinutes;
  if (i.ptMinutes != null) {
    out.score = i.ptMinutes <= lim * 0.5 ? 100 : i.ptMinutes <= lim ? Math.round(100 - ((i.ptMinutes - lim * 0.5) / (lim * 0.5)) * 40) : 0;
    out.reasons.push(`${i.ptMinutes} min by public transport to the nearest office (limit ${lim}).`);
  } else if (i.carMinutes != null && p.maxCarMinutes != null) {
    out.score = i.carMinutes <= p.maxCarMinutes ? 80 : 0; out.reasons.push(`${i.carMinutes} min by car (limit ${p.maxCarMinutes}).`);
  } else if (i.zoneMaxPtMinutes != null) {
    // Only a zone-level estimate: reported as such, and capped so it cannot look like a measured commute.
    out.score = i.zoneMaxPtMinutes <= lim ? 65 : 15;
    out.reasons.push(`Based on its area (${i.zoneCode ?? "zone"}), not a measured journey: ${i.zoneMaxPtMinutes <= lim ? "inside" : "outside"} your travel limit.`);
    out.unverified.push("Measured travel time (set your home postcode)");
  } else out.unverified.push("Office location / travel time");
  return out;
}

function relevantWork(i: EmployerAssessmentInput, p: AssessmentProfile): Partial {
  const out: Partial = { score: null, reasons: [], evidence: [], unverified: [] };
  const parts: number[] = [];
  if (i.isArchitecturePractice === true || i.practiceType === "architecture_practice") { parts.push(100); out.reasons.push("An architecture practice."); }
  else if (i.isArchitecturePractice === false) { parts.push(40); out.reasons.push("Not primarily an architecture practice."); }
  else if (i.practiceType && i.practiceType !== "unknown") { parts.push(65); out.reasons.push(`Categorised as ${i.practiceType.replace(/_/g, " ")}.`); }
  const emp = [...i.sectors, ...i.specialisms];
  if (emp.length && p.sectorInterests.length) {
    const hits = emp.filter((e) => termMatches(e, p.sectorInterests)).length;
    parts.push(hits > 0 ? Math.min(100, 60 + hits * 20) : 35);
    out.reasons.push(hits > 0 ? `Its sectors and specialisms overlap your interests (${hits}).` : "Its recorded sectors do not overlap your stated interests.");
  } else if (!emp.length) out.unverified.push("Specialisms and sectors");
  if (i.hasProjectEvidence) { parts.push(80); out.reasons.push("Published project work is recorded."); }
  if (parts.length) out.score = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  return out;
}

function recruitmentEvidence(i: EmployerAssessmentInput): Partial {
  const out: Partial = { score: null, reasons: [], evidence: [], unverified: [] };
  let s = 0, known = false;
  if (i.hiresPart1 === "yes") { s += 40; known = true; out.reasons.push("Evidence that it employs Part 1 / assistant-level staff."); }
  else if (i.hiresPart1 === "no") { known = true; out.reasons.push("No evidence of junior staff."); }
  if (i.hasGraduateProgramme === true) { s += 25; known = true; out.reasons.push("Runs a graduate programme."); }
  if (i.historicalEntryRoles > 0) { s += Math.min(20, 10 * i.historicalEntryRoles); known = true; out.reasons.push(`${i.historicalEntryRoles} entry-level role(s) seen advertised.`); }
  const sig = i.signals.strong * 10 + i.signals.moderate * 5 + i.signals.weak * 2;
  if (sig > 0) { s += Math.min(15, sig); known = true; out.reasons.push("Recent hiring or growth signals recorded."); }
  if (!known) { out.unverified.push("Entry-level recruitment evidence"); return out; }
  out.score = Math.min(100, s);
  return out;
}

function trainingDev(i: EmployerAssessmentInput): Partial {
  const out: Partial = { score: null, reasons: [], evidence: [], unverified: [] };
  let s = 0;
  if (i.trainingText) { s += 60; out.reasons.push(`States training or development support: ${i.trainingText}`); }
  if (i.hasGraduateProgramme === true) { s += 40; out.reasons.push("Graduate programme."); }
  if (s === 0) { out.unverified.push("Training and development opportunities"); return out; }
  out.score = Math.min(100, s);
  return out;
}

function speculativeRationale(i: EmployerAssessmentInput): Partial {
  const out: Partial = { score: null, reasons: [], evidence: [], unverified: [] };
  let s = 0, known = false;
  if (i.acceptsSpeculative === "yes") { s += 40; known = true; out.reasons.push("States that speculative applications are welcome."); }
  else if (i.acceptsSpeculative === "no") { known = true; out.reasons.push("States that it does not want speculative applications."); }
  if (i.recruitmentRouteKnown) { s += 25; known = true; out.reasons.push("A recruitment or applications route is published."); }
  if (i.namedContactWithRole) { s += 15; known = true; out.reasons.push("A named person with a relevant role is recorded."); }
  if (i.relevantProjectCited) { s += 20; known = true; out.reasons.push("A specific, cited project gives a concrete reason to get in touch."); }
  if (i.openVacancies > 0) out.reasons.push(`${i.openVacancies} open vacancy(ies) exist; assess those separately.`);
  if (!known) { out.unverified.push("A recruitment route or reason for a speculative approach"); return out; }
  out.score = Math.min(100, s);
  return out;
}

/**
 * Speculative-priority assessment for an employer. It answers "is a speculative approach worthwhile?" and is not comparable
 * with a vacancy suitability score. Unknown criteria are excluded from the total and reported, as for vacancies.
 */
export function assessEmployer(i: EmployerAssessmentInput, p: AssessmentProfile, weights: EmployerWeights = DEFAULT_EMPLOYER_WEIGHTS): AssessmentResult {
  const parts: Record<EmployerCriterion, Partial> = {
    geography: geography(i, p), relevant_work: relevantWork(i, p), recruitment_evidence: recruitmentEvidence(i), training_development: trainingDev(i), speculative_rationale: speculativeRationale(i),
  };
  const criteria: CriterionResult[] = EMPLOYER_CRITERIA.map((k) => {
    const x = parts[k]; const known = x.score != null;
    return { criterion: k, label: CRITERION_LABELS[k]!, weight: weights[k], score: x.score, points: known ? round1((x.score! * weights[k]) / 100) : null, known, reasons: x.reasons, evidence: x.evidence, unverified: x.unverified };
  });
  const totalWeight = criteria.reduce((a, c) => a + c.weight, 0) || 100;
  const knownWeight = criteria.filter((c) => c.known).reduce((a, c) => a + c.weight, 0);
  const earned = criteria.reduce((a, c) => a + (c.points ?? 0), 0);
  const total = knownWeight > 0 ? round1((earned / knownWeight) * 100) : 0;
  const range = { low: round1((earned / totalWeight) * 100), high: round1(((earned + (totalWeight - knownWeight)) / totalWeight) * 100) };

  const blockers: Blocker[] = [];
  if (i.suppressed) blockers.push({ code: "employer_suppressed", text: "The employer is on your suppression list.", evidence: null });
  if (i.doNotContact) blockers.push({ code: "do_not_contact", text: "A contact has asked not to be contacted.", evidence: null });
  if (["closed_no_opportunity", "suppressed"].includes(i.stage)) blockers.push({ code: "stage_closed", text: `The employer is marked ${i.stage.replace(/_/g, " ")}.`, evidence: null });
  if (i.acceptsSpeculative === "no") blockers.push({ code: "no_speculative", text: "The employer states it does not accept speculative applications.", evidence: null });
  const farBy = i.ptMinutes != null && i.ptMinutes > p.maxPublicTransportMinutes && (i.carMinutes == null || p.maxCarMinutes == null || i.carMinutes > p.maxCarMinutes);
  if (farBy) blockers.push({ code: "outside_travel_range", text: `Nearest office is ${i.ptMinutes} min by public transport, beyond your ${p.maxPublicTransportMinutes} min limit.`, evidence: null });

  const checks: [boolean, number][] = [
    [i.officialSourceRead, 25], [criteria[0]!.known, 15], [criteria[1]!.known, 15], [criteria[2]!.known, 15], [criteria[3]!.known, 10], [i.recruitmentRouteKnown || i.namedContactWithRole, 10], [i.claimsTotal > 0, 10],
  ];
  let completeness = checks.reduce((a, [ok, w]) => a + (ok ? w : 0), 0);
  if (i.sourcesTried > 0 && i.sourcesFailed > 0) completeness = Math.max(0, completeness - Math.round((25 * i.sourcesFailed) / i.sourcesTried));
  let confidence = i.claimsTotal > 0 ? Math.round((i.claimsSourced / i.claimsTotal) * 100) : i.officialSourceRead ? 35 : 10;
  confidence = Math.max(0, confidence - 15 * i.conflicts.length);

  const strengths = criteria.filter((c) => c.known && (c.score ?? 0) >= 75 && c.reasons[0]).map((c) => c.reasons[0]!);
  const missing = [...criteria.filter((c) => !c.known).map((c) => `${c.label}: could not be assessed from stored evidence`), ...criteria.flatMap((c) => c.unverified.map((u) => `Unverified: ${u}`))];
  const questions = [...i.conflicts.map((c) => `Sources disagree on ${c.field}: ${c.detail}. Which is correct?`)];
  if (!i.recruitmentRouteKnown && !i.namedContactWithRole) questions.push("Who receives speculative applications at this practice?");
  const nextSteps: string[] = [];
  if (blockers.length) nextSteps.push("Resolve or accept the blockers before planning any approach.");
  if (i.sourcesFailed > 0) nextSteps.push("Retry the pages that could not be read, or review the website manually.");
  if (!i.officialSourceRead) nextSteps.push("Read the employer's own website to establish the facts.");
  if (i.conflicts.length) nextSteps.push("Review the conflicting sources.");
  if (!p.approved) nextSteps.push("Approve your candidate profile so assessments can be used.");
  if (!blockers.length && completeness >= 60 && total >= 50) nextSteps.push("Review the findings, then save the employer for Stage 3.");

  const preliminary = knownWeight < 60 || completeness < 60;
  let recommendation: string;
  if (blockers.length) recommendation = "Blockers present: a speculative approach is not advisable until resolved.";
  else if (knownWeight < 40) recommendation = "Not enough evidence to judge yet: complete the research.";
  else if (total >= 70 && !preliminary) recommendation = "Worth a speculative approach.";
  else if (total >= 50) recommendation = preliminary ? "Possibly worth approaching, but the research is incomplete." : "Reasonable speculative target: check the open questions.";
  else recommendation = "Weak case for a speculative approach on the evidence available.";

  return { kind: "employer", total, assessedWeight: Math.round((knownWeight / totalWeight) * 100), range, criteria, blockers, strengths, missing, develop: [], questions, nextSteps, conflicts: i.conflicts, completeness, confidence, recommendation, preliminary };
}
