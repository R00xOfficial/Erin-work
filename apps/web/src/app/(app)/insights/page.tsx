import Link from "next/link";
import { computeInsights, detectFindings, feedbackThemes, isoDay, pct, type Insights } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, humanise } from "@/lib/utils";
import { loadFacts, loadPrefs, resolvePeriod } from "@/server/insights";
import { Bars, Delta, GroupTable, RateCard, SampleBadge, Stat } from "@/components/insights/bits";
import * as act from "@/server/actions/insights";

export const dynamic = "force-dynamic";

const TABS = [["overview", "Overview"], ["funnel", "Funnel"], ["sources", "Sources"], ["applications", "Applications"], ["employers", "Employer insights"], ["recommendations", "Recommendations"], ["history", "History"], ["definitions", "Definitions"]] as const;
type Sp = { tab?: string; range?: string; from?: string; to?: string; open?: string };
const DEF: Record<string, string> = {
  discovery_to_research: "Eligible vacancies first seen in the period that have been researched, divided by eligible vacancies first seen in the period. Test records, duplicates and ineligible vacancies are left out.",
  research_to_priority: "Researched vacancies that are prioritised for action (high or recommended), divided by researched vacancies. On-hold and backlog items are neither counted as prioritised nor as failures.",
  submission: "Applications selected in the period with a confirmed submission, divided by applications selected. Withdrawn-before-submission applications are left out; ones still being prepared are shown as in progress.",
  interview: "Confirmed submissions in the period with at least one interview or assessment, divided by confirmed submissions that are resolved or older than the maturity window. Newer silent ones are shown as too early to tell.",
  offer: "Same denominator as the interview rate; counts an offer whether later accepted or declined.",
  response: "Same denominator; a reply is an interview, assessment, rejection, offer or logged employer feedback. Acknowledgements do not count.",
};

export default async function InsightsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";
  const { supabase } = await requireUser();
  const prefs = await loadPrefs(supabase), now = new Date();
  const period = resolvePeriod(sp, now, prefs.defaultPeriodDays);
  const facts = await loadFacts(supabase);
  const ins = computeInsights(facts, period, { now, maturityDays: prefs.maturityDays, backlogDays: prefs.backlogDays });
  const findings = detectFindings(facts, ins, { now, maturityDays: prefs.maturityDays, backlogDays: prefs.backlogDays });
  const [{ data: recs }, { data: sugg }, { data: reports }, { data: changes }, { data: exportsLog }, { data: defs }, { data: fb }] = await Promise.all([
    supabase.from("insight_recommendations").select("*").order("created_at", { ascending: false }),
    supabase.from("profile_suggestions").select("*").order("created_at", { ascending: false }),
    supabase.from("insight_reports").select("id, kind, period_start, period_end, is_partial, created_at, note, results, params").order("created_at", { ascending: false }).limit(30),
    supabase.from("strategy_changes").select("*").order("changed_on", { ascending: false }),
    supabase.from("export_history").select("*").order("created_at", { ascending: false }).limit(10),
    supabase.from("metric_definitions").select("*").eq("is_active", true).order("key"),
    supabase.from("application_feedback").select("id, application_id, source, kind, body, tags, occurred_at, applications(vacancies(title), employers(display_name, legal_name))").order("occurred_at", { ascending: false }).limit(100),
  ]);
  const qs = (patch: Partial<Sp>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ tab: sp.tab, range: sp.range, from: sp.from, to: sp.to, ...patch })) if (v) p.set(k, v); return `/insights?${p}`; };
  const o = ins.overview;
  const noData = facts.vacancies.length === 0 && facts.applications.length === 0;
  const openRecs = (recs ?? []).filter((r) => ["proposed", "deferred", "accepted"].includes(r.status));
  const themes = feedbackThemes(facts.feedback);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold mr-auto">Insights</h1>
        {([["day", "Today"], ["week", "Week"], ["month", "Month"], ["30d", "30 days"], ["90d", "90 days"]] as const).map(([k, l]) => <Link key={k} href={qs({ range: k, from: undefined, to: undefined })} className={`btn btn-sm ${period.key === k ? "btn-primary" : ""}`}>{l}</Link>)}
        <form className="flex gap-1 items-center text-xs" method="get"><input type="hidden" name="range" value="custom" /><input type="hidden" name="tab" value={tab} /><input type="date" name="from" defaultValue={sp.from ?? isoDay(period.start)} /><span>to</span><input type="date" name="to" defaultValue={sp.to ?? isoDay(period.end)} /><button className="btn btn-sm">Apply</button></form>
      </div>
      <p className="muted text-xs">{period.label} · {isoDay(ins.period.start)} to {isoDay(ins.period.end)}{ins.period.isPartial ? ` · not finished (${ins.period.elapsedDays} of ${ins.period.days} days)` : ""}. Everything here is calculated live from your own records; test records are excluded. These are patterns to investigate, not conclusions.</p>
      <nav className="flex flex-wrap gap-1 border-b border-border">{TABS.map(([k, l]) => <Link key={k} href={qs({ tab: k })} className={`px-3 py-1.5 text-sm ${tab === k ? "border-b-2 border-accent font-medium" : "muted"}`}>{l}{k === "recommendations" && openRecs.filter((r) => r.status === "proposed").length > 0 ? ` (${openRecs.filter((r) => r.status === "proposed").length})` : ""}</Link>)}</nav>

      {ins.dataNotes.length > 0 && <div className="card text-sm space-y-1">{ins.dataNotes.map((n, i) => <p key={i}>{n}</p>)}{noData && <p className="muted">There is nothing to analyse until discovery has run and applications have been recorded. Activity that would help most: review discovered vacancies, record applications as you submit them, and log replies and outcomes.</p>}</div>}

      {tab === "overview" && <Overview ins={ins} />}
      {tab === "funnel" && <Funnel ins={ins} open={sp.open} qs={qs} findings={findings.filter((f) => f.funnel)} />}
      {tab === "sources" && <Sources ins={ins} />}
      {tab === "applications" && <ApplicationsTab ins={ins} />}
      {tab === "employers" && <EmployersTab ins={ins} themes={themes} />}
      {tab === "recommendations" && <Recs recs={recs ?? []} sugg={sugg ?? []} fb={fb ?? []} found={findings.length} />}
      {tab === "history" && (
        <div className="space-y-4">
          <section className="card space-y-2"><h2 className="font-semibold">Saved reports</h2>
            <form action={act.saveReport} className="flex flex-wrap gap-2 items-end"><input type="hidden" name="range" value={period.key} /><input type="hidden" name="from" value={isoDay(period.start)} /><input type="hidden" name="to" value={isoDay(period.end)} /><div className="flex-1 min-w-56"><label>Note (optional)</label><input name="note" /></div><button className="btn btn-primary">Save a report for {period.label}</button></form>
            <p className="muted text-xs">A saved report is a snapshot of what you saw, with the metric definitions it used. It cannot be edited or deleted.{ins.period.isPartial ? " This period is not finished and will be labelled partial." : ""}</p>
            <table><thead><tr><th>Saved</th><th>Period</th><th>Submitted</th><th>Interviews</th><th>Note</th></tr></thead><tbody>{(reports ?? []).map((r) => { const res = r.results as unknown as Insights; return (
              <tr key={r.id}><td>{fmtDateTime(r.created_at)}</td><td>{fmtDate(r.period_start)} – {fmtDate(r.period_end)} {r.is_partial && <span className="badge badge-warn">partial</span>}</td><td>{res.overview?.applicationsSubmitted ?? "—"}</td><td>{res.overview?.interviewsOrAssessments ?? "—"}</td><td className="muted">{r.note ?? ""}</td></tr>); })}{(reports ?? []).length === 0 && <tr><td colSpan={5} className="muted text-center py-4">None saved.</td></tr>}</tbody></table>
          </section>
          <section className="card space-y-2"><h2 className="font-semibold">Strategy changes you made</h2>
            <form action={act.recordStrategyChange} className="grid-form"><div><label>Area</label><select name="area">{["discovery", "sources", "research", "prioritisation", "applications", "interviews", "follow_up", "outreach", "profile", "scoring", "other"].map((a) => <option key={a} value={a}>{humanise(a)}</option>)}</select></div><div><label>What did you change?</label><input name="title" required /></div><div><label>When</label><input type="date" name="changed_on" defaultValue={isoDay(now)} /></div><div><label>Linked recommendation</label><select name="recommendation_id"><option value="">None</option>{(recs ?? []).map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select></div><div className="col-span-full"><label>Notes</label><textarea name="description" rows={2} /></div><div className="col-span-full"><button className="btn btn-sm">Record the change</button></div></form>
            <p className="muted text-xs">Logging a change lets later periods be read against it. The platform never makes these changes for you.</p>
            <ul className="text-sm space-y-1">{(changes ?? []).map((c) => <li key={c.id}><span className="badge mr-2">{humanise(c.area)}</span>{c.title} <span className="muted">· {fmtDate(c.changed_on)}</span>{c.description && <div className="muted text-xs">{c.description}</div>}</li>)}</ul>
          </section>
          <section className="card space-y-2"><h2 className="font-semibold">Recommendations decided</h2>
            <ul className="text-sm space-y-1">{(recs ?? []).filter((r) => r.status !== "proposed").map((r) => <li key={r.id}><span className={`badge mr-2 ${r.status === "accepted" ? "badge-ok" : ""}`}>{humanise(r.status)}</span>{r.title} <span className="muted">· {r.decided_at ? fmtDate(r.decided_at) : fmtDate(r.updated_at)}{r.status_note ? ` · ${r.status_note}` : ""}</span></li>)}</ul>
          </section>
          <section className="card space-y-2"><h2 className="font-semibold">Export</h2>
            <form action="/api/export/insights" method="get" className="space-y-2">
              <input type="hidden" name="range" value={period.key} /><input type="hidden" name="from" value={isoDay(period.start)} /><input type="hidden" name="to" value={isoDay(period.end)} />
              <p className="text-xs muted">Choose what to include for {period.label}. Nothing else is exported.</p>
              <div className="flex flex-wrap gap-4 text-sm">{([["summary", "Summary and rates"], ["funnel", "Funnel counts"], ["sources", "Source comparison"], ["recommendations", "Recommendations and decisions"], ["feedback", "Feedback and reflections (text)"], ["applications", "Application list"]] as const).map(([k, l]) => <label key={k} className="flex gap-2 items-center m-0"><input type="checkbox" name="sections" value={k} defaultChecked={["summary", "funnel", "sources"].includes(k)} className="w-auto" />{l}</label>)}</div>
              <label className="flex gap-2 items-center text-sm"><input type="checkbox" name="names" value="1" className="w-auto" /> Include employer and vacancy names (otherwise they are replaced by numbers)</label>
              <div className="flex gap-2"><button className="btn btn-primary" name="format" value="json">Download JSON</button><button className="btn" name="format" value="csv">Download CSV</button></div>
            </form>
            {(exportsLog ?? []).length > 0 && <p className="muted text-xs">Recent exports: {(exportsLog ?? []).map((e) => `${fmtDate(e.created_at)} (${e.sections.join(", ")})`).join("; ")}</p>}
          </section>
          <form action={act.saveInsightPrefs} className="card grid-form"><div className="col-span-full"><h2 className="font-semibold">Settings</h2></div>
            <div><label>Default period (days)</label><input name="default_period_days" type="number" defaultValue={prefs.defaultPeriodDays} /></div>
            <div><label>Days before a silent submission counts as judged</label><input name="maturity_days" type="number" defaultValue={prefs.maturityDays} /></div>
            <div><label>Days before an unsubmitted application is a backlog</label><input name="backlog_days" type="number" defaultValue={prefs.backlogDays} /></div>
            <div className="col-span-full"><button className="btn btn-sm">Save</button></div></form>
        </div>
      )}
      {tab === "definitions" && (
        <div className="card space-y-3"><p className="text-sm muted">Every rate shown uses these definitions. Reports record the version used.</p>
          {(defs ?? []).map((d) => <div key={`${d.key}${d.version}`} className="text-sm"><div className="font-medium">{d.label} <span className="muted text-xs">v{d.version}</span></div><div><strong>Counts:</strong> {d.numerator}</div><div><strong>Out of:</strong> {d.denominator ?? "—"}</div><div><strong>Left out:</strong> {d.exclusions ?? "—"}</div>{d.notes && <div className="muted">{d.notes}</div>}</div>)}
          <p className="text-sm"><strong>Sample labels.</strong> Fewer than 5 records: too few to interpret. 5–19: preliminary. 20–39: moderate. 40 or more: reasonable. Ranges shown are 95% Wilson intervals. A difference between two groups is called reliable only when their ranges do not overlap, and even then it is an association, not proof of cause.</p></div>
      )}
    </div>
  );
}

function Overview({ ins }: { ins: Insights }) {
  const o = ins.overview, p = ins.previous, partial = ins.period.isPartial;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Stat label="Employers discovered" value={o.employersDiscovered} /><Stat label="Vacancies discovered" value={o.vacanciesDiscovered} sub={`${o.vacanciesReviewed} reviewed · ${o.vacanciesAwaitingReview} waiting`} />
        <Stat label="Applications prepared" value={o.applicationsPrepared} /><Stat label="Applications submitted (confirmed)" value={o.applicationsSubmitted} />
        <Stat label="Awaiting a response" value={o.awaitingResponse} /><Stat label="Interviews or assessments" value={o.interviewsOrAssessments} /><Stat label="Offers" value={o.offers} /><Stat label="Not yet submitted" value={o.inProgress} sub="in preparation" />
      </div>
      <div className="card"><div className="flex flex-wrap gap-x-6 gap-y-1 text-sm"><span>Vacancies: <Delta now={o.vacanciesDiscovered} before={p.vacanciesDiscovered} partial={partial} /></span><span>Prepared: <Delta now={o.applicationsPrepared} before={p.applicationsPrepared} partial={partial} /></span><span>Submitted: <Delta now={o.applicationsSubmitted} before={p.applicationsSubmitted} partial={partial} /></span><span>Replies: <Delta now={ins.series.reduce((a, s) => a + s.responses, 0)} before={p.responses} partial={partial} /></span></div></div>
      <div className="card"><h2 className="font-semibold text-sm mb-2">Activity over time</h2><Bars series={ins.series} keys={[{ key: "discovered", label: "Vacancies discovered", color: "#64748b" }, { key: "selected", label: "Applications started", color: "#2563eb" }, { key: "submitted", label: "Submitted", color: "#16a34a" }, { key: "responses", label: "Employer replies", color: "#d97706" }]} /></div>
      <div className="grid gap-3 md:grid-cols-3">
        <RateCard title="Discovery to research" rate={ins.rates.discoveryToResearch} definition={DEF.discovery_to_research!} />
        <RateCard title="Research to priority" rate={ins.rates.researchToPriority} definition={DEF.research_to_priority!} />
        <RateCard title="Submission rate" rate={ins.rates.submission} definition={DEF.submission!} />
        <RateCard title="Reply rate" rate={ins.rates.response} definition={DEF.response!} />
        <RateCard title="Interview rate" rate={ins.rates.interview} definition={DEF.interview!} />
        <RateCard title="Offer rate" rate={ins.rates.offer} definition={DEF.offer!} />
      </div>
      <div className="card space-y-1"><h2 className="font-semibold text-sm">Where submitted applications stand</h2><p className="muted text-xs">Unknown and pending outcomes are kept apart from rejections and withdrawals.</p>
        <ul className="text-sm grid sm:grid-cols-2 gap-x-6">{ins.outcomes.map((x) => <li key={x.key} className="flex justify-between"><span>{x.label}</span><span className="font-medium">{x.count}</span></li>)}</ul></div>
      <div className="card text-sm space-y-1"><div>Duplicate vacancy rate: {o.duplicateRate.denominator ? `${o.duplicateRate.numerator} of ${o.duplicateRate.denominator} (${pct(o.duplicateRate.rate)})` : "no data"}</div><div>Closed or disappeared: {o.expiredRate.denominator ? `${o.expiredRate.numerator} of ${o.expiredRate.denominator} (${pct(o.expiredRate.rate)})` : "no data"}</div>
        <div>Typical time from discovery to submission: {ins.timing.discoveryToSubmission.medianDays == null ? "not enough data" : `${ins.timing.discoveryToSubmission.medianDays.toFixed(0)} days (n=${ins.timing.discoveryToSubmission.n})`} · from submission to first reply: {ins.timing.submissionToResponse.medianDays == null ? "not enough data" : `${ins.timing.submissionToResponse.medianDays.toFixed(0)} days (n=${ins.timing.submissionToResponse.n})`}</div></div>
    </div>
  );
}

function recordHref(r: { kind: string; id: string }) { return r.kind === "vacancy" ? `/vacancies/${r.id}` : `/applications/${r.id}`; }
function Funnel({ ins, open, qs, findings }: { ins: Insights; open?: string; qs: (p: Partial<Sp>) => string; findings: ReturnType<typeof detectFindings> }) {
  const max = Math.max(1, ...ins.funnel.map((s) => s.count));
  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <p className="muted text-xs">Opportunity steps count vacancies first seen in the period. Application steps count applications started in the period, including speculative ones, so a later step can occasionally exceed an earlier one. Several interviews on one application count once. Applications still in progress are not failures.</p>
        {ins.funnel.map((s) => (
          <div key={s.key}>
            <div className="flex items-center gap-2 text-sm"><span className="w-56">{s.label}</span><div className="flex-1 bg-surface-2 rounded h-5"><div className="bg-accent h-5 rounded" style={{ width: `${(s.count / max) * 100}%`, minWidth: s.count ? 4 : 0 }} /></div><Link className="w-12 text-right underline" href={qs({ open: open === s.key ? undefined : s.key })}>{s.count}</Link></div>
            {s.note && <div className="muted text-xs ml-56">{s.note}</div>}
            {open === s.key && <ul className="ml-56 text-sm my-1 columns-1 md:columns-2">{s.records.slice(0, 200).map((r) => <li key={r.id}><Link className="underline" href={recordHref(r)}>{r.label}</Link></li>)}{s.records.length === 0 && <li className="muted">No records.</li>}{s.records.length > 200 && <li className="muted">…and {s.records.length - 200} more</li>}</ul>}
          </div>))}
      </div>
      <div className="card space-y-2"><h2 className="font-semibold text-sm">Possible bottlenecks to look into</h2>
        {findings.length === 0 ? <p className="muted text-sm">Nothing stands out on the data available. That may be because there is not yet enough of it; see the sample labels.</p> : findings.map((f) => <div key={f.fingerprint} className="text-sm"><div className="font-medium">{f.title} <span className="badge ml-1">{f.confidence} confidence</span></div><div>{f.observation}</div><div className="muted text-xs">{f.why}</div></div>)}
        <p className="muted text-xs">These are prompts to investigate, not conclusions about what you are doing wrong. Open the Recommendations tab to act on them.</p></div>
    </div>
  );
}

function Sources({ ins }: { ins: Insights }) {
  return (
    <div className="space-y-3">
      <p className="muted text-xs">A source that finds many vacancies is not necessarily better than one that finds fewer, better-matched ones. Relevance means eligible and not dismissed; vacancies not yet reviewed are shown as waiting, not irrelevant. With fewer than 20 vacancies a source is a preliminary observation, not a ranking.</p>
      <div className="card p-0 overflow-x-auto"><table><thead><tr><th>Source</th><th>Found</th><th>Employers</th><th>Relevant</th><th>Waiting</th><th>Applied</th><th>Interviews</th><th>Offers</th><th>Closed / gone</th><th>Duplicates</th><th>Refreshes ok</th><th>Reading</th></tr></thead>
        <tbody>{ins.sources.map((s) => (
          <tr key={s.source}><td className="font-medium">{s.label}</td><td>{s.discovered}</td><td>{s.uniqueEmployers}</td><td>{s.relevant} <span className="muted text-xs">({s.discovered ? pct(s.relevantRate.rate) : "—"})</span></td><td>{s.pendingReview}</td><td>{s.appliedFrom}</td><td>{s.interviews}</td><td>{s.offers}</td>
            <td>{s.stale} <span className="muted text-xs">({s.discovered ? pct(s.staleRate.rate) : "—"})</span></td><td>{s.rawIncludingDuplicates - s.discovered}</td><td>{s.reliability ? `${s.reliability.runs - s.reliability.failed}/${s.reliability.runs}` : <span className="muted">no runs</span>}</td><td><SampleBadge level={s.relevantRate.level} /></td></tr>))}
          {ins.sources.length === 0 && <tr><td colSpan={12} className="muted text-center py-6">No vacancies were discovered in this period, so there is nothing to compare. Run discovery, or widen the period.</td></tr>}</tbody></table></div>
    </div>
  );
}

function ApplicationsTab({ ins }: { ins: Insights }) {
  const b = ins.breakdowns;
  return (
    <div className="space-y-3">
      <p className="muted text-xs">Breakdowns use confirmed submissions in the period that are old enough to judge. They show associations in your own results, not causes. Small groups are labelled; do not choose a strategy from a handful of applications.</p>
      <div className="grid gap-3 md:grid-cols-3"><RateCard title="Reply rate" rate={ins.rates.response} definition={DEF.response!} /><RateCard title="Interview rate" rate={ins.rates.interview} definition={DEF.interview!} /><RateCard title="Offer rate" rate={ins.rates.offer} definition={DEF.offer!} /></div>
      <GroupTable title="Direct application or speculative outreach" rows={b.type} /><GroupTable title="Role family" rows={b.roleFamily} /><GroupTable title="Source" rows={b.source} /><GroupTable title="CV version used" rows={b.cv} /><GroupTable title="Area" rows={b.zone} /><GroupTable title="Matched your stated preferences" rows={b.matched} />
    </div>
  );
}

function EmployersTab({ ins, themes }: { ins: Insights; themes: ReturnType<typeof feedbackThemes> }) {
  return (
    <div className="space-y-3">
      <GroupTable title="By type of practice" rows={ins.breakdowns.practiceType} />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="card"><h3 className="font-semibold text-sm">Recurring themes in employer feedback</h3><p className="muted text-xs">Counted once per application. Only what employers themselves said.</p>{themes.employer.length === 0 ? <p className="muted text-sm mt-1">No tagged employer feedback yet.</p> : <ul className="text-sm mt-1">{themes.employer.slice(0, 10).map((t) => <li key={t.tag}>{t.tag} <span className="muted">· {t.applications} application{t.applications === 1 ? "" : "s"}</span></li>)}</ul>}</div>
        <div className="card"><h3 className="font-semibold text-sm">Themes in your own reflections</h3><p className="muted text-xs">Your interpretation, kept separate from what employers said.</p>{themes.own.length === 0 ? <p className="muted text-sm mt-1">No tagged reflections yet.</p> : <ul className="text-sm mt-1">{themes.own.slice(0, 10).map((t) => <li key={t.tag}>{t.tag} <span className="muted">· {t.applications}</span></li>)}</ul>}</div>
      </div>
    </div>
  );
}

type RecRow = { id: string; code: string; area: string; title: string; observation: string; evidence: unknown; sample_size: number; why_it_matters: string; proposed_action: string; confidence: string; status: string; status_note: string | null; deferred_until: string | null; last_seen_at: string; first_seen_at: string };
type SuggRow = { id: string; kind: string; title: string; detail: string; evidence: unknown; status: string; status_note: string | null };
function Decide({ id, fn, applied }: { id: string; fn: "rec" | "sugg"; applied?: boolean }) {
  const bind = (d: "accepted" | "dismissed" | "deferred" | "applied") => (fn === "rec" ? act.decideRecommendation.bind(null, id, d as never) : act.decideSuggestion.bind(null, id, d));
  return (
    <form className="flex flex-wrap gap-2 items-end mt-2"><input name="note" placeholder="Note (required to dismiss)" className="min-w-56" />
      <button formAction={bind("accepted")} className="btn btn-sm btn-primary">Accept</button><button formAction={bind("dismissed")} className="btn btn-sm">Dismiss</button>
      <input name="defer_days" type="number" defaultValue={14} min={1} className="w-16" title="Days to defer" /><button formAction={bind("deferred")} className="btn btn-sm">Defer</button>
      {applied && <button formAction={bind("applied")} className="btn btn-sm">I made this change</button>}</form>
  );
}
function Recs({ recs, sugg, fb, found }: { recs: RecRow[]; sugg: SuggRow[]; fb: { id: string; application_id: string; source: string; kind: string; body: string; tags: string[]; occurred_at: string; applications: unknown }[]; found: number }) {
  const open = recs.filter((r) => ["proposed", "deferred", "accepted"].includes(r.status));
  const openS = sugg.filter((r) => ["proposed", "deferred", "accepted"].includes(r.status));
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3"><form action={act.refreshRecommendations}><button className="btn btn-primary">Refresh from the latest data</button></form><span className="muted text-xs">Looks at the last 90 days and updates existing recommendations rather than duplicating them. {found} pattern{found === 1 ? "" : "s"} currently observed. Nothing is changed for you: accepting only records your decision.</span></div>
      {open.length === 0 && <div className="card text-sm muted">No open recommendations. That usually means either nothing stands out or there is not yet enough data for a fair conclusion; thresholds are deliberately conservative so a few records never trigger advice.</div>}
      {open.map((r) => (
        <section key={r.id} className="card space-y-1">
          <div className="flex flex-wrap gap-2 items-center"><h3 className="font-semibold mr-auto">{r.title}</h3><span className="badge">{humanise(r.area)}</span><span className="badge">{r.confidence} confidence</span><span className={`badge ${r.status === "accepted" ? "badge-ok" : r.status === "deferred" ? "badge-warn" : ""}`}>{humanise(r.status)}{r.status === "deferred" && r.deferred_until ? ` to ${fmtDate(r.deferred_until)}` : ""}</span></div>
          <p className="text-sm"><strong>What was observed:</strong> {r.observation}</p>
          <p className="text-sm"><strong>Sample:</strong> {r.sample_size} record{r.sample_size === 1 ? "" : "s"}. <span className="muted">Last checked {fmtDate(r.last_seen_at)}.</span></p>
          <p className="text-sm"><strong>Why it may matter:</strong> {r.why_it_matters}</p>
          <p className="text-sm"><strong>Suggested action:</strong> {r.proposed_action}</p>
          <details className="text-xs"><summary className="cursor-pointer muted">Supporting data</summary><pre className="whitespace-pre-wrap">{JSON.stringify(r.evidence, null, 1)}</pre></details>
          {r.status_note && <p className="text-xs muted">Your note: {r.status_note}</p>}
          <Decide id={r.id} fn="rec" />
        </section>))}
      <section className="space-y-2"><h2 className="font-semibold">Suggested profile and strategy refinements</h2><p className="muted text-xs">These need your review. A requirement appearing often in job descriptions does not mean you have it, and nothing here edits your profile. Make any change yourself in Settings → Candidate profile, then mark it as done.</p>
        {openS.length === 0 && <div className="card text-sm muted">None at the moment.</div>}
        {openS.map((s) => <div key={s.id} className="card space-y-1"><div className="flex gap-2 items-center"><h3 className="font-semibold mr-auto">{s.title}</h3><span className="badge">{humanise(s.kind)}</span><span className="badge">{humanise(s.status)}</span></div><p className="text-sm">{s.detail}</p><details className="text-xs"><summary className="cursor-pointer muted">Supporting data</summary><pre className="whitespace-pre-wrap">{JSON.stringify(s.evidence, null, 1)}</pre></details><Decide id={s.id} fn="sugg" applied /></div>)}</section>
      <section className="card space-y-2"><h2 className="font-semibold">Feedback on file</h2><p className="muted text-xs">Employer feedback and your own reflections are labelled separately. Add them on each application. No reason for a rejection is inferred when the employer gave none.</p>
        <ul className="text-sm space-y-1">{fb.map((f) => { const a = f.applications as { vacancies: { title: string } | null; employers: { display_name: string | null; legal_name: string } | null } | null; return <li key={f.id}><span className={`badge mr-2 ${f.source === "employer" ? "badge-accent" : ""}`}>{f.source === "employer" ? "Employer said" : "My reflection"}</span><Link className="underline" href={`/applications/${f.application_id}`}>{a?.vacancies?.title ?? a?.employers?.display_name ?? a?.employers?.legal_name ?? "Application"}</Link> · {humanise(f.kind)} · {fmtDate(f.occurred_at)}<div className="muted text-xs whitespace-pre-wrap">{f.body}{f.tags.length ? ` [${f.tags.join(", ")}]` : ""}</div></li>; })}{fb.length === 0 && <li className="muted">None yet.</li>}</ul></section>
    </div>
  );
}
