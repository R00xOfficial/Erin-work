"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";

const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" && v.trim() !== "" ? v.trim() : null; };
const list = (v: string | null) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export async function saveResearchNote(formData: FormData) {
  const { supabase } = await requireUser();
  const employerId = s(formData, "employer_id")!;
  const vacancyId = s(formData, "vacancy_id");
  const row = {
    employer_id: employerId,
    vacancy_id: vacancyId,
    why_fit: s(formData, "why_fit"),
    relevant_project: s(formData, "relevant_project"),
    design_interest: s(formData, "design_interest"),
    matching_skills: list(s(formData, "matching_skills")),
    gaps: list(s(formData, "gaps")),
    hiring_signal_summary: s(formData, "hiring_signal_summary"),
    best_contact_id: s(formData, "best_contact_id"),
    best_contact_reason: s(formData, "best_contact_reason"),
    personalised_opener: s(formData, "personalised_opener"),
    proposed_ask: s(formData, "proposed_ask"),
    evidence_status: (s(formData, "evidence_status") ?? "unverified") as "verified_fact" | "source_supported_summary" | "inference" | "unverified" | "conflicting_sources",
    reviewed_at: formData.get("reviewed") === "on" ? new Date().toISOString() : null,
    is_current: true,
  };
  let q = supabase.from("research_notes").select("id").eq("employer_id", employerId).eq("is_current", true);
  q = vacancyId ? q.eq("vacancy_id", vacancyId) : q.is("vacancy_id", null);
  const { data: existing } = await q.maybeSingle();
  const { error } = existing
    ? await supabase.from("research_notes").update(row).eq("id", existing.id)
    : await supabase.from("research_notes").insert(row);
  if (error) throw new Error(error.message);
  revalidatePath(`/employers/${employerId}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Stage 2: research and assessment actions. None of these contact an employer or send anything.
// ---------------------------------------------------------------------------------------------------------------------
import { requestJob } from "@/server/actions/jobs";
import { queueResearch } from "@/server/research-queue";

type Kind = "vacancy" | "employer";
type Client = Awaited<ReturnType<typeof requireUser>>["supabase"];
const nowIso = () => new Date().toISOString();
const table = (k: Kind) => (k === "vacancy" ? "vacancies" : "employers");
const stale = (k: Kind, id: string) => { revalidatePath("/research"); revalidatePath(`/research/${k === "vacancy" ? "vacancies" : "employers"}/${id}`); revalidatePath(k === "vacancy" ? `/vacancies/${id}` : `/employers/${id}`); };

export async function requestVacancyResearch(id: string, force: boolean) { const { supabase } = await requireUser(); await queueResearch(supabase, "vacancy", id, { force }); stale("vacancy", id); }
export async function requestEmployerResearch(id: string, force: boolean) { const { supabase } = await requireUser(); await queueResearch(supabase, "employer", id, { force }); stale("employer", id); }

export async function retryRun(runId: string) {
  const { supabase } = await requireUser();
  const { data: r, error } = await supabase.from("research_runs").select("kind, employer_id, vacancy_id").eq("id", runId).single();
  if (error) throw new Error(error.message);
  const kind = r.kind as Kind;
  const id = (kind === "vacancy" ? r.vacancy_id : r.employer_id)!;
  await queueResearch(supabase, kind, id, { force: true, trigger: "retry", retryOf: runId });
  stale(kind, id);
}

async function recompute(kind: Kind, id: string) {
  await requestJob("assessments.recompute", { [kind === "vacancy" ? "vacancyId" : "employerId"]: id, reason: "record changed" }, `assess:${kind}:${id}`);
}

export async function markAssessmentReviewed(assessmentId: string, formData: FormData) {
  const { supabase } = await requireUser();
  const { data: a, error } = await supabase.from("assessments").update({ reviewed_at: nowIso(), review_note: s(formData, "review_note") }).eq("id", assessmentId).eq("is_current", true).select("kind, vacancy_id, employer_id").single();
  if (error) throw new Error(error.message);
  const kind = a.kind as Kind;
  const id = (kind === "vacancy" ? a.vacancy_id : a.employer_id)!;
  await supabase.from(table(kind)).update({ research_state: "reviewed" }).eq("id", id);
  stale(kind, id);
}

/** Erin's decision on one extracted requirement. Confirmed/corrected findings outrank the model; disputed ones are set aside and flagged. */
export async function reviewRequirement(reqId: string, decision: "confirmed" | "disputed" | "rejected" | "unreviewed", formData: FormData) {
  const { supabase } = await requireUser();
  const { data: r, error } = await supabase.from("vacancy_requirements").update({ review: decision, review_note: s(formData, "note") }).eq("id", reqId).select("vacancy_id").single();
  if (error) throw new Error(error.message);
  await recompute("vacancy", r.vacancy_id);
  stale("vacancy", r.vacancy_id);
}

export async function correctRequirement(reqId: string, formData: FormData) {
  const { supabase } = await requireUser();
  const { data: cur, error: e0 } = await supabase.from("vacancy_requirements").select("*").eq("id", reqId).single();
  if (e0) throw new Error(e0.message);
  const text = s(formData, "text") ?? cur.text;
  const patch = {
    text, normalised_text: text.toLowerCase().replace(/\s+/g, " ").trim(),
    kind: (s(formData, "kind") ?? cur.kind) as typeof cur.kind, necessity: (s(formData, "necessity") ?? cur.necessity) as typeof cur.necessity,
    review: "corrected" as const, review_note: s(formData, "note"), original: cur.original ?? { text: cur.text, kind: cur.kind, necessity: cur.necessity, quote: cur.quote },
  };
  const { error } = await supabase.from("vacancy_requirements").update(patch).eq("id", reqId);
  if (error) throw new Error(error.message);
  await recompute("vacancy", cur.vacancy_id);
  stale("vacancy", cur.vacancy_id);
}

export async function addRequirement(vacancyId: string, formData: FormData) {
  const { supabase } = await requireUser();
  const text = s(formData, "text");
  if (!text) return;
  const { error } = await supabase.from("vacancy_requirements").insert({
    vacancy_id: vacancyId, kind: (s(formData, "kind") ?? "other") as "other", necessity: (s(formData, "necessity") ?? "essential") as "essential", text, normalised_text: text.toLowerCase().replace(/\s+/g, " ").trim(),
    quote: s(formData, "quote"), extracted_by: "human", evidence_status: "verified_fact", review: "confirmed", review_note: "Added by you",
  });
  if (error) throw new Error(error.message);
  await recompute("vacancy", vacancyId);
  stale("vacancy", vacancyId);
}

/** Only a reviewed, complete, conflict-free assessment on an approved profile can go to Stage 3 (the same rule the queue's "ready" flag uses). */
export async function saveForStage3(kind: Kind, id: string) {
  const { supabase } = await requireUser();
  const view = kind === "vacancy" ? "v_research_vacancies" : "v_research_employers";
  const { data: row } = await supabase.from(view).select("ready_for_stage3, reviewed_at, profile_approved, completeness, conflict_count").eq("id", id).maybeSingle();
  if (!row?.ready_for_stage3) {
    const why = !row ? "no assessment yet" : !row.reviewed_at ? "the assessment has not been reviewed" : !row.profile_approved ? "your profile is not approved" : (row.completeness ?? 0) < 60 ? "research is under 60% complete" : (row.conflict_count ?? 0) > 0 ? "sources conflict" : "an open dispute, a failed run or a closed record";
    throw new Error(`Not ready for Stage 3: ${why}.`);
  }
  await supabase.from(table(kind)).update({ stage3_saved_at: nowIso() }).eq("id", id);
  await requestJob("priorities.recompute", kind === "vacancy" ? { vacancyId: id, reason: "saved for Stage 3" } : { employerId: id, reason: "saved for Stage 3" }, `prio:${kind}:${id}`);
  await requestJob("planner.generate", { reason: "saved for Stage 3" }, "planner:now");
  revalidatePath("/priorities");
  stale(kind, id);
}

export async function returnToDiscovery(kind: Kind, id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from(table(kind)).update({ discovery_state: "new", reviewed_at: null, saved_at: null, stage3_saved_at: null, research_state: "none", returned_to_discovery_at: nowIso() }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/discovery");
  stale(kind, id);
}
