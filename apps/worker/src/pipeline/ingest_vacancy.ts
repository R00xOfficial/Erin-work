import { canonicaliseUrl, urlHash, vacancyFingerprint, normaliseTitle, classifyTitle, qualificationFromText, experienceYearsFromText, evaluateEligibility, matchEmployer, contentHash, VACANCY_DEDUP_WINDOW_DAYS, type EmployerCandidate, type EmploymentType } from "@ajis/shared";
import type { TablesUpdate } from "@ajis/db";
import { db } from "../lib/db.js";
import type { RawVacancy } from "../adapters/types.js";
import { loadProfile } from "../jobs/scoring.recompute.js";

export type IngestOutcome = { outcome: "created" | "updated" | "duplicate" | "rejected"; vacancyId?: string; reason?: string };

let candidateCache: { at: number; list: EmployerCandidate[] } | null = null;
async function employerCandidates(): Promise<EmployerCandidate[]> {
  if (candidateCache && Date.now() - candidateCache.at < 120_000) return candidateCache.list;
  const { data } = await db().from("employers").select("id, normalised_name, companies_house_number, website_domain, employer_aliases(alias)").is("deleted_at", null);
  const list: EmployerCandidate[] = (data ?? []).map((e) => ({ id: e.id, normalisedName: e.normalised_name, companiesHouseNumber: e.companies_house_number, websiteDomain: e.website_domain, aliases: (e.employer_aliases as { alias: string }[]).map((a) => a.alias) }));
  candidateCache = { at: Date.now(), list };
  return list;
}

/**
 * Idempotent vacancy ingestion: canonicalise → hash → upsert → snapshot → fingerprint dedup →
 * employer match → eligibility → enqueue extraction + scoring. Running the same source twice
 * never creates a second row.
 */
export async function ingestVacancy(raw: RawVacancy, src: { sourceDefinitionId: string; sourceCode: string; sourceRunId: string | null; evidenceType?: "job_board" | "recruiter" | "primary_official" }): Promise<IngestOutcome> {
  const canon = canonicaliseUrl(raw.url);
  if (!canon || !raw.title?.trim()) return { outcome: "rejected", reason: "missing url or title" };
  const hash = urlHash(canon);
  const now = new Date().toISOString();
  const { data: source } = await db().from("sources").upsert({ url: raw.url, url_hash: hash, canonical_url: canon, host: new URL(canon).hostname, publisher: src.sourceCode, evidence_type: src.evidenceType ?? "job_board", confidence: 70, entity_type: "vacancy", source_definition_id: src.sourceDefinitionId, last_fetched_at: now, fetch_status: "ok", recheck_interval: "3 days", next_check_at: new Date(Date.now() + 3 * 86_400_000).toISOString() }, { onConflict: "url_hash" }).select("id").single();

  const { data: existing } = await db().from("vacancies").select("id, description_hash, status, employer_id").eq("canonical_url_hash", hash).is("deleted_at", null).maybeSingle();
  const descHash = raw.description ? contentHash(raw.description) : null;
  if (existing) {
    const patch: Record<string, unknown> = { last_checked_at: now, last_verified_at: now, disappeared_at: null };
    if (existing.status === "closed" && !raw.closingAt) patch.status = "open"; // reappeared → verify
    if (raw.description && descHash && descHash !== existing.description_hash) {
      patch.description_snapshot = raw.description; patch.description_hash = descHash; patch.description_snapshot_at = now; patch.description_is_truncated = raw.descriptionIsTruncated;
      await db().from("vacancy_snapshots").upsert({ vacancy_id: existing.id, content_hash: descHash, description: raw.description, raw: raw.raw as never, source_url: raw.url, source_run_id: src.sourceRunId }, { onConflict: "vacancy_id,content_hash", ignoreDuplicates: true });
      await db().from("job_requests").insert({ job_name: "ai.vacancy_extract", payload: { vacancyId: existing.id }, singleton_key: `extract:${existing.id}` });
    }
    if (raw.closingAt) patch.closing_at = raw.closingAt;
    await db().from("vacancies").update(patch as TablesUpdate<"vacancies">).eq("id", existing.id);
    if (existing.status === "closed" && existing.employer_id) {
      await db().from("hiring_signals").upsert({ employer_id: existing.employer_id, signal_type: "vacancy_reappeared", strength: "moderate", summary: `Vacancy reappeared: ${raw.title}`, source_id: source?.id ?? null, vacancy_id: existing.id, evidence_status: "verified_fact" }, { onConflict: "employer_id,signal_type,source_id,observed_on", ignoreDuplicates: true });
    }
    return { outcome: "updated", vacancyId: existing.id };
  }

  // Employer match
  let employerId: string | null = null;
  let matchStatus: "pending" | "matched" | "unmatched" | "agency_anonymised" = raw.postedByAgency ? "agency_anonymised" : "unmatched";
  let agencyId: string | null = null;
  if (raw.employerName) {
    const m = matchEmployer({ name: raw.employerName }, await employerCandidates());
    if (m.kind === "exact") { employerId = m.id; matchStatus = "matched"; }
    else if (m.kind === "fuzzy") { matchStatus = "pending"; }
    if (raw.postedByAgency && employerId) { agencyId = employerId; employerId = null; matchStatus = "agency_anonymised"; }
  }
  // Cross-source duplicate within the window
  const fingerprint = vacancyFingerprint({ employerName: raw.employerName, title: raw.title, postcode: raw.postcode, town: raw.locationText });
  const since = new Date(Date.now() - VACANCY_DEDUP_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: dup } = await db().from("vacancies").select("id, employer_id").eq("dedup_fingerprint", fingerprint).gte("first_seen_at", since).is("deleted_at", null).is("duplicate_of_vacancy_id", null).limit(1).maybeSingle();
  const cls = classifyTitle(raw.title);
  const qual = qualificationFromText(raw.description);
  const years = experienceYearsFromText(raw.description);
  const prof = await loadProfile();
  const elig = evaluateEligibility({ title: raw.title, status: "open", qualificationRequired: qual, experienceYearsMin: years, employmentType: raw.employmentType, salaryMinGbpPerYear: raw.salaryMin, requiresExistingRightToWork: false, publicTransportMinutes: null, carMinutes: null, isRemote: false, employerSuppressed: false }, prof);
  const { data: v, error } = await db().from("vacancies").insert({
    employer_id: employerId ?? dup?.employer_id ?? null,
    employer_match_status: employerId ? "matched" : matchStatus,
    employer_name_raw: raw.employerName,
    posted_by_agency_id: agencyId,
    title: raw.title.trim(),
    normalised_title: normaliseTitle(raw.title),
    role_family: cls.family,
    canonical_url: canon,
    original_url: raw.url,
    source_definition_id: src.sourceDefinitionId,
    source_id: source?.id ?? null,
    discovery_source: src.sourceCode,
    external_ref: raw.externalRef,
    posted_at: raw.postedAt,
    closing_at: raw.closingAt,
    last_verified_at: now,
    last_checked_at: now,
    status: "open",
    employment_type: raw.employmentType,
    seniority: cls.entryLevel ? "entry" : cls.family === "senior_or_unsuitable" ? "senior" : "unknown",
    qualification_required: qual !== "unknown" ? qual : cls.impliedQualification,
    experience_years_min: years,
    salary_min: raw.salaryMin, salary_max: raw.salaryMax, salary_text: raw.salaryText, salary_period: raw.salaryMin != null ? "year" : "unknown",
    location_text: raw.locationText, postcode: raw.postcode, lat: raw.lat, lng: raw.lng,
    application_url: raw.applicationUrl, application_email: raw.applicationEmail, application_route: raw.applicationEmail ? "email" : raw.postedByAgency ? "agency" : raw.applicationUrl ? "portal" : "unknown",
    description_snapshot: raw.description, description_hash: descHash, description_snapshot_at: raw.description ? now : null, description_is_truncated: raw.descriptionIsTruncated,
    eligibility_status: elig.status, hard_flags: elig.hardFlags, eligibility_reasons: elig.reasons, eligibility_checked_at: now,
    dedup_fingerprint: fingerprint,
    duplicate_of_vacancy_id: dup?.id ?? null,
  }).select("id").single();
  if (error) {
    if (error.code === "23505") return { outcome: "duplicate", reason: "canonical url already present" };
    return { outcome: "rejected", reason: error.message };
  }
  if (source?.id) await db().from("sources").update({ entity_id: v.id }).eq("id", source.id);
  if (raw.description && raw.description.length > 80) await db().from("vacancy_snapshots").insert({ vacancy_id: v.id, content_hash: descHash!, description: raw.description, raw: raw.raw as never, source_url: raw.url, source_run_id: src.sourceRunId });
  if (dup) return { outcome: "duplicate", vacancyId: v.id, reason: `same role seen on ${src.sourceCode} within ${VACANCY_DEDUP_WINDOW_DAYS} days` };
  if (raw.description && raw.description.length > 80) await db().from("job_requests").insert({ job_name: "ai.vacancy_extract", payload: { vacancyId: v.id }, singleton_key: `extract:${v.id}` });
  if (employerId) {
    await db().from("hiring_signals").upsert({ employer_id: employerId, signal_type: "vacancy_posted", strength: "strong", summary: `Vacancy: ${raw.title}`, source_id: source?.id ?? null, vacancy_id: v.id, evidence_status: "verified_fact" }, { onConflict: "employer_id,signal_type,source_id,observed_on", ignoreDuplicates: true });
    await db().from("job_requests").insert({ job_name: "scoring.recompute", payload: { employerId }, singleton_key: `score:${employerId}` });
  } else if (raw.employerName && !raw.postedByAgency && matchStatus !== "matched") {
    await db().from("tasks").insert({ title: `New vacancy from unknown employer "${raw.employerName}" — add employer or link`, task_type: "verify_vacancy", entity_type: "vacancy", entity_id: v.id, auto_generated: true, dedupe_key: `unmatched_employer:${normaliseTitle(raw.employerName)}`, priority: elig.status === "eligible" ? "high" : "low" });
  }
  return { outcome: "created", vacancyId: v.id };
}
