import { describe, expect, it } from "vitest";
import {
  computeEmployerPriority, computeVacancyPriority, estimateEmployerEffort, estimateVacancyEffort, planWeek,
  type EmployerPriorityInput, type PlanItem, type SuitabilityInput, type VacancyPriorityInput,
} from "../src/index.js";

const NOW = new Date("2026-11-02T09:00:00Z");
const suit = (o: Partial<SuitabilityInput> = {}): SuitabilityInput => ({
  exists: true, total: 80, assessedWeight: 90, rangeLow: 72, preliminary: false, completeness: 85, confidence: 80, blockers: [], conflictCount: 0, profileApproved: true,
  criteria: { career_relevance: 90, training_development: 70, location_practical: 85, geography: 85, relevant_work: 80 }, ...o,
});
const vac = (o: Partial<VacancyPriorityInput> = {}): VacancyPriorityInput => ({ now: NOW, vacancyStatus: "open", closingAt: new Date("2026-11-07T23:59:00Z"), suitability: suit(), applicationRouteKnown: true, effortMinutes: 120, ...o });
const sum = (r: { components: { points: number | null }[] }) => Math.round(r.components.reduce((a, c) => a + (c.points ?? 0), 0) * 10) / 10;

describe("computeVacancyPriority", () => {
  it("makes a strong match with an approaching deadline high priority, and the shown contributions add up to the score", () => {
    const r = computeVacancyPriority(vac());
    expect(r.recommended).toBe("high");
    expect(r.live).toBe(true);
    expect(r.deadline.daysLeft).toBe(5);
    expect(sum(r)).toBe(r.score);
    expect(r.components.map((c) => c.weight)).toEqual([40, 20, 15, 15, 10]);
    expect(r.rationale.join(" ")).toMatch(/Closes in 5/);
  });
  it("does not let an approaching deadline make a weak match look suitable", () => {
    const weak = computeVacancyPriority(vac({ suitability: suit({ total: 45, rangeLow: 40 }), closingAt: new Date("2026-11-03T23:59:00Z") }));
    const deadline = weak.components.find((c) => c.key === "deadline")!;
    expect(deadline.score).toBeLessThan(25);
    expect(weak.recommended).not.toBe("high");
    expect(weak.components.find((c) => c.key === "suitability")!.score).toBe(45);
  });
  it("treats an unknown closing date as unknown: excluded from the score, flagged, never open-ended", () => {
    const r = computeVacancyPriority(vac({ closingAt: null }));
    const d = r.components.find((c) => c.key === "deadline")!;
    expect(d.known).toBe(false);
    expect(d.score).toBeNull();
    expect(r.deadline.known).toBe(false);
    expect(r.warnings.map((w) => w.code)).toContain("deadline_unknown");
    expect(sum(r)).toBe(r.score);
  });
  it("puts an item with an essential blocker on hold with the reason, however well it scores", () => {
    const r = computeVacancyPriority(vac({ suitability: suit({ total: 92, blockers: [{ code: "essential_qualification", text: "Essential Part 2 requirement" }] }) }));
    expect(r.recommended).toBe("on_hold");
    expect(r.holdReason).toMatch(/Part 2/);
    expect(r.warnings.find((w) => w.code === "essential_qualification")!.severity).toBe("blocker");
    expect(r.score).toBeGreaterThan(60);
  });
  it("does not let a high suitability score override a practical constraint", () => {
    const r = computeVacancyPriority(vac({ suitability: suit({ total: 95, blockers: [{ code: "commute_exceeds_limit", text: "Commute 150 min exceeds your 90 min limit" }] }) }));
    expect(r.recommended).toBe("on_hold");
    expect(r.components.find((c) => c.key === "feasibility")!.score).toBe(0);
    expect(r.holdReason).toMatch(/Practical constraint/);
  });
  it("never recommends a closed, filled or expired vacancy as a live application", () => {
    for (const r of [computeVacancyPriority(vac({ vacancyStatus: "closed" })), computeVacancyPriority(vac({ closingAt: new Date("2026-10-30T23:59:00Z") }))]) {
      expect(r.live).toBe(false);
      expect(r.recommended).toBe("dismissed");
      expect(r.score).toBeNull();
    }
  });
  it("gives no score when Stage 2 research is missing or too thin, instead of fabricating one", () => {
    expect(computeVacancyPriority(vac({ suitability: suit({ exists: false, total: null, assessedWeight: 0 }) })).score).toBeNull();
    const thin = computeVacancyPriority(vac({ suitability: suit({ assessedWeight: 25 }) }));
    expect(thin.score).toBeNull();
    expect(thin.recommended).toBe("on_hold");
    expect(thin.holdReason).toBe("Research incomplete");
  });
  it("cannot rank incomplete, conflicting or unapproved-profile items as high priority", () => {
    expect(computeVacancyPriority(vac({ suitability: suit({ preliminary: true, completeness: 50 }) })).recommended).not.toBe("high");
    expect(computeVacancyPriority(vac({ suitability: suit({ conflictCount: 1 }) })).recommended).toBe("recommended");
    expect(computeVacancyPriority(vac({ suitability: suit({ profileApproved: false }) })).recommended).toBe("recommended");
  });
  it("uses a cautious suitability figure when research is preliminary", () => {
    const r = computeVacancyPriority(vac({ suitability: suit({ preliminary: true, total: 80, rangeLow: 40 }) }));
    expect(r.components.find((c) => c.key === "suitability")!.score).toBe(60);
  });
  it("honours custom weights", () => {
    const a = computeVacancyPriority(vac({ closingAt: new Date("2026-12-30T23:59:00Z") }));
    const b = computeVacancyPriority(vac({ closingAt: new Date("2026-12-30T23:59:00Z") }), { suitability: 10, deadline: 70, career_value: 5, feasibility: 10, evidence: 5 });
    expect(b.score).toBeLessThan(a.score!);
  });
});

const emp = (o: Partial<EmployerPriorityInput> = {}): EmployerPriorityInput => ({
  now: NOW, suitability: suit(), suppressed: false, doNotContact: false, stage: "ready_to_contact", outboundCount: 0, lastOutboundAt: null, replied: false, cooldownDays: 60, recontactApproved: false,
  openVacancies: 0, acceptsSpeculative: "unknown", acceptsSpeculativeVerified: false, hiresPart1Verified: true, graduateProgramme: null, historicalEntryRoles: 1, recentSignals: 0,
  routeKnown: true, namedContact: false, effortMinutes: 80, ...o,
});

describe("computeEmployerPriority", () => {
  it("separates confirmed recruitment from a hypothesis, in the score and in the wording", () => {
    const hyp = computeEmployerPriority(emp());
    const conf = computeEmployerPriority(emp({ acceptsSpeculative: "yes", acceptsSpeculativeVerified: true }));
    expect(hyp.components.find((c) => c.key === "receptiveness")!.score).toBe(50);
    expect(conf.components.find((c) => c.key === "receptiveness")!.score).toBe(100);
    expect(hyp.components.find((c) => c.key === "receptiveness")!.reasons.join(" ")).toMatch(/not evidence that it is hiring/);
    expect(hyp.warnings.map((w) => w.code)).toContain("hiring_unconfirmed");
    expect(conf.score!).toBeGreaterThan(hyp.score!);
  });
  it("holds back an employer already approached, until the cooldown ends or Erin records a reason", () => {
    const recent = emp({ outboundCount: 1, lastOutboundAt: new Date("2026-10-20T10:00:00Z"), stage: "email_sent" });
    const held = computeEmployerPriority(recent);
    expect(held.recommended).toBe("on_hold");
    expect(held.holdUntil).toBe("2026-12-19");
    expect(held.holdReason).toMatch(/2026-10-20/);
    expect(computeEmployerPriority({ ...recent, recontactApproved: true }).recommended).not.toBe("on_hold");
    const later = computeEmployerPriority(emp({ outboundCount: 1, lastOutboundAt: new Date("2026-08-01T10:00:00Z"), stage: "email_sent" }));
    expect(later.recommended).not.toBe("on_hold");
    expect(later.warnings.map((w) => w.code)).toContain("previously_contacted");
  });
  it("keeps employers in conversation out of the speculative queue and never recommends suppressed ones", () => {
    expect(computeEmployerPriority(emp({ replied: true })).holdReason).toBe("Already in conversation");
    const s = computeEmployerPriority(emp({ suppressed: true }));
    expect(s.recommended).toBe("dismissed");
    expect(s.live).toBe(false);
  });
  it("will not make a speculative target high priority without a route to approach them", () => {
    const r = computeEmployerPriority(emp({ routeKnown: false, namedContact: false, suitability: suit({ total: 95 }) }));
    expect(r.recommended).not.toBe("high");
    expect(r.rationale.join(" ")).toMatch(/No legitimate application route/);
  });
});

describe("effort estimates", () => {
  it("are labelled as estimates, itemised and exclude work already done", () => {
    const e = estimateVacancyEffort({ assessmentReviewed: false, blockerCount: 0, missingCount: 2, employerResearchComplete: false, routeKnown: false, applicationRoute: "portal", portfolioRequired: null });
    expect(e.isEstimate).toBe(true);
    expect(e.items.map((x) => x.task)).toEqual(expect.arrayContaining(["review_job", "research_employer", "find_route", "tailor_cv", "cover_letter", "application_answers"]));
    expect(e.totalMinutes).toBe(e.items.reduce((a, b) => a + b.minutes, 0));
    const done = estimateVacancyEffort({ assessmentReviewed: true, blockerCount: 0, missingCount: 0, employerResearchComplete: true, routeKnown: true, applicationRoute: "email", portfolioRequired: false, done: new Set(["tailor_cv"]) });
    expect(done.items.map((x) => x.task)).toEqual(["cover_letter"]);
    expect(estimateEmployerEffort({ employerResearchComplete: true, routeKnown: true, namedContact: false }).totalMinutes).toBe(60);
  });
});

const item = (o: Partial<PlanItem> = {}): PlanItem => ({
  id: "i1", kind: "vacancy", name: "Part 1 Assistant, Studio X", status: "high", score: 80, pinned: false, favourite: false, live: true, deadlineAt: new Date("2026-11-06T23:59:00Z"), needsReview: false,
  holdReason: null, holdUntil: null, researchIncomplete: false, hasBlockers: false, effortMinutes: 120, effortBasis: "Tailor CV and write a cover letter.", employerId: "e1", vacancyId: "v1", ...o,
});
const prefs = { hoursPerDay: 2, workingDays: [1, 2, 3, 4, 5], maxApplicationsPerWeek: 2, maxOutreachPerWeek: 2, maxResearchPerWeek: 2 };
const plan = (items: PlanItem[], extra: Partial<Parameters<typeof planWeek>[0]> = {}) => planWeek({ today: "2026-11-02", items, prefs, booked: {}, bookedCounts: { applications: 0, outreach: 0, research: 0 }, ...extra });

describe("planWeek", () => {
  it("schedules deadline work before the deadline and within a day's available time", () => {
    const { actions } = plan([item()]);
    const prep = actions.filter((a) => a.kind === "prepare_application");
    expect(prep.length).toBeGreaterThan(0);
    for (const a of prep) { expect(a.plannedFor! <= "2026-11-06").toBe(true); expect(a.minutes).toBeLessThanOrEqual(120); }
    const perDay = new Map<string, number>();
    for (const a of actions) perDay.set(a.plannedFor!, (perDay.get(a.plannedFor!) ?? 0) + a.minutes);
    for (const m of perDay.values()) expect(m).toBeLessThanOrEqual(120);
  });
  it("does not fill the week: respects the weekly application limit and leaves the rest unscheduled with a reason", () => {
    const many = ["a", "b", "c", "d"].map((x, k) => item({ id: x, name: `Role ${x}`, score: 90 - k, deadlineAt: null, effortMinutes: 60 }));
    const { actions, unscheduled } = plan(many);
    expect(new Set(actions.filter((a) => a.kind === "prepare_application").map((a) => a.itemId)).size).toBe(2);
    expect(unscheduled.some((u) => /Weekly limit/.test(u.warning ?? ""))).toBe(true);
  });
  it("says when something cannot fit before its deadline instead of overbooking", () => {
    const { actions, unscheduled } = plan([item({ effortMinutes: 600, deadlineAt: new Date("2026-11-03T23:59:00Z") })]);
    expect(actions.filter((a) => a.plannedFor! > "2026-11-03")).toEqual([]);
    expect(unscheduled.some((u) => /No room before the closing date/.test(u.warning ?? ""))).toBe(true);
  });
  it("asks to verify an unknown closing date rather than assuming one", () => {
    const { actions } = plan([item({ deadlineAt: null })]);
    const v = actions.find((a) => a.kind === "verify")!;
    expect(v.dueAt).toBeNull();
    expect(actions.find((a) => a.kind === "prepare_application")!.dueAt).toBeNull();
  });
  it("plans research for items on hold only because research is incomplete, and reconsideration when a hold has ended", () => {
    const { actions } = plan([item({ id: "r", status: "on_hold", researchIncomplete: true, score: null, deadlineAt: null }), item({ id: "h", status: "on_hold", holdUntil: "2026-11-01", holdReason: "Already approached", score: null, deadlineAt: null })]);
    expect(actions.map((a) => a.kind)).toEqual(expect.arrayContaining(["research", "reconsider"]));
  });
  it("does not plan backlog, dismissed or non-live items, and skips non-working days", () => {
    const { actions } = plan([item({ id: "b", status: "backlog" }), item({ id: "d", status: "dismissed" }), item({ id: "x", live: false }), item({ id: "w", deadlineAt: null })], { today: "2026-11-07" });
    expect(actions.every((a) => a.itemId === "w")).toBe(true);
    expect(actions.every((a) => !["2026-11-07", "2026-11-08"].includes(a.plannedFor!))).toBe(true);
  });
  it("counts time Erin has already committed", () => {
    const { actions } = plan([item({ deadlineAt: null, effortMinutes: 60 })], { booked: { "2026-11-02": 120, "2026-11-03": 120, "2026-11-04": 120, "2026-11-05": 120, "2026-11-06": 100 } });
    expect(actions.filter((a) => a.kind === "prepare_application")).toEqual([]);
  });
});
