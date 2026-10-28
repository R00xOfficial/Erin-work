import { db } from "../lib/db.js";
import { assessEmployerNow, assessVacancyNow, loadAssessmentProfile, loadWeights } from "../research/store.js";
import { prioritiseEntity } from "../priority/store.js";
import type { Job } from "./index.js";

interface Payload { all?: boolean; vacancyId?: string; employerId?: string; reason?: string }

/**
 * Re-scores existing assessments from stored data (no fetching, no AI) when the profile, the weights or the records change.
 * A new assessment row is written only if the result's inputs actually changed, so earlier assessments stay in the history.
 */
export async function assessmentsRecompute(job: Job<Payload>) {
  const profile = await loadAssessmentProfile();
  const [vw, ew] = [await loadWeights("vacancy"), await loadWeights("employer")];
  const counts = { vacancies: 0, employers: 0, changed: 0, errors: 0 };
  const run = async (fn: () => Promise<{ changed: boolean } | null>, kind: "vacancies" | "employers", id: string) => {
    try { const r = await fn(); if (r) { counts[kind]++; if (r.changed) { counts.changed++; await prioritiseEntity(kind === "vacancies" ? "vacancy" : "employer", id).catch(() => null); } } } catch { counts.errors++; }
  };
  if (job.data.vacancyId) await run(() => assessVacancyNow(job.data.vacancyId!, { profile, weights: vw }), "vacancies", job.data.vacancyId!);
  else if (job.data.employerId) await run(() => assessEmployerNow(job.data.employerId!, { profile, weights: ew }), "employers", job.data.employerId!);
  else {
    const { data: vs } = await db().from("assessments").select("vacancy_id").eq("kind", "vacancy").eq("is_current", true);
    for (const a of vs ?? []) if (a.vacancy_id) await run(() => assessVacancyNow(a.vacancy_id!, { profile, weights: vw }), "vacancies", a.vacancy_id!);
    const { data: es } = await db().from("assessments").select("employer_id").eq("kind", "employer").eq("is_current", true);
    for (const a of es ?? []) if (a.employer_id) await run(() => assessEmployerNow(a.employer_id!, { profile, weights: ew }), "employers", a.employer_id!);
  }
  return { ...counts, profileVersion: profile.version, reason: job.data.reason ?? "scheduled" };
}
