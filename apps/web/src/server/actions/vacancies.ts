"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canonicaliseUrl, urlHash, vacancyInputSchema, vacancyFingerprint, classifyTitle, isAdjacentFamily, qualificationFromText, experienceYearsFromText, evaluateEligibility, normaliseTitle, normaliseCompanyName, type CandidateEligibilityProfile, type VacancyStatus, type EmploymentType } from "@ajis/shared";
import type { TablesUpdate } from "@ajis/db";
import { requireUser } from "@/lib/supabase/server";
import { requestJob } from "@/server/actions/jobs";

const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" && v.trim() !== "" ? v.trim() : null; };

export async function loadCandidateProfile(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"]): Promise<CandidateEligibilityProfile> {
  const { data: p } = await supabase.from("candidate_profile").select("*").eq("id", true).maybeSingle();
  return {
    qualification: p?.qualification ?? "part1_equivalent",
    experienceYears: Number(p?.experience_years ?? 0),
    hasUkRightToWork: p?.has_uk_right_to_work ?? true,
    maxPublicTransportMinutes: p?.max_public_transport_minutes ?? 90,
    maxCarMinutes: p?.max_car_minutes ?? null,
    acceptedEmploymentTypes: (p?.accepted_employment_types ?? []) as EmploymentType[],
    minSalaryGbp: p?.min_salary_gbp ?? null,
    acceptAdjacentEntryRoles: p?.accept_adjacent_entry_roles ?? true,
  };
}

/** Manual vacancy import (paste URL + description). Idempotent on canonical URL. */
export async function importVacancy(formData: FormData) {
  const { supabase } = await requireUser();
  const input = vacancyInputSchema.parse({
    employer_id: s(formData, "employer_id"),
    employer_name: s(formData, "employer_name"),
    title: s(formData, "title"),
    url: s(formData, "url"),
    description: s(formData, "description"),
    location_text: s(formData, "location_text"),
    postcode: s(formData, "postcode"),
    employment_type: s(formData, "employment_type") ?? "unknown",
    closing_at: s(formData, "closing_at"),
    salary_text: s(formData, "salary_text"),
    application_email: s(formData, "application_email"),
    source_label: s(formData, "source_label"),
  });
  const canon = canonicaliseUrl(input.url);
  if (!canon) throw new Error("Invalid URL");
  const hash = urlHash(canon);
  const { data: existing } = await supabase.from("vacancies").select("id").eq("canonical_url_hash", hash).is("deleted_at", null).maybeSingle();
  if (existing) redirect(`/vacancies/${existing.id}?duplicate=1`);

  let employerId = input.employer_id ?? null;
  let employerName = input.employer_name ?? null;
  if (!employerId && employerName) {
    const { data: match } = await supabase.from("employers").select("id").eq("normalised_name", normaliseCompanyName(employerName)).is("deleted_at", null).maybeSingle();
    employerId = match?.id ?? null;
  }
  if (employerId && !employerName) {
    const { data: e } = await supabase.from("employers").select("legal_name").eq("id", employerId).single();
    employerName = e?.legal_name ?? null;
  }
  const { data: src } = await supabase.from("sources").upsert({ url: input.url, url_hash: hash, canonical_url: canon, evidence_type: "job_board", confidence: 70, entity_type: "vacancy", publisher: input.source_label ?? new URL(canon).hostname }, { onConflict: "url_hash" }).select("id").single();
  const cls = classifyTitle(input.title);
  const qual = qualificationFromText(input.description);
  const years = experienceYearsFromText(input.description);
  const { data: manualDef } = await supabase.from("source_definitions").select("id").eq("code", "manual_import").single();
  const profile = await loadCandidateProfile(supabase);
  const elig = evaluateEligibility({
    title: input.title, status: "open", qualificationRequired: qual, experienceYearsMin: years, employmentType: input.employment_type,
    salaryMinGbpPerYear: null, requiresExistingRightToWork: false, publicTransportMinutes: null, carMinutes: null, isRemote: false, employerSuppressed: false,
  }, profile);
  const { data: v, error } = await supabase.from("vacancies").insert({
    employer_id: employerId,
    employer_match_status: employerId ? "matched" : employerName ? "pending" : "unmatched",
    employer_name_raw: employerName,
    title: input.title,
    normalised_title: normaliseTitle(input.title),
    role_family: cls.family,
    is_adjacent: isAdjacentFamily(cls.family),
    canonical_url: canon,
    original_url: input.url,
    source_id: src?.id ?? null,
    source_definition_id: manualDef?.id ?? null,
    discovery_source: input.source_label ?? "manual",
    status: "open",
    employment_type: input.employment_type,
    qualification_required: qual,
    experience_years_min: years,
    seniority: cls.entryLevel ? "entry" : cls.family === "senior_or_unsuitable" ? "senior" : "unknown",
    closing_at: input.closing_at ? new Date(input.closing_at).toISOString() : null,
    salary_text: input.salary_text,
    location_text: input.location_text,
    postcode: input.postcode,
    application_email: input.application_email,
    application_route: input.application_email ? "email" : "unknown",
    description_snapshot: input.description,
    eligibility_status: elig.status,
    hard_flags: elig.hardFlags,
    eligibility_reasons: elig.reasons,
    eligibility_checked_at: new Date().toISOString(),
    dedup_fingerprint: vacancyFingerprint({ employerName, title: input.title, postcode: input.postcode, town: input.location_text }),
    last_verified_at: new Date().toISOString(),
  }).select("id").single();
  if (error) throw new Error(error.message);
  if (src?.id) await supabase.from("sources").update({ entity_id: v.id }).eq("id", src.id);
  if (input.description) await requestJob("ai.vacancy_extract", { vacancyId: v.id }, `extract:${v.id}`);
  if (employerId) {
    await supabase.from("hiring_signals").upsert({ employer_id: employerId, signal_type: "vacancy_posted", strength: "strong", summary: `Vacancy: ${input.title}`, source_id: src?.id ?? null, vacancy_id: v.id, evidence_status: "verified_fact" }, { onConflict: "employer_id,signal_type,source_id,observed_on", ignoreDuplicates: true });
    await requestJob("scoring.recompute", { employerId }, `score:${employerId}`);
  }
  revalidatePath("/vacancies");
  redirect(`/vacancies/${v.id}`);
}

export async function updateVacancy(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  const patch: Record<string, unknown> = {};
  for (const f of ["title", "status", "employment_type", "seniority", "qualification_required", "salary_text", "hours_text", "hybrid_policy", "location_text", "postcode", "application_route", "application_email", "application_url", "notes", "reporting_line", "team_info", "portfolio_requirements", "office_attendance_text"]) {
    if (formData.has(f)) patch[f] = s(formData, f);
  }
  for (const n of ["experience_years_min", "experience_years_max", "salary_min", "salary_max"]) if (formData.has(n)) { const v = s(formData, n); patch[n] = v ? Number(v) : null; }
  for (const d of ["closing_at", "posted_at"]) if (formData.has(d)) { const v = s(formData, d); patch[d] = v ? new Date(v).toISOString() : null; }
  for (const arr of ["software_requested", "skills_requested", "sectors_requested"]) if (formData.has(arr)) patch[arr] = (s(formData, arr) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (formData.has("right_to_work_required")) patch.right_to_work_required = formData.get("right_to_work_required") === "on";
  if (formData.has("employer_id")) { const eid = s(formData, "employer_id"); patch.employer_id = eid; patch.employer_match_status = eid ? "matched" : "unmatched"; }
  if (formData.get("mark_verified") === "on") patch.last_verified_at = new Date().toISOString();
  if (formData.get("mark_reviewed") === "on") patch.reviewed_at = new Date().toISOString();
  const { data: v, error } = await supabase.from("vacancies").update(patch as TablesUpdate<"vacancies">).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  await recheckEligibility(id);
  if (v.employer_id) await requestJob("scoring.recompute", { employerId: v.employer_id }, `score:${v.employer_id}`);
  revalidatePath(`/vacancies/${id}`);
  revalidatePath("/vacancies");
}

export async function recheckEligibility(id: string) {
  const { supabase } = await requireUser();
  const { data: v, error } = await supabase.from("vacancies").select("*, employers!employer_id(is_suppressed)").eq("id", id).single();
  if (error) throw new Error(error.message);
  const profile = await loadCandidateProfile(supabase);
  let pt: number | null = null; let car: number | null = null;
  if (v.office_id) {
    const { data: tt } = await supabase.from("travel_times").select("mode, minutes").eq("office_id", v.office_id);
    pt = tt?.find((t) => t.mode === "public_transport")?.minutes ?? null;
    car = tt?.find((t) => t.mode === "car")?.minutes ?? null;
  } else if (v.employer_id) {
    const { data: tt } = await supabase.from("travel_times").select("mode, minutes, offices!inner(employer_id)").eq("offices.employer_id", v.employer_id);
    const pts = (tt ?? []).filter((t) => t.mode === "public_transport").map((t) => t.minutes);
    const cars = (tt ?? []).filter((t) => t.mode === "car").map((t) => t.minutes);
    pt = pts.length ? Math.min(...pts) : null; car = cars.length ? Math.min(...cars) : null;
  }
  const salaryYear = v.salary_min != null ? (v.salary_period === "year" || v.salary_period === "unknown" ? Number(v.salary_min) : v.salary_period === "month" ? Number(v.salary_min) * 12 : v.salary_period === "day" ? Number(v.salary_min) * 220 : v.salary_period === "hour" ? Number(v.salary_min) * 1600 : null) : null;
  const elig = evaluateEligibility({
    title: v.title, status: v.status as VacancyStatus, qualificationRequired: v.qualification_required, experienceYearsMin: v.experience_years_min,
    employmentType: v.employment_type as EmploymentType, salaryMinGbpPerYear: salaryYear, requiresExistingRightToWork: v.right_to_work_required === true,
    publicTransportMinutes: pt, carMinutes: car, isRemote: v.hybrid_policy === "remote", employerSuppressed: (v.employers as { is_suppressed: boolean } | null)?.is_suppressed ?? false,
  }, profile);
  await supabase.from("vacancies").update({ eligibility_status: elig.status, hard_flags: elig.hardFlags, eligibility_reasons: elig.reasons, eligibility_checked_at: new Date().toISOString(), role_family: classifyTitle(v.title).family, is_adjacent: isAdjacentFamily(classifyTitle(v.title).family) }).eq("id", id);
  revalidatePath(`/vacancies/${id}`);
}

/** Records that the job itself has closed. For "not interested" use dismissVacancy in discovery.ts, which leaves status alone. */
export async function closeVacancy(id: string, status: "closed" | "withdrawn") {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("vacancies").update({ status, reviewed_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/vacancies");
  revalidatePath(`/vacancies/${id}`);
}

export async function markVacancyReviewed(id: string) {
  const { supabase } = await requireUser();
  await supabase.from("vacancies").update({ reviewed_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/vacancies");
  revalidatePath("/");
}

export async function linkVacancyEmployer(id: string, employerId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("vacancies").update({ employer_id: employerId, employer_match_status: "matched" }).eq("id", id);
  if (error) throw new Error(error.message);
  await requestJob("scoring.recompute", { employerId }, `score:${employerId}`);
  revalidatePath(`/vacancies/${id}`);
}

export async function createEmployerFromVacancy(id: string) {
  const { supabase } = await requireUser();
  const { data: v, error } = await supabase.from("vacancies").select("employer_name_raw, location_text, postcode, application_email").eq("id", id).single();
  if (error) throw new Error(error.message);
  if (!v.employer_name_raw) throw new Error("No employer name on this vacancy");
  const { data: e, error: e2 } = await supabase.from("employers").insert({ legal_name: v.employer_name_raw, normalised_name: normaliseCompanyName(v.employer_name_raw), outreach_stage: "awaiting_research", applications_email: v.application_email }).select("id").single();
  if (e2) throw new Error(e2.message);
  await supabase.from("offices").insert({ employer_id: e.id, town: v.location_text, postcode: v.postcode, is_primary: true });
  await supabase.from("vacancies").update({ employer_id: e.id, employer_match_status: "matched" }).eq("id", id);
  await supabase.from("tasks").insert({ title: `Research ${v.employer_name_raw}`, task_type: "research", entity_type: "employer", entity_id: e.id, employer_id: e.id, auto_generated: true, dedupe_key: `research:employer:${e.id}` });
  revalidatePath(`/vacancies/${id}`);
  redirect(`/employers/${e.id}`);
}
