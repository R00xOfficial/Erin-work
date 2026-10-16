import { vacancyExtractionSchema, evaluateEligibility, classifyTitle, type VacancyExtraction, type EmploymentType, type VacancyStatus } from "@ajis/shared";
import type { TablesUpdate } from "@ajis/db";
import { db } from "../lib/db.js";
import { runStructured } from "../ai/client.js";
import { loadProfile } from "./scoring.recompute.js";
import type { Job } from "./index.js";

interface Payload { vacancyId: string }
const PROMPT_VERSION = "vacancy-extract-v1";
const SYSTEM = `You extract structured requirements from a job advertisement for an entry-level architecture job seeker. Use only the advertisement text. For every field give {value, evidence_status, quote}: quote the exact phrase that supports the value; use evidence_status "verified_fact" when quoted plainly, "inference" when deduced, "unverified" when the text is silent (value null/unknown). Never guess salaries or deadlines. qualification_required: part1 if RIBA Part 1 / Part I / year-out is the level; part2 if Part 2 / Part II; part3 if qualified/registered architect; technician for technologist/technician qualifications; none if explicitly none; unknown otherwise.`;

export async function aiVacancyExtract(job: Job<Payload>) {
  const { vacancyId } = job.data;
  const { data: v } = await db().from("vacancies").select("*, employers!employer_id(is_suppressed)").eq("id", vacancyId).is("deleted_at", null).maybeSingle();
  if (!v) return { skipped: "missing" };
  if (!v.description_snapshot || v.description_snapshot.length < 80) return { skipped: "no description" };
  const user = `TITLE: ${v.title}\nEMPLOYER (as advertised): ${v.employer_name_raw ?? "unknown"}\nLOCATION: ${v.location_text ?? "unknown"}\nSALARY TEXT: ${v.salary_text ?? "none"}\n\nADVERTISEMENT:\n${v.description_snapshot.slice(0, 12000)}\n\nReturn JSON with keys: employment_type (permanent|fixed_term|temporary|contract|internship|placement|apprenticeship|freelance|part_time|unknown), seniority (entry|junior|mid|senior|unknown), qualification_required (none|part1|part2|part3|technician|other|unknown), experience_years_min, experience_years_max, salary_min, salary_max, salary_period (year|month|week|day|hour|unknown), salary_is_estimate (boolean, top-level), hours_text, benefits[], hybrid_policy (office|hybrid|remote|unknown), software[], skills[], sectors[], responsibilities[], right_to_work_required (bool|null), portfolio_required (bool|null), portfolio_size_limit, application_route (email|portal|ats|agency|linkedin|unknown), application_email, closing_date (YYYY-MM-DD or null), posted_by_agency (bool|null), employer_name_in_text. Every key except salary_is_estimate is {value, evidence_status, quote}.`;
  const result = await runStructured<VacancyExtraction>({ purpose: "vacancy_extraction", entityType: "vacancy", entityId: vacancyId, promptVersion: PROMPT_VERSION, system: SYSTEM, user, schema: vacancyExtractionSchema, maxTokens: 3000 });
  if (!result.ok) return { skipped: result.reason };
  const x = result.data;
  const sourceId = v.source_id;
  for (const [k, c] of Object.entries(x)) {
    if (k === "salary_is_estimate" || typeof c !== "object" || c === null || !("evidence_status" in c)) continue;
    const cl = c as { value: unknown; evidence_status: string; quote?: string | null };
    await db().from("claims").upsert({ entity_type: "vacancy", entity_id: vacancyId, field_name: k, value: cl.value as never, evidence_status: cl.evidence_status as never, source_id: sourceId, quote: cl.quote ?? null, extracted_by: "ai", model: process.env.ANTHROPIC_MODEL ?? null, prompt_version: PROMPT_VERSION }, { onConflict: "entity_type,entity_id,field_name,source_id" });
  }
  // Only quoted facts update the vacancy's requirement fields; inferences stay as claims.
  const fact = <T>(c: { value: T; evidence_status: string }) => (c.evidence_status === "verified_fact" ? c.value : undefined);
  const patch: Record<string, unknown> = {};
  const set = (k: string, val: unknown) => { if (val !== undefined && val !== null) patch[k] = val; };
  set("employment_type", fact(x.employment_type) === "unknown" ? undefined : fact(x.employment_type));
  set("seniority", fact(x.seniority) === "unknown" ? undefined : fact(x.seniority));
  set("qualification_required", fact(x.qualification_required) === "unknown" ? undefined : fact(x.qualification_required));
  set("experience_years_min", fact(x.experience_years_min));
  set("experience_years_max", fact(x.experience_years_max));
  set("salary_min", fact(x.salary_min));
  set("salary_max", fact(x.salary_max));
  set("salary_period", fact(x.salary_period) === "unknown" ? undefined : fact(x.salary_period));
  set("hours_text", fact(x.hours_text));
  set("benefits", fact(x.benefits));
  set("hybrid_policy", fact(x.hybrid_policy) === "unknown" ? undefined : fact(x.hybrid_policy));
  set("software_requested", x.software.value);
  set("skills_requested", x.skills.value);
  set("sectors_requested", x.sectors.value);
  set("responsibilities", x.responsibilities.value);
  set("right_to_work_required", fact(x.right_to_work_required));
  set("portfolio_required", fact(x.portfolio_required));
  set("portfolio_requirements", fact(x.portfolio_size_limit));
  set("application_route", fact(x.application_route) === "unknown" ? undefined : fact(x.application_route));
  set("application_email", fact(x.application_email));
  if (fact(x.closing_date)) patch.closing_at = new Date(`${fact(x.closing_date)}T23:59:00Z`).toISOString();
  if (x.salary_is_estimate) patch.salary_is_estimate = true;
  if (!v.employer_name_raw && fact(x.employer_name_in_text)) patch.employer_name_raw = fact(x.employer_name_in_text);
  if (fact(x.posted_by_agency) === true && v.employer_match_status === "pending") patch.employer_match_status = "agency_anonymised";
  if (Object.keys(patch).length) await db().from("vacancies").update(patch as TablesUpdate<"vacancies">).eq("id", vacancyId);
  // Re-run eligibility with the new facts.
  const { data: v2 } = await db().from("vacancies").select("*").eq("id", vacancyId).single();
  if (!v2) return { skipped: "vacancy vanished" };
  const prof = await loadProfile();
  const elig = evaluateEligibility({
    title: v2.title, status: v2.status as VacancyStatus, qualificationRequired: v2.qualification_required, experienceYearsMin: v2.experience_years_min, employmentType: v2.employment_type as EmploymentType,
    salaryMinGbpPerYear: v2.salary_min != null && (v2.salary_period === "year" || v2.salary_period === "unknown") ? Number(v2.salary_min) : null, requiresExistingRightToWork: v2.right_to_work_required === true,
    publicTransportMinutes: null, carMinutes: null, isRemote: v2.hybrid_policy === "remote", employerSuppressed: (v.employers as { is_suppressed: boolean } | null)?.is_suppressed ?? false,
  }, prof);
  await db().from("vacancies").update({ eligibility_status: elig.status, hard_flags: elig.hardFlags, eligibility_reasons: elig.reasons, eligibility_checked_at: new Date().toISOString(), role_family: classifyTitle(v2.title).family }).eq("id", vacancyId);
  if (v2.employer_id) await db().from("job_requests").insert({ job_name: "scoring.recompute", payload: { employerId: v2.employer_id }, singleton_key: `score:${v2.employer_id}` });
  return { vacancyId, cached: result.cached, eligibility: elig.status, hardFlags: elig.hardFlags, updated: Object.keys(patch) };
}
