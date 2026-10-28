import type { ApplicationFact, FeedbackFact, FollowupFact, InsightFacts, RequirementGapFact, SourceRunFact, VacancyFact } from "@ajis/shared";
import type { requireUser } from "@/lib/supabase/server";

// Builds the evidence the analytics run on, straight from the persisted records of Stages 1-4. Nothing is stored twice and nothing is invented:
// a figure can always be recomputed from these rows.

type Client = Awaited<ReturnType<typeof requireUser>>["supabase"];
const PAGE = 1000;

/** Supabase returns at most 1,000 rows per request; read every page so large histories are not silently truncated. */
export async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}
const D = (v: string | null | undefined) => (v ? new Date(v) : null);

export async function loadPrefs(supabase: Client) {
  const { data } = await supabase.from("insight_preferences").select("*").eq("id", true).maybeSingle();
  return { defaultPeriodDays: data?.default_period_days ?? 30, maturityDays: data?.maturity_days ?? 21, backlogDays: data?.backlog_days ?? 14 };
}

export async function loadFacts(supabase: Client): Promise<InsightFacts> {
  const [vacs, prios, apps, interviews, acts, fb, fups, runs, defs, gaps, emps, docs] = await Promise.all([
    all((f, t) => supabase.from("vacancies").select("id, title, employer_id, discovery_source, first_seen_at, status, discovery_state, eligibility_status, duplicate_of_vacancy_id, is_test, research_state, role_family, zone_code, hard_flags, disappeared_at, dismissed_reason, employers!employer_id(display_name, legal_name, practice_type)").is("deleted_at", null).order("first_seen_at").range(f, t)),
    all((f, t) => supabase.from("priority_items").select("id, vacancy_id, status, recommendation_response").order("created_at").range(f, t)),
    all((f, t) => supabase.from("applications").select("id, employer_id, vacancy_id, application_type, stage, selected_at, created_at, submitted_at, submission_confirmed_at, outcome_at, cv_document_id, priority_snapshot, research_snapshot, is_test, employers(display_name, legal_name, practice_type), vacancies(title, role_family, discovery_source, first_seen_at, zone_code, eligibility_status, hard_flags)").is("deleted_at", null).order("created_at").range(f, t)),
    all((f, t) => supabase.from("interviews").select("id, application_id, kind").order("created_at").range(f, t)),
    all((f, t) => supabase.from("activities").select("id, application_id, activity_type, occurred_at").not("application_id", "is", null).in("activity_type", ["employer_feedback", "interview_invitation", "assessment_request", "offer"]).order("occurred_at").range(f, t)),
    all((f, t) => supabase.from("application_feedback").select("id, application_id, source, kind, tags, occurred_at").order("created_at").range(f, t)),
    all((f, t) => supabase.from("application_followups").select("status, due_at, completed_at").order("due_at").range(f, t)),
    all((f, t) => supabase.from("source_runs").select("source_definition_id, started_at, status, errors").order("started_at").range(f, t)),
    all((f, t) => supabase.from("source_definitions").select("id, code, label, enabled").order("code").range(f, t)),
    all((f, t) => supabase.from("assessments").select("vacancy_id, total, missing").eq("kind", "vacancy").eq("is_current", true).order("computed_at").range(f, t)),
    all((f, t) => supabase.from("employers").select("id, first_discovered_at, is_test").is("deleted_at", null).order("first_discovered_at").range(f, t)),
    all((f, t) => supabase.from("documents").select("id, kind, version_label").order("created_at").range(f, t)),
  ]);

  const prioByVac = new Map<string, string>();
  for (const p of prios) if (p.vacancy_id) prioByVac.set(p.vacancy_id, p.status ?? "");
  const vacancies: VacancyFact[] = vacs.map((v) => {
    const e = v.employers as { display_name: string | null; legal_name: string; practice_type: string | null } | null;
    const ps = prioByVac.get(v.id) ?? null;
    return {
      id: v.id, label: `${v.title}${e ? ` · ${e.display_name ?? e.legal_name}` : ""}`, employerId: v.employer_id, source: v.discovery_source ?? "unknown", firstSeenAt: new Date(v.first_seen_at), status: v.status,
      discoveryState: v.discovery_state, eligibility: v.eligibility_status, duplicateOf: v.duplicate_of_vacancy_id, isTest: v.is_test, researched: ["needs_review", "reviewed"].includes(v.research_state),
      prioritised: ps === "high" || ps === "recommended", priorityStatus: ps, dismissedReason: v.dismissed_reason, roleFamily: v.role_family, practiceType: e?.practice_type ?? null, zone: v.zone_code,
      hardFlags: v.hard_flags ?? [], disappeared: !!v.disappeared_at,
    };
  });

  const count = new Map<string, { i: number; a: number }>();
  for (const iv of interviews) { const c = count.get(iv.application_id) ?? { i: 0, a: 0 }; if (iv.kind === "assessment") c.a++; else c.i++; count.set(iv.application_id, c); }
  const firstReply = new Map<string, Date>();
  for (const x of acts) { const d = new Date(x.occurred_at); const cur = firstReply.get(x.application_id!); if (!cur || d < cur) firstReply.set(x.application_id!, d); }
  const cvLabel = new Map(docs.map((d) => [d.id, d.version_label]));

  const applications: ApplicationFact[] = apps.map((a) => {
    const e = a.employers as { display_name: string | null; legal_name: string; practice_type: string | null } | null;
    const v = a.vacancies as { title: string; role_family: string | null; discovery_source: string | null; first_seen_at: string; zone_code: string | null; eligibility_status: string; hard_flags: string[] | null } | null;
    const prio = (a.priority_snapshot ?? {}) as { status?: string; suitability_total?: number | null };
    const res = (a.research_snapshot ?? {}) as { total?: number | null };
    const c = count.get(a.id);
    const reply = firstReply.get(a.id) ?? (["rejected", "offer_received", "offer_accepted", "offer_declined"].includes(a.stage) ? D(a.outcome_at) : null);
    return {
      id: a.id, label: `${v?.title ?? (a.application_type === "speculative" ? "Speculative" : "Application")} · ${e?.display_name ?? e?.legal_name ?? ""}`, employerId: a.employer_id, vacancyId: a.vacancy_id, type: a.application_type, stage: a.stage,
      selectedAt: new Date(a.selected_at ?? a.created_at), submittedAt: D(a.submitted_at), confirmed: !!a.submission_confirmed_at, outcomeAt: D(a.outcome_at), source: v?.discovery_source ?? (a.application_type === "speculative" ? "speculative" : null),
      roleFamily: v?.role_family ?? null, practiceType: e?.practice_type ?? null, zone: v?.zone_code ?? null, cvVersion: a.cv_document_id ? cvLabel.get(a.cv_document_id) ?? null : null,
      suitability: prio.suitability_total ?? res.total ?? null, priorityStatus: prio.status ?? null, matchedPreferences: !v ? null : (v.hard_flags ?? []).length > 0 ? false : v.eligibility_status === "eligible" ? true : null,
      discoveredAt: D(v?.first_seen_at), firstResponseAt: reply, interviews: c?.i ?? 0, assessments: c?.a ?? 0, isTest: a.is_test,
    };
  });

  const defById = new Map(defs.map((d) => [d.id, d.code]));
  const sourceRuns: SourceRunFact[] = runs.filter((r) => r.source_definition_id && defById.has(r.source_definition_id)).map((r) => ({ source: defById.get(r.source_definition_id!)!, startedAt: new Date(r.started_at), status: r.status, errors: Array.isArray(r.errors) ? r.errors.length : r.errors ? 1 : 0 }));
  const feedback: FeedbackFact[] = fb.map((f) => ({ id: f.id, applicationId: f.application_id, source: f.source as "employer" | "own", kind: f.kind, tags: f.tags ?? [], occurredAt: new Date(f.occurred_at) }));
  const followups: FollowupFact[] = fups.map((f) => ({ status: f.status, dueAt: new Date(f.due_at), completedAt: D(f.completed_at) }));
  const gapFacts: RequirementGapFact[] = gaps.filter((g) => g.vacancy_id).map((g) => ({ vacancyId: g.vacancy_id!, suitability: g.total == null ? null : Number(g.total), missing: g.missing ?? [] }));

  return {
    vacancies, applications, feedback, followups, sourceRuns, gaps: gapFacts, sources: defs.map((d) => ({ code: d.code, label: d.label, enabled: d.enabled })),
    priorityFeedback: { accepted: prios.filter((p) => p.recommendation_response === "accepted").length, rejected: prios.filter((p) => p.recommendation_response === "rejected").length },
    employersDiscovered: emps.map((e) => ({ id: e.id, discoveredAt: new Date(e.first_discovered_at), isTest: e.is_test })),
  };
}

/** Period from search params. Presets are relative to today; a custom range is validated. */
export function resolvePeriod(sp: { range?: string; from?: string; to?: string }, now: Date, defaultDays: number) {
  const day = 86_400_000, today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? new Date(`${s}T00:00:00Z`) : null);
  if (sp.range === "custom" && valid(sp.from) && valid(sp.to) && valid(sp.from)! <= valid(sp.to)!) return { key: "custom", start: valid(sp.from)!, end: valid(sp.to)!, label: `${sp.from} to ${sp.to}` };
  if (sp.range === "day") return { key: "day", start: today, end: today, label: "Today" };
  if (sp.range === "week") { const dow = (today.getUTCDay() + 6) % 7, s = new Date(today.getTime() - dow * day); return { key: "week", start: s, end: new Date(s.getTime() + 6 * day), label: "This week (Mon–Sun)" }; }
  if (sp.range === "month") { const s = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)), e = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)); return { key: "month", start: s, end: e, label: "This month" }; }
  const days = sp.range && /^\d+d$/.test(sp.range) ? Math.min(730, Math.max(1, Number(sp.range.slice(0, -1)))) : defaultDays;
  return { key: `${days}d`, start: new Date(today.getTime() - (days - 1) * day), end: today, label: `Last ${days} days (to ${iso(today)})` };
}
