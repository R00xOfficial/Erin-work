import type { EvidenceStatus } from "../enums.js";
import { evaluateEligibility, QUALIFICATION_RANK } from "../scoring/eligibility.js";
import {
  CRITERION_LABELS, DEFAULT_VACANCY_WEIGHTS, VACANCY_CRITERIA,
  type AssessmentProfile, type AssessmentResult, type Blocker, type CriterionResult, type RequirementInput, type VacancyAssessmentInput, type VacancyCriterion, type VacancyWeights,
} from "./types.js";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.\s-]/g, " ").replace(/\s+/g, " ").trim();
const round1 = (n: number) => Math.round(n * 10) / 10;

// Terms that name the same tool or skill. A requirement matches a profile term directly or through one of these groups.
const SYNONYMS: string[][] = [
  ["autocad", "cad", "computer aided design", "microstation"],
  ["revit", "bim", "building information model", "building information modelling"],
  ["rhino", "rhinoceros", "grasshopper"],
  ["sketchup", "sketch up"],
  ["photoshop", "indesign", "illustrator", "adobe", "creative suite"],
  ["microsoft office", "office", "word", "excel", "powerpoint"],
  ["enscape", "lumion", "twinmotion", "v-ray", "vray"],
  ["model making", "modelmaking", "physical models", "model-making"],
  ["hand drawing", "sketching", "freehand"],
];
const hasWord = (haystack: string, needle: string) => needle.length > 1 && new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(haystack);

/** True when the requirement text names something the profile lists, directly or through a synonym group. */
export function termMatches(requirement: string, profileTerms: string[]): boolean {
  const req = norm(requirement);
  const terms = profileTerms.map(norm).filter((t) => t.length > 1);
  for (const t of terms) if (hasWord(req, t) || (req.length >= 4 && hasWord(t, req))) return true;
  for (const group of SYNONYMS) {
    const inReq = group.some((g) => hasWord(req, g));
    const inProfile = group.some((g) => terms.some((t) => t === g || hasWord(t, g)));
    if (inReq && inProfile) return true;
  }
  return false;
}

/** Highest qualification level a piece of requirement text asks for: 0 none, 1 Part 1 / degree / technician, 2 Part 2, 3 Part 3 / registered. Null if it names none. */
export function qualificationRankFromText(text: string): number | null {
  const t = text.toLowerCase();
  if (/\bpart\s*(3|iii|three)\b|registered architect|\barb\b|riba chartered|chartered architect|\bmriba\b/.test(t)) return 3;
  if (/\bpart\s*(2|ii|two)\b|\bm\.?arch\b|diploma in architecture/.test(t)) return 2;
  if (/\bpart\s*(1|i|one)\b|\bb\.?a\b|undergraduate|degree|\bhnc\b|\bhnd\b|\bciat\b|architectural technolog|\bbsc\b/.test(t)) return 1;
  return null;
}

const EVIDENCE_WEIGHT: Record<EvidenceStatus, number> = { verified_fact: 100, source_supported_summary: 80, inference: 40, unverified: 20, conflicting_sources: 20 };

function yearsFromText(text: string): number | null {
  const m = text.match(/(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?years?/i);
  return m ? Number.parseInt(m[1]!, 10) : null;
}

type Partial = { score: number | null; reasons: string[]; evidence: string[]; unverified: string[]; strengths?: string[]; develop?: string[]; questions?: string[]; blockers?: Blocker[] };

function qualifications(i: VacancyAssessmentInput, p: AssessmentProfile, reqs: RequirementInput[]): Partial {
  const c = QUALIFICATION_RANK[p.qualification];
  const out: Partial = { score: null, reasons: [], evidence: [], unverified: [], develop: [], questions: [], blockers: [] };
  const items = reqs.filter((r) => r.kind === "qualification" || r.kind === "registration");
  let essMet = 0, essTotal = 0, desMet = 0, desTotal = 0, unmetEssential = false;
  for (const r of items) {
    const rank = qualificationRankFromText(r.text);
    if (rank == null) {
      // e.g. a driving licence or CSCS card: the profile does not record these, so this cannot be confirmed either way.
      if (termMatches(r.text, [...p.skills, ...p.software])) { if (r.necessity === "essential") { essTotal++; essMet++; } else { desTotal++; desMet++; } out.reasons.push(`Profile lists "${r.text}".`); }
      else { out.unverified.push(`${r.necessity === "essential" ? "Essential" : "Desirable"}: ${r.text}`); out.questions!.push(`Do you hold or can you obtain: ${r.text}?`); }
      if (r.quote) out.evidence.push(r.quote);
      continue;
    }
    const met = rank <= c;
    if (r.necessity === "desirable") {
      desTotal++; if (met) desMet++; else out.develop!.push(`Desirable qualification: ${r.text}`);
    } else {
      essTotal++;
      if (met) essMet++;
      else { unmetEssential = true; out.blockers!.push({ code: "essential_qualification", text: `Essential requirement "${r.text}" is above your recorded qualification.`, evidence: r.quote }); }
    }
    out.reasons.push(met ? `Meets ${r.necessity} requirement: ${r.text}.` : `${r.necessity === "essential" ? "Does not meet essential" : "Does not meet desirable"} requirement: ${r.text}.`);
    if (r.quote) out.evidence.push(r.quote);
  }
  // Fall back to the structured field only when no requirement row speaks to qualifications.
  if (essTotal + desTotal === 0 && i.qualificationRequired !== "unknown" && i.qualificationRequired !== "other") {
    const need = { none: 0, part1: 1, technician: 1, part2: 2, part3: 3 }[i.qualificationRequired];
    essTotal = 1;
    if (need <= c) { essMet = 1; out.reasons.push(need === 0 ? "No qualification required." : `Vacancy asks for ${i.qualificationRequired}; you meet it.`); }
    else { unmetEssential = true; out.reasons.push(`Vacancy asks for ${i.qualificationRequired}; you do not yet meet it.`); }
    out.evidence.push("Vacancy qualification field");
  }
  if (essTotal + desTotal === 0) { out.reasons.push("No qualification requirement could be verified."); return out; }
  let score = essTotal ? (essMet / essTotal) * 100 : 100;
  if (unmetEssential) score = Math.min(score, 25);
  if (desTotal) score = score * 0.85 + (desMet / desTotal) * 15;
  out.score = Math.round(score);
  return out;
}

function experience(i: VacancyAssessmentInput, p: AssessmentProfile, reqs: RequirementInput[]): Partial {
  const out: Partial = { score: null, reasons: [], evidence: [], unverified: [], questions: [], blockers: [] };
  if (i.roleFamily === "senior_or_unsuitable") {
    out.score = 0; out.reasons.push("Title indicates a senior or fully qualified role."); out.evidence.push(i.title); return out;
  }
  const expReqs = reqs.filter((r) => r.kind === "experience");
  const essYears = [i.experienceYearsMin, ...expReqs.filter((r) => r.necessity === "essential").map((r) => yearsFromText(r.text))].filter((n): n is number => n != null);
  const desYears = expReqs.filter((r) => r.necessity !== "essential").map((r) => yearsFromText(r.text)).filter((n): n is number => n != null);
  for (const r of expReqs) if (r.quote) out.evidence.push(r.quote);
  if (essYears.length) {
    const need = Math.max(...essYears);
    if (need <= p.experienceYears) { out.score = 100; out.reasons.push(`Asks for ${need} year(s); you have ${p.experienceYears}.`); }
    else if (need <= p.experienceYears + 1) { out.score = 65; out.reasons.push(`Asks for ${need} year(s); you have ${p.experienceYears}, a small gap.`); }
    else { out.score = 10; out.reasons.push(`Asks for ${need} year(s); you have ${p.experienceYears}.`); }
    return out;
  }
  if (i.entryLevel && i.entryLevel.value === "yes") { out.score = 90; out.reasons.push("The advert presents the role as entry-level."); if (i.entryLevel.quote) out.evidence.push(i.entryLevel.quote); }
  else if (i.entryLevel && i.entryLevel.value === "no") {
    out.score = 15; out.reasons.push("The advert does not read as an entry-level role.");
    if (i.entryLevel.quote) out.evidence.push(i.entryLevel.quote);
    out.blockers!.push({ code: "not_entry_level", text: "The vacancy text indicates it is not an entry-level role.", evidence: i.entryLevel.quote });
  } else if (!["unknown", "part2_assistant", "architect_part3"].includes(i.roleFamily)) { out.score = 70; out.reasons.push("The role family (from the job title) is typical of an entry-level role: an inference from the title only."); out.evidence.push(i.title); out.questions!.push("Does the full advert confirm no prior experience is needed?"); }
  else { out.reasons.push("Experience expectations are not stated."); out.questions!.push("How much practical experience does the employer expect?"); }
  if (desYears.length && out.score != null) out.reasons.push(`Desirable experience mentioned: ${Math.max(...desYears)} year(s) (not required).`);
  return out;
}

function skills(p: AssessmentProfile, reqs: RequirementInput[]): Partial {
  const out: Partial = { score: null, reasons: [], evidence: [], unverified: [], strengths: [], develop: [], questions: [] };
  const items = reqs.filter((r) => r.kind === "skill" || r.kind === "software");
  if (items.length === 0) { out.reasons.push("No skills or software requirements were found in the vacancy text."); return out; }
  const have = [...p.software, ...p.skills];
  if (have.length === 0) { out.reasons.push("Your profile lists no skills or software, so a match cannot be judged."); out.questions!.push("Add your software and skills to your profile."); return out; }
  let essMet = 0, essTotal = 0, desMet = 0, desTotal = 0;
  for (const r of items) {
    const met = termMatches(r.text, have);
    const essential = r.necessity !== "desirable";
    if (essential) { essTotal++; if (met) essMet++; } else { desTotal++; if (met) desMet++; }
    if (met) out.strengths!.push(`Profile lists ${r.text} (${r.necessity}).`);
    else { out.develop!.push(`${r.necessity === "desirable" ? "Desirable" : "Required"} skill not in your profile: ${r.text}`); }
    out.reasons.push(met ? `Match: ${r.text} (${r.necessity}).` : `Not in your profile: ${r.text} (${r.necessity}).`);
    if (r.quote) out.evidence.push(r.quote);
    if (r.necessity === "unclear") out.unverified.push(`Unclear whether essential: ${r.text}`);
  }
  const e = essTotal ? essMet / essTotal : null, d = desTotal ? desMet / desTotal : null;
  out.score = Math.round((e != null && d != null ? e * 75 + d * 25 : (e ?? d ?? 0) * 100));
  return out;
}

function locationPractical(i: VacancyAssessmentInput, p: AssessmentProfile): Partial {
  const out: Partial = { score: null, reasons: [], evidence: [], unverified: [], questions: [] };
  const parts: number[] = [];
  const remote = i.hybridPolicy === "remote";
  if (remote) { parts.push(100); out.reasons.push("Remote working."); }
  else if (i.ptMinutes != null) {
    const lim = p.maxPublicTransportMinutes;
    const s = i.ptMinutes <= lim * 0.5 ? 100 : i.ptMinutes <= lim ? Math.round(100 - ((i.ptMinutes - lim * 0.5) / (lim * 0.5)) * 40) : 0;
    parts.push(s); out.reasons.push(`${i.ptMinutes} min by public transport (limit ${lim}).`);
  } else if (i.carMinutes != null && p.maxCarMinutes != null) {
    parts.push(i.carMinutes <= p.maxCarMinutes ? 80 : 0); out.reasons.push(`${i.carMinutes} min by car (limit ${p.maxCarMinutes}).`);
  } else { out.unverified.push("Travel time (set your home postcode so it can be calculated)"); }
  if (i.hybridPolicy !== "unknown" && p.workingArrangementPreference !== "unknown") {
    const same = i.hybridPolicy === p.workingArrangementPreference;
    const s = same ? 100 : i.hybridPolicy === "hybrid" || p.workingArrangementPreference === "hybrid" ? 70 : 40;
    parts.push(s); out.reasons.push(`Working pattern ${i.hybridPolicy}; you prefer ${p.workingArrangementPreference}.`);
  } else if (i.hybridPolicy === "unknown") out.unverified.push("Working pattern (office, hybrid or remote)");
  if (i.salaryYearMin != null) {
    if (p.minSalaryGbp != null) { parts.push(i.salaryYearMin >= p.minSalaryGbp ? 100 : 20); out.reasons.push(`Salary from £${Math.round(i.salaryYearMin)}; your minimum is £${p.minSalaryGbp}.`); }
    else out.reasons.push(`Salary from £${Math.round(i.salaryYearMin)} (you have not set a minimum).`);
  } else out.unverified.push("Salary");
  if (i.employmentType !== "unknown") {
    const ok = p.acceptedEmploymentTypes.includes(i.employmentType);
    parts.push(ok ? 100 : 0); out.reasons.push(`Employment type ${i.employmentType} is ${ok ? "within" : "outside"} your accepted types.`);
  } else out.unverified.push("Employment type");
  if (parts.length) out.score = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  return out;
}

const CORE_FAMILIES = new Set(["part1_assistant", "graduate_assistant", "placement_internship"]);
function careerRelevance(i: VacancyAssessmentInput, p: AssessmentProfile): Partial {
  const out: Partial = { score: null, reasons: [], evidence: [], unverified: [] };
  const parts: number[] = [];
  if (i.roleFamily !== "unknown") {
    if (p.targetRoleFamilies.length) {
      const hit = p.targetRoleFamilies.includes(i.roleFamily);
      const s = hit ? 100 : i.isAdjacent && p.acceptAdjacentEntryRoles ? 60 : 30;
      parts.push(s); out.reasons.push(hit ? "Role family is one you are targeting." : i.isAdjacent ? "An adjacent route into architecture, which your profile accepts." : "Role family is not among your targets.");
    } else {
      parts.push(CORE_FAMILIES.has(i.roleFamily) ? 85 : i.isAdjacent && p.acceptAdjacentEntryRoles ? 60 : 30);
      out.reasons.push(CORE_FAMILIES.has(i.roleFamily) ? "A core architecture entry role." : "Adjacent route (you have not set target roles).");
    }
  }
  const emp = [...i.employer.sectors, ...i.employer.specialisms];
  if (p.sectorInterests.length && emp.length) {
    const hits = emp.filter((e) => termMatches(e, p.sectorInterests)).length;
    const s = hits > 0 ? Math.min(100, 60 + hits * 20) : 35;
    parts.push(s); out.reasons.push(hits > 0 ? `Employer work overlaps your sector interests (${hits} match${hits === 1 ? "" : "es"}).` : "No overlap between the employer's stated sectors and your interests.");
  } else if (p.sectorInterests.length) out.unverified.push("Employer sectors (none recorded)");
  if (parts.length) out.score = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  return out;
}

function training(i: VacancyAssessmentInput): Partial {
  const out: Partial = { score: null, reasons: [], evidence: [], unverified: [], strengths: [] };
  let s = 0;
  const v = i.trainingSignals.filter((t) => t.origin === "vacancy"), e = i.trainingSignals.filter((t) => t.origin === "employer");
  if (v.length) { s += 45; out.reasons.push(`The vacancy mentions training or development: ${v[0]!.text}`); for (const t of v) if (t.quote) out.evidence.push(t.quote); }
  if (e.length) { s += 30; out.reasons.push(`The employer states training support: ${e[0]!.text}`); for (const t of e) if (t.quote) out.evidence.push(t.quote); }
  if (i.employer.hasGraduateProgramme === true) { s += 25; out.reasons.push("The employer runs a graduate programme."); }
  if (s === 0) { out.reasons.push("No training or development evidence found (absence of a statement is not evidence there is none)."); return out; }
  out.score = Math.min(100, s);
  out.strengths!.push(out.reasons[0]!);
  return out;
}

/**
 * Vacancy suitability on a 100-point scale. Deterministic: the same inputs, profile and weights always give the same result.
 * Unknown criteria are excluded from the total (never counted as good or bad) and reported through assessedWeight, range and completeness.
 * Blockers are reported separately and are never masked by a high total.
 */
export function assessVacancy(i: VacancyAssessmentInput, p: AssessmentProfile, weights: VacancyWeights = DEFAULT_VACANCY_WEIGHTS): AssessmentResult {
  const reqs = i.requirements.filter((r) => r.review !== "rejected" && r.review !== "disputed");
  const disputed = i.requirements.filter((r) => r.review === "disputed");
  const parts: Record<VacancyCriterion, Partial> = {
    qualifications: qualifications(i, p, reqs),
    experience: experience(i, p, reqs),
    skills: skills(p, reqs),
    location_practical: locationPractical(i, p),
    career_relevance: careerRelevance(i, p),
    training_development: training(i),
  };
  const criteria: CriterionResult[] = VACANCY_CRITERIA.map((k) => {
    const x = parts[k];
    const known = x.score != null;
    return { criterion: k, label: CRITERION_LABELS[k]!, weight: weights[k], score: x.score, points: known ? round1((x.score! * weights[k]) / 100) : null, known, reasons: x.reasons, evidence: x.evidence, unverified: x.unverified };
  });
  const totalWeight = criteria.reduce((a, c) => a + c.weight, 0) || 100;
  const knownWeight = criteria.filter((c) => c.known).reduce((a, c) => a + c.weight, 0);
  const earned = criteria.reduce((a, c) => a + (c.points ?? 0), 0);
  const total = knownWeight > 0 ? round1((earned / knownWeight) * 100) : 0;
  const range = { low: round1((earned / totalWeight) * 100), high: round1(((earned + (totalWeight - knownWeight)) / totalWeight) * 100) };

  // Blockers: the hard eligibility rules, plus anything the requirement and entry-level checks found.
  const elig = evaluateEligibility({
    title: i.title, status: i.status as never, qualificationRequired: i.qualificationRequired, experienceYearsMin: i.experienceYearsMin, employmentType: i.employmentType,
    salaryMinGbpPerYear: i.salaryYearMin, requiresExistingRightToWork: i.rightToWorkRequired === true, publicTransportMinutes: i.ptMinutes, carMinutes: i.carMinutes,
    isRemote: i.hybridPolicy === "remote", employerSuppressed: i.employer.suppressed,
  }, { qualification: p.qualification, experienceYears: p.experienceYears, hasUkRightToWork: p.hasUkRightToWork, maxPublicTransportMinutes: p.maxPublicTransportMinutes, maxCarMinutes: p.maxCarMinutes, acceptedEmploymentTypes: p.acceptedEmploymentTypes, minSalaryGbp: p.minSalaryGbp, acceptAdjacentEntryRoles: p.acceptAdjacentEntryRoles });
  const blockers: Blocker[] = elig.details.map((d) => ({ code: d.flag, text: d.reason, evidence: null }));
  for (const x of Object.values(parts)) for (const b of x.blockers ?? []) if (!blockers.some((e) => e.code === b.code && e.text === b.text)) blockers.push(b);
  // Avoid reporting the same qualification gap twice (field-based flag and requirement row).
  const hasPart = blockers.some((b) => b.code === "requires_part2" || b.code === "requires_part3");
  const deduped = hasPart && blockers.some((b) => b.code === "essential_qualification") ? blockers.filter((b) => b.code !== "essential_qualification" || b.evidence) : blockers;

  // Completeness: how much of what a decision needs has actually been established.
  const checks: [boolean, number][] = [
    [i.descriptionAnalysed, 15], [i.requirementsExtracted, 15], [criteria[0]!.known, 10], [criteria[1]!.known, 10],
    [reqs.some((r) => r.kind === "skill" || r.kind === "software"), 10], [i.salaryKnown, 5], [i.locationKnown, 10], [i.closingKnown, 5],
    [i.applicationRouteKnown, 5], [i.officialSourceRead, 10], [i.trainingSignals.length > 0 || i.employer.hasGraduateProgramme != null, 5],
  ];
  let completeness = checks.reduce((a, [ok, w]) => a + (ok ? w : 0), 0);
  if (i.sourcesTried > 0 && i.sourcesFailed > 0) completeness = Math.max(0, completeness - Math.round((20 * i.sourcesFailed) / i.sourcesTried));

  // Confidence: how well supported the findings used are, separate from how suitable the role is.
  const weightsUsed = reqs.map((r) => (r.review === "confirmed" || r.review === "corrected" ? 100 : EVIDENCE_WEIGHT[r.evidenceStatus]));
  let confidence = weightsUsed.length ? weightsUsed.reduce((a, b) => a + b, 0) / weightsUsed.length : i.descriptionAnalysed ? 30 : 10;
  confidence = Math.max(0, Math.round(confidence - 15 * i.conflicts.length - 10 * disputed.length));

  const strengths = Object.values(parts).flatMap((x) => x.strengths ?? []);
  for (const c of criteria) if (c.known && (c.score ?? 0) >= 80 && c.reasons[0] && !strengths.includes(c.reasons[0])) strengths.push(c.reasons[0]);
  const missing = [
    ...criteria.filter((c) => !c.known).map((c) => `${c.label}: could not be assessed from stored evidence`),
    ...criteria.flatMap((c) => c.unverified.map((u) => `Unverified: ${u}`)),
    ...disputed.map((r) => `Disputed by you: ${r.text}`),
  ];
  const develop = Object.values(parts).flatMap((x) => x.develop ?? []);
  const questions = [...new Set([...Object.values(parts).flatMap((x) => x.questions ?? []), ...i.conflicts.map((c) => `Sources disagree on ${c.field}: ${c.detail}. Which is correct?`)])];
  const nextSteps: string[] = [];
  if (deduped.length) nextSteps.push("Resolve the blockers before investing time in an application.");
  if (i.sourcesFailed > 0) nextSteps.push("Retry the sources that could not be read, or check them manually.");
  if (!i.requirementsExtracted) nextSteps.push("Run research to extract the vacancy's requirements.");
  if (i.conflicts.length) nextSteps.push("Review the conflicting sources and correct the record.");
  if (!p.approved) nextSteps.push("Approve your candidate profile so assessments can be used.");
  if (!deduped.length && completeness >= 60 && total >= 50) nextSteps.push("Review the findings, then save the opportunity for Stage 3.");

  const preliminary = knownWeight < 60 || completeness < 60;
  let recommendation: string;
  if (deduped.length) recommendation = "Blockers present: resolve them before applying.";
  else if (knownWeight < 40) recommendation = "Not enough evidence to judge yet: complete the research.";
  else if (total >= 70 && !preliminary) recommendation = "Strong match: worth pursuing.";
  else if (total >= 50) recommendation = preliminary ? "Possible match, but the research is incomplete." : "Possible match: check the open questions first.";
  else recommendation = "Weak match on the evidence available.";

  return { kind: "vacancy", total, assessedWeight: Math.round((knownWeight / totalWeight) * 100), range, criteria, blockers: deduped, strengths, missing, develop, questions, nextSteps, conflicts: i.conflicts, completeness, confidence, recommendation, preliminary };
}
