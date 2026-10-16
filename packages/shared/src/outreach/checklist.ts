import { TERMINAL_OUTREACH_STAGES, type EmployerOutreachStage } from "../enums.js";
import { emailDomain, PUBLIC_EMAIL_DOMAINS } from "../normalise/name.js";

/**
 * Pre-send checklist. Every outbound email passes through this in TypeScript (worker + UI preview)
 * AND through fn_can_send() in SQL inside the send transaction. The two must agree; the SQL
 * version is authoritative because it runs under row locks.
 */
export const BLOCK_REASONS = [
  "stop_switch",
  "dry_run",
  "credential_not_active",
  "recipient_suppressed",
  "domain_suppressed",
  "employer_suppressed",
  "contact_suppressed",
  "contact_bounced",
  "contact_do_not_contact",
  "employer_stage_not_approved",
  "employer_stage_terminal",
  "vacancy_hard_flags",
  "recent_contact_outbound",
  "recent_employer_outbound",
  "idempotency_key_used",
  "daily_cap_reached",
  "weekly_cap_reached",
  "attachment_missing",
  "attachment_hash_mismatch",
  "template_unrendered",
  "subject_empty",
  "recipient_empty",
  "recipient_domain_mismatch",
  "approval_missing",
  "approval_expired",
] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

export interface ChecklistInput {
  stopSwitch: boolean;
  dryRun: boolean;
  credentialStatus: "active" | "needs_reauth" | "revoked" | "missing";
  recipientEmail: string | null;
  recipientSuppressed: boolean;
  domainSuppressed: boolean;
  employerSuppressed: boolean;
  contactSuppressed: boolean;
  contactBounced: boolean;
  contactDoNotContact: boolean;
  employerStage: EmployerOutreachStage;
  isFollowUp: boolean;
  vacancyHardFlags: string[];
  daysSinceLastOutboundToContact: number | null;
  daysSinceLastOutboundToEmployer: number | null;
  sameThreadAsLastEmployerOutbound: boolean;
  idempotencyKeyUsed: boolean;
  sentToday: number;
  dailyCap: number;
  sentThisWeek: number;
  weeklyCap: number;
  attachments: { present: boolean; hashMatches: boolean }[];
  requiredAttachmentCount: number;
  renderedSubject: string;
  renderedBody: string;
  employerDomain: string | null;
  contactConfirmedByReply: boolean;
  approvedAt: Date | null;
  approvalTtlHours: number;
  now?: Date;
}

export interface ChecklistResult {
  ok: boolean;
  /** `dry_run` is informational: the send is simulated, not blocked. */
  blocked: BlockReason[];
  simulated: boolean;
}

const UNRENDERED = /\{\{\s*[\w.]+\s*\}\}|\[\[[^\]]+\]\]|\bTODO\b|\bXXX\b/;

export function evaluateChecklist(i: ChecklistInput): ChecklistResult {
  const blocked: BlockReason[] = [];
  const now = i.now ?? new Date();
  if (i.stopSwitch) blocked.push("stop_switch");
  if (i.credentialStatus !== "active") blocked.push("credential_not_active");
  if (!i.recipientEmail || !i.recipientEmail.includes("@")) blocked.push("recipient_empty");
  if (i.recipientSuppressed) blocked.push("recipient_suppressed");
  if (i.domainSuppressed) blocked.push("domain_suppressed");
  if (i.employerSuppressed) blocked.push("employer_suppressed");
  if (i.contactSuppressed) blocked.push("contact_suppressed");
  if (i.contactBounced) blocked.push("contact_bounced");
  if (i.contactDoNotContact) blocked.push("contact_do_not_contact");
  if (TERMINAL_OUTREACH_STAGES.includes(i.employerStage)) blocked.push("employer_stage_terminal");
  else {
    const allowed: EmployerOutreachStage[] = i.isFollowUp
      ? ["email_sent", "follow_up_due", "replied", "conversation_in_progress", "cv_requested"]
      : ["contact_approved"];
    if (!allowed.includes(i.employerStage)) blocked.push("employer_stage_not_approved");
  }
  if (i.vacancyHardFlags.length > 0) blocked.push("vacancy_hard_flags");
  if (i.daysSinceLastOutboundToContact != null && i.daysSinceLastOutboundToContact < 30 && !i.isFollowUp) blocked.push("recent_contact_outbound");
  if (i.daysSinceLastOutboundToEmployer != null && i.daysSinceLastOutboundToEmployer < 7 && !i.sameThreadAsLastEmployerOutbound) blocked.push("recent_employer_outbound");
  if (i.idempotencyKeyUsed) blocked.push("idempotency_key_used");
  if (i.sentToday >= i.dailyCap) blocked.push("daily_cap_reached");
  if (i.sentThisWeek >= i.weeklyCap) blocked.push("weekly_cap_reached");
  if (i.attachments.length < i.requiredAttachmentCount || i.attachments.some((a) => !a.present)) blocked.push("attachment_missing");
  if (i.attachments.some((a) => a.present && !a.hashMatches)) blocked.push("attachment_hash_mismatch");
  if (!i.renderedSubject.trim()) blocked.push("subject_empty");
  if (UNRENDERED.test(i.renderedSubject) || UNRENDERED.test(i.renderedBody)) blocked.push("template_unrendered");
  const rDomain = emailDomain(i.recipientEmail);
  if (rDomain && !i.contactConfirmedByReply) {
    const generic = PUBLIC_EMAIL_DOMAINS.has(rDomain);
    if (!i.employerDomain || generic || (rDomain !== i.employerDomain && !rDomain.endsWith(`.${i.employerDomain}`))) blocked.push("recipient_domain_mismatch");
  }
  if (!i.approvedAt) blocked.push("approval_missing");
  else if (now.getTime() - i.approvedAt.getTime() > i.approvalTtlHours * 3600_000) blocked.push("approval_expired");
  return { ok: blocked.length === 0, blocked, simulated: i.dryRun };
}

/** Outbound idempotency key: one message per employer/contact/template version per day. */
export function outboundIdempotencyKey(p: { employerId: string; contactId: string | null; templateCode: string; templateVersion: number; date: Date }): string {
  const day = p.date.toISOString().slice(0, 10);
  return `out:${p.employerId}:${p.contactId ?? "none"}:${p.templateCode}:v${p.templateVersion}:${day}`;
}

/** Simple, strict template renderer: {{var}} only; throws on unknown variable. */
export function renderTemplate(tmpl: string, vars: Record<string, string | number | null | undefined>): string {
  return tmpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v == null || v === "") throw new Error(`Template variable "${key}" is missing`);
    return String(v);
  });
}
