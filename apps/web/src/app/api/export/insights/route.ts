import { NextResponse } from "next/server";
import { computeInsights, isoDay } from "@ajis/shared";
import type { Json } from "@ajis/db";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadFacts, loadPrefs, resolvePeriod } from "@/server/insights";

// Exports only the sections Erin ticks, for the period she is looking at. Employer and vacancy names are left out unless she asks for them, and
// contact details, email addresses and document files are never included. Each export is logged.
const SECTIONS = ["summary", "funnel", "sources", "recommendations", "feedback", "applications"] as const;
const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export async function GET(req: Request) {
  const supabase = await createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Not signed in", { status: 401 });
  const url = new URL(req.url), q = url.searchParams;
  const sections = q.getAll("sections").filter((s): s is (typeof SECTIONS)[number] => (SECTIONS as readonly string[]).includes(s));
  if (sections.length === 0) return new NextResponse("Choose at least one section to export.", { status: 400 });
  const names = q.get("names") === "1", format = q.get("format") === "csv" ? "csv" : "json";
  const prefs = await loadPrefs(supabase), now = new Date();
  const p = resolvePeriod({ range: q.get("range") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined }, now, prefs.defaultPeriodDays);
  const facts = await loadFacts(supabase);
  const ins = computeInsights(facts, p, { now, maturityDays: prefs.maturityDays, backlogDays: prefs.backlogDays });
  const anon = new Map<string, string>(); const name = (id: string, label: string, kind: string) => names ? label : (anon.get(id) ?? anon.set(id, `${kind} ${anon.size + 1}`).get(id)!);
  const rate = (r: typeof ins.rates.interview) => ({ numerator: r.numerator, denominator: r.denominator, rate: r.rate, low: r.low, high: r.high, sample: r.level, pending: r.pending, excluded: r.excluded });

  const out: Record<string, unknown[]> = {};
  if (sections.includes("summary")) out.summary = [{ period: `${isoDay(ins.period.start)} to ${isoDay(ins.period.end)}`, partial: ins.period.isPartial, ...ins.overview, duplicateRate: undefined, expiredRate: undefined, sourcesWithMostRelevant: undefined },
    ...Object.entries(ins.rates).map(([metric, r]) => ({ metric, ...rate(r), excluded: r.excluded.map((e) => `${e.count} ${e.reason}`).join("; ") }))];
  if (sections.includes("funnel")) out.funnel = ins.funnel.map((f) => ({ step: f.label, cohort: f.cohort, count: f.count }));
  if (sections.includes("sources")) out.sources = ins.sources.map((s) => ({ source: s.label, found: s.discovered, uniqueEmployers: s.uniqueEmployers, relevant: s.relevant, waitingReview: s.pendingReview, applied: s.appliedFrom, interviews: s.interviews, offers: s.offers, closedOrGone: s.stale, duplicates: s.rawIncludingDuplicates - s.discovered, sample: s.relevantRate.level }));
  if (sections.includes("recommendations")) {
    const { data } = await supabase.from("insight_recommendations").select("title, area, observation, sample_size, confidence, status, status_note, decided_at, first_seen_at").order("first_seen_at");
    out.recommendations = data ?? [];
  }
  if (sections.includes("feedback")) {
    const { data } = await supabase.from("application_feedback").select("application_id, source, kind, body, tags, occurred_at").order("occurred_at");
    out.feedback = (data ?? []).map((f) => ({ application: name(f.application_id, "", "Application"), source: f.source === "employer" ? "employer said" : "my reflection", kind: f.kind, tags: f.tags.join("; "), date: f.occurred_at, text: f.body }));
  }
  if (sections.includes("applications")) out.applications = facts.applications.filter((a) => !a.isTest).map((a) => ({ application: name(a.id, a.label, "Application"), type: a.type, stage: a.stage, selected: isoDay(a.selectedAt), submitted: a.confirmed && a.submittedAt ? isoDay(a.submittedAt) : "", firstReply: a.firstResponseAt ? isoDay(a.firstResponseAt) : "", interviews: a.interviews, assessments: a.assessments, source: a.source ?? "", cvVersion: a.cvVersion ?? "" }));

  await supabase.from("export_history").insert({ kind: format, period_start: isoDay(p.start), period_end: isoDay(p.end), sections, row_counts: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])) as Json });
  const stamp = isoDay(now);
  if (format === "csv") {
    const lines: string[] = [];
    for (const [section, rows] of Object.entries(out)) {
      const objs = rows as Record<string, unknown>[], cols = [...new Set(objs.flatMap((r) => Object.keys(r).filter((k) => r[k] !== undefined && typeof r[k] !== "object" || k === "excluded")))];
      lines.push(`# ${section}`, cols.map(esc).join(","), ...objs.map((r) => cols.map((c) => esc(Array.isArray(r[c]) ? JSON.stringify(r[c]) : r[c])).join(",")), "");
    }
    return new NextResponse(lines.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="insights-${stamp}.csv"`, "Cache-Control": "no-store" } });
  }
  return new NextResponse(JSON.stringify({ exported_at: now.toISOString(), period: { start: isoDay(p.start), end: isoDay(p.end), partial: ins.period.isPartial }, includes_names: names, ...out }, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="insights-${stamp}.json"`, "Cache-Control": "no-store" } });
}
