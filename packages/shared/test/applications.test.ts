import { describe, expect, it } from "vitest";
import {
  APPLICATION_STAGES, applicationReadiness, checkDraft, columnFor, defaultChecklist, duplicateOutreachCheck, interviewChecklist, nextAction, selectableStages, suggestFollowUp, thankYouDueAt,
  type DraftFact, type DraftParagraph, type NextActionInput,
} from "../src/index.js";

const NOW = new Date("2026-11-10T09:00:00Z");
const D = (s: string) => new Date(s);

describe("lifecycle", () => {
  it("maps every stage to exactly one pipeline column", () => {
    for (const s of APPLICATION_STAGES) expect(columnFor(s)).toBeTruthy();
    expect(columnFor("ready_to_submit")).toBe("ready");
    expect(columnFor("awaiting_response")).toBe("awaiting");
    expect(columnFor("assessment")).toBe("interviews");
    expect(columnFor("vacancy_closed")).toBe("closed");
  });
  it("never offers 'submitted' in the generic stage control, and hides post-submission stages until the submission is confirmed", () => {
    const before = selectableStages("preparing", false, APPLICATION_STAGES);
    expect(before).not.toContain("submitted");
    expect(before).not.toContain("interview_1");
    expect(before).toContain("withdrawn");
    const after = selectableStages("awaiting_response", true, APPLICATION_STAGES);
    expect(after).not.toContain("submitted");
    expect(after).toContain("interview_1");
  });
});

describe("applicationReadiness", () => {
  const base = { now: NOW, deadline: D("2026-11-20T23:59:00Z"), openRequiredChecklist: [], cvSelected: true, recipientKnown: true, methodKnown: true, messageFinal: true, messageRequired: true, unacknowledgedDraftFlags: 0, stage2Blockers: [], listingClosed: false };
  it("is ready when everything is in place", () => expect(applicationReadiness(base).ready).toBe(true));
  it("blocks on a missing CV, recipient, unfinished checklist, unchecked draft claims or a passed deadline", () => {
    const r = applicationReadiness({ ...base, cvSelected: false, recipientKnown: false, openRequiredChecklist: ["Draft the cover letter"], unacknowledgedDraftFlags: 2, deadline: D("2026-11-01T00:00:00Z") });
    expect(r.ready).toBe(false);
    expect(r.issues.filter((i) => i.severity === "blocker").map((i) => i.code)).toEqual(expect.arrayContaining(["no_cv", "no_recipient", "checklist", "draft_flags", "deadline_passed"]));
  });
  it("warns, without blocking, about research blockers, an unknown deadline and a closed listing", () => {
    const r = applicationReadiness({ ...base, deadline: null, listingClosed: true, stage2Blockers: ["Essential Part 2 requirement"], messageFinal: false });
    expect(r.ready).toBe(true);
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["deadline_unknown", "listing_closed", "stage2_blocker", "no_final_message"]));
  });
});

describe("suggestFollowUp", () => {
  const submittedAt = D("2026-11-03T10:00:00Z");
  it("prefers Erin's own date, then the employer's stated timeframe, then a labelled rule", () => {
    const mine = suggestFollowUp({ submittedAt, explicit: D("2026-11-30T00:00:00Z"), defaultDays: 14, followUpsDone: 0, maxFollowUps: 2 });
    expect("basis" in mine && mine.basis).toBe("user_set");
    const stated = suggestFollowUp({ submittedAt, responseExpectedBy: D("2026-11-17T00:00:00Z"), defaultDays: 14, followUpsDone: 0, maxFollowUps: 2 });
    expect("basis" in stated && stated.basis).toBe("employer_stated");
    const rule = suggestFollowUp({ submittedAt, defaultDays: 14, followUpsDone: 0, maxFollowUps: 2 });
    expect("basis" in rule && rule.basis).toBe("rule_suggestion");
    expect("note" in rule && rule.note).toMatch(/Suggested only.*not an employer requirement/);
    if ("dueAt" in rule) expect(rule.dueAt.toISOString().slice(0, 10)).toBe("2026-11-17");
  });
  it("stops suggesting after the allowed number of follow-ups and measures the next gap from the last follow-up", () => {
    const next = suggestFollowUp({ submittedAt, defaultDays: 7, followUpsDone: 1, maxFollowUps: 2, lastFollowUpAt: D("2026-11-20T00:00:00Z") });
    if ("dueAt" in next) expect(next.dueAt.toISOString().slice(0, 10)).toBe("2026-11-27");
    const done = suggestFollowUp({ submittedAt, defaultDays: 7, followUpsDone: 2, maxFollowUps: 2 });
    expect("exhausted" in done && done.exhausted).toBe(true);
  });
  it("sets a thank-you after the interview ends", () => {
    expect(thankYouDueAt(D("2026-11-12T10:00:00Z"), 45, 24).toISOString()).toBe("2026-11-13T10:45:00.000Z");
  });
});

describe("nextAction", () => {
  const base: NextActionInput = { now: NOW, stage: "preparing", deadline: null, openRequiredChecklist: 3, nextInterviewAt: null, nextFollowUp: null, offerDecisionDeadline: null, listingClosed: false, submitted: false };
  it("never calls something overdue unless a stored date has passed", () => {
    const none = nextAction(base);
    expect(none.urgency).toBe("normal");
    expect(none.reason).toMatch(/No closing date is recorded/);
    expect(nextAction({ ...base, deadline: D("2026-11-05T00:00:00Z") }).urgency).toBe("overdue");
    expect(nextAction({ ...base, deadline: D("2026-12-25T00:00:00Z") }).urgency).toBe("normal");
    expect(nextAction({ ...base, deadline: D("2026-11-12T00:00:00Z") }).urgency).toBe("soon");
  });
  it("puts a due follow-up or upcoming interview ahead of routine preparation, and waits quietly when nothing is scheduled", () => {
    expect(nextAction({ ...base, stage: "awaiting_response", submitted: true, nextFollowUp: { dueAt: D("2026-11-08T00:00:00Z"), title: "Follow up" } }).label).toBe("Follow up");
    expect(nextAction({ ...base, stage: "interview_1", submitted: true, nextInterviewAt: D("2026-11-11T10:00:00Z") }).label).toMatch(/Prepare for the interview/);
    const idle = nextAction({ ...base, stage: "awaiting_response", submitted: true });
    expect(idle.urgency).toBe("none");
    expect(idle.label).toBe("Waiting for the employer");
  });
  it("treats a closed listing as a prompt to check, not as an outcome", () => {
    const r = nextAction({ ...base, stage: "awaiting_response", submitted: true, listingClosed: true });
    expect(r.label).toMatch(/Check whether you have heard back/);
    expect(r.reason).toMatch(/not an outcome/);
  });
  it("asks for an offer decision, using the real deadline when there is one", () => {
    const r = nextAction({ ...base, stage: "offer_received", submitted: true, offerDecisionDeadline: D("2026-11-14T00:00:00Z") });
    expect(r.label).toBe("Decide on the offer");
    expect(r.dueAt?.toISOString().slice(0, 10)).toBe("2026-11-14");
  });
});

describe("duplicateOutreachCheck", () => {
  const app = (o: Partial<Parameters<typeof duplicateOutreachCheck>[0]["applications"][number]> = {}) => ({ id: "a", stage: "awaiting_response", applicationType: "speculative", createdAt: D("2026-10-20T00:00:00Z"), submittedAt: D("2026-10-25T00:00:00Z"), vacancyTitle: null, ...o });
  it("needs confirmation for a speculative approach within the gap or alongside an open one, and shows the history", () => {
    const r = duplicateOutreachCheck({ now: NOW, type: "speculative", applications: [app()], contacts: [{ sentAt: D("2026-10-25T00:00:00Z"), subject: "Hello" }], cooldownDays: 60 });
    expect(r.needsConfirmation).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/open speculative application/);
    expect(r.lastContactAt?.toISOString().slice(0, 10)).toBe("2026-10-25");
    expect(r.applications).toHaveLength(1);
  });
  it("is clear for an employer never contacted, and old contact outside the gap only needs a mention for speculative repeats", () => {
    expect(duplicateOutreachCheck({ now: NOW, type: "speculative", applications: [], contacts: [], cooldownDays: 60 }).needsConfirmation).toBe(false);
    const old = duplicateOutreachCheck({ now: NOW, type: "speculative", applications: [app({ stage: "closed_without_response", submittedAt: D("2026-03-01T00:00:00Z") })], contacts: [{ sentAt: D("2026-03-01T00:00:00Z"), subject: null }], cooldownDays: 60 });
    expect(old.reasons.join(" ")).toMatch(/sent this employer a speculative application before/);
  });
  it("does not block a second, different vacancy at the same employer unless there is recent contact", () => {
    expect(duplicateOutreachCheck({ now: NOW, type: "advertised", applications: [app({ applicationType: "advertised", submittedAt: D("2026-08-01T00:00:00Z") })], contacts: [], cooldownDays: 60 }).needsConfirmation).toBe(false);
  });
});

describe("checklists", () => {
  it("adapts to speculative and advertised applications", () => {
    const spec = defaultChecklist({ speculative: true, hasVacancy: false, applicationRoute: "unknown", portfolioRequired: null });
    expect(spec.map((i) => i.kind)).toContain("intro_email");
    expect(spec.map((i) => i.kind)).not.toContain("eligibility_deadline");
    const adv = defaultChecklist({ speculative: false, hasVacancy: true, applicationRoute: "portal", portfolioRequired: false });
    expect(adv.map((i) => i.kind)).toEqual(expect.arrayContaining(["eligibility_deadline", "cover_letter", "answers"]));
    expect(adv.find((i) => i.kind === "portfolio")!.required).toBe(false);
    expect(new Set(adv.map((i) => i.sort)).size).toBe(adv.length);
  });
  it("has separate preparation lists for interviews and assessments", () => {
    expect(interviewChecklist("interview").map((i) => i.kind)).toContain("questions");
    expect(interviewChecklist("assessment").map((i) => i.kind)).toContain("assessment_instructions");
    expect(interviewChecklist("interview").find((i) => i.kind === "thank_you")!.required).toBe(false);
  });
});

describe("checkDraft", () => {
  const facts: DraftFact[] = [
    { id: "p1", text: "I completed the RIBA Part 1 at the University of Portsmouth in 2025.", source: "profile" },
    { id: "p2", text: "I use Revit and Rhino.", source: "profile" },
    { id: "e1", text: "Studio X designed Harbour School, a primary school in Gosport.", source: "employer" },
  ];
  const P = (text: string, factual: boolean, ids: string[] = []): DraftParagraph => ({ text, factual, fact_ids: ids });
  it("accepts a draft whose factual statements all cite real facts", () => {
    expect(checkDraft([P("Dear Studio X,", false), P("I completed my RIBA Part 1 at Portsmouth in 2025 and use Revit.", true, ["p1", "p2"]), P("I admired Harbour School.", true, ["e1"]), P("Kind regards", false)], facts, ["Studio X"])).toEqual([]);
  });
  it("flags factual statements with no supporting fact, and citations of facts that were never supplied", () => {
    const f = checkDraft([P("I have extensive experience in housing.", true, []), P("I know your work well.", true, ["zz"])], facts);
    expect(f.map((x) => x.code)).toEqual(expect.arrayContaining(["unsupported_claim", "unknown_fact_reference"]));
  });
  it("flags invented numbers, credentials and personal connections even when a paragraph cites a fact", () => {
    const f = checkDraft([P("I completed my Part 1 in 2025 and have 3 years of site experience.", true, ["p1"]), P("I won a design award and was introduced by a mutual friend.", true, ["p1"])], facts);
    const codes = f.map((x) => x.code);
    expect(codes).toContain("unverified_detail");
    expect(codes).toContain("unverified_credential");
    expect(codes).toContain("personal_connection");
    expect(f.find((x) => x.code === "unverified_detail")!.text).toMatch(/"3"/);
    expect(f.some((x) => /"2025"/.test(x.text))).toBe(false);
  });
});
