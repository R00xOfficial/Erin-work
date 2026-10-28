import { db } from "../lib/db.js";
import { loadModel, loadPrefs, prioritiseEmployer, prioritiseVacancy } from "../priority/store.js";
import type { Job } from "./index.js";

interface Payload { all?: boolean; vacancyId?: string; employerId?: string; reason?: string }

/**
 * Recalculates priority recommendations for everything that has reached Stage 3. Manual decisions (status, pin, favourite, override, holds)
 * live in separate columns and are never touched here; a material change is recorded with an explanation for Erin to review.
 */
export async function prioritiesRecompute(job: Job<Payload>) {
  const [vm, em, prefs] = [await loadModel("vacancy"), await loadModel("employer"), await loadPrefs()];
  const out = { vacancies: 0, employers: 0, changed: 0, materialChanges: 0, errors: 0 };
  const run = async (kind: "vacancies" | "employers", fn: () => Promise<{ changed: boolean; materialChange?: boolean } | null>) => {
    try { const r = await fn(); if (r) { out[kind]++; if (r.changed) out.changed++; if (r.materialChange) out.materialChanges++; } } catch { out.errors++; }
  };
  if (job.data.vacancyId) await run("vacancies", () => prioritiseVacancy(job.data.vacancyId!, { model: vm }));
  else if (job.data.employerId) await run("employers", () => prioritiseEmployer(job.data.employerId!, { model: em, prefs }));
  else {
    const { data: vs } = await db().from("vacancies").select("id").not("stage3_saved_at", "is", null).is("deleted_at", null);
    const { data: es } = await db().from("employers").select("id").not("stage3_saved_at", "is", null).is("deleted_at", null);
    const { data: pi } = await db().from("priority_items").select("kind, vacancy_id, employer_id");
    const vIds = new Set([...(vs ?? []).map((v) => v.id), ...(pi ?? []).filter((p) => p.kind === "vacancy" && p.vacancy_id).map((p) => p.vacancy_id!)]);
    const eIds = new Set([...(es ?? []).map((e) => e.id), ...(pi ?? []).filter((p) => p.kind === "employer" && p.employer_id).map((p) => p.employer_id!)]);
    for (const id of vIds) await run("vacancies", () => prioritiseVacancy(id, { model: vm }));
    for (const id of eIds) await run("employers", () => prioritiseEmployer(id, { model: em, prefs }));
  }
  // Reaching the end of a hold is itself a reason to look again.
  const today = new Date().toISOString().slice(0, 10);
  await db().from("priority_items").update({ needs_review_reason: "The hold period has ended: reconsider this opportunity.", needs_review_since: new Date().toISOString() }).lte("hold_until", today).is("needs_review_reason", null).in("status", ["on_hold"]);
  return { ...out, reason: job.data.reason ?? "scheduled" };
}
