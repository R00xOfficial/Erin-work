import { renderTemplate, outboundIdempotencyKey, extractDomain } from "@ajis/shared";
import type { TablesUpdate } from "@ajis/db";
import { db, getSetting } from "../lib/db.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { gmailClient } from "../lib/gmail/client.js";
import { buildMime } from "../lib/gmail/mime.js";
import type { Job } from "./index.js";

interface Payload { activityId: string; useStoredBody?: boolean; originalActivityId?: string }

const ROLE_LABELS: Record<string, string> = { part1_assistant: "Part 1 Architectural Assistant", graduate_assistant: "Graduate Architectural Assistant", technician: "Architectural Technician", technologist: "Architectural Technologist", bim_cad: "Junior BIM / CAD Technician", design_coordinator: "Graduate Design Coordinator", planning_assistant: "Planning Assistant", urban_design_junior: "Graduate Urban Designer", visualisation: "Junior Architectural Visualiser", placement_internship: "Architectural Placement", other_entry: "entry-level architectural" };

/** Loads attachment bytes from Supabase Storage and verifies the hash recorded on the activity. */
async function loadAttachments(atts: { document_id: string; sha256: string; file_name: string; kind?: string }[]) {
  const out: { filename: string; content: Buffer; contentType?: string }[] = [];
  for (const a of atts) {
    const { data: doc } = await db().from("documents").select("storage_bucket, storage_path, mime_type, sha256, file_name, size_bytes").eq("id", a.document_id).is("deleted_at", null).maybeSingle();
    if (!doc) throw new Error(`attachment document ${a.document_id} missing`);
    if (doc.sha256 !== a.sha256) throw new Error(`attachment ${a.file_name} changed since the draft was created`);
    if (a.kind === "portfolio" && Number(doc.size_bytes ?? 0) > 8 * 1024 * 1024) { logger.info({ file: a.file_name }, "portfolio over 8 MB; link only"); continue; }
    const { data: blob, error } = await db().storage.from(doc.storage_bucket).download(doc.storage_path);
    if (error || !blob) throw new Error(`could not download ${a.file_name}: ${error?.message}`);
    out.push({ filename: doc.file_name, content: Buffer.from(await blob.arrayBuffer()), contentType: doc.mime_type ?? undefined });
  }
  return out;
}

/**
 * Renders the template with verified facts (research notes, profile) and creates a Gmail draft.
 * Blocked by the stop switch. Never sends.
 */
export async function gmailDraftCreate(job: Job<Payload>) {
  const { activityId } = job.data;
  if (await getSetting<boolean>("stop_switch", true)) {
    await db().from("activities").update({ delivery_result: "blocked", blocked_reasons: ["stop_switch"] }).eq("id", activityId);
    return { activityId, blocked: "stop_switch" };
  }
  const { data: a } = await db().from("activities").select("*, employers(*), contacts(full_name, email), vacancies(title, discovery_source, role_family)").eq("id", activityId).maybeSingle();
  if (!a) return { skipped: "activity missing" };
  if (a.approval_status === "rejected" || a.delivery_result === "cancelled") return { skipped: "rejected" };
  const e = a.employers as NonNullable<typeof a.employers>;
  const c = a.contacts as { full_name: string; email: string | null } | null;
  const v = a.vacancies as { title: string; discovery_source: string | null; role_family: string } | null;
  const [{ data: profile }, { data: note }, { data: tmpl }, { data: original }] = await Promise.all([
    db().from("candidate_profile").select("*").eq("id", true).maybeSingle(),
    db().from("research_notes").select("*").eq("employer_id", a.employer_id!).eq("is_current", true).is("vacancy_id", null).maybeSingle(),
    a.template_code ? db().from("email_templates").select("*").eq("code", a.template_code).eq("version", a.template_version ?? 1).maybeSingle() : Promise.resolve({ data: null }),
    job.data.originalActivityId ? db().from("activities").select("subject, sent_at, rfc_message_id, provider_thread_id").eq("id", job.data.originalActivityId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!profile?.full_name) throw new Error("Candidate profile has no name — complete Settings → Candidate profile first");
  if (!tmpl && !job.data.useStoredBody) throw new Error(`template ${a.template_code} v${a.template_version} not found`);
  let subject = a.subject ?? "", body = a.body_text ?? "";
  if (!job.data.useStoredBody || !subject || !body) {
    const isFollowUp = a.template_code?.startsWith("follow_up") ?? false;
    if (!isFollowUp && (!note?.personalised_opener || !note.reviewed_at)) throw new Error("Research notes must contain a reviewed personalised opener before drafting (employer → Fit & research notes)");
    const roleLabel = ROLE_LABELS[v?.role_family ?? ""] ?? (profile.target_role_families[0] ? ROLE_LABELS[profile.target_role_families[0]] : "Part 1 Architectural Assistant");
    const vars: Record<string, string | null | undefined> = {
      greeting_name: c?.full_name ? c.full_name.split(" ")[0] : "Hiring Team",
      personalised_opener: note?.personalised_opener,
      skills_sentence: profile.software.length ? `I work confidently in ${profile.software.filter((s) => !/learning/i.test(s)).slice(0, 4).join(", ")} and bring ${profile.skills.slice(0, 3).join(", ").toLowerCase()} from my degree projects.` : "I bring strong drawing, model-making and presentation skills from my degree projects.",
      role_family_label: roleLabel,
      employer_name: e.display_name ?? e.legal_name,
      portfolio_url: profile.portfolio_url ?? "(portfolio available on request)",
      candidate_name: profile.full_name,
      candidate_phone: profile.phone ?? "",
      vacancy_title: v?.title,
      vacancy_source: v?.discovery_source ?? "your website",
      availability: profile.availability_from ?? "immediately",
      original_subject: original?.subject,
      sent_date: original?.sent_at ? new Date(original.sent_at).toLocaleDateString("en-GB", { day: "numeric", month: "long" }) : undefined,
      relevance_clause: note?.relevant_project ? `, particularly your work on ${note.relevant_project}` : "",
    };
    subject = renderTemplate(tmpl!.subject_tmpl, vars);
    body = renderTemplate(tmpl!.body_tmpl, vars);
  }
  const mailbox = env().OUTREACH_MAILBOX;
  const { gmail, cred, reason } = await gmailClient();
  const from = cred?.account_email ?? mailbox ?? "me";
  const attachments = await loadAttachments((a.attachments as { document_id: string; sha256: string; file_name: string; kind?: string }[]) ?? []);
  const idem = outboundIdempotencyKey({ employerId: a.employer_id!, contactId: a.contact_id, templateCode: a.template_code ?? "custom", templateVersion: a.template_version ?? 1, date: new Date() });
  const patch: Record<string, unknown> = { subject, body_text: body, sender_email: from, idempotency_key: idem, delivery_result: "drafted", approval_status: a.approval_status === "approved" ? "approved" : "pending_approval", blocked_reasons: [] };
  if (!gmail) {
    // No mailbox connected: keep the rendered draft in the CRM so it can still be reviewed; sending will be blocked anyway.
    patch.notes = `Draft rendered locally; Gmail draft not created (${reason}).`;
    const { error } = await db().from("activities").update(patch as TablesUpdate<"activities">).eq("id", activityId);
    if (error) throw new Error(error.message);
    return { activityId, rendered: true, gmailDraft: false, reason };
  }
  const { raw, messageId } = await buildMime({ from, to: a.recipient_email!, subject, text: body, attachments, inReplyTo: a.in_reply_to ?? original?.rfc_message_id ?? null, references: a.in_reply_to ?? original?.rfc_message_id ?? null, messageIdDomain: extractDomain(from) ?? "ajis.local" });
  const threadId = a.provider_thread_id ?? original?.provider_thread_id ?? undefined;
  const draft = a.provider_draft_id
    ? await gmail.users.drafts.update({ userId: "me", id: a.provider_draft_id, requestBody: { message: { raw, threadId } } })
    : await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw, threadId } } });
  patch.provider_draft_id = draft.data.id;
  patch.rfc_message_id = messageId;
  if (threadId) patch.provider_thread_id = threadId;
  const { error } = await db().from("activities").update(patch as TablesUpdate<"activities">).eq("id", activityId);
  if (error) throw new Error(error.message);
  return { activityId, rendered: true, gmailDraft: draft.data.id };
}
