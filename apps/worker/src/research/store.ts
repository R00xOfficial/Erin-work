import {
  DEFAULT_EMPLOYER_WEIGHTS, DEFAULT_VACANCY_WEIGHTS, EMPLOYER_CRITERIA, VACANCY_CRITERIA, assessEmployer, assessVacancy, inputsHash,
  type AssessmentProfile, type AssessmentResult, type Conflict, type EmployerAssessmentInput, type EmployerWeights, type EmploymentType, type RequirementInput, type RoleFamily,
  type VacancyAssessmentInput, type VacancyWeights, type WorkingArrangement,
} from "@ajis/shared";
import type { Json } from "@ajis/db";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";

const ENTRY_FAMILIES = new Set(["part1_assistant", "graduate_assistant", "placement_internship", "bim_cad", "technician", "technologist", "design_coordinator", "urban_design_junior", "planning_assistant", "visualisation", "other_entry"]);
const OPEN = ["open", "closing_soon", "unverified"];

export async function loadAssessmentProfile(): Promise<AssessmentProfile> {
  const { data: p } = await db().from("candidate_profile").select("*").eq("id", true).maybeSingle();
  return {
    version: p?.profile_version ?? 1,
    approved: p != null && p.approved_version === p.profile_version,
    qualification: p?.qualification ?? "part1_equivalent",
    experienceYears: Number(p?.experience_years ?? 0),
    software: p?.software ?? [],
    skills: p?.skills ?? [],
    sectorInterests: p?.sector_interests ?? [],
    targetRoleFamilies: (p?.target_role_families ?? []) as RoleFamily[],
    acceptAdjacentEntryRoles: p?.accept_adjacent_entry_roles ?? true,
    acceptedEmploymentTypes: (p?.accepted_employment_types ?? []) as EmploymentType[],
    workingArrangementPreference: (p?.working_arrangement_preference ?? "unknown") as WorkingArrangement,
    maxPublicTransportMinutes: p?.max_public_transport_minutes ?? 90,
    maxCarMinutes: p?.max_car_minutes ?? null,
    minSalaryGbp: p?.min_salary_gbp ?? null,
    hasUkRightToWork: p?.has_uk_right_to_work ?? true,
  };
}

function validWeights<T extends string>(raw: unknown, keys: readonly T[], fallback: Record<T, number>): Record<T, number> {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out = {} as Record<T, number>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) { logger.warn({ key: k }, "invalid assessment weight; using defaults"); return fallback; }
    out[k] = v;
  }
  return out;
}

export async function loadWeights(kind: "vacancy"): Promise<{ version: number; weights: VacancyWeights }>;
export async function loadWeights(kind: "employer"): Promise<{ version: number; weights: EmployerWeights }>;
export async function loadWeights(kind: "vacancy" | "employer") {
  const { data } = await db().from("assessment_weights").select("version, weights").eq("kind", kind).eq("is_active", true).maybeSingle();
  if (!data) throw new Error(`No active ${kind} assessment weights`);
  return kind === "vacancy"
    ? { version: data.version, weights: validWeights(data.weights, VACANCY_CRITERIA, DEFAULT_VACANCY_WEIGHTS) }
    : { version: data.version, weights: validWeights(data.weights, EMPLOYER_CRITERIA, DEFAULT_EMPLOYER_WEIGHTS) };
}

export interface RunStats { tried: number; failed: number; officialRead: boolean }
/** What the most recent finished research run managed to read, taken from its own step log. */
export async function latestRunStats(kind: "vacancy" | "employer", id: string): Promise<RunStats> {
  const col = kind === "vacancy" ? "vacancy_id" : "employer_id";
  let q = db().from("research_runs").select("steps").eq("kind", kind).eq(col, id).in("status", ["succeeded", "partial", "failed"]).order("created_at", { ascending: false }).limit(1);
  if (kind === "employer") q = q.is("vacancy_id", null);
  const { data } = await q.maybeSingle();
  const attempts = ((data?.steps ?? []) as { sources?: { ok: boolean; official?: boolean }[] }[]).flatMap((s) => s.sources ?? []);
  return { tried: attempts.length, failed: attempts.filter((a) => !a.ok).length, officialRead: attempts.some((a) => a.ok && a.official) };
}

const dayKey = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const sameText = (a: string | null, b: string | null) => !!a && !!b && (a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase()));

/** Disagreements between the canonical listing and the duplicate listings of the same vacancy, plus any claims already marked conflicting. */
async function vacancyConflicts(vacancyId: string, v: { salary_min: number | null; salary_max: number | null; closing_at: string | null; location_text: string | null }): Promise<Conflict[]> {
  const out: Conflict[] = [];
  const { data: dups } = await db().from("vacancies").select("salary_min, salary_max, closing_at, location_text, discovery_source").eq("duplicate_of_vacancy_id", vacancyId).is("deleted_at", null);
  for (const d of dups ?? []) {
    if (v.salary_min != null && d.salary_min != null && Math.abs(Number(v.salary_min) - Number(d.salary_min)) / Number(v.salary_min) > 0.05)
      out.push({ field: "salary", detail: `£${Number(v.salary_min)} on the main listing vs £${Number(d.salary_min)} on ${d.discovery_source ?? "another listing"}` });
    if (v.closing_at && d.closing_at && dayKey(v.closing_at) !== dayKey(d.closing_at))
      out.push({ field: "closing date", detail: `${dayKey(v.closing_at)} vs ${dayKey(d.closing_at)} on ${d.discovery_source ?? "another listing"}` });
    if (v.location_text && d.location_text && !sameText(v.location_text, d.location_text))
      out.push({ field: "location", detail: `"${v.location_text}" vs "${d.location_text}" on ${d.discovery_source ?? "another listing"}` });
  }
  const { data: cl } = await db().from("claims").select("field_name").eq("entity_type", "vacancy").eq("entity_id", vacancyId).eq("is_current", true).eq("evidence_status", "conflicting_sources");
  for (const c of cl ?? []) out.push({ field: c.field_name, detail: "recorded as conflicting between sources" });
  const seen = new Set<string>();
  return out.filter((c) => { const k = `${c.field}|${c.detail}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export async function buildVacancyInput(vacancyId: string): Promise<{ input: VacancyAssessmentInput; employerId: string | null } | null> {
  const { data: v } = await db().from("vacancies").select("*, employers!employer_id(sectors, specialisms, has_graduate_programme, is_suppressed, training_support), sources!source_id(evidence_type)").eq("id", vacancyId).is("deleted_at", null).maybeSingle();
  if (!v) return null;
  const emp = v.employers as { sectors: string[]; specialisms: string[]; has_graduate_programme: "yes" | "no" | "unknown"; is_suppressed: boolean; training_support: string | null } | null;
  const [{ data: reqs }, { data: claims }, { data: aiRun }, stats] = await Promise.all([
    db().from("vacancy_requirements").select("id, kind, necessity, text, quote, evidence_status, review").eq("vacancy_id", vacancyId).eq("is_current", true),
    db().from("claims").select("field_name, value, quote").eq("entity_type", "vacancy").eq("entity_id", vacancyId).eq("is_current", true).like("field_name", "research.%"),
    db().from("ai_runs").select("id").eq("entity_type", "vacancy_research").eq("entity_id", vacancyId).eq("status", "succeeded").limit(1),
    latestRunStats("vacancy", vacancyId),
  ]);
  // Travel time: the vacancy's own office if known, otherwise the employer's best office.
  let pt: number | null = null, car: number | null = null;
  const tt = v.office_id
    ? (await db().from("travel_times").select("mode, minutes").eq("office_id", v.office_id)).data
    : v.employer_id ? (await db().from("travel_times").select("mode, minutes, offices!inner(employer_id)").eq("offices.employer_id", v.employer_id)).data : null;
  const mins = (m: string) => (tt ?? []).filter((t) => t.mode === m).map((t) => t.minutes);
  if (mins("public_transport").length) pt = Math.min(...mins("public_transport"));
  if (mins("car").length) car = Math.min(...mins("car"));

  const per = v.salary_period;
  const salaryYear = v.salary_min == null ? null : Number(v.salary_min) * (per === "month" ? 12 : per === "week" ? 52 : per === "day" ? 220 : per === "hour" ? 1600 : 1);
  const entry = (claims ?? []).find((c) => c.field_name === "research.entry_level");
  const entryVal = entry ? (entry.value as { value?: string } | null)?.value : null;
  const officialSource = v.discovery_source === "careers_pages" || (v.sources as { evidence_type: string } | null)?.evidence_type === "primary_official" || stats.officialRead;
  const input: VacancyAssessmentInput = {
    title: v.title, roleFamily: v.role_family as RoleFamily, isAdjacent: v.is_adjacent, status: v.status, employmentType: v.employment_type as EmploymentType,
    qualificationRequired: v.qualification_required, experienceYearsMin: v.experience_years_min, salaryYearMin: salaryYear, rightToWorkRequired: v.right_to_work_required,
    hybridPolicy: v.hybrid_policy as WorkingArrangement, ptMinutes: pt, carMinutes: car,
    closingKnown: !!(v.closing_at || v.application_deadline), applicationRouteKnown: v.application_route !== "unknown" || !!v.application_url || !!v.application_email,
    salaryKnown: v.salary_min != null || !!v.salary_text, locationKnown: !!(v.location_text || v.postcode),
    descriptionAnalysed: (v.description_snapshot?.length ?? 0) >= 200 && !v.description_is_truncated,
    requirementsExtracted: (aiRun?.length ?? 0) > 0 || (reqs?.length ?? 0) > 0,
    officialSourceRead: officialSource, sourcesTried: stats.tried, sourcesFailed: stats.failed,
    entryLevel: entryVal === "yes" || entryVal === "no" || entryVal === "unclear" ? { value: entryVal, quote: entry?.quote ?? null } : null,
    requirements: (reqs ?? []).map((r) => ({ id: r.id, kind: r.kind, necessity: r.necessity, text: r.text, quote: r.quote, evidenceStatus: r.evidence_status, review: r.review }) satisfies RequirementInput),
    trainingSignals: [
      ...(claims ?? []).filter((c) => c.field_name.startsWith("research.training.")).map((c) => ({ text: String((c.value as { text?: string } | null)?.text ?? ""), quote: c.quote, origin: "vacancy" as const })),
      ...(emp?.training_support ? [{ text: emp.training_support, quote: null, origin: "employer" as const }] : []),
    ].filter((t) => t.text),
    employer: { sectors: emp?.sectors ?? [], specialisms: emp?.specialisms ?? [], hasGraduateProgramme: emp?.has_graduate_programme === "yes" ? true : emp?.has_graduate_programme === "no" ? false : null, suppressed: emp?.is_suppressed ?? false },
    conflicts: await vacancyConflicts(vacancyId, v),
  };
  return { input, employerId: v.employer_id };
}

export async function buildEmployerInput(employerId: string): Promise<EmployerAssessmentInput | null> {
  const { data: e } = await db().from("employers").select("*").eq("id", employerId).is("deleted_at", null).maybeSingle();
  if (!e) return null;
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: offices }, { data: vacs }, { data: signals }, { data: claims }, { data: contacts }, { data: note }, stats] = await Promise.all([
    db().from("offices").select("zone_code, is_primary, travel_times(mode, minutes)").eq("employer_id", employerId).is("deleted_at", null),
    db().from("vacancies").select("role_family, status").eq("employer_id", employerId).is("deleted_at", null).is("duplicate_of_vacancy_id", null),
    db().from("hiring_signals").select("strength").eq("employer_id", employerId).gte("observed_on", since),
    db().from("claims").select("field_name, source_id, evidence_status").eq("entity_type", "employer").eq("entity_id", employerId).eq("is_current", true),
    db().from("contacts").select("role_title, do_not_contact").eq("employer_id", employerId).is("deleted_at", null),
    db().from("research_notes").select("relevant_project, evidence_status").eq("employer_id", employerId).is("vacancy_id", null).eq("is_current", true).maybeSingle(),
    latestRunStats("employer", employerId),
  ]);
  const primary = (offices ?? []).find((o) => o.is_primary) ?? (offices ?? [])[0];
  const zoneCode = primary?.zone_code ?? null;
  const zone = zoneCode ? (await db().from("geo_zones").select("max_pt_minutes").eq("code", zoneCode).maybeSingle()).data : null;
  const times = (offices ?? []).flatMap((o) => (o.travel_times as { mode: string; minutes: number }[]) ?? []);
  const best = (m: string) => { const a = times.filter((t) => t.mode === m).map((t) => t.minutes); return a.length ? Math.min(...a) : null; };
  const good = (s: string) => s === "verified_fact" || s === "source_supported_summary";
  const projects = (claims ?? []).filter((c) => c.field_name.startsWith("project.") && good(c.evidence_status));
  const live = (vacs ?? []).filter((v) => OPEN.includes(v.status));
  return {
    name: e.display_name ?? e.legal_name, suppressed: e.is_suppressed, stage: e.outreach_stage, doNotContact: (contacts ?? []).some((c) => c.do_not_contact),
    isArchitecturePractice: e.is_architecture_practice, practiceType: e.practice_type, sectors: e.sectors, specialisms: e.specialisms,
    hasProjectEvidence: projects.length > 0 || good(e.project_intelligence_evidence), zoneMaxPtMinutes: zone?.max_pt_minutes ?? null, zoneCode,
    ptMinutes: best("public_transport"), carMinutes: best("car"), hiresPart1: e.hires_part1, hasGraduateProgramme: e.has_graduate_programme === "unknown" ? null : e.has_graduate_programme === "yes",
    acceptsSpeculative: e.accepts_speculative, historicalEntryRoles: (vacs ?? []).filter((v) => ENTRY_FAMILIES.has(v.role_family)).length, openVacancies: live.length,
    signals: { strong: (signals ?? []).filter((s) => s.strength === "strong").length, moderate: (signals ?? []).filter((s) => s.strength === "moderate").length, weak: (signals ?? []).filter((s) => s.strength === "weak").length },
    trainingText: e.training_support, recruitmentRouteKnown: !!(e.applications_email || e.generic_email || e.careers_url), namedContactWithRole: (contacts ?? []).some((c) => !c.do_not_contact && c.role_title),
    relevantProjectCited: !!note?.relevant_project && good(note.evidence_status), officialSourceRead: stats.officialRead || (e.last_checked_at != null && e.data_quality !== "poor"),
    sourcesTried: stats.tried, sourcesFailed: stats.failed, claimsTotal: (claims ?? []).length, claimsSourced: (claims ?? []).filter((c) => c.source_id).length,
    conflicts: (claims ?? []).filter((c) => c.evidence_status === "conflicting_sources").map((c) => ({ field: c.field_name, detail: "recorded as conflicting between sources" })),
  };
}

export interface PersistMeta { kind: "vacancy" | "employer"; employerId: string | null; vacancyId: string | null; profile: AssessmentProfile; weightsVersion: number; hash: string; runId: string | null; touch: boolean }

/**
 * Writes an assessment only when something that feeds it has changed, superseding (never editing) the previous row so the
 * history shows how a vacancy, the profile or the weights moved the result. An unchanged result is just re-stamped on a refresh.
 */
export async function persistAssessment(r: AssessmentResult, m: PersistMeta): Promise<{ changed: boolean; id: string }> {
  const col = m.kind === "vacancy" ? "vacancy_id" : "employer_id";
  const key = m.kind === "vacancy" ? m.vacancyId! : m.employerId!;
  let q = db().from("assessments").select("id, inputs_hash").eq("kind", m.kind).eq(col, key).eq("is_current", true);
  if (m.kind === "employer") q = q.is("vacancy_id", null);
  const { data: cur } = await q.maybeSingle();
  if (cur && cur.inputs_hash === m.hash) {
    if (m.touch) await db().from("assessments").update({ computed_at: new Date().toISOString(), research_run_id: m.runId }).eq("id", cur.id);
    return { changed: false, id: cur.id };
  }
  if (cur) await db().from("assessments").update({ is_current: false, superseded_at: new Date().toISOString() }).eq("id", cur.id);
  const { data: row, error } = await db().from("assessments").insert({
    kind: m.kind, employer_id: m.employerId, vacancy_id: m.vacancyId, profile_version: m.profile.version, profile_approved: m.profile.approved, weights_version: m.weightsVersion,
    total: r.total, criteria: { items: r.criteria, assessedWeight: r.assessedWeight, range: r.range, preliminary: r.preliminary, recommendation: r.recommendation } as unknown as Json,
    blockers: r.blockers as unknown as Json, strengths: r.strengths, missing: r.missing, develop: r.develop, questions: r.questions, conflicts: r.conflicts as unknown as Json, next_steps: r.nextSteps,
    completeness: r.completeness, confidence: r.confidence, inputs_hash: m.hash, research_run_id: m.runId,
  }).select("id").single();
  if (error || !row) throw new Error(error?.message ?? "could not store assessment");
  return { changed: true, id: row.id };
}

/** Compute and store the current vacancy assessment. Pure scoring; no network and no AI. */
export async function assessVacancyNow(vacancyId: string, ctx: { profile?: AssessmentProfile; weights?: { version: number; weights: VacancyWeights }; runId?: string | null; touch?: boolean } = {}) {
  const built = await buildVacancyInput(vacancyId);
  if (!built) return null;
  const profile = ctx.profile ?? (await loadAssessmentProfile());
  const w = ctx.weights ?? (await loadWeights("vacancy"));
  const result = assessVacancy(built.input, profile, w.weights);
  const hash = inputsHash(built.input, profile, w.weights);
  const saved = await persistAssessment(result, { kind: "vacancy", employerId: built.employerId, vacancyId, profile, weightsVersion: w.version, hash, runId: ctx.runId ?? null, touch: ctx.touch ?? false });
  return { result, ...saved };
}

export async function assessEmployerNow(employerId: string, ctx: { profile?: AssessmentProfile; weights?: { version: number; weights: EmployerWeights }; runId?: string | null; touch?: boolean } = {}) {
  const input = await buildEmployerInput(employerId);
  if (!input) return null;
  const profile = ctx.profile ?? (await loadAssessmentProfile());
  const w = ctx.weights ?? (await loadWeights("employer"));
  const result = assessEmployer(input, profile, w.weights);
  const hash = inputsHash(input, profile, w.weights);
  const saved = await persistAssessment(result, { kind: "employer", employerId, vacancyId: null, profile, weightsVersion: w.version, hash, runId: ctx.runId ?? null, touch: ctx.touch ?? false });
  return { result, ...saved };
}
