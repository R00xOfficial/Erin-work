"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { applicationInputSchema, applicationStageChangeSchema, APPLICATION_STAGES, type ApplicationStage } from "@ajis/shared";
import type { TablesUpdate } from "@ajis/db";
import { requireUser } from "@/lib/supabase/server";

const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" && v.trim() !== "" ? v.trim() : null; };

export async function createApplication(formData: FormData) {
  const { supabase } = await requireUser();
  const input = applicationInputSchema.parse({
    employer_id: s(formData, "employer_id"),
    vacancy_id: s(formData, "vacancy_id"),
    application_type: s(formData, "application_type") ?? "speculative",
    stage: s(formData, "stage") ?? (s(formData, "vacancy_id") ? "vacancy_discovered" : "preparing"),
    notes: s(formData, "notes"),
  });
  // Snapshot current default documents so we always know which CV version a company received.
  const { data: docs } = await supabase.from("documents").select("id, kind, version_label, sha256, file_name").eq("is_current", true).is("deleted_at", null);
  const cv = docs?.find((d) => d.kind === "cv");
  const portfolio = docs?.find((d) => d.kind === "portfolio");
  let deadline: string | null = null;
  if (input.vacancy_id) {
    const { data: v } = await supabase.from("vacancies").select("closing_at, eligibility_status, hard_flags").eq("id", input.vacancy_id).single();
    deadline = v?.closing_at ?? null;
    if (v?.eligibility_status === "ineligible") throw new Error(`Vacancy is ineligible: ${v.hard_flags.join(", ")}`);
  }
  const { data, error } = await supabase.from("applications").insert({
    employer_id: input.employer_id,
    vacancy_id: input.vacancy_id ?? null,
    application_type: input.application_type,
    stage: input.stage,
    cv_document_id: cv?.id ?? null,
    portfolio_document_id: portfolio?.id ?? null,
    notes: input.notes ?? null,
    deadline_at: deadline,
    documents_snapshot: (docs ?? []).map((d) => ({ document_id: d.id, kind: d.kind, version_label: d.version_label, sha256: d.sha256, file_name: d.file_name })),
  }).select("id").single();
  if (error) {
    if (error.message.includes("applications_vacancy_uq")) {
      const { data: existing } = await supabase.from("applications").select("id").eq("vacancy_id", input.vacancy_id!).is("deleted_at", null).single();
      if (existing) redirect(`/applications/${existing.id}`);
    }
    throw new Error(error.message);
  }
  if (input.vacancy_id) await supabase.from("vacancies").update({ reviewed_at: new Date().toISOString() }).eq("id", input.vacancy_id).is("reviewed_at", null);
  revalidatePath("/applications");
  revalidatePath(`/employers/${input.employer_id}`);
  redirect(`/applications/${data.id}`);
}

export async function moveApplicationStage(id: string, stage: ApplicationStage, note?: string) {
  const { supabase } = await requireUser();
  if (!APPLICATION_STAGES.includes(stage)) throw new Error("Unknown stage");
  const { data, error } = await supabase.from("applications").update({ stage }).eq("id", id).select("employer_id").single();
  if (error) throw new Error(error.message);
  if (note) await supabase.from("activities").insert({ employer_id: data.employer_id, application_id: id, activity_type: "note", direction: "internal", channel: "system", body_text: `Application stage → ${stage}: ${note}` });
  revalidatePath("/applications");
  revalidatePath(`/applications/${id}`);
  revalidatePath("/");
}

export async function changeApplicationStage(formData: FormData) {
  const input = applicationStageChangeSchema.parse({ id: s(formData, "id"), stage: s(formData, "stage"), note: s(formData, "note") });
  await moveApplicationStage(input.id, input.stage, input.note ?? undefined);
}

export async function updateApplication(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  const patch: Record<string, unknown> = {};
  for (const f of ["cover_letter_text", "tailoring_notes", "submitted_via", "submitted_to", "salary_expectation", "availability_stated", "right_to_work_answer", "confirmation_ref", "next_action", "feedback", "outcome_reason", "lessons_learned", "notes", "cv_document_id", "portfolio_document_id", "cover_letter_document_id"]) {
    if (formData.has(f)) patch[f] = s(formData, f);
  }
  for (const d of ["next_action_due", "deadline_at", "submitted_at", "offer_decision_deadline"]) {
    if (formData.has(d)) { const v = s(formData, d); patch[d] = v ? new Date(v).toISOString() : null; }
  }
  if (formData.has("application_answers")) {
    const raw = s(formData, "application_answers");
    patch.application_answers = raw ? { text: raw } : null;
  }
  if (formData.has("offer_salary") || formData.has("offer_notes")) {
    patch.offer = { salary: s(formData, "offer_salary"), notes: s(formData, "offer_notes") };
  }
  // Re-snapshot documents if the selection changed.
  const docIds = [patch.cv_document_id, patch.portfolio_document_id, patch.cover_letter_document_id].filter((x): x is string => typeof x === "string");
  if (docIds.length) {
    const { data: docs } = await supabase.from("documents").select("id, kind, version_label, sha256, file_name").in("id", docIds);
    patch.documents_snapshot = (docs ?? []).map((d) => ({ document_id: d.id, kind: d.kind, version_label: d.version_label, sha256: d.sha256, file_name: d.file_name }));
  }
  const { error } = await supabase.from("applications").update(patch as TablesUpdate<"applications">).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/applications/${id}`);
  revalidatePath("/applications");
}

export async function addInterview(formData: FormData) {
  const { supabase } = await requireUser();
  const applicationId = s(formData, "application_id")!;
  const { data: last } = await supabase.from("interviews").select("round").eq("application_id", applicationId).order("round", { ascending: false }).limit(1).maybeSingle();
  const scheduled = s(formData, "scheduled_at");
  const { error } = await supabase.from("interviews").insert({
    application_id: applicationId,
    round: (last?.round ?? 0) + 1,
    scheduled_at: scheduled ? new Date(scheduled).toISOString() : null,
    format: (s(formData, "format") ?? "in_person") as "phone" | "video" | "in_person" | "portfolio_review" | "assessment",
    location: s(formData, "location"),
    interviewers: s(formData, "interviewers"),
    prep_notes: s(formData, "prep_notes"),
  });
  if (error) throw new Error(error.message);
  await supabase.from("tasks").insert({ title: "Prepare for interview", task_type: "interview_prep", entity_type: "application", entity_id: applicationId, priority: "high", auto_generated: true, due_at: scheduled ? new Date(new Date(scheduled).getTime() - 86_400_000).toISOString() : null, dedupe_key: `interview_prep:${applicationId}:${(last?.round ?? 0) + 1}` });
  revalidatePath(`/applications/${applicationId}`);
}

export async function updateInterview(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  const patch: Record<string, unknown> = {};
  for (const f of ["location", "interviewers", "prep_notes", "questions_asked", "feedback", "outcome", "format"]) if (formData.has(f)) patch[f] = s(formData, f);
  if (formData.has("scheduled_at")) { const v = s(formData, "scheduled_at"); patch.scheduled_at = v ? new Date(v).toISOString() : null; }
  const { data, error } = await supabase.from("interviews").update(patch as TablesUpdate<"interviews">).eq("id", id).select("application_id").single();
  if (error) throw new Error(error.message);
  revalidatePath(`/applications/${data.application_id}`);
}

export async function logSubmission(formData: FormData) {
  const { supabase } = await requireUser();
  const id = s(formData, "id")!;
  const { data: app, error } = await supabase.from("applications").select("employer_id, vacancy_id, cv_document_id, portfolio_document_id, documents_snapshot").eq("id", id).single();
  if (error) throw new Error(error.message);
  const via = s(formData, "submitted_via") ?? "portal";
  const to = s(formData, "submitted_to");
  const { data: act } = await supabase.from("activities").insert({
    employer_id: app.employer_id,
    application_id: id,
    vacancy_id: app.vacancy_id,
    activity_type: "application_submitted",
    direction: "outbound",
    channel: via === "email" ? "email" : "portal",
    subject: `Application submitted via ${via}${to ? ` to ${to}` : ""}`,
    body_text: s(formData, "notes"),
    delivery_result: "sent",
    sent_at: new Date().toISOString(),
    attachments: app.documents_snapshot,
    recipient_email: via === "email" ? to : null,
  }).select("id").single();
  await supabase.from("applications").update({ stage: "submitted", submitted_via: via, submitted_to: to, confirmation_ref: s(formData, "confirmation_ref"), confirmation_email_activity_id: act?.id ?? null, next_action: "Await acknowledgement", next_action_due: new Date(Date.now() + 14 * 86_400_000).toISOString() }).eq("id", id);
  revalidatePath(`/applications/${id}`);
  revalidatePath("/applications");
}
