"use server";
import { revalidatePath } from "next/cache";
import { computeInsights, detectFindings, profileSuggestions, type Insights } from "@ajis/shared";
import type { Json } from "@ajis/db";
import { requireUser } from "@/lib/supabase/server";
import { loadFacts, loadPrefs, resolvePeriod } from "@/server/insights";

// Stage 5 never changes search criteria, scoring weights, documents or the candidate profile. Accepting a recommendation records Erin's decision;
// any change is one she makes herself and can log here afterwards.

const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" && v.trim() !== "" ? v.trim() : null; };
const refresh = () => { revalidatePath("/insights"); revalidatePath("/"); };
const WINDOW_DAYS = 90;

/** Records, without the long lists of linked records: a saved report keeps the numbers and definitions, and the records stay in their own tables. */
function snapshot(ins: Insights): Json {
  return JSON.parse(JSON.stringify({ ...ins, funnel: ins.funnel.map((f) => ({ ...f, records: undefined, recordCount: f.records.length })) })) as Json;
}

export async function refreshRecommendations() {
  const { supabase } = await requireUser();
  const prefs = await loadPrefs(supabase), now = new Date();
  const facts = await loadFacts(supabase);
  const p = resolvePeriod({ range: `${WINDOW_DAYS}d` }, now, WINDOW_DAYS);
  const ins = computeInsights(facts, p, { now, maturityDays: prefs.maturityDays, backlogDays: prefs.backlogDays });
  const found = detectFindings(facts, ins, { now, maturityDays: prefs.maturityDays, backlogDays: prefs.backlogDays });
  const suggestions = profileSuggestions(facts, ins);

  const { data: existing } = await supabase.from("insight_recommendations").select("id, fingerprint, status, sample_size, deferred_until");
  const open = new Map((existing ?? []).filter((r) => ["proposed", "deferred", "accepted"].includes(r.status)).map((r) => [r.fingerprint, r]));
  const dismissed = new Map<string, number>();
  for (const r of existing ?? []) if (r.status === "dismissed") dismissed.set(r.fingerprint, Math.max(dismissed.get(r.fingerprint) ?? 0, r.sample_size));
  const seen = new Set<string>();
  for (const f of found) {
    seen.add(f.fingerprint);
    const row = { observation: f.observation, evidence: f.evidence as Json, sample_size: f.sampleSize, confidence: f.confidence, last_seen_at: now.toISOString(), title: f.title, why_it_matters: f.why, proposed_action: f.action };
    const cur = open.get(f.fingerprint);
    if (cur) {
      await supabase.from("insight_recommendations").update({ ...row, ...(cur.status === "deferred" && cur.deferred_until && cur.deferred_until <= now.toISOString().slice(0, 10) ? { status: "proposed", deferred_until: null } : {}) }).eq("id", cur.id);
    } else if (!dismissed.has(f.fingerprint) || f.sampleSize >= dismissed.get(f.fingerprint)! * 1.5) {
      const { data: created } = await supabase.from("insight_recommendations").insert({ code: f.code, fingerprint: f.fingerprint, area: f.area, ...row }).select("id").single();
      if (created) await supabase.from("insight_recommendation_events").insert({ recommendation_id: created.id, event: "proposed", evidence: f.evidence as Json });
    }
  }
  // No longer observed: an undecided one is retired with a note, keeping its history. Accepted and deferred ones are Erin's to close.
  for (const [fp, r] of open) if (!seen.has(fp) && r.status === "proposed") {
    await supabase.from("insight_recommendations").update({ status: "superseded", status_note: "No longer observed in the latest data." }).eq("id", r.id);
    await supabase.from("insight_recommendation_events").insert({ recommendation_id: r.id, event: "superseded", note: "No longer observed in the latest data." });
  }

  const { data: ps } = await supabase.from("profile_suggestions").select("id, fingerprint, status");
  const openS = new Map((ps ?? []).filter((x) => ["proposed", "deferred", "accepted"].includes(x.status)).map((x) => [x.fingerprint, x]));
  const closedS = new Set((ps ?? []).filter((x) => ["dismissed", "applied"].includes(x.status)).map((x) => x.fingerprint));
  for (const x of suggestions) {
    if (openS.has(x.fingerprint)) await supabase.from("profile_suggestions").update({ detail: x.detail, evidence: x.evidence as Json }).eq("id", openS.get(x.fingerprint)!.id);
    else if (!closedS.has(x.fingerprint)) await supabase.from("profile_suggestions").insert({ kind: x.kind, title: x.title, detail: x.detail, evidence: x.evidence as Json, fingerprint: x.fingerprint });
  }
  refresh();
}

export async function decideRecommendation(id: string, decision: "accepted" | "dismissed" | "deferred" | "proposed", formData: FormData) {
  const { supabase } = await requireUser();
  const note = s(formData, "note"), days = Number(s(formData, "defer_days") ?? 14);
  if (decision === "dismissed" && !note) throw new Error("Say briefly why, so the decision makes sense later.");
  const patch = { status: decision, status_note: note, decided_at: decision === "proposed" ? null : new Date().toISOString(), deferred_until: decision === "deferred" ? new Date(Date.now() + (Number.isFinite(days) ? days : 14) * 86_400_000).toISOString().slice(0, 10) : null };
  const { error } = await supabase.from("insight_recommendations").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  await supabase.from("insight_recommendation_events").insert({ recommendation_id: id, event: decision, note });
  refresh();
}

export async function decideSuggestion(id: string, decision: "accepted" | "dismissed" | "deferred" | "applied", formData: FormData) {
  const { supabase } = await requireUser();
  const note = s(formData, "note");
  if (decision === "dismissed" && !note) throw new Error("Say briefly why.");
  let version: number | null = null;
  if (decision === "applied") { const { data } = await supabase.from("candidate_profile").select("profile_version").limit(1).maybeSingle(); version = data?.profile_version ?? null; }
  const { error } = await supabase.from("profile_suggestions").update({ status: decision, status_note: note, decided_at: new Date().toISOString(), applied_profile_version: version }).eq("id", id);
  if (error) throw new Error(error.message);
  refresh();
}

export async function recordStrategyChange(formData: FormData) {
  const { supabase } = await requireUser();
  const title = s(formData, "title");
  if (!title) throw new Error("Describe the change you made.");
  const { error } = await supabase.from("strategy_changes").insert({ area: (s(formData, "area") ?? "other") as never, title, description: s(formData, "description"), recommendation_id: s(formData, "recommendation_id"), profile_suggestion_id: s(formData, "profile_suggestion_id"), changed_on: s(formData, "changed_on") ?? new Date().toISOString().slice(0, 10) });
  if (error) throw new Error(error.message);
  refresh();
}

export async function addFeedback(applicationId: string, formData: FormData) {
  const { supabase } = await requireUser();
  const body = s(formData, "body");
  if (!body) throw new Error("Write the feedback or reflection.");
  const source = s(formData, "source") === "employer" ? "employer" : "own";
  const tags = (s(formData, "tags") ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const { error } = await supabase.from("application_feedback").insert({ application_id: applicationId, interview_id: s(formData, "interview_id"), source, kind: (s(formData, "kind") ?? "other") as never, body, tags, occurred_at: s(formData, "occurred_at") ?? new Date().toISOString().slice(0, 10) });
  if (error) throw new Error(error.message);
  revalidatePath(`/applications/${applicationId}`); refresh();
}
export async function deleteFeedback(id: string, applicationId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("application_feedback").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/applications/${applicationId}`); refresh();
}

export async function saveReport(formData: FormData) {
  const { supabase } = await requireUser();
  const prefs = await loadPrefs(supabase), now = new Date();
  const p = resolvePeriod({ range: s(formData, "range") ?? undefined, from: s(formData, "from") ?? undefined, to: s(formData, "to") ?? undefined }, now, prefs.defaultPeriodDays);
  const facts = await loadFacts(supabase);
  const ins = computeInsights(facts, p, { now, maturityDays: prefs.maturityDays, backlogDays: prefs.backlogDays });
  const kind = p.key === "day" ? "daily" : p.key === "week" ? "weekly" : p.key === "month" ? "monthly" : "custom";
  const { data: def } = await supabase.from("metric_definitions").select("version").order("version", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("insight_reports").insert({ kind, period_start: p.start.toISOString().slice(0, 10), period_end: p.end.toISOString().slice(0, 10), is_partial: ins.period.isPartial, definitions_version: def?.version ?? 1, params: { maturityDays: prefs.maturityDays, backlogDays: prefs.backlogDays, label: p.label } as Json, results: snapshot(ins), note: s(formData, "note") });
  if (error) throw new Error(error.message);
  refresh();
}

export async function saveInsightPrefs(formData: FormData) {
  const { supabase } = await requireUser();
  const n = (k: string, lo: number, hi: number) => { const v = Number(formData.get(k)); if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`${k.replace(/_/g, " ")} must be a whole number from ${lo} to ${hi}.`); return v; };
  const { error } = await supabase.from("insight_preferences").update({ default_period_days: n("default_period_days", 7, 730), maturity_days: n("maturity_days", 1, 180), backlog_days: n("backlog_days", 1, 180) }).eq("id", true);
  if (error) throw new Error(error.message);
  refresh();
}
