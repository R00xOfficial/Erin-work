import { computeScore, evaluateEligibility, DEFAULT_BAND_THRESHOLDS, DEFAULT_WEIGHTS, validateWeights, type BandThresholds, type HardFlag, type ScoringInput, type ScoringWeights, type CandidateEligibilityProfile, type EmploymentType, type VacancyStatus } from "@ajis/shared";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import type { Job } from "./index.js";

interface Payload { employerId?: string; all?: boolean }

async function loadWeights(): Promise<{ version: number; weights: ScoringWeights; thresholds: BandThresholds }> {
  const { data } = await db().from("scoring_weights").select("*").eq("is_active", true).maybeSingle();
  if (!data) return { version: 1, weights: DEFAULT_WEIGHTS, thresholds: DEFAULT_BAND_THRESHOLDS };
  let weights = DEFAULT_WEIGHTS;
  try { weights = validateWeights(data.weights as Record<string, number>); } catch (e) { logger.warn({ err: (e as Error).message }, "invalid stored weights; using defaults"); }
  return { version: data.version, weights, thresholds: { ...DEFAULT_BAND_THRESHOLDS, ...(data.band_thresholds as Partial<BandThresholds>) } };
}

export async function loadProfile(): Promise<CandidateEligibilityProfile & { software: string[]; skills: string[]; sectors: string[]; maxPt: number }> {
  const { data: p } = await db().from("candidate_profile").select("*").eq("id", true).maybeSingle();
  return {
    qualification: p?.qualification ?? "part1_equivalent",
    experienceYears: Number(p?.experience_years ?? 0),
    hasUkRightToWork: p?.has_uk_right_to_work ?? true,
    maxPublicTransportMinutes: p?.max_public_transport_minutes ?? 90,
    maxCarMinutes: p?.max_car_minutes ?? null,
    acceptedEmploymentTypes: (p?.accepted_employment_types ?? []) as EmploymentType[],
    minSalaryGbp: p?.min_salary_gbp ?? null,
    acceptAdjacentEntryRoles: p?.accept_adjacent_entry_roles ?? true,
    software: (p?.software ?? []).map((s) => s.toLowerCase().replace(/\s*\(.*\)$/, "")),
    skills: (p?.skills ?? []).map((s) => s.toLowerCase()),
    sectors: (p?.sector_interests ?? []).map((s) => s.toLowerCase()),
    maxPt: p?.max_public_transport_minutes ?? 90,
  };
}

function overlap(a: string[], b: string[]): number | null {
  if (b.length === 0) return null;
  const A = new Set(a.map((x) => x.toLowerCase()));
  let hit = 0;
  for (const x of b) if ([...A].some((y) => y.includes(x.toLowerCase()) || x.toLowerCase().includes(y))) hit++;
  return hit / b.length;
}

export async function scoreEmployer(employerId: string, ctx?: Awaited<ReturnType<typeof loadWeights>>, profile?: Awaited<ReturnType<typeof loadProfile>>) {
  const weights = ctx ?? (await loadWeights());
  const prof = profile ?? (await loadProfile());
  const [{ data: e }, { data: vacancies }, { data: offices }, { data: contacts }, { data: signals }, { data: claims }] = await Promise.all([
    db().from("employers").select("*").eq("id", employerId).is("deleted_at", null).maybeSingle(),
    db().from("vacancies").select("*").eq("employer_id", employerId).is("deleted_at", null),
    db().from("offices").select("id, working_arrangement, travel_times(mode, minutes)").eq("employer_id", employerId).is("deleted_at", null),
    db().from("contacts").select("email, email_verification, hiring_authority, do_not_contact").eq("employer_id", employerId).is("deleted_at", null),
    db().from("hiring_signals").select("strength, observed_on").eq("employer_id", employerId).gte("observed_on", new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10)),
    db().from("claims").select("source_id").eq("entity_type", "employer").eq("entity_id", employerId).eq("is_current", true),
  ]);
  if (!e) return null;

  // Hard flags per vacancy (also refreshes each vacancy's eligibility so commute changes propagate).
  const ptAll: number[] = []; const carAll: number[] = [];
  for (const o of offices ?? []) for (const t of (o.travel_times as { mode: string; minutes: number }[]) ?? []) (t.mode === "public_transport" ? ptAll : carAll).push(t.minutes);
  const bestPt = ptAll.length ? Math.min(...ptAll) : null;
  const bestCar = carAll.length ? Math.min(...carAll) : null;
  let openEligible = 0, openIneligible = 0, newestAge: number | null = null, historicalEntry = 0;
  const requested: string[] = [];
  for (const v of vacancies ?? []) {
    const elig = evaluateEligibility({
      title: v.title, status: v.status as VacancyStatus, qualificationRequired: v.qualification_required, experienceYearsMin: v.experience_years_min,
      employmentType: v.employment_type as EmploymentType, salaryMinGbpPerYear: v.salary_min != null && (v.salary_period === "year" || v.salary_period === "unknown") ? Number(v.salary_min) : null,
      requiresExistingRightToWork: v.right_to_work_required === true, publicTransportMinutes: bestPt, carMinutes: bestCar, isRemote: v.hybrid_policy === "remote", employerSuppressed: e.is_suppressed,
    }, prof);
    if (elig.status !== v.eligibility_status || elig.hardFlags.join() !== v.hard_flags.join()) {
      await db().from("vacancies").update({ eligibility_status: elig.status, hard_flags: elig.hardFlags, eligibility_reasons: elig.reasons, eligibility_checked_at: new Date().toISOString() }).eq("id", v.id);
    }
    const open = ["open", "closing_soon", "unverified"].includes(v.status);
    if (open && elig.status === "eligible") openEligible++;
    else if (open) openIneligible++;
    if (!["senior_or_unsuitable", "architect_part3", "part2_assistant", "unknown"].includes(v.role_family)) historicalEntry++;
    if (open) {
      const age = Math.floor((Date.now() - new Date(v.posted_at ?? v.first_seen_at).getTime()) / 86_400_000);
      newestAge = newestAge == null ? age : Math.min(newestAge, age);
    }
    requested.push(...v.software_requested, ...v.skills_requested);
  }
  requested.push(...e.software);
  const usable = (contacts ?? []).filter((c) => !c.do_not_contact);
  const input: ScoringInput = {
    openEligibleVacancies: vacancies == null ? null : openEligible,
    openIneligibleVacancies: openIneligible,
    newestVacancyAgeDays: newestAge,
    hiresPart1: e.hires_part1,
    historicalEntryRoles: historicalEntry,
    hasGraduateProgramme: e.has_graduate_programme === "unknown" ? null : e.has_graduate_programme === "yes",
    acceptsSpeculative: e.accepts_speculative,
    skillOverlap: overlap(prof.software.concat(prof.skills), requested),
    sectorOverlap: overlap(prof.sectors, e.sectors),
    signals: { strong: (signals ?? []).filter((s) => s.strength === "strong").length, moderate: (signals ?? []).filter((s) => s.strength === "moderate").length, weak: (signals ?? []).filter((s) => s.strength === "weak").length },
    contact: { exists: usable.length > 0, hasEmail: usable.some((c) => c.email), verified: usable.some((c) => c.email_verification === "confirmed_by_reply"), hiringAuthority: usable.some((c) => c.hiring_authority === "decision_maker" || c.hiring_authority === "influencer"), applicationsEmailKnown: !!e.applications_email },
    bestPublicTransportMinutes: bestPt,
    bestCarMinutes: bestCar,
    maxPublicTransportMinutes: prof.maxPt,
    workingArrangement: ((offices ?? []).find((o) => o.working_arrangement !== "unknown")?.working_arrangement ?? "unknown") as ScoringInput["workingArrangement"],
    confidenceScore: Number(e.confidence_score),
    daysSinceLastChecked: e.last_checked_at ? Math.floor((Date.now() - new Date(e.last_checked_at).getTime()) / 86_400_000) : null,
    claimsWithSources: (claims ?? []).filter((c) => c.source_id).length,
    claimsTotal: (claims ?? []).length,
    outreachStage: e.outreach_stage,
  };
  const hardFlags: HardFlag[] = e.is_suppressed ? ["employer_suppressed"] : [];
  if (bestPt != null && bestPt > prof.maxPublicTransportMinutes && (bestCar == null || prof.maxCarMinutes == null || bestCar > prof.maxCarMinutes)) hardFlags.push("commute_exceeds_limit");
  const result = computeScore(input, hardFlags, weights.weights, weights.thresholds);
  const factorScores = Object.fromEntries(Object.entries(result.factors).map(([k, v]) => [k, v.score]));
  const factorReasons = Object.fromEntries(Object.entries(result.factors).map(([k, v]) => [k, v.reason]));
  await db().from("employer_scores").insert({ employer_id: employerId, weights_version: weights.version, total: result.total, factor_scores: factorScores, factor_reasons: factorReasons, unknown_factors: result.unknownFactors, hard_flags: result.hardFlags, band: result.band });
  await db().from("employers").update({ latest_score: result.total, latest_band: result.band, latest_scored_at: new Date().toISOString() }).eq("id", employerId);
  return { employerId, total: result.total, band: result.band, hardFlags: result.hardFlags };
}

export async function scoringRecompute(job: Job<Payload>) {
  const ctx = await loadWeights();
  const prof = await loadProfile();
  if (job.data.employerId) return scoreEmployer(job.data.employerId, ctx, prof);
  const { data: ids } = await db().from("employers").select("id").is("deleted_at", null);
  let n = 0;
  for (const row of ids ?? []) { await scoreEmployer(row.id, ctx, prof); n++; }
  return { scored: n, weightsVersion: ctx.version };
}
