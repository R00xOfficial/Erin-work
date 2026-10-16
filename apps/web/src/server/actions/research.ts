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
