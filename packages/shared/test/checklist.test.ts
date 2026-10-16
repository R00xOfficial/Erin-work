import { describe, expect, it } from "vitest";
import { evaluateChecklist, outboundIdempotencyKey, renderTemplate, type ChecklistInput } from "../src/index.js";

const ok: ChecklistInput = {
  stopSwitch: false,
  dryRun: false,
  credentialStatus: "active",
  recipientEmail: "studio@makearchitects.com",
  recipientSuppressed: false,
  domainSuppressed: false,
  employerSuppressed: false,
  contactSuppressed: false,
  contactBounced: false,
  contactDoNotContact: false,
  employerStage: "contact_approved",
  isFollowUp: false,
  vacancyHardFlags: [],
  daysSinceLastOutboundToContact: null,
  daysSinceLastOutboundToEmployer: null,
  sameThreadAsLastEmployerOutbound: false,
  idempotencyKeyUsed: false,
  sentToday: 0,
  dailyCap: 5,
  sentThisWeek: 0,
  weeklyCap: 20,
  attachments: [{ present: true, hashMatches: true }],
  requiredAttachmentCount: 1,
  renderedSubject: "Speculative application — Part 1 Architectural Assistant",
  renderedBody: "Dear Studio team, ...",
  employerDomain: "makearchitects.com",
  contactConfirmedByReply: false,
  approvedAt: new Date(),
  approvalTtlHours: 72,
};

describe("evaluateChecklist", () => {
  it("passes a clean approved message", () => {
    expect(evaluateChecklist(ok)).toEqual({ ok: true, blocked: [], simulated: false });
  });
  it("reports dry run as simulated, not blocked", () => {
    expect(evaluateChecklist({ ...ok, dryRun: true })).toEqual({ ok: true, blocked: [], simulated: true });
  });
  const cases: [string, Partial<ChecklistInput>, string][] = [
    ["stop switch", { stopSwitch: true }, "stop_switch"],
    ["credential", { credentialStatus: "needs_reauth" }, "credential_not_active"],
    ["recipient suppressed", { recipientSuppressed: true }, "recipient_suppressed"],
    ["domain suppressed", { domainSuppressed: true }, "domain_suppressed"],
    ["employer suppressed", { employerSuppressed: true }, "employer_suppressed"],
    ["contact suppressed", { contactSuppressed: true }, "contact_suppressed"],
    ["bounced", { contactBounced: true }, "contact_bounced"],
    ["dnc", { contactDoNotContact: true }, "contact_do_not_contact"],
    ["stage", { employerStage: "ready_to_contact" }, "employer_stage_not_approved"],
    ["terminal", { employerStage: "suppressed" }, "employer_stage_terminal"],
    ["hard flags", { vacancyHardFlags: ["requires_part2"] }, "vacancy_hard_flags"],
    ["recent contact", { daysSinceLastOutboundToContact: 10 }, "recent_contact_outbound"],
    ["recent employer", { daysSinceLastOutboundToEmployer: 2 }, "recent_employer_outbound"],
    ["idempotency", { idempotencyKeyUsed: true }, "idempotency_key_used"],
    ["daily cap", { sentToday: 5 }, "daily_cap_reached"],
    ["weekly cap", { sentThisWeek: 20 }, "weekly_cap_reached"],
    ["attachment missing", { attachments: [] }, "attachment_missing"],
    ["attachment hash", { attachments: [{ present: true, hashMatches: false }] }, "attachment_hash_mismatch"],
    ["unrendered", { renderedBody: "Dear {{first_name}}" }, "template_unrendered"],
    ["subject", { renderedSubject: "  " }, "subject_empty"],
    ["recipient empty", { recipientEmail: null }, "recipient_empty"],
    ["domain mismatch", { recipientEmail: "someone@gmail.com" }, "recipient_domain_mismatch"],
    ["approval missing", { approvedAt: null }, "approval_missing"],
    ["approval expired", { approvedAt: new Date(Date.now() - 100 * 3600_000) }, "approval_expired"],
  ];
  for (const [name, patch, reason] of cases) {
    it(`blocks on ${name}`, () => {
      const r = evaluateChecklist({ ...ok, ...patch });
      expect(r.ok).toBe(false);
      expect(r.blocked).toContain(reason);
    });
  }
  it("allows follow-ups in a thread after a sent email", () => {
    const r = evaluateChecklist({ ...ok, isFollowUp: true, employerStage: "follow_up_due", daysSinceLastOutboundToContact: 8, daysSinceLastOutboundToEmployer: 8, sameThreadAsLastEmployerOutbound: true });
    expect(r.ok).toBe(true);
  });
  it("allows a confirmed-by-reply contact on a different domain", () => {
    expect(evaluateChecklist({ ...ok, recipientEmail: "jane@otherdomain.co.uk", contactConfirmedByReply: true }).ok).toBe(true);
  });
});

describe("helpers", () => {
  it("builds a daily idempotency key", () => {
    const k = outboundIdempotencyKey({ employerId: "e", contactId: null, templateCode: "speculative_intro", templateVersion: 1, date: new Date("2026-10-16T09:00:00Z") });
    expect(k).toBe("out:e:none:speculative_intro:v1:2026-10-16");
  });
  it("renders strictly", () => {
    expect(renderTemplate("Hi {{ name }}", { name: "Sam" })).toBe("Hi Sam");
    expect(() => renderTemplate("Hi {{name}}", {})).toThrow(/missing/);
  });
});
