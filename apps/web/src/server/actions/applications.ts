"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  APPLICATION_STAGES, OUTCOME_STAGES, applicationReadiness, checkDraft, defaultChecklist, duplicateOutreachCheck, interviewChecklist, selectableStages, type ApplicationStage, type DraftFact, type DraftParagraph,
} from "@ajis/shared";
import type { Json, TablesUpdate } from "@ajis/db";
import { requireUser } from "@/lib/supabase/server";
import { requestJob } from "@/server/actions/jobs";

// Stage 4. Preparing, reviewing and submitting are separate states, and every external step (submission, sending, accepting an offer,
// withdrawing) is something Erin does and confirms herself. Nothing here sends anything.

type Client = Awaited<ReturnType<typeof requireUser>>["supabase"];
const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" && v.trim() !== "" ? v.trim() : null; };
const nowIso = () => new Date().toISOString();
const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
const refresh = (id?: string) => { for (const p of ["/applications", "/priorities", "/"]) revalidatePath(p); if (id) revalidatePath(`/applications/${id}`); };

async function log(supabase: Client, a: { id: string; employer_id: string; vacancy_id: string | null }, row: { type: string; subject: string; body?: string | null; direction?: "inbound" | "outbound" | "internal"; channel?: string; at?: string | null; document_ids?: Json }) {
  const { error } = await supabase.from("activities").insert({
    employer_id: a.employer_id, application_id: a.id, vacancy_id: a.vacancy_id, activity_type: row.type as never, direction: row.direction ?? "internal", channel: (row.channel ?? "system") as never,
    subject: row.subject, body_text: row.body ?? null, occurred_at: row.at ?? nowIso(), attachments: row.document_ids ?? [], delivery_result: "pending", origin: "manual", confirmation: "user",
  });
  if (error) throw new Error(`Saved, but the timeline entry failed: ${error.message}`);
}
async function getApp(supabase: Client, id: string) {
  const { data, error } = await supabase.from("applications").select("*").eq("id", id).is("deleted_at", null).single();
  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------------------------------------------------------------
// Creating an application from a Stage 3 opportunity
// ---------------------------------------------------------------------------------------------------------------------

/** Used by /applications/new. Returns the prior history so the page can show it before anything is created. */
export async function loadStartContext(employerId: string, type: string) {
  const { supabase } = await requireUser();
  const [{ data: prefs }, { data: apps }, { data: acts }] = await Promise.all([
    supabase.from("planner_preferences").select("recontact_cooldown_days").eq("id", true).maybeSingle(),
    supabase.from("applications").select("id, stage, application_type, created_at, submitted_at, vacancies(title)").eq("employer_id", employerId).is("deleted_at", null),
    supabase.from("activities").select("sent_at, subject").eq("employer_id", employerId).eq("direction", "outbound").in("delivery_result", ["sent", "delivered"]).not("sent_at", "is", null),
  ]);
  return duplicateOutreachCheck({
    now: new Date(), type, cooldownDays: prefs?.recontact_cooldown_days ?? 60,
    applications: (apps ?? []).map((a) => ({ id: a.id, stage: a.stage, applicationType: a.application_type, createdAt: new Date(a.created_at), submittedAt: a.submitted_at ? new Date(a.submitted_at) : null, vacancyTitle: (a.vacancies as { title: string } | null)?.title ?? null })),
    contacts: (acts ?? []).map((a) => ({ sentAt: new Date(a.sent_at!), subject: a.subject })),
  });
}

export async function createApplication(formData: FormData) {
  const { supabase } = await requireUser();
  let employerId = s(formData, "employer_id");
  let vacancyId = s(formData, "vacancy_id");
  const priorityId = s(formData, "priority_item_id");
  type PriorityRow = { id: string; kind: string; employer_id: string | null; vacancy_id: string | null; status: string; score: number | null; rationale: string[]; components: Json; warnings: Json; model_version: number; computed_at: string; suitability_total: number | null; suitability_assessment_id: string | null };
  let item: PriorityRow | null = null;
  if (priorityId) {
    const { data, error } = await supabase.from("priority_items").select("id, kind, employer_id, vacancy_id, status, score, rationale, components, warnings, model_version, computed_at, suitability_total, suitability_assessment_id").eq("id", priorityId).single();
    if (error) throw new Error(error.message);
    item = data as unknown as PriorityRow;
    employerId = data.employer_id ?? employerId; vacancyId = data.vacancy_id;
  }
  if (!employerId) throw new Error("An application needs an employer.");
  const type = vacancyId ? "advertised" : "speculative";
  const { data: emp } = await supabase.from("employers").select("id, is_suppressed, applications_email, generic_email").eq("id", employerId).single();
  if (emp?.is_suppressed) throw new Error("This employer is on your suppression list.");

  let vac: { closing_at: string | null; status: string; application_email: string | null; application_url: string | null; application_route: string; portfolio_required: boolean | null; title: string } | null = null;
  if (vacancyId) {
    const { data: v } = await supabase.from("vacancies").select("closing_at, status, application_email, application_url, application_route, portfolio_required, title").eq("id", vacancyId).single();
    vac = v;
    if (v && ["closed", "filled", "withdrawn"].includes(v.status)) throw new Error("This vacancy is closed, so an application cannot be started from it.");
    if (v?.closing_at && new Date(v.closing_at) < new Date()) throw new Error("The closing date for this vacancy has passed.");
  }

  const dup = await loadStartContext(employerId, type);
  if (dup.needsConfirmation && formData.get("confirm_repeat") !== "on") redirect(`/applications/new?employer_id=${employerId}${vacancyId ? `&vacancy_id=${vacancyId}` : ""}${priorityId ? `&priority_item_id=${priorityId}` : ""}`);
  const repeatReason = s(formData, "repeat_reason");
  if (dup.needsConfirmation && !repeatReason) throw new Error("Say why another approach is appropriate.");

  const [{ data: docs }, { data: assessment }] = await Promise.all([
    supabase.from("documents").select("id, kind, version_label, sha256, file_name").eq("is_current", true).is("deleted_at", null),
    vacancyId ? supabase.from("assessments").select("id, total, completeness, confidence, blockers, missing, criteria").eq("kind", "vacancy").eq("vacancy_id", vacancyId).eq("is_current", true).maybeSingle()
      : supabase.from("assessments").select("id, total, completeness, confidence, blockers, missing, criteria").eq("kind", "employer").eq("employer_id", employerId).is("vacancy_id", null).eq("is_current", true).maybeSingle(),
  ]);
  const cv = docs?.find((d) => d.kind === "cv"), portfolio = docs?.find((d) => d.kind === "portfolio");
  const recipient = vac?.application_email ?? vac?.application_url ?? emp?.applications_email ?? emp?.generic_email ?? null;
  const { data: created, error } = await supabase.from("applications").insert({
    employer_id: employerId, vacancy_id: vacancyId, application_type: type, stage: "selected", selected_at: nowIso(), priority_item_id: item?.id ?? null,
    selection_reason: s(formData, "selection_reason") ?? item?.rationale?.join(" ") ?? null, repeat_reason: dup.needsConfirmation ? repeatReason : null, notes: s(formData, "notes"),
    deadline_at: vac?.closing_at ?? null, recipient, cv_document_id: cv?.id ?? null, portfolio_document_id: portfolio?.id ?? null,
    documents_snapshot: (docs ?? []).map((d) => ({ document_id: d.id, kind: d.kind, version_label: d.version_label, sha256: d.sha256, file_name: d.file_name })),
    priority_snapshot: item ? ({ status: item.status, score: item.score, rationale: item.rationale, warnings: item.warnings, components: item.components, model_version: item.model_version, computed_at: item.computed_at, suitability_total: item.suitability_total } as Json) : null,
    research_snapshot: assessment ? ({ assessment_id: assessment.id, total: assessment.total, completeness: assessment.completeness, confidence: assessment.confidence, blockers: assessment.blockers, missing: assessment.missing } as Json) : null,
  }).select("id, employer_id, vacancy_id").single();
  if (error) {
    if (error.message.includes("applications_vacancy_uq")) {
      const { data: existing } = await supabase.from("applications").select("id").eq("vacancy_id", vacancyId!).is("deleted_at", null).single();
      if (existing) redirect(`/applications/${existing.id}`);
    }
    throw new Error(error.message);
  }
  const list = defaultChecklist({ speculative: type === "speculative", hasVacancy: !!vacancyId, applicationRoute: vac?.application_route ?? "unknown", portfolioRequired: vac?.portfolio_required ?? null });
  await supabase.from("application_checklist_items").insert(list.map((c) => ({ application_id: created.id, kind: c.kind, label: c.label, required: c.required, sort: c.sort })));
  await log(supabase, created, { type: "note", subject: `Application started${item ? " from Stage 3" : ""}${dup.needsConfirmation ? " (repeat approach confirmed)" : ""}`, body: [s(formData, "selection_reason") ?? item?.rationale?.join(" "), repeatReason ? `Reason for another approach: ${repeatReason}` : null].filter(Boolean).join("\n") || null });
  if (vacancyId) await supabase.from("vacancies").update({ reviewed_at: nowIso() }).eq("id", vacancyId).is("reviewed_at", null);
  refresh();
  revalidatePath(`/employers/${employerId}`);
  redirect(`/applications/${created.id}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Stage and preparation
// ---------------------------------------------------------------------------------------------------------------------

export async function moveApplicationStage(id: string, stage: ApplicationStage, note?: string) {
  const { supabase } = await requireUser();
  if (!APPLICATION_STAGES.includes(stage)) throw new Error("Unknown stage");
  const a = await getApp(supabase, id);
  if (stage === "submitted") throw new Error('Use "Confirm submission": an application is only submitted when you say it was.');
  if (OUTCOME_STAGES.includes(stage)) throw new Error("Record outcomes with the outcome form so the date, feedback and your confirmation are kept.");
  if (!selectableStages(a.stage, !!a.submission_confirmed_at, APPLICATION_STAGES).includes(stage)) throw new Error("That stage needs a confirmed submission first.");
  const { error } = await supabase.from("applications").update({ stage }).eq("id", id);
  if (error) throw new Error(error.message);
  if (note) await log(supabase, a, { type: "note", subject: `Stage changed to ${stage.replace(/_/g, " ")}`, body: note });
  refresh(id);
}
export async function changeApplicationStage(formData: FormData) {
  const id = s(formData, "id"), stage = s(formData, "stage");
  if (!id || !stage) throw new Error("Choose a stage.");
  await moveApplicationStage(id, stage as ApplicationStage, s(formData, "note") ?? undefined);
}

export async function updateApplication(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  const patch: TablesUpdate<"applications"> = {};
  const text = (f: keyof TablesUpdate<"applications">) => { if (formData.has(f as string)) (patch as Record<string, unknown>)[f as string] = s(formData, f as string); };
  for (const f of ["cover_letter_text", "tailoring_notes", "recipient", "submission_instructions", "response_timeframe_text", "contact_source", "selection_reason", "notes", "next_action", "salary_expectation", "availability_stated", "right_to_work_answer"] as const) text(f);
  for (const f of ["cv_document_id", "portfolio_document_id", "cover_letter_document_id", "contact_id", "office_id"] as const) text(f);
  if (formData.has("submitted_via_plan")) patch.submitted_via = s(formData, "submitted_via_plan");
  for (const d of ["next_action_due", "deadline_at", "offer_decision_deadline"] as const) if (formData.has(d)) (patch as Record<string, unknown>)[d] = iso(s(formData, d));
  if (formData.has("response_expected_by")) patch.response_expected_by = s(formData, "response_expected_by");
  if (formData.has("portfolio_projects")) patch.portfolio_projects = (s(formData, "portfolio_projects") ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  if (formData.has("application_answers")) patch.application_answers = s(formData, "application_answers") ? ({ text: s(formData, "application_answers") } as Json) : null;
  const docIds = [patch.cv_document_id, patch.portfolio_document_id, patch.cover_letter_document_id].filter((x): x is string => typeof x === "string");
  if (docIds.length) {
    const a = await getApp(supabase, id);
    const keepIds = [...new Set([...docIds, a.cv_document_id, a.portfolio_document_id, a.cover_letter_document_id].filter((x): x is string => !!x))];
    const { data: docs } = await supabase.from("documents").select("id, kind, version_label, sha256, file_name").in("id", keepIds);
    patch.documents_snapshot = (docs ?? []).map((d) => ({ document_id: d.id, kind: d.kind, version_label: d.version_label, sha256: d.sha256, file_name: d.file_name })) as Json;
  }
  const { error } = await supabase.from("applications").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  refresh(id);
}

// ---------------------------------------------------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------------------------------------------------

export async function toggleChecklistItem(itemId: string, applicationId: string) {
  const { supabase } = await requireUser();
  const { data: cur, error } = await supabase.from("application_checklist_items").select("done").eq("id", itemId).single();
  if (error) throw new Error(error.message);
  const { error: e2 } = await supabase.from("application_checklist_items").update({ done: !cur.done, done_at: cur.done ? null : nowIso() }).eq("id", itemId);
  if (e2) throw new Error(e2.message);
  refresh(applicationId);
}
export async function addChecklistItem(applicationId: string, formData: FormData) {
  const { supabase } = await requireUser();
  const label = s(formData, "label");
  if (!label) return;
  const { data: last } = await supabase.from("application_checklist_items").select("sort").eq("application_id", applicationId).order("sort", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("application_checklist_items").insert({ application_id: applicationId, label, required: formData.get("required") === "on", sort: (last?.sort ?? 0) + 10, due_at: iso(s(formData, "due_at")), interview_id: s(formData, "interview_id") });
  if (error) throw new Error(error.message);
  refresh(applicationId);
}
export async function updateChecklistItem(itemId: string, applicationId: string, formData: FormData) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("application_checklist_items").update({ label: s(formData, "label") ?? "Untitled", required: formData.get("required") === "on", notes: s(formData, "notes"), due_at: iso(s(formData, "due_at")) }).eq("id", itemId);
  if (error) throw new Error(error.message);
  refresh(applicationId);
}
export async function deleteChecklistItem(itemId: string, applicationId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("application_checklist_items").delete().eq("id", itemId);
  if (error) throw new Error(error.message);
  refresh(applicationId);
}

// ---------------------------------------------------------------------------------------------------------------------
// Review and submission
// ---------------------------------------------------------------------------------------------------------------------

async function readiness(supabase: Client, id: string) {
  const a = await getApp(supabase, id);
  const [{ data: items }, { data: drafts }, { data: v }] = await Promise.all([
    supabase.from("application_checklist_items").select("label, required, done, interview_id").eq("application_id", id),
    supabase.from("application_drafts").select("kind, status, flags, flags_acknowledged_at").eq("application_id", id).neq("status", "discarded"),
    a.vacancy_id ? supabase.from("vacancies").select("status").eq("id", a.vacancy_id).single() : Promise.resolve({ data: null }),
  ]);
  const message = (drafts ?? []).filter((d) => ["cover_letter", "speculative_email", "recruiter_intro"].includes(d.kind));
  const blockers = (((a.research_snapshot ?? {}) as { blockers?: { text: string }[] }).blockers ?? []).map((b) => b.text);
  return {
    app: a,
    result: applicationReadiness({
      now: new Date(), deadline: a.deadline_at ? new Date(a.deadline_at) : null, openRequiredChecklist: (items ?? []).filter((c) => c.required && !c.done && !c.interview_id).map((c) => c.label),
      cvSelected: !!a.cv_document_id, recipientKnown: !!a.recipient, methodKnown: !!a.submitted_via || !!a.recipient, messageFinal: message.some((d) => d.status === "final") || !!a.cover_letter_text,
      messageRequired: true, unacknowledgedDraftFlags: (drafts ?? []).filter((d) => ((d.flags ?? []) as unknown[]).length > 0 && !d.flags_acknowledged_at && d.status !== "final").length,
      stage2Blockers: blockers, listingClosed: !!v && ["closed", "filled", "withdrawn"].includes(v.status),
    }),
  };
}

export async function markReadyForReview(id: string) {
  const { supabase } = await requireUser();
  const { app, result } = await readiness(supabase, id);
  if (!result.ready) throw new Error(`Not ready yet: ${result.issues.filter((i) => i.severity === "blocker").map((i) => i.text).join(" ")}`);
  const { error } = await supabase.from("applications").update({ stage: "ready_to_submit" }).eq("id", id);
  if (error) throw new Error(error.message);
  await log(supabase, app, { type: "note", subject: "Marked ready for review", body: result.issues.length ? `Open warnings: ${result.issues.map((i) => i.text).join(" ")}` : null });
  refresh(id);
}
export async function backToPreparing(id: string) { const { supabase } = await requireUser(); const { error } = await supabase.from("applications").update({ stage: "preparing" }).eq("id", id).in("stage", ["ready_to_submit", "selected"]); if (error) throw new Error(error.message); refresh(id); }

/**
 * Records a submission Erin has made. The confirmation box is required, and the documents and wording sent are frozen into a snapshot that
 * later edits to the base CV or the working draft cannot change.
 */
export async function confirmSubmission(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  if (formData.get("confirm") !== "on") throw new Error("Tick the box to confirm that you have actually submitted this application.");
  const a = await getApp(supabase, id);
  if (a.submission_confirmed_at) throw new Error("This submission is already confirmed.");
  const at = s(formData, "submitted_at"), method = s(formData, "method"), recipient = s(formData, "recipient") ?? a.recipient;
  if (!at || !method || !recipient) throw new Error("Give the date, the method and the recipient or portal.");
  const when = new Date(at);
  if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 5 * 60_000) throw new Error("The submission date cannot be in the future.");
  const evidence = s(formData, "evidence"), ref = s(formData, "confirmation_ref"), linked = s(formData, "activity_id");
  let confirmedBy: "user" | "integration" = "user";
  if (linked) {
    const { data: act } = await supabase.from("activities").select("origin, delivery_result, application_id, sent_at").eq("id", linked).single();
    if (!act || act.application_id !== id || act.origin !== "synced" || !["sent", "delivered"].includes(act.delivery_result)) throw new Error("That email is not a confirmed, synchronised send for this application.");
    confirmedBy = "integration";
  }
  const ids = [a.cv_document_id, a.portfolio_document_id, a.cover_letter_document_id].filter((x): x is string => !!x);
  const { data: docs } = ids.length ? await supabase.from("documents").select("id, kind, version_label, sha256, file_name, storage_path").in("id", ids) : { data: [] };
  const { data: finals } = await supabase.from("application_drafts").select("id, kind, subject, body, question").eq("application_id", id).eq("status", "final");
  const snapshot = {
    submitted_at: when.toISOString(), method, recipient, confirmed_by: confirmedBy,
    documents: (docs ?? []).map((d) => ({ document_id: d.id, kind: d.kind, version_label: d.version_label, sha256: d.sha256, file_name: d.file_name, storage_path: d.storage_path })),
    cover_letter_text: a.cover_letter_text, answers: a.application_answers, drafts: finals ?? [], portfolio_projects: a.portfolio_projects,
  };
  const { data: act } = await supabase.from("activities").insert({
    employer_id: a.employer_id, application_id: id, vacancy_id: a.vacancy_id, activity_type: "application_submitted", direction: "outbound", channel: method === "email" ? "email" : "portal", subject: `Submitted via ${method} to ${recipient}`,
    body_text: [ref ? `Confirmation reference: ${ref}` : null, evidence].filter(Boolean).join("\n") || null, delivery_result: "sent", sent_at: when.toISOString(), occurred_at: when.toISOString(), attachments: snapshot.documents as Json,
    recipient_email: method === "email" ? recipient : null, origin: "manual", confirmation: "user",
  }).select("id").single();
  const { error } = await supabase.from("applications").update({
    stage: "submitted", submitted_at: when.toISOString(), submitted_via: method, submitted_to: recipient, confirmation_ref: ref, submission_evidence: evidence, submission_confirmed_at: nowIso(), submission_confirmed_by: confirmedBy,
    submitted_snapshot: snapshot as unknown as Json, documents_snapshot: snapshot.documents as unknown as Json, confirmation_email_activity_id: linked ?? act?.id ?? null, next_action: "Await a response",
  }).eq("id", id);
  if (error) throw new Error(`Could not record the submission: ${error.message}`);
  await requestJob("followups.generate", {}, "followups:now");
  refresh(id);
}

export async function correctSubmission(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  const reason = s(formData, "reason");
  if (!reason) throw new Error("A reason is required.");
  const { error } = await supabase.rpc("fn_retract_submission", { p_application_id: id, p_reason: reason });
  if (error) throw new Error(error.message);
  await supabase.from("application_followups").update({ status: "dismissed", dismissed_at: nowIso() }).eq("application_id", id).in("status", ["open", "snoozed"]);
  refresh(id);
}

// ---------------------------------------------------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------------------------------------------------

export async function addFollowUp(applicationId: string, formData: FormData) {
  const { supabase } = await requireUser();
  const due = s(formData, "due_at"), title = s(formData, "title");
  if (!due || !title) throw new Error("Give a title and a date.");
  const kind = (s(formData, "kind") ?? "custom") as "custom" | "info_requested" | "awaiting_response";
  const { error } = await supabase.from("application_followups").insert({ application_id: applicationId, kind, title, due_at: iso(due)!, basis: "user_set", basis_note: kind === "info_requested" ? "The employer asked for more information." : "A date you set." });
  if (error) throw new Error(error.message);
  refresh(applicationId);
}
export async function completeFollowUp(id: string, applicationId: string, formData: FormData) {
  const { supabase } = await requireUser();
  const a = await getApp(supabase, applicationId);
  const { data: f, error } = await supabase.from("application_followups").update({ status: "done", completed_at: nowIso() }).eq("id", id).select("kind, title").single();
  if (error) throw new Error(error.message);
  if (formData.get("i_sent_one") === "on") await log(supabase, a, { type: "follow_up", subject: `Follow-up sent: ${f.title}`, body: s(formData, "note"), direction: "outbound", channel: s(formData, "channel") ?? "email" });
  else if (s(formData, "note")) await log(supabase, a, { type: "note", subject: `Reminder completed: ${f.title}`, body: s(formData, "note") });
  await requestJob("followups.generate", {}, "followups:now");
  refresh(applicationId);
}
export async function snoozeFollowUp(id: string, applicationId: string, days: number) {
  const { supabase } = await requireUser();
  const until = new Date(Date.now() + days * 86_400_000).toISOString();
  const { error } = await supabase.from("application_followups").update({ status: "snoozed", snoozed_until: until }).eq("id", id);
  if (error) throw new Error(error.message);
  refresh(applicationId);
}
export async function rescheduleFollowUp(id: string, applicationId: string, formData: FormData) {
  const { supabase } = await requireUser();
  const due = s(formData, "due_at");
  if (!due) throw new Error("Choose a date.");
  const { error } = await supabase.from("application_followups").update({ due_at: iso(due)!, basis: "user_set", basis_note: "A date you set.", status: "open", snoozed_until: null }).eq("id", id);
  if (error) throw new Error(error.message);
  refresh(applicationId);
}
export async function dismissFollowUp(id: string, applicationId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("application_followups").update({ status: "dismissed", dismissed_at: nowIso() }).eq("id", id);
  if (error) throw new Error(error.message);
  refresh(applicationId);
}

// ---------------------------------------------------------------------------------------------------------------------
// Interviews and assessments
// ---------------------------------------------------------------------------------------------------------------------

export async function addInterview(formData: FormData) {
  const { supabase } = await requireUser();
  const applicationId = s(formData, "application_id")!;
  const a = await getApp(supabase, applicationId);
  const kind = s(formData, "kind") === "assessment" ? "assessment" : "interview";
  const { data: last } = await supabase.from("interviews").select("round").eq("application_id", applicationId).order("round", { ascending: false }).limit(1).maybeSingle();
  const scheduled = iso(s(formData, "scheduled_at"));
  const { data: created, error } = await supabase.from("interviews").insert({
    application_id: applicationId, round: (last?.round ?? 0) + 1, kind, title: s(formData, "title"), scheduled_at: scheduled, deadline_at: iso(s(formData, "deadline_at")), duration_minutes: s(formData, "duration_minutes") ? Number(s(formData, "duration_minutes")) : null,
    format: (s(formData, "format") ?? (kind === "assessment" ? "assessment" : "in_person")) as "phone" | "video" | "in_person" | "portfolio_review" | "assessment", location: s(formData, "location"), interviewers: s(formData, "interviewers"),
    contact_details: s(formData, "contact_details"), instructions: s(formData, "instructions"), prep_notes: s(formData, "prep_notes"), questions_to_ask: s(formData, "questions_to_ask"),
  }).select("id").single();
  if (error) throw new Error(error.message);
  await supabase.from("application_checklist_items").insert(interviewChecklist(kind).map((c) => ({ application_id: applicationId, interview_id: created.id, kind: c.kind, label: c.label, required: c.required, sort: c.sort })));
  await log(supabase, a, { type: kind === "assessment" ? "assessment_request" : "interview_invitation", subject: `${kind === "assessment" ? "Assessment" : "Interview"} recorded${s(formData, "title") ? `: ${s(formData, "title")}` : ""}`, body: s(formData, "instructions"), direction: "inbound", at: nowIso() });
  // Recording an invitation is evidence that the process has moved on; submission must already be confirmed for the stage to change.
  if (a.submission_confirmed_at && ["submitted", "awaiting_response", "acknowledged", "shortlisted", "interview_1", "further_interview", "assessment"].includes(a.stage)) {
    const target: ApplicationStage = kind === "assessment" ? "assessment" : (last?.round ?? 0) === 0 && !["interview_1", "further_interview"].includes(a.stage) ? "interview_1" : "further_interview";
    await supabase.from("applications").update({ stage: target }).eq("id", applicationId);
  }
  refresh(applicationId);
}
export async function updateInterview(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  const patch: TablesUpdate<"interviews"> = {};
  for (const f of ["title", "location", "interviewers", "contact_details", "instructions", "prep_notes", "questions_to_ask", "questions_asked", "notes", "feedback", "outcome", "format"] as const) if (formData.has(f)) (patch as Record<string, unknown>)[f] = s(formData, f);
  for (const f of ["scheduled_at", "deadline_at"] as const) if (formData.has(f)) (patch as Record<string, unknown>)[f] = iso(s(formData, f));
  if (formData.has("duration_minutes")) patch.duration_minutes = s(formData, "duration_minutes") ? Number(s(formData, "duration_minutes")) : null;
  const { data, error } = await supabase.from("interviews").update(patch).eq("id", id).select("application_id").single();
  if (error) throw new Error(error.message);
  refresh(data.application_id);
}
export async function markThankYouSent(id: string, applicationId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("interviews").update({ thank_you_sent_at: nowIso() }).eq("id", id);
  if (error) throw new Error(error.message);
  await supabase.from("application_followups").update({ status: "done", completed_at: nowIso() }).eq("interview_id", id).eq("kind", "thank_you").in("status", ["open", "snoozed"]);
  const a = await getApp(supabase, applicationId);
  await log(supabase, a, { type: "follow_up", subject: "Thank-you message sent after the interview (logged by you)", direction: "outbound" });
  refresh(applicationId);
}

// ---------------------------------------------------------------------------------------------------------------------
// Outcomes, and logging interactions by hand
// ---------------------------------------------------------------------------------------------------------------------

export async function recordOutcome(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  const stage = s(formData, "stage") as ApplicationStage | null;
  if (!stage || ![...OUTCOME_STAGES, "offer_received"].includes(stage)) throw new Error("Choose an outcome.");
  const a = await getApp(supabase, id);
  if (["offer_accepted", "offer_declined", "withdrawn"].includes(stage) && formData.get("confirm") !== "on") throw new Error("Tick the box to confirm this decision: it is yours to make.");
  const feedback = s(formData, "feedback"), reason = s(formData, "reason");
  const patch: TablesUpdate<"applications"> = { stage, feedback: feedback ?? a.feedback, outcome_reason: reason ?? a.outcome_reason, lessons_learned: s(formData, "lessons") ?? a.lessons_learned };
  const when = s(formData, "outcome_at");
  if (stage !== "offer_received") patch.outcome_at = when ? new Date(when).toISOString() : nowIso();
  if (stage === "offer_received") {
    patch.offer = { salary: s(formData, "offer_salary"), notes: s(formData, "offer_notes"), start_date: s(formData, "offer_start") } as Json;
    patch.offer_decision_deadline = iso(s(formData, "offer_deadline"));
  }
  const { error } = await supabase.from("applications").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  const label = { offer_received: "Offer received", offer_accepted: "Offer accepted", offer_declined: "Offer declined", rejected: "Rejected by the employer", withdrawn: "Withdrawn by me", vacancy_closed: "Vacancy closed, no known individual outcome", closed_without_response: "No response after my follow-ups" }[stage as string] ?? stage;
  await log(supabase, a, { type: stage === "offer_received" ? "offer" : "employer_feedback", subject: label, body: [feedback, reason].filter(Boolean).join("\n") || null, direction: stage === "withdrawn" || stage === "offer_declined" || stage === "offer_accepted" ? "outbound" : "inbound", at: when ? new Date(when).toISOString() : nowIso() });
  if (stage !== "offer_received") await supabase.from("application_followups").update({ status: "dismissed", dismissed_at: nowIso() }).eq("application_id", id).in("status", ["open", "snoozed"]).neq("kind", "thank_you");
  await requestJob("followups.generate", {}, "followups:now");
  refresh(id);
}

const LOG_TYPES: Record<string, { type: string; direction: "inbound" | "outbound" | "internal"; channel: string }> = {
  email_sent: { type: "email_sent", direction: "outbound", channel: "email" }, email_received: { type: "email_received", direction: "inbound", channel: "email" }, call: { type: "call", direction: "internal", channel: "phone" },
  meeting: { type: "meeting", direction: "internal", channel: "in_person" }, interview_invitation: { type: "interview_invitation", direction: "inbound", channel: "email" }, assessment_request: { type: "assessment_request", direction: "inbound", channel: "email" },
  employer_feedback: { type: "employer_feedback", direction: "inbound", channel: "email" }, follow_up: { type: "follow_up", direction: "outbound", channel: "email" }, note: { type: "note", direction: "internal", channel: "system" },
};
/** A manual timeline entry. It is always shown as "logged by you", never as a synchronised event. */
export async function logInteraction(applicationId: string, formData: FormData) {
  const { supabase } = await requireUser();
  const a = await getApp(supabase, applicationId);
  const t = LOG_TYPES[s(formData, "type") ?? "note"] ?? LOG_TYPES.note!;
  const summary = s(formData, "summary");
  if (!summary) throw new Error("Add a short summary.");
  const doc = s(formData, "document_id");
  await log(supabase, a, { type: t.type, subject: summary, body: s(formData, "details"), direction: t.direction, channel: t.channel, at: iso(s(formData, "occurred_at")), document_ids: doc ? ([{ document_id: doc }] as Json) : [] });
  if (s(formData, "type") === "email_received" && a.submission_confirmed_at && ["submitted", "awaiting_response"].includes(a.stage) && formData.get("is_acknowledgement") === "on") await supabase.from("applications").update({ stage: "acknowledged" }).eq("id", applicationId);
  if (formData.get("asks_for_info") === "on") {
    const due = s(formData, "info_due");
    await supabase.from("application_followups").insert({ application_id: applicationId, kind: "info_requested", title: `Send the information they asked for: ${summary}`, due_at: due ? new Date(due).toISOString() : new Date(Date.now() + 2 * 86_400_000).toISOString(), basis: due ? "employer_stated" : "user_set", basis_note: due ? "A date from the employer's message." : "Default of two days; change it if they gave a date." });
  }
  refresh(applicationId);
}

// ---------------------------------------------------------------------------------------------------------------------
// Drafts. Generating a draft sends nothing; creating an email for approval is a separate step through the outreach approval flow.
// ---------------------------------------------------------------------------------------------------------------------

export async function requestDraft(applicationId: string, formData: FormData) {
  const { supabase } = await requireUser();
  const a = await getApp(supabase, applicationId);
  const kind = s(formData, "kind") ?? "cover_letter";
  if (kind === "answer" && !s(formData, "question")) throw new Error("Paste the question to answer.");
  const { data: d, error } = await supabase.from("application_drafts").insert({ application_id: applicationId, employer_id: a.employer_id, kind, question: s(formData, "question"), title: s(formData, "title"), generation_state: "queued", status: "draft", source: "ai" }).select("id").single();
  if (error) throw new Error(error.message);
  await requestJob("drafts.generate", { draftId: d.id }, `draft:${d.id}`);
  refresh(applicationId);
}
export async function createManualDraft(applicationId: string, formData: FormData) {
  const { supabase } = await requireUser();
  const a = await getApp(supabase, applicationId);
  const { error } = await supabase.from("application_drafts").insert({ application_id: applicationId, employer_id: a.employer_id, kind: s(formData, "kind") ?? "cover_letter", subject: s(formData, "subject"), body: s(formData, "body") ?? "", source: "manual", generation_state: "ready" });
  if (error) throw new Error(error.message);
  refresh(applicationId);
}
export async function saveDraft(draftId: string, applicationId: string, formData: FormData) {
  const { supabase } = await requireUser();
  const { data: d, error } = await supabase.from("application_drafts").select("facts, flags, status").eq("id", draftId).single();
  if (error) throw new Error(error.message);
  if (d.status === "final") throw new Error("This draft is marked final. Reopen it to edit.");
  const body = s(formData, "body") ?? "";
  // Re-check the edited wording. Detail checks run again on the new text; earlier "unsupported claim" flags stay while their text is still there.
  const paras: DraftParagraph[] = body.split(/\n{2,}/).map((t) => ({ text: t, factual: false, fact_ids: [] }));
  const facts = (d.facts ?? []) as unknown as DraftFact[];
  const fresh = checkDraft(paras, facts);
  const kept = ((d.flags ?? []) as { code: string; excerpt: string }[]).filter((f) => f.code === "unsupported_claim" && body.includes(f.excerpt.slice(0, 40)));
  const { error: e2 } = await supabase.from("application_drafts").update({ subject: s(formData, "subject"), body, flags: [...kept, ...fresh] as unknown as Json, flags_acknowledged_at: null, source: "manual" }).eq("id", draftId);
  if (e2) throw new Error(e2.message);
  refresh(applicationId);
}
export async function acknowledgeDraftFlags(draftId: string, applicationId: string) { const { supabase } = await requireUser(); const { error } = await supabase.from("application_drafts").update({ flags_acknowledged_at: nowIso() }).eq("id", draftId); if (error) throw new Error(error.message); refresh(applicationId); }
export async function finaliseDraft(draftId: string, applicationId: string) {
  const { supabase } = await requireUser();
  const { data: d, error } = await supabase.from("application_drafts").select("flags, flags_acknowledged_at, body").eq("id", draftId).single();
  if (error) throw new Error(error.message);
  if (!d.body.trim()) throw new Error("The draft is empty.");
  if (((d.flags ?? []) as unknown[]).length > 0 && !d.flags_acknowledged_at) throw new Error("Check the flagged claims first: verify them or edit them out, then confirm you have checked.");
  const { error: e2 } = await supabase.from("application_drafts").update({ status: "final", finalised_at: nowIso() }).eq("id", draftId);
  if (e2) throw new Error(e2.message);
  refresh(applicationId);
}
export async function reopenDraft(draftId: string, applicationId: string) { const { supabase } = await requireUser(); await supabase.from("application_drafts").update({ status: "draft", finalised_at: null }).eq("id", draftId); refresh(applicationId); }
export async function discardDraft(draftId: string, applicationId: string) { const { supabase } = await requireUser(); await supabase.from("application_drafts").update({ status: "discarded" }).eq("id", draftId); refresh(applicationId); }
export async function useDraftAsCoverLetter(draftId: string, applicationId: string) {
  const { supabase } = await requireUser();
  const a = await getApp(supabase, applicationId);
  if (a.submission_confirmed_at) throw new Error("This application has been submitted; its record cannot be changed.");
  const { data: d, error } = await supabase.from("application_drafts").select("body, status").eq("id", draftId).single();
  if (error) throw new Error(error.message);
  if (d.status !== "final") throw new Error("Mark the draft final first.");
  await supabase.from("applications").update({ cover_letter_text: d.body }).eq("id", applicationId);
  refresh(applicationId);
}

/**
 * Hands a final draft to the existing outreach approval flow: this creates an email *draft for approval*. It is not sent until Erin approves it
 * on the Outreach page, and even then the stop switch, suppression list and caps still apply.
 */
export async function createEmailForApproval(draftId: string, applicationId: string, formData: FormData) {
  const { supabase } = await requireUser();
  const a = await getApp(supabase, applicationId);
  const { data: d, error } = await supabase.from("application_drafts").select("*").eq("id", draftId).single();
  if (error) throw new Error(error.message);
  if (d.status !== "final") throw new Error("Mark the draft final before preparing it for approval.");
  const to = s(formData, "to");
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error("Enter the recipient's email address.");
  const { data: emp } = await supabase.from("employers").select("is_suppressed").eq("id", a.employer_id).single();
  if (emp?.is_suppressed) throw new Error("This employer is on your suppression list.");
  if (a.contact_id) { const { data: c } = await supabase.from("contacts").select("do_not_contact").eq("id", a.contact_id).single(); if (c?.do_not_contact) throw new Error("This contact has asked not to be contacted."); }
  const attachments = [a.cv_document_id, a.portfolio_document_id].filter((x): x is string => !!x);
  const { data: docs } = attachments.length ? await supabase.from("documents").select("id, sha256, file_name, kind").in("id", attachments) : { data: [] };
  const { data: act, error: e2 } = await supabase.from("activities").insert({
    employer_id: a.employer_id, application_id: applicationId, vacancy_id: a.vacancy_id, contact_id: a.contact_id, activity_type: "email_draft_created", direction: "outbound", channel: "email", subject: d.subject ?? "Application", body_text: d.body,
    recipient_email: to, delivery_result: "pending", approval_status: "pending_approval", attachments: (docs ?? []).map((x) => ({ document_id: x.id, sha256: x.sha256, file_name: x.file_name, kind: x.kind })) as Json, provider: "gmail", origin: "manual",
  }).select("id").single();
  if (e2) throw new Error(e2.message);
  await supabase.from("application_drafts").update({ activity_id: act.id }).eq("id", draftId);
  await requestJob("gmail.draft_create", { activityId: act.id, useStoredBody: true }, `draft:${act.id}`);
  refresh(applicationId);
  redirect("/outreach");
}
