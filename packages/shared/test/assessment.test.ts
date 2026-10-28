import { describe, expect, it } from "vitest";
import { assessEmployer, assessVacancy, inputsHash, qualificationRankFromText, termMatches, type AssessmentProfile, type EmployerAssessmentInput, type RequirementInput, type VacancyAssessmentInput } from "../src/index.js";

const profile: AssessmentProfile = {
  version: 3, approved: true, qualification: "part1", experienceYears: 0.5, software: ["Revit", "AutoCAD", "Rhino"], skills: ["model making", "hand drawing"],
  sectorInterests: ["residential", "education"], targetRoleFamilies: ["part1_assistant", "graduate_assistant"], acceptAdjacentEntryRoles: true,
  acceptedEmploymentTypes: ["permanent", "fixed_term", "placement"], workingArrangementPreference: "hybrid", maxPublicTransportMinutes: 90, maxCarMinutes: null, minSalaryGbp: 24000, hasUkRightToWork: true,
};
const req = (o: Partial<RequirementInput> & { text: string }): RequirementInput => ({ id: o.text, kind: "skill", necessity: "essential", quote: o.text, evidenceStatus: "verified_fact", review: "unreviewed", ...o });
const vacancy = (o: Partial<VacancyAssessmentInput> = {}): VacancyAssessmentInput => ({
  title: "Part 1 Architectural Assistant", roleFamily: "part1_assistant", isAdjacent: false, status: "open", employmentType: "permanent", qualificationRequired: "unknown", experienceYearsMin: null,
  salaryYearMin: 27000, rightToWorkRequired: null, hybridPolicy: "hybrid", ptMinutes: 40, carMinutes: null, closingKnown: true, applicationRouteKnown: true, salaryKnown: true, locationKnown: true,
  descriptionAnalysed: true, requirementsExtracted: true, officialSourceRead: true, sourcesTried: 2, sourcesFailed: 0, entryLevel: { value: "yes", quote: "no experience necessary" },
  requirements: [req({ kind: "qualification", text: "RIBA Part 1" }), req({ text: "Revit" }), req({ text: "AutoCAD", necessity: "desirable" })],
  trainingSignals: [{ text: "mentoring towards Part 2", quote: "mentoring towards Part 2", origin: "vacancy" }],
  employer: { sectors: ["residential"], specialisms: [], hasGraduateProgramme: null, suppressed: false }, conflicts: [], ...o,
});

describe("requirement text helpers", () => {
  it("reads qualification level from wording", () => {
    expect(qualificationRankFromText("RIBA Part 1 qualified")).toBe(1);
    expect(qualificationRankFromText("Part II")).toBe(2);
    expect(qualificationRankFromText("ARB registered architect")).toBe(3);
    expect(qualificationRankFromText("Full UK driving licence")).toBeNull();
  });
  it("matches skills directly and through synonym groups, not loosely", () => {
    expect(termMatches("Proficiency in Revit", ["revit"])).toBe(true);
    expect(termMatches("BIM experience", ["Revit"])).toBe(true);
    expect(termMatches("Adobe InDesign", ["Photoshop"])).toBe(true);
    expect(termMatches("Cadence software", ["cad"])).toBe(false);
    expect(termMatches("Python scripting", ["Revit", "AutoCAD"])).toBe(false);
  });
});

describe("assessVacancy", () => {
  it("is reproducible: identical inputs give identical results and hashes", () => {
    const a = assessVacancy(vacancy(), profile), b = assessVacancy(vacancy(), profile);
    expect(a).toEqual(b);
    expect(inputsHash(vacancy(), profile)).toBe(inputsHash(vacancy(), profile));
    expect(inputsHash(vacancy(), { ...profile, version: 4 })).not.toBe(inputsHash(vacancy(), profile));
  });
  it("scores a well-matched entry-level role highly with no blockers and shows every criterion with weights", () => {
    const r = assessVacancy(vacancy(), profile);
    expect(r.total).toBeGreaterThanOrEqual(80);
    expect(r.blockers).toEqual([]);
    expect(r.criteria.map((c) => c.weight)).toEqual([25, 20, 20, 15, 10, 10]);
    expect(r.criteria.every((c) => c.reasons.length > 0)).toBe(true);
    expect(r.recommendation).toMatch(/Strong match/);
  });
  it("treats missing information as unknown: excluded from the total, visible in range and missing list", () => {
    const r = assessVacancy(vacancy({ title: "Studio role", requirements: [], entryLevel: null, roleFamily: "unknown", trainingSignals: [], ptMinutes: null, hybridPolicy: "unknown", salaryYearMin: null, employmentType: "unknown", employer: { sectors: [], specialisms: [], hasGraduateProgramme: null, suppressed: false }, requirementsExtracted: false, descriptionAnalysed: false, officialSourceRead: false }), profile);
    expect(r.criteria.filter((c) => c.known)).toHaveLength(0);
    expect(r.total).toBe(0);
    expect(r.assessedWeight).toBe(0);
    expect(r.range).toEqual({ low: 0, high: 100 });
    expect(r.missing.length).toBeGreaterThan(5);
    expect(r.recommendation).toMatch(/Not enough evidence/);
    expect(r.preliminary).toBe(true);
  });
  it("flags an essential requirement above Erin's qualification as a blocker even when the total is high", () => {
    const r = assessVacancy(vacancy({ requirements: [req({ kind: "qualification", text: "RIBA Part 2 essential", quote: "Part 2 essential" }), req({ text: "Revit" }), req({ text: "AutoCAD" })] }), profile);
    expect(r.blockers.some((b) => /Part 2|essential_qualification|requires_part2/.test(b.code + b.text))).toBe(true);
    expect(r.total).toBeGreaterThan(50);
    expect(r.recommendation).toMatch(/Blockers present/);
  });
  it("does not block on a missing desirable skill, but lists it as something to develop", () => {
    const r = assessVacancy(vacancy({ requirements: [req({ kind: "qualification", text: "RIBA Part 1" }), req({ text: "Revit" }), req({ text: "Dynamo scripting", necessity: "desirable" })] }), profile);
    expect(r.blockers).toEqual([]);
    expect(r.develop.join(" ")).toMatch(/Dynamo/);
  });
  it("never counts a skill the profile does not list as a strength", () => {
    const r = assessVacancy(vacancy({ requirements: [req({ text: "Vectorworks" })] }), profile);
    expect(r.strengths.join(" ")).not.toMatch(/Vectorworks/);
    expect(r.develop.join(" ")).toMatch(/Vectorworks/);
  });
  it("cannot confirm registrations the profile does not record: they stay unverified and become questions", () => {
    const r = assessVacancy(vacancy({ requirements: [req({ kind: "registration", text: "Full UK driving licence" }), req({ kind: "qualification", text: "RIBA Part 1" })] }), profile);
    expect(r.criteria[0]!.unverified.join(" ")).toMatch(/driving licence/);
    expect(r.questions.join(" ")).toMatch(/driving licence/);
    expect(r.blockers).toEqual([]);
  });
  it("excludes rejected requirements and sets aside disputed ones, flagging them", () => {
    const r = assessVacancy(vacancy({ requirements: [req({ kind: "qualification", text: "RIBA Part 3", review: "disputed" }), req({ text: "Sketchup", review: "rejected" }), req({ kind: "qualification", text: "RIBA Part 1" })] }), profile);
    expect(r.blockers).toEqual([]);
    expect(r.missing.join(" ")).toMatch(/Disputed by you: RIBA Part 3/);
    expect(r.criteria[2]!.reasons.join(" ")).not.toMatch(/Sketchup/);
  });
  it("lowers completeness when sources failed, and keeps confidence separate from suitability", () => {
    const ok = assessVacancy(vacancy(), profile);
    const failed = assessVacancy(vacancy({ sourcesTried: 4, sourcesFailed: 3, officialSourceRead: false }), profile);
    expect(failed.completeness).toBeLessThan(ok.completeness);
    expect(failed.total).toBe(ok.total);
    const weak = assessVacancy(vacancy({ requirements: vacancy().requirements.map((r) => ({ ...r, evidenceStatus: "inference" as const })) }), profile);
    expect(weak.confidence).toBeLessThan(ok.confidence);
    expect(weak.total).toBe(ok.total);
  });
  it("preserves source conflicts and lowers confidence rather than picking a side", () => {
    const r = assessVacancy(vacancy({ conflicts: [{ field: "salary", detail: "£27,000 vs £32,000" }] }), profile);
    expect(r.conflicts).toHaveLength(1);
    expect(r.questions.join(" ")).toMatch(/salary/);
    expect(r.confidence).toBeLessThan(assessVacancy(vacancy(), profile).confidence);
  });
  it("respects adjustable weights", () => {
    const heavySkills = assessVacancy(vacancy({ requirements: [req({ text: "Vectorworks" })] }), profile, { qualifications: 5, experience: 5, skills: 70, location_practical: 10, career_relevance: 5, training_development: 5 });
    const base = assessVacancy(vacancy({ requirements: [req({ text: "Vectorworks" })] }), profile);
    expect(heavySkills.total).toBeLessThan(base.total);
  });
});

const employer = (o: Partial<EmployerAssessmentInput> = {}): EmployerAssessmentInput => ({
  name: "Studio X", suppressed: false, stage: "awaiting_research", doNotContact: false, isArchitecturePractice: true, practiceType: "architecture_practice", sectors: ["residential"], specialisms: ["housing"],
  hasProjectEvidence: true, zoneMaxPtMinutes: 90, zoneCode: "A", ptMinutes: 35, carMinutes: null, hiresPart1: "yes", hasGraduateProgramme: null, acceptsSpeculative: "yes", historicalEntryRoles: 1,
  openVacancies: 0, signals: { strong: 0, moderate: 1, weak: 0 }, trainingText: "Supports Part 2 study", recruitmentRouteKnown: true, namedContactWithRole: false, relevantProjectCited: true,
  officialSourceRead: true, sourcesTried: 3, sourcesFailed: 0, claimsTotal: 10, claimsSourced: 8, conflicts: [], ...o,
});

describe("assessEmployer", () => {
  it("rates a well-evidenced speculative target and explains it", () => {
    const r = assessEmployer(employer(), profile);
    expect(r.kind).toBe("employer");
    expect(r.total).toBeGreaterThanOrEqual(70);
    expect(r.blockers).toEqual([]);
    expect(r.criteria.map((c) => c.weight)).toEqual([30, 20, 20, 10, 20]);
  });
  it("uses a zone-level estimate only as a capped, labelled inference when no travel time exists", () => {
    const r = assessEmployer(employer({ ptMinutes: null }), profile);
    const geo = r.criteria[0]!;
    expect(geo.score).toBe(65);
    expect(geo.unverified.join(" ")).toMatch(/home postcode/);
  });
  it("blocks suppressed employers and ones that refuse speculative applications", () => {
    expect(assessEmployer(employer({ suppressed: true }), profile).blockers.map((b) => b.code)).toContain("employer_suppressed");
    expect(assessEmployer(employer({ acceptsSpeculative: "no" }), profile).blockers.map((b) => b.code)).toContain("no_speculative");
  });
  it("reports unknowns instead of scoring them when nothing is established", () => {
    const r = assessEmployer(employer({ hiresPart1: "unknown", acceptsSpeculative: "unknown", historicalEntryRoles: 0, signals: { strong: 0, moderate: 0, weak: 0 }, trainingText: null, recruitmentRouteKnown: false, relevantProjectCited: false, officialSourceRead: false, claimsTotal: 0, claimsSourced: 0, ptMinutes: null, zoneMaxPtMinutes: null, hasProjectEvidence: false, sectors: [], specialisms: [] }), profile);
    expect(r.criteria.filter((c) => c.known).length).toBeLessThan(2);
    expect(r.preliminary).toBe(true);
    expect(r.recommendation).toMatch(/Not enough evidence|incomplete/);
  });
});
