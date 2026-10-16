"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { requestJob } from "@/server/actions/jobs";

const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" && v.trim() !== "" ? v.trim() : null; };

/**
 * Creates the activity row (delivery_result=pending, approval pending) and asks the worker to render
 * the template and create the Gmail draft. Nothing is sent here.
 */
export async function createDraft(formData: FormData) {
  const { supabase } = await requireUser();
  const employerId = s(formData, "employer_id")!;
  const contactId = s(formData, "contact_id");
  const vacancyId = s(formData, "vacancy_id");
  const templateCode = s(formData, "template_code") ?? "speculative_intro";
  const { data: tmpl, error: te } = await supabase.from("email_templates").select("id, code, version").eq("code", templateCode).eq("is_active", true).order("version", { ascending: false }).limit(1).single();
  if (te) throw new Error(te.message);
  const { data: employer } = await supabase.from("employers").select("applications_email, generic_email, is_suppressed").eq("id", employerId).single();
  if (employer?.is_suppressed) throw new Error("Employer is suppressed");
  let recipient: string | null = null;
  if (contactId) {
    const { data: c } = await supabase.from("contacts").select("email, do_not_contact").eq("id", contactId).single();
    if (c?.do_not_contact) throw new Error("Contact is marked do-not-contact");
    recipient = c?.email ?? null;
  } else {
    recipient = employer?.applications_email ?? employer?.generic_email ?? null;
  }
  const attachments: { document_id: string; sha256: string; file_name: string; kind: string }[] = [];
  for (const key of ["cv_document_id", "portfolio_document_id"]) {
    const docId = s(formData, key);
    if (!docId) continue;
    const { data: d } = await supabase.from("documents").select("id, sha256, file_name, kind").eq("id", docId).single();
    if (d) attachments.push({ document_id: d.id, sha256: d.sha256, file_name: d.file_name, kind: d.kind });
  }
  const { data: act, error } = await supabase.from("activities").insert({
    employer_id: employerId,
    contact_id: contactId,
    vacancy_id: vacancyId,
    activity_type: "email_draft_created",
    direction: "outbound",
    channel: "email",
    template_id: tmpl.id,
    template_code: tmpl.code,
    template_version: tmpl.version,
    recipient_email: recipient,
    delivery_result: "pending",
    approval_status: "pending_approval",
    attachments,
    provider: "gmail",
  }).select("id").single();
  if (error) throw new Error(error.message);
  await requestJob("gmail.draft_create", { activityId: act.id }, `draft:${act.id}`);
  revalidatePath(`/employers/${employerId}`);
  revalidatePath("/outreach");
  redirect("/outreach");
}

export async function approveDraft(id: string) {
  const { supabase } = await requireUser();
  const { data: a, error } = await supabase.from("activities").select("delivery_result, subject, body_text").eq("id", id).single();
  if (error) throw new Error(error.message);
  if (a.delivery_result !== "drafted") throw new Error("Draft has not been rendered yet; wait for the worker.");
  const { error: e2 } = await supabase.from("activities").update({ approval_status: "approved", approved_at: new Date().toISOString(), delivery_result: "approved" }).eq("id", id);
  if (e2) throw new Error(e2.message);
  await requestJob("gmail.send", { activityId: id }, `send:${id}`);
  revalidatePath("/outreach");
  revalidatePath("/");
}

export async function rejectDraft(id: string, note: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("activities").update({ approval_status: "rejected", rejected_at: new Date().toISOString(), rejection_note: note || null, delivery_result: "cancelled" }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/outreach");
  revalidatePath("/");
}

export async function editDraft(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  const subject = s(formData, "subject");
  const body = s(formData, "body_text");
  const { error } = await supabase.from("activities").update({ subject, body_text: body, approval_status: "pending_approval", approved_at: null }).eq("id", id);
  if (error) throw new Error(error.message);
  // Re-render the Gmail draft with the edited text.
  await requestJob("gmail.draft_create", { activityId: id, useStoredBody: true }, `draft:${id}`);
  revalidatePath("/outreach");
}

export async function markFollowUpDone(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("activities").update({ follow_up_done: true }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/outreach");
  revalidatePath("/");
}

export async function createFollowUpDraft(originalActivityId: string) {
  const { supabase } = await requireUser();
  const { data: o, error } = await supabase.from("activities").select("employer_id, contact_id, vacancy_id, application_id, recipient_email, subject, provider_thread_id, rfc_message_id, attachments").eq("id", originalActivityId).single();
  if (error) throw new Error(error.message);
  const { data: tmpl } = await supabase.from("email_templates").select("id, code, version").eq("code", "follow_up_1").eq("is_active", true).order("version", { ascending: false }).limit(1).single();
  const { data: act, error: e2 } = await supabase.from("activities").insert({
    employer_id: o.employer_id,
    contact_id: o.contact_id,
    vacancy_id: o.vacancy_id,
    application_id: o.application_id,
    activity_type: "email_draft_created",
    direction: "outbound",
    channel: "email",
    template_id: tmpl?.id ?? null,
    template_code: "follow_up_1",
    template_version: tmpl?.version ?? 1,
    recipient_email: o.recipient_email,
    provider_thread_id: o.provider_thread_id,
    in_reply_to: o.rfc_message_id,
    delivery_result: "pending",
    approval_status: "pending_approval",
    attachments: [],
    provider: "gmail",
    notes: `Follow-up to activity ${originalActivityId}`,
  }).select("id").single();
  if (e2) throw new Error(e2.message);
  await supabase.from("activities").update({ follow_up_done: true }).eq("id", originalActivityId);
  await requestJob("gmail.draft_create", { activityId: act.id, originalActivityId }, `draft:${act.id}`);
  revalidatePath("/outreach");
}
