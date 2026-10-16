import { describe, expect, it } from "vitest";
import { computeScore, evaluateEligibility, DEFAULT_WEIGHTS, validateWeights, type ScoringInput, type CandidateEligibilityProfile, type VacancyEligibilityInput } from "../src/index.js";

const base: ScoringInput = {
  openEligibleVacancies: 1,
  openIneligibleVacancies: 0,
  newestVacancyAgeDays: 3,
  hiresPart1: "yes",
  historicalEntryRoles: 2,
  hasGraduateProgramme: false,
  acceptsSpeculative: "yes",
  skillOverlap: 0.8,
  sectorOverlap: 0.7,
  signals: { strong: 1, moderate: 1, weak: 0 },
  contact: { exists: true, hasEmail: true, verified: false, hiringAuthority: true, applicationsEmailKnown: true },
  bestPublicTransportMinutes: 35,
  bestCarMinutes: 45,
  maxPublicTransportMinutes: 90,
  workingArrangement: "hybrid",
  confidenceScore: 80,
  daysSinceLastChecked: 2,
  claimsWithSources: 9,
  claimsTotal: 10,
  outreachStage: "verified_eligible",
};

describe("computeScore", () => {
  it("gives a Priority A for a strong, fresh, well-evidenced employer", () => {
    const r = computeScore(base);
    expect(r.total).toBeGreaterThanOrEqual(70);
    expect(r.band).toBe("A");
    expect(r.unknownFactors).toEqual([]);
  });
  it("gives B for good fit without vacancy", () => {
    const r = computeScore({ ...base, openEligibleVacancies: 0, newestVacancyAgeDays: null, signals: { strong: 0, moderate: 0, weak: 0 } });
    expect(r.band).toBe("B");
  });
  it("gives C for weak fit and long commute", () => {
    const r = computeScore({ ...base, openEligibleVacancies: 0, acceptsSpeculative: "no", hiresPart1: "no", historicalEntryRoles: 0, skillOverlap: 0.2, sectorOverlap: 0.1, bestPublicTransportMinutes: 130, signals: { strong: 0, moderate: 0, weak: 0 }, contact: { exists: false, hasEmail: false, verified: false, hiringAuthority: false, applicationsEmailKnown: true } });
    expect(r.band).toBe("C");
  });
  it("returns research_further when too much is unknown", () => {
    const r = computeScore({ ...base, openEligibleVacancies: null, skillOverlap: null, sectorOverlap: null, contact: { exists: false, hasEmail: false, verified: false, hiringAuthority: false, applicationsEmailKnown: false }, confidenceScore: 20 });
    expect(r.band).toBe("research_further");
    expect(r.unknownFactors.length).toBeGreaterThanOrEqual(3);
  });
  it("validates weights", () => {
    expect(() => validateWeights({ ...DEFAULT_WEIGHTS, commute: 50 })).toThrow();
    expect(validateWeights(DEFAULT_WEIGHTS)).toEqual(DEFAULT_WEIGHTS);
  });
});

const candidate: CandidateEligibilityProfile = {
  qualification: "part1_equivalent",
  experienceYears: 0,
  hasUkRightToWork: true,
  maxPublicTransportMinutes: 90,
  maxCarMinutes: 90,
  acceptedEmploymentTypes: ["permanent", "fixed_term", "internship", "placement"],
  minSalaryGbp: null,
  acceptAdjacentEntryRoles: true,
};
const vacancy: VacancyEligibilityInput = {
  title: "Part 1 Architectural Assistant",
  status: "open",
  qualificationRequired: "part1",
  experienceYearsMin: 0,
  employmentType: "permanent",
  salaryMinGbpPerYear: 26000,
  requiresExistingRightToWork: false,
  publicTransportMinutes: 40,
  carMinutes: null,
  isRemote: false,
  employerSuppressed: false,
};

describe("evaluateEligibility", () => {
  it("accepts a matching Part 1 role", () => {
    const r = evaluateEligibility(vacancy, candidate);
    expect(r.status).toBe("eligible");
    expect(r.hardFlags).toEqual([]);
  });
  it("hard-flags Part 2 / Part 3 roles even with a high score context", () => {
    expect(evaluateEligibility({ ...vacancy, title: "Part 2 Architectural Assistant", qualificationRequired: "unknown" }, candidate).hardFlags).toContain("requires_part2");
    expect(evaluateEligibility({ ...vacancy, qualificationRequired: "part3", title: "Architect" }, candidate).hardFlags).toContain("requires_part3");
  });
  it("flags experience, commute, closed, suppressed, salary and right-to-work", () => {
    expect(evaluateEligibility({ ...vacancy, experienceYearsMin: 5 }, candidate).hardFlags).toContain("requires_experience_years");
    expect(evaluateEligibility({ ...vacancy, publicTransportMinutes: 150, carMinutes: 120 }, candidate).hardFlags).toContain("commute_exceeds_limit");
    expect(evaluateEligibility({ ...vacancy, status: "closed" }, candidate).hardFlags).toContain("vacancy_closed");
    expect(evaluateEligibility({ ...vacancy, employerSuppressed: true }, candidate).hardFlags).toContain("employer_suppressed");
    expect(evaluateEligibility({ ...vacancy, salaryMinGbpPerYear: 20000 }, { ...candidate, minSalaryGbp: 24000 }).hardFlags).toContain("salary_below_minimum");
    expect(evaluateEligibility({ ...vacancy, requiresExistingRightToWork: true }, { ...candidate, hasUkRightToWork: false }).hardFlags).toContain("no_right_to_work");
  });
  it("accepts adjacent entry roles in broad mode and excludes them in strict mode", () => {
    const tech = { ...vacancy, title: "Junior BIM Technician", qualificationRequired: "unknown" as const };
    expect(evaluateEligibility(tech, candidate).status).toBe("eligible");
    expect(evaluateEligibility(tech, { ...candidate, acceptAdjacentEntryRoles: false }).hardFlags).toContain("employment_type_excluded");
  });
  it("marks unknown titles with no requirement as needs_review", () => {
    expect(evaluateEligibility({ ...vacancy, title: "Studio Opportunity", qualificationRequired: "unknown" }, candidate).status).toBe("needs_review");
  });
});
