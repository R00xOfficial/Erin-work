import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate, humanise } from "@/lib/utils";
import { requestEmployerResearch, requestVacancyResearch } from "@/server/actions/research";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
type SP = Record<string, string | undefined>;
const href = (sp: SP, patch: SP) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) q.set(k, v); return `/research?${q.toString()}`; };
const PRESETS: [string, string][] = [["", "All"], ["high_fit", "High fit"], ["blockers", "Potential blockers"], ["incomplete", "Incomplete research"], ["stale", "Stale evidence"], ["speculative", "Worth a speculative approach"], ["needs_review", "Needs my review"], ["failed", "Failed or partial runs"], ["ready", "Ready for Stage 3"]];

export default async function ResearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const view = sp.view === "employers" ? "employers" : "vacancies";
  const page = Math.max(1, Number(sp.page) || 1);
  const preset = sp.preset ?? "";
  const { supabase } = await requireUser();
  const { data: c } = await supabase.from("v_research_counts").select("*").maybeSingle();
  const range: [number, number] = [(page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1];

  let rows: Row[] = []; let total = 0;
  if (view === "vacancies") {
    let q = supabase.from("v_research_vacancies").select("*", { count: "exact" }).order("total", { ascending: false, nullsFirst: false }).range(...range);
    if (sp.q) q = q.ilike("title", `%${sp.q}%`);
    if (preset === "high_fit") q = q.gte("total", 70).eq("blocker_count", 0).gte("completeness", 60);
    if (preset === "blockers") q = q.gt("blocker_count", 0);
    if (preset === "incomplete") q = q.or("assessment_id.is.null,completeness.lt.60");
    if (preset === "stale") q = q.eq("stale", true);
    if (preset === "needs_review") q = q.eq("research_state", "needs_review");
    if (preset === "failed") q = q.in("run_status", ["failed", "partial"]);
    if (preset === "ready") q = q.eq("ready_for_stage3", true);
    const { data, count, error } = await q; if (error) throw new Error(error.message);
    rows = (data ?? []).map((r) => ({ id: r.id!, name: r.title ?? "", sub: r.employer_name, ...pick(r) })); total = count ?? 0;
  } else {
    let q = supabase.from("v_research_employers").select("*", { count: "exact" }).order("total", { ascending: false, nullsFirst: false }).range(...range);
    if (sp.q) q = q.ilike("name", `%${sp.q}%`);
    if (preset === "high_fit") q = q.gte("total", 70).eq("blocker_count", 0).gte("completeness", 60);
    if (preset === "blockers") q = q.gt("blocker_count", 0);
    if (preset === "incomplete") q = q.or("assessment_id.is.null,completeness.lt.60");
    if (preset === "stale") q = q.eq("stale", true);
    if (preset === "speculative") q = q.eq("open_vacancy_count", 0).gte("total", 60).eq("blocker_count", 0);
    if (preset === "needs_review") q = q.eq("research_state", "needs_review");
    if (preset === "failed") q = q.in("run_status", ["failed", "partial"]);
    if (preset === "ready") q = q.eq("ready_for_stage3", true);
    const { data, count, error } = await q; if (error) throw new Error(error.message);
    rows = (data ?? []).map((r) => ({ id: r.id!, name: r.name ?? "", sub: `${r.open_vacancy_count ?? 0} open vacancies`, ...pick(r) })); total = count ?? 0;
  }
  const research = view === "vacancies" ? requestVacancyResearch : requestEmployerResearch;
  const base = view === "vacancies" ? "/research/vacancies" : "/research/employers";
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold mr-auto">Research &amp; scoring</h1><Link className="btn" href="/discovery">Back to Discovery</Link></div>
      {c && !c.profile_approved && <div className="card text-sm border-warn">Your candidate profile (v{c.profile_version}) is not approved. Assessments run, but they stay preliminary and nothing can go to Stage 3 until you <Link className="underline" href="/settings/profile">approve it</Link>.</div>}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-8">
        <Tile label="Vacancies in research" value={c?.vacancies_in_research} to={href({}, { view: "vacancies" })} />
        <Tile label="Needing my review" value={c?.vacancies_needs_review} to={href({}, { view: "vacancies", preset: "needs_review" })} />
        <Tile label="With blockers" value={c?.vacancies_with_blockers} to={href({}, { view: "vacancies", preset: "blockers" })} />
        <Tile label="Vacancies ready" value={c?.vacancies_ready} to={href({}, { view: "vacancies", preset: "ready" })} />
        <Tile label="Employers in research" value={c?.employers_in_research} to={href({}, { view: "employers" })} />
        <Tile label="Employers ready" value={c?.employers_ready} to={href({}, { view: "employers", preset: "ready" })} />
        <Tile label="Run problems (7d)" value={c?.recent_run_problems} to={href({}, { preset: "failed" })} />
        <Tile label="Awaiting research" value={c?.vacancies_awaiting} to={href({}, { view: "vacancies", preset: "incomplete" })} />
      </div>
      <div className="flex gap-2 border-b border-border">
        {(["vacancies", "employers"] as const).map((t) => <Link key={t} href={href({}, { view: t })} className={`px-3 py-2 text-sm -mb-px border-b-2 ${view === t ? "border-accent font-semibold" : "border-transparent muted"}`}>{t === "vacancies" ? "Vacancies" : "Employers (speculative)"}</Link>)}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {PRESETS.filter(([k]) => view === "employers" || k !== "speculative").map(([k, l]) => <Link key={k} href={href(sp, { preset: k, page: "" })} className={`btn btn-sm ${preset === k ? "btn-primary" : ""}`}>{l}</Link>)}
        <form method="get" className="ml-auto flex gap-2"><input type="hidden" name="view" value={view} /><input type="hidden" name="preset" value={preset} /><input name="q" placeholder="Search" defaultValue={sp.q ?? ""} /><button className="btn btn-sm" type="submit">Search</button></form>
      </div>
      <p className="muted text-xs">{view === "employers" ? "Employer scores measure how worthwhile a speculative approach is and are not comparable with vacancy suitability scores. " : ""}Only saved items and items already researched appear here. “—” means nothing could be assessed yet, not a score of zero.</p>
      <div className="muted text-sm">{total === 0 ? "No results" : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`} {page > 1 && <Link className="btn btn-sm ml-2" href={href(sp, { page: String(page - 1) })}>Previous</Link>} {page < pages && <Link className="btn btn-sm ml-1" href={href(sp, { page: String(page + 1) })}>Next</Link>}</div>
      <div className="card p-0 overflow-x-auto">
        <table>
          <thead><tr><th>{view === "vacancies" ? "Vacancy" : "Employer"}</th><th>Score</th><th>Blockers</th><th>Completeness</th><th>Confidence</th><th>State</th><th>Last run</th><th>Computed</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link className="underline font-medium" href={`${base}/${r.id}`}>{r.name}</Link><div className="muted text-xs">{r.sub}</div></td>
                <td>{r.assessmentId ? (r.total != null && r.completeness != null ? <span className={`badge ${r.total >= 70 ? "badge-ok" : r.total >= 50 ? "badge-accent" : "badge-warn"}`}>{Math.round(r.total)}</span> : "—") : <span className="muted">none</span>}</td>
                <td>{r.blockers > 0 ? <span className="badge badge-danger">{r.blockers}</span> : <span className="muted">0</span>}{r.conflicts > 0 && <span className="badge badge-warn ml-1">{r.conflicts} conflict</span>}</td>
                <td>{r.completeness != null ? `${Math.round(r.completeness)}%` : "—"}</td>
                <td>{r.confidence != null ? `${Math.round(r.confidence)}%` : "—"}</td>
                <td><span className="badge">{humanise(r.researchState)}</span>{r.ready && <span className="badge badge-ok ml-1">ready</span>}{r.stage3 && <span className="badge badge-accent ml-1">stage 3</span>}{r.stale && <span className="badge badge-warn ml-1">stale</span>}</td>
                <td className="text-xs">{r.runStatus ? <><span className={`badge ${r.runStatus === "failed" ? "badge-danger" : r.runStatus === "partial" ? "badge-warn" : ""}`}>{r.runStatus}</span>{r.runError && <div className="text-warn max-w-xs truncate" title={r.runError}>{r.runError}</div>}</> : <span className="muted">never</span>}</td>
                <td className="muted whitespace-nowrap">{r.computedAt ? fmtDate(r.computedAt) : "—"}</td>
                <td><form action={research.bind(null, r.id, false)}><button className="btn btn-sm" disabled={r.researchState === "queued" || r.researchState === "running"}>{r.assessmentId ? "Re-research" : "Research"}</button></form></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="muted text-center py-8">Nothing here yet. Save a vacancy or employer in Discovery to start research.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface Row { id: string; name: string; sub: string | null; assessmentId: string | null; total: number | null; blockers: number; conflicts: number; completeness: number | null; confidence: number | null; researchState: string; ready: boolean; stage3: boolean; stale: boolean; runStatus: string | null; runError: string | null; computedAt: string | null }
function pick(r: { assessment_id: string | null; total: number | null; blocker_count: number | null; conflict_count: number | null; completeness: number | null; confidence: number | null; research_state: string | null; ready_for_stage3: boolean | null; stage3_saved_at: string | null; stale: boolean | null; run_status: string | null; run_error: string | null; computed_at: string | null }) {
  return { assessmentId: r.assessment_id, total: r.total == null ? null : Number(r.total), blockers: Number(r.blocker_count ?? 0), conflicts: Number(r.conflict_count ?? 0), completeness: r.completeness == null ? null : Number(r.completeness), confidence: r.confidence == null ? null : Number(r.confidence), researchState: r.research_state ?? "none", ready: !!r.ready_for_stage3, stage3: !!r.stage3_saved_at, stale: !!r.stale, runStatus: r.run_status, runError: r.run_error, computedAt: r.computed_at };
}
function Tile({ label, value, to }: { label: string; value: number | null | undefined; to: string }) {
  return <Link href={to} className="card block hover:bg-surface-2"><div className="text-2xl font-semibold">{value ?? "—"}</div><div className="muted text-xs">{label}</div></Link>;
}
