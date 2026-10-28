import { describe, expect, it } from "vitest";
import { compareRates, computeInsights, detectFindings, feedbackThemes, makePeriod, makeRate, profileSuggestions, sampleLevel, wilson, type ApplicationFact, type InsightFacts, type VacancyFact } from "../src/index.js";

const now = new Date("2026-11-30T12:00:00Z");
const d = (s: string) => new Date(`${s}T10:00:00Z`);
const empty = (): InsightFacts => ({ vacancies: [], applications: [], feedback: [], followups: [], sourceRuns: [], gaps: [], sources: [], priorityFeedback: { accepted: 0, rejected: 0 }, employersDiscovered: [] });
const vac = (i: number, o: Partial<VacancyFact> = {}): VacancyFact => ({ id: `v${i}`, label: `V${i}`, employerId: `e${i}`, source: "reed", firstSeenAt: d("2026-11-05"), status: "open", discoveryState: "new", eligibility: "eligible", duplicateOf: null, isTest: false, researched: false, prioritised: false, priorityStatus: null, dismissedReason: null, roleFamily: null, practiceType: null, zone: null, hardFlags: [], disappeared: false, ...o });
const app = (i: number, o: Partial<ApplicationFact> = {}): ApplicationFact => ({ id: `a${i}`, label: `A${i}`, employerId: `e${i}`, vacancyId: null, type: "advertised", stage: "awaiting_response", selectedAt: d("2026-10-01"), submittedAt: d("2026-10-05"), confirmed: true, outcomeAt: null, source: "reed", roleFamily: null, practiceType: null, zone: null, cvVersion: "cv1", suitability: 70, priorityStatus: null, matchedPreferences: null, discoveredAt: null, firstResponseAt: null, interviews: 0, assessments: 0, isTest: false, ...o });
const range = { start: new Date("2026-10-01"), end: new Date("2026-11-30") };
const run = (f: InsightFacts) => computeInsights(f, range, { now, maturityDays: 21, backlogDays: 14 });

describe("statistics", () => {
  it("never treats an empty denominator as 0%", () => { const r = makeRate(0, 0); expect(r.rate).toBeNull(); expect(r.level).toBe("none"); });
  it("keeps 1 of 2 and 20 of 40 apart", () => {
    const small = makeRate(1, 2), large = makeRate(20, 40);
    expect(small.rate).toBe(large.rate);
    expect(small.level).toBe("insufficient"); expect(large.level).toBe("reasonable");
    expect(wilson(1, 2)!.high - wilson(1, 2)!.low).toBeGreaterThan(wilson(20, 40)!.high - wilson(20, 40)!.low);
    expect(compareRates(small, large).comparable).toBe(false);
  });
  it("labels sample sizes", () => { expect([0, 3, 10, 30, 50].map(sampleLevel)).toEqual(["none", "insufficient", "preliminary", "moderate", "reasonable"]); });
  it("only calls a difference reliable when the ranges do not overlap", () => {
    expect(compareRates(makeRate(2, 10), makeRate(5, 10)).reliableDifference).toBe(false);
    expect(compareRates(makeRate(1, 40), makeRate(30, 40)).reliableDifference).toBe(true);
  });
  it("compares a partial period with an equally long earlier one", () => {
    const p = makePeriod(new Date("2026-11-01"), new Date("2026-11-30"), new Date("2026-11-10T12:00:00Z"));
    expect(p.isPartial).toBe(true); expect(p.previous.days).toBe(p.elapsedDays);
  });
});

describe("computeInsights", () => {
  it("reports no data rather than zero when nothing exists", () => {
    const i = run(empty());
    expect(i.rates.interview.rate).toBeNull(); expect(i.dataNotes.length).toBeGreaterThan(0);
  });
  it("excludes test records, duplicates and ineligible vacancies from the discovery denominator", () => {
    const f = empty();
    f.vacancies = [vac(1, { researched: true }), vac(2), vac(3, { isTest: true }), vac(4, { duplicateOf: "v1" }), vac(5, { eligibility: "ineligible" })];
    const r = run(f).rates.discoveryToResearch;
    expect(r.numerator).toBe(1); expect(r.denominator).toBe(2); expect(r.excluded.map((e) => e.count)).toEqual(expect.arrayContaining([1]));
  });
  it("does not count recent silent submissions as failures", () => {
    const f = empty();
    f.applications = [app(1, { submittedAt: d("2026-11-25") }), app(2, { interviews: 1, submittedAt: d("2026-11-25") }), app(3), app(4)];
    const r = run(f).rates.interview;
    expect(r.denominator).toBe(3); expect(r.numerator).toBe(1);
    expect(r.excluded.find((e) => e.reason.includes("too recently"))!.count).toBe(1);
  });
  it("leaves unconfirmed submissions out and says so", () => {
    const f = empty(); f.applications = [app(1, { confirmed: false })];
    const i = run(f);
    expect(i.rates.interview.denominator).toBe(0); expect(i.dataNotes.join(" ")).toMatch(/no confirmed submission/);
  });
  it("counts an application once however many interviews it had", () => {
    const f = empty(); f.applications = [app(1, { interviews: 3, assessments: 1, stage: "further_interview" })];
    expect(run(f).funnel.find((s) => s.key === "interviews")!.count).toBe(0 + 1 - 0); // selected in Oct, confirmed, interviewed
  });
  it("keeps unknown, withdrawn and rejected outcomes apart", () => {
    const f = empty(); f.applications = [app(1, { stage: "rejected" }), app(2, { stage: "withdrawn" }), app(3, { stage: "vacancy_closed" }), app(4)];
    const o = Object.fromEntries(run(f).outcomes.map((x) => [x.key, x.count]));
    expect(o).toMatchObject({ rejected: 1, withdrawn: 1, vacancy_closed: 1, awaiting: 1 });
    expect(run(f).overview.noKnownOutcome).toBe(2);
  });
  it("does not let a duplicate inflate source counts", () => {
    const f = empty(); f.vacancies = [vac(1), vac(2, { duplicateOf: "v1" })];
    const s = run(f).sources[0]!; expect(s.discovered).toBe(1); expect(s.rawIncludingDuplicates).toBe(2); expect(s.duplicateRate.rate).toBe(0.5);
  });
});

describe("findings", () => {
  const opts = { now, maturityDays: 21, backlogDays: 14 };
  it("makes no recommendation from a handful of applications", () => {
    const f = empty(); f.applications = [app(1), app(2), app(3)];
    expect(detectFindings(f, run(f), opts)).toEqual([]);
  });
  it("flags consistently unanswered applications with the numbers behind it", () => {
    const f = empty(); f.applications = Array.from({ length: 10 }, (_, i) => app(i));
    const found = detectFindings(f, run(f), opts).find((x) => x.code === "applications.no_response")!;
    expect(found.observation).toMatch(/0 of 10/); expect(found.sampleSize).toBe(10); expect(found.confidence).toBe("low");
  });
  it("does not recommend a source on a small difference", () => {
    const f = empty(); f.vacancies = [...Array.from({ length: 10 }, (_, i) => vac(i, { source: "a", discoveryState: "saved" })), ...Array.from({ length: 12 }, (_, i) => vac(20 + i, { source: "b", discoveryState: i < 8 ? "saved" : "dismissed" }))];
    expect(detectFindings(f, run(f), opts).some((x) => x.code.startsWith("sources."))).toBe(false);
  });
  it("uses stable fingerprints so a refresh updates rather than duplicates", () => {
    const f = empty(); f.applications = Array.from({ length: 10 }, (_, i) => app(i));
    expect(detectFindings(f, run(f), opts).map((x) => x.fingerprint)).toEqual(detectFindings(f, run(f), opts).map((x) => x.fingerprint));
  });
});

describe("feedback and profile suggestions", () => {
  const fb = (id: string, applicationId: string, source: "employer" | "own", tags: string[]) => ({ id, applicationId, source, kind: "missing_skill", tags, occurredAt: now });
  it("counts employer feedback and personal reflections separately, once per application", () => {
    const t = feedbackThemes([fb("1", "a1", "employer", ["Revit"]), fb("2", "a1", "employer", ["revit"]), fb("3", "a2", "employer", ["Revit"]), fb("4", "a3", "own", ["Revit"])]);
    expect(t.employer).toEqual([{ tag: "revit", applications: 2 }]); expect(t.own).toEqual([{ tag: "revit", applications: 1 }]);
  });
  it("suggests, never asserts, a skill from repeated gaps", () => {
    const f = empty(); f.gaps = [1, 2, 3].map((i) => ({ vacancyId: `v${i}`, suitability: 75, missing: ["RIBA Part 3"] })).concat([{ vacancyId: "v9", suitability: 30, missing: ["RIBA Part 3"] }]);
    const s = profileSuggestions(f, run(f));
    expect(s).toHaveLength(1); expect(s[0]!.detail).toMatch(/does not mean you have it/); expect(s[0]!.evidence).toMatchObject({ vacancies: 3 });
  });
});
