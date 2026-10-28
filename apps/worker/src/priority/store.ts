import {
  DEFAULT_EMPLOYER_PRIORITY_WEIGHTS, DEFAULT_PRIORITY_CONFIG, DEFAULT_VACANCY_PRIORITY_WEIGHTS, EMPLOYER_PRIORITY_KEYS, VACANCY_PRIORITY_KEYS,
  computeEmployerPriority, computeVacancyPriority, estimateEmployerEffort, estimateVacancyEffort, inputsHash,
  type EmployerPriorityWeights, type PlannerPrefs, type PriorityConfig, type PriorityResult, type PriorityStatus, type SuitabilityInput, type VacancyPriorityWeights,
} from "@ajis/shared";
import type { Json, TablesUpdate } from "@ajis/db";
import { db } from "../lib/db.js";

const DAY = 86_400_000;
export const londonDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
export const londonHour = (d = new Date()) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(d));
const STATUS_LABEL: Record<PriorityStatus, string> = { high: "High priority", recommended: "Recommended", backlog: "Backlog", on_hold: "On hold", dismissed: "Dismissed" };

export interface Prefs extends PlannerPrefs {
  recontactCooldownDays: number; reminderDeadlineDays: number[]; digestFrequency: string; digestHour: number;
  remindTasksDue: boolean; remindOverdue: boolean; remindDecisions: boolean; remindStatusChanges: boolean; remindReconsider: boolean; remindOutreach: boolean;
}
export async function loadPrefs(): Promise<Prefs> {
  const { data: p } = await db().from("planner_preferences").select("*").eq("id", true).maybeSingle();
  return {
    hoursPerDay: Number(p?.hours_per_day ?? 2), workingDays: p?.working_days ?? [1, 2, 3, 4, 5], maxApplicationsPerWeek: p?.max_applications_per_week ?? 3, maxOutreachPerWeek: p?.max_outreach_per_week ?? 5,
    maxResearchPerWeek: p?.max_research_per_week ?? 6, recontactCooldownDays: p?.recontact_cooldown_days ?? 60, reminderDeadlineDays: p?.reminder_deadline_days ?? [7, 3, 1],
    digestFrequency: p?.digest_frequency ?? "daily", digestHour: p?.digest_hour ?? 8, remindTasksDue: p?.remind_tasks_due ?? true, remindOverdue: p?.remind_overdue ?? true,
    remindDecisions: p?.remind_decisions ?? true, remindStatusChanges: p?.remind_status_changes ?? true, remindReconsider: p?.remind_reconsider ?? true, remindOutreach: p?.remind_outreach ?? true,
  };
}

function validWeights<T extends string>(raw: unknown, keys: readonly T[], fallback: Record<T, number>): Record<T, number> {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out = {} as Record<T, number>;
  for (const k of keys) { const v = o[k]; if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return fallback; out[k] = v; }
  return out;
}
export interface ModelCtx<W> { version: number; weights: W; config: PriorityConfig }
export async function loadModel(kind: "vacancy"): Promise<ModelCtx<VacancyPriorityWeights>>;
export async function loadModel(kind: "employer"): Promise<ModelCtx<EmployerPriorityWeights>>;
export async function loadModel(kind: "vacancy" | "employer") {
  const { data } = await db().from("prioritisation_models").select("version, weights, config").eq("kind", kind).eq("is_active", true).maybeSingle();
  if (!data) throw new Error(`No active ${kind} prioritisation model`);
  const config = { ...DEFAULT_PRIORITY_CONFIG, ...((data.config ?? {}) as Partial<PriorityConfig>) };
  return kind === "vacancy"
    ? { version: data.version, weights: validWeights(data.weights, VACANCY_PRIORITY_KEYS, DEFAULT_VACANCY_PRIORITY_WEIGHTS), config }
    : { version: data.version, weights: validWeights(data.weights, EMPLOYER_PRIORITY_KEYS, DEFAULT_EMPLOYER_PRIORITY_WEIGHTS), config };
}

type AssessmentRow = { id: string; total: number; completeness: number; confidence: number; criteria: unknown; blockers: unknown; conflicts: unknown; profile_approved: boolean; reviewed_at: string | null; missing: string[] };
function suitabilityFrom(a: AssessmentRow | null): SuitabilityInput {
  if (!a) return { exists: false, total: null, assessedWeight: 0, rangeLow: 0, preliminary: true, completeness: 0, confidence: 0, blockers: [], conflictCount: 0, profileApproved: false, criteria: {} };
  const doc = (a.criteria ?? {}) as { items?: { criterion: string; score: number | null }[]; assessedWeight?: number; range?: { low: number }; preliminary?: boolean };
  return {
    exists: true, total: Number(a.total), assessedWeight: doc.assessedWeight ?? 0, rangeLow: doc.range?.low ?? 0, preliminary: !!doc.preliminary,
    completeness: Number(a.completeness), confidence: Number(a.confidence), blockers: ((a.blockers ?? []) as { code: string; text: string }[]).map((b) => ({ code: b.code, text: b.text })),
    conflictCount: ((a.conflicts ?? []) as unknown[]).length, profileApproved: a.profile_approved, criteria: Object.fromEntries((doc.items ?? []).map((c) => [c.criterion, c.score])),
  };
}

const CHANGE_SCORE = 10;
interface Existing { id: string; recommended_status: PriorityStatus; score: number | null; live: boolean; deadline_at: string | null; suitability_total: number | null; warnings: unknown; inputs_hash: string; manual_status: PriorityStatus | null; needs_review_reason: string | null }

/** Explains, in plain words, what changed since the last calculation. Only material changes are reported. */
function explainChange(old: Existing, now: PriorityResult, suitabilityTotal: number | null): string[] {
  const out: string[] = [];
  const oldDeadline = old.deadline_at ? old.deadline_at.slice(0, 10) : null, newDeadline = now.deadline.at ? now.deadline.at.slice(0, 10) : null;
  if (oldDeadline !== newDeadline) out.push(oldDeadline && newDeadline ? `The closing date changed from ${oldDeadline} to ${newDeadline}.` : newDeadline ? `A closing date (${newDeadline}) is now recorded.` : "The closing date is no longer recorded.");
  if (old.live && !now.live) out.push("The vacancy is no longer live (closed or past its closing date).");
  if (!old.live && now.live) out.push("The vacancy is live again.");
  const oldCodes = new Set(((old.warnings ?? []) as { code: string; severity: string }[]).filter((w) => w.severity === "blocker").map((w) => w.code));
  for (const w of now.warnings) if (w.severity === "blocker" && !oldCodes.has(w.code)) out.push(`New blocker: ${w.text}`);
  for (const c of oldCodes) if (!now.warnings.some((w) => w.code === c && w.severity === "blocker")) out.push("A previous blocker has been resolved.");
  if (old.recommended_status !== now.recommended) out.push(`The recommendation changed from ${STATUS_LABEL[old.recommended_status]} to ${STATUS_LABEL[now.recommended]}.`);
  if (old.score != null && now.score != null && Math.abs(Number(old.score) - now.score) >= CHANGE_SCORE) out.push(`The priority score moved from ${Math.round(Number(old.score))} to ${Math.round(now.score)}.`);
  if (old.suitability_total != null && suitabilityTotal != null && Math.abs(Number(old.suitability_total) - suitabilityTotal) >= CHANGE_SCORE) out.push(`Stage 2 suitability moved from ${Math.round(Number(old.suitability_total))} to ${Math.round(suitabilityTotal)}.`);
  return out;
}

interface Save { kind: "vacancy" | "employer"; employerId: string | null; vacancyId: string | null; result: PriorityResult; model: number; assessmentId: string | null; suitabilityTotal: number | null; effort: unknown; deadlineSource: string | null; extra?: Record<string, unknown> }
async function saveItem(s: Save) {
  const col = s.kind === "vacancy" ? "vacancy_id" : "employer_id";
  let q = db().from("priority_items").select("id, recommended_status, score, live, deadline_at, suitability_total, warnings, inputs_hash, manual_status, needs_review_reason").eq("kind", s.kind).eq(col, (s.kind === "vacancy" ? s.vacancyId : s.employerId)!);
  if (s.kind === "employer") q = q.is("vacancy_id", null);
  const { data: old } = await q.maybeSingle();
  const r = s.result;
  const hash = inputsHash({ r, model: s.model, assessmentId: s.assessmentId, effort: s.effort });
  const row = {
    kind: s.kind, employer_id: s.employerId, vacancy_id: s.vacancyId, recommended_status: r.recommended, score: r.score, components: { items: r.components, hold: { reason: r.holdReason, condition: r.holdCondition, until: r.holdUntil } } as unknown as Json,
    warnings: r.warnings as unknown as Json, rationale: r.rationale, live: r.live, model_version: s.model, suitability_assessment_id: s.assessmentId, suitability_total: s.suitabilityTotal,
    deadline_at: r.deadline.at, deadline_source: s.deadlineSource, effort: s.effort as Json, inputs_hash: hash, computed_at: new Date().toISOString(),
  };
  if (!old) {
    const { data: created, error } = await db().from("priority_items").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    await db().from("priority_events").insert({ item_id: created.id, event: "created", actor: "system", to_status: r.recommended, score_after: r.score, reason: r.rationale[0] ?? null, detail: { warnings: r.warnings.map((w) => w.code) } as Json });
    return { id: created.id, changed: true };
  }
  if (old.inputs_hash === hash) return { id: old.id, changed: false };
  const why = explainChange(old as Existing, r, s.suitabilityTotal);
  const patch: TablesUpdate<"priority_items"> = { ...row };
  if (why.length) { patch.needs_review_reason = [old.needs_review_reason, ...why].filter(Boolean).join(" ").slice(0, 1000); if (!old.needs_review_reason) patch.needs_review_since = new Date().toISOString(); }
  const { error } = await db().from("priority_items").update(patch).eq("id", old.id);
  if (error) throw new Error(error.message);
  if (why.length) await db().from("priority_events").insert({ item_id: old.id, event: "material_change", actor: "system", from_status: old.recommended_status, to_status: r.recommended, score_before: old.score, score_after: r.score, reason: why.join(" "), detail: { manual_status_kept: old.manual_status, changes: why } as Json });
  return { id: old.id, changed: true, materialChange: why.length > 0 };
}

const LIVE_OPEN = ["open", "closing_soon", "unverified"];

export async function prioritiseVacancy(vacancyId: string, ctx: { model?: ModelCtx<VacancyPriorityWeights>; now?: Date } = {}) {
  const model = ctx.model ?? (await loadModel("vacancy"));
  const now = ctx.now ?? new Date();
  const { data: v } = await db().from("vacancies").select("id, employer_id, status, closing_at, application_deadline, application_route, application_url, application_email, portfolio_required, stage3_saved_at").eq("id", vacancyId).is("deleted_at", null).maybeSingle();
  if (!v) return null;
  const [{ data: a }, { data: ea }, { data: app }, { data: done }] = await Promise.all([
    db().from("assessments").select("id, total, completeness, confidence, criteria, blockers, conflicts, profile_approved, reviewed_at, missing").eq("kind", "vacancy").eq("vacancy_id", vacancyId).eq("is_current", true).maybeSingle(),
    v.employer_id ? db().from("assessments").select("completeness").eq("kind", "employer").eq("employer_id", v.employer_id).is("vacancy_id", null).eq("is_current", true).maybeSingle() : Promise.resolve({ data: null }),
    db().from("applications").select("stage").eq("vacancy_id", vacancyId).is("deleted_at", null).limit(1).maybeSingle(),
    db().from("plan_actions").select("kind, priority_items!inner(vacancy_id)").eq("status", "done").eq("priority_items.vacancy_id", vacancyId),
  ]);
  const suit = suitabilityFrom(a as AssessmentRow | null);
  const doneKinds = new Set<string>();
  for (const d of done ?? []) {
    if (d.kind === "prepare_application") ["tailor_cv", "portfolio", "cover_letter", "application_answers", "review_job"].forEach((k) => doneKinds.add(k));
    if (d.kind === "research") doneKinds.add("research_employer");
    if (d.kind === "verify") doneKinds.add("confirm_eligibility");
  }
  const routeKnown = v.application_route !== "unknown" || !!v.application_url || !!v.application_email;
  const effort = estimateVacancyEffort({ assessmentReviewed: !!a?.reviewed_at, blockerCount: suit.blockers.length, missingCount: (a as AssessmentRow | null)?.missing?.length ?? 0, employerResearchComplete: Number(ea?.completeness ?? 0) >= 60, routeKnown, applicationRoute: v.application_route, portfolioRequired: v.portfolio_required, done: doneKinds });
  const closing = v.closing_at ?? v.application_deadline;
  const result = computeVacancyPriority({ now, vacancyStatus: v.status, closingAt: closing ? new Date(closing) : null, suitability: suit, applicationRouteKnown: routeKnown, effortMinutes: effort.totalMinutes }, model.weights, model.config);
  if (app && !["vacancy_discovered", "eligibility_checked"].includes(app.stage)) result.rationale.push(`An application is already at stage "${app.stage}": it is managed in Stage 4.`);
  return saveItem({ kind: "vacancy", employerId: v.employer_id, vacancyId, result, model: model.version, assessmentId: a?.id ?? null, suitabilityTotal: a ? Number(a.total) : null, effort, deadlineSource: v.closing_at ? "vacancy closing date" : v.application_deadline ? "application deadline" : null });
}

export async function prioritiseEmployer(employerId: string, ctx: { model?: ModelCtx<EmployerPriorityWeights>; prefs?: Prefs; now?: Date } = {}) {
  const model = ctx.model ?? (await loadModel("employer"));
  const prefs = ctx.prefs ?? (await loadPrefs());
  const now = ctx.now ?? new Date();
  const { data: e } = await db().from("employers").select("id, is_suppressed, outreach_stage, accepts_speculative, hires_part1, hires_part1_evidence, has_graduate_programme, applications_email, generic_email, careers_url").eq("id", employerId).is("deleted_at", null).maybeSingle();
  if (!e) return null;
  const since = new Date(now.getTime() - 180 * DAY).toISOString().slice(0, 10);
  const [{ data: a }, { data: hist }, { data: contacts }, { data: vacs }, { data: signals }, { data: specClaim }, { data: existing }, { data: done }] = await Promise.all([
    db().from("assessments").select("id, total, completeness, confidence, criteria, blockers, conflicts, profile_approved, reviewed_at, missing").eq("kind", "employer").eq("employer_id", employerId).is("vacancy_id", null).eq("is_current", true).maybeSingle(),
    db().from("v_employer_contact_history").select("outbound_count, last_outbound_at, replied").eq("employer_id", employerId).maybeSingle(),
    db().from("contacts").select("role_title, do_not_contact").eq("employer_id", employerId).is("deleted_at", null),
    db().from("vacancies").select("role_family, status").eq("employer_id", employerId).is("deleted_at", null).is("duplicate_of_vacancy_id", null),
    db().from("hiring_signals").select("id").eq("employer_id", employerId).gte("observed_on", since),
    db().from("claims").select("evidence_status").eq("entity_type", "employer").eq("entity_id", employerId).eq("field_name", "accepts_speculative").eq("is_current", true).limit(1).maybeSingle(),
    db().from("priority_items").select("recontact_reason").eq("kind", "employer").eq("employer_id", employerId).is("vacancy_id", null).maybeSingle(),
    db().from("plan_actions").select("kind, priority_items!inner(employer_id, kind)").eq("status", "done").eq("priority_items.employer_id", employerId).eq("priority_items.kind", "employer"),
  ]);
  const suit = suitabilityFrom(a as AssessmentRow | null);
  const entry = new Set(["part1_assistant", "graduate_assistant", "placement_internship", "bim_cad", "technician", "technologist", "design_coordinator", "urban_design_junior", "planning_assistant", "visualisation", "other_entry"]);
  const doneKinds = new Set<string>();
  for (const d of done ?? []) { if (d.kind === "research") doneKinds.add("research_employer"); if (d.kind === "prepare_outreach") doneKinds.add("prepare_outreach"); }
  const route = !!(e.applications_email || e.generic_email || e.careers_url);
  const named = (contacts ?? []).some((c) => !c.do_not_contact && c.role_title);
  const effort = estimateEmployerEffort({ employerResearchComplete: suit.completeness >= 60, routeKnown: route, namedContact: named, done: doneKinds });
  const good = (s?: string) => s === "verified_fact" || s === "source_supported_summary";
  const result = computeEmployerPriority({
    now, suitability: suit, suppressed: e.is_suppressed, doNotContact: (contacts ?? []).some((c) => c.do_not_contact), stage: e.outreach_stage, outboundCount: Number(hist?.outbound_count ?? 0),
    lastOutboundAt: hist?.last_outbound_at ? new Date(hist.last_outbound_at) : null, replied: !!hist?.replied, cooldownDays: prefs.recontactCooldownDays, recontactApproved: !!existing?.recontact_reason,
    openVacancies: (vacs ?? []).filter((v) => LIVE_OPEN.includes(v.status)).length, acceptsSpeculative: e.accepts_speculative, acceptsSpeculativeVerified: good(specClaim?.evidence_status),
    hiresPart1Verified: e.hires_part1 === "yes" && good(e.hires_part1_evidence), graduateProgramme: e.has_graduate_programme === "unknown" ? null : e.has_graduate_programme === "yes",
    historicalEntryRoles: (vacs ?? []).filter((v) => entry.has(v.role_family)).length, recentSignals: (signals ?? []).length, routeKnown: route, namedContact: named, effortMinutes: effort.totalMinutes,
  }, model.weights, model.config);
  const saved = await saveItem({ kind: "employer", employerId, vacancyId: null, result, model: model.version, assessmentId: a?.id ?? null, suitabilityTotal: a ? Number(a.total) : null, effort, deadlineSource: null });
  if (result.holdUntil) await db().from("priority_items").update({ hold_until: result.holdUntil, hold_condition: result.holdCondition }).eq("id", saved.id).is("manual_status", null);
  return saved;
}

/** Re-prioritise one opportunity if it has reached Stage 3 (saved for Stage 3, or already has a priority item). */
export async function prioritiseEntity(kind: "vacancy" | "employer", id: string) {
  const col = kind === "vacancy" ? "vacancy_id" : "employer_id";
  let existing = db().from("priority_items").select("id").eq("kind", kind).eq(col, id);
  if (kind === "employer") existing = existing.is("vacancy_id", null);
  const { data: item } = await existing.maybeSingle();
  const { data: rec } = await db().from(kind === "vacancy" ? "vacancies" : "employers").select("stage3_saved_at").eq("id", id).maybeSingle();
  if (!item && !rec?.stage3_saved_at) return null;
  return kind === "vacancy" ? prioritiseVacancy(id) : prioritiseEmployer(id);
}
