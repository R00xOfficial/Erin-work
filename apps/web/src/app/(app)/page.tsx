import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { fmtDateTime, humanise } from "@/lib/utils";
import { completeTask } from "@/server/actions/tasks";
import { completeAction } from "@/server/actions/priorities";

export const dynamic = "force-dynamic";

function Kpi({ label, value, sub, href }: { label: string; value: number | string; sub: string; href: string }) {
  return (
    <Link href={href} className="card block hover:border-accent">
      <div className="muted text-xs">{label}</div>
      <div className="kpi mt-1">{value}</div>
      <div className="muted text-xs mt-1">{sub}</div>
    </Link>
  );
}

export default async function TodayPage() {
  const { supabase } = await requireUser();
  const [{ data: c }, { data: actions }, { data: research }, { data: newVacancies }, { data: approvals }, { data: followUps }, { data: dq }] = await Promise.all([
    supabase.from("v_dashboard_counts").select("*").maybeSingle(),
    supabase.from("v_today_actions").select("*").order("due_at", { ascending: true, nullsFirst: false }).limit(40),
    supabase.from("v_queue_research").select("*").limit(8),
    supabase.from("v_queue_new_vacancies").select("*").limit(8),
    supabase.from("v_queue_outreach_approval").select("*").limit(8),
    supabase.from("v_queue_follow_up").select("*").limit(8),
    supabase.from("v_data_quality_issues").select("issue").limit(500),
  ]);
  const todayLondon = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const [{ data: planToday }, { data: topPriorities }, { data: stage3 }] = await Promise.all([
    supabase.from("plan_actions").select("id, title, estimated_minutes, priority_items(id)").eq("status", "accepted").lte("planned_for", todayLondon).order("planned_for").limit(6),
    supabase.from("v_priority_queue").select("id, name, status, score, days_left, deadline_at").eq("status", "high").eq("live", true).order("pinned", { ascending: false }).order("score_used", { ascending: false, nullsFirst: false }).limit(4),
    supabase.from("v_stage3_counts").select("*").maybeSingle(),
  ]);
  const dqCounts = new Map<string, number>();
  for (const row of dq ?? []) { const k = row.issue ?? "unknown"; dqCounts.set(k, (dqCounts.get(k) ?? 0) + 1); }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Job search command centre</h1>
        <span className="muted text-xs">Live counts from the database</span>
      </div>

      <section className="card space-y-2">
        <div className="flex items-center gap-2"><h2 className="font-semibold mr-auto">Your plan</h2><Link className="btn btn-sm" href="/priorities?tab=plan">Planner</Link><Link className="btn btn-sm" href="/priorities">Priority queue</Link></div>
        {(planToday ?? []).length === 0 && (topPriorities ?? []).length === 0 ? (
          <p className="muted text-sm">Nothing is planned or prioritised yet. Save researched opportunities for Stage 3 to build your plan. {(stage3?.unread_notifications ?? 0) > 0 && <Link className="underline" href="/priorities">{stage3?.unread_notifications} unread reminder(s)</Link>}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 text-sm">
            <div><div className="muted text-xs mb-1">Planned for today or earlier</div>{(planToday ?? []).length === 0 ? <span className="muted">Nothing accepted for today.</span> : <ul className="space-y-1">{(planToday ?? []).map((a) => <li key={a.id} className="flex gap-2 items-center"><span>{a.title}{a.estimated_minutes != null && <span className="muted text-xs"> ~{a.estimated_minutes} min</span>}</span><form action={completeAction.bind(null, a.id)} className="ml-auto"><button className="btn btn-sm">Done</button></form></li>)}</ul>}</div>
            <div><div className="muted text-xs mb-1">High priority</div>{(topPriorities ?? []).length === 0 ? <span className="muted">None right now.</span> : <ul className="space-y-1">{(topPriorities ?? []).map((t) => <li key={t.id}><Link className="underline" href={`/priorities/${t.id}`}>{t.name}</Link> <span className="muted text-xs">{t.deadline_at ? `closes in ${t.days_left} day(s)` : "closing date unknown"}</span></li>)}</ul>}</div>
          </div>
        )}
      </section>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Kpi label="Employers" value={c?.employers_total ?? 0} sub={`${c?.employers_verified ?? 0} verified · ${c?.employers_unresearched ?? 0} awaiting research`} href="/employers" />
        <Kpi label="Open eligible vacancies" value={c?.open_eligible_vacancies ?? 0} sub={`${c?.open_vacancies_all ?? 0} open in total · ${c?.vacancies_unreviewed ?? 0} unreviewed`} href="/vacancies" />
        <Kpi label="Applications in progress" value={c?.applications_in_progress ?? 0} sub={`${c?.applications_preparing ?? 0} being prepared`} href="/applications" />
        <Kpi label="Actions due" value={(c?.tasks_due ?? 0) + (c?.follow_ups_due ?? 0) + (c?.approvals_pending ?? 0)} sub={`${c?.tasks_due ?? 0} tasks · ${c?.follow_ups_due ?? 0} follow-ups · ${c?.approvals_pending ?? 0} approvals`} href="/tasks" />
      </div>

      <section className="card">
        <h2 className="font-semibold mb-3">What should I do today?</h2>
        {actions && actions.length > 0 ? (
          <table>
            <thead><tr><th>Type</th><th>Action</th><th>Detail</th><th>Due</th><th></th></tr></thead>
            <tbody>
              {actions.map((a) => (
                <tr key={`${a.kind}-${a.entity_id}`}>
                  <td><span className={`badge ${a.priority === "high" ? "badge-danger" : ""}`}>{humanise(a.kind)}</span></td>
                  <td>{a.employer_id ? <Link className="underline" href={`/employers/${a.employer_id}`}>{a.title}</Link> : a.title}</td>
                  <td className="muted">{humanise(a.subtype)}</td>
                  <td className="muted whitespace-nowrap">{fmtDateTime(a.due_at)}</td>
                  <td>
                    {a.kind === "task" && a.entity_id && (
                      <form action={completeTask.bind(null, a.entity_id)}><button className="btn btn-sm">Done</button></form>
                    )}
                    {a.kind === "approval" && <Link className="btn btn-sm" href="/outreach">Review</Link>}
                    {a.kind === "application" && <Link className="btn btn-sm" href={`/applications/${a.entity_id}`}>Open</Link>}
                    {a.kind === "deadline" && <Link className="btn btn-sm" href={`/applications/${a.entity_id}`}>Open</Link>}
                    {a.kind === "follow_up" && <Link className="btn btn-sm" href="/outreach?tab=follow-ups">Open</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">Nothing due. Research the next employers below or import new vacancies.</p>}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <div className="flex justify-between items-baseline mb-2"><h2 className="font-semibold">New vacancies</h2><Link className="text-xs underline" href="/vacancies?filter=unreviewed">All</Link></div>
          <p className="muted text-xs mb-2">Unreviewed roles. Check eligibility and either create an application or dismiss.</p>
          {newVacancies && newVacancies.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {newVacancies.map((v) => (
                <li key={v.id} className="flex gap-2 items-baseline">
                  <span className={`badge ${v.eligibility_status === "eligible" ? "badge-ok" : v.eligibility_status === "ineligible" ? "badge-danger" : "badge-warn"}`}>{humanise(v.eligibility_status)}</span>
                  <Link className="underline" href={`/vacancies/${v.id}`}>{v.title}</Link>
                  <span className="muted truncate">{v.employer_name ?? "unmatched employer"}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted">No unreviewed vacancies. <Link className="underline" href="/vacancies/import">Paste one</Link> or enable a source.</p>}
        </section>

        <section className="card">
          <div className="flex justify-between items-baseline mb-2"><h2 className="font-semibold">Research queue</h2><Link className="text-xs underline" href="/employers?stage=awaiting_research">All</Link></div>
          <p className="muted text-xs mb-2">Employers not yet researched, best score first.</p>
          {research && research.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {research.map((e) => (
                <li key={e.id} className="flex gap-2 items-baseline">
                  <span className="badge">{e.latest_band ?? "?"}</span>
                  <Link className="underline" href={`/employers/${e.id}`}>{e.display_name ?? e.legal_name}</Link>
                  <span className="muted">{e.town ?? ""} {e.zone_code ? `· Zone ${e.zone_code}` : ""}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Research queue is empty.</p>}
        </section>

        <section className="card">
          <div className="flex justify-between items-baseline mb-2"><h2 className="font-semibold">Outreach due</h2><Link className="text-xs underline" href="/outreach">All</Link></div>
          <p className="muted text-xs mb-2">Drafts awaiting your approval and follow-ups that are due.</p>
          <ul className="space-y-1 text-sm">
            {(approvals ?? []).map((a) => (
              <li key={a.id} className="flex gap-2 items-baseline"><span className="badge badge-accent">Approve</span><span>{a.subject}</span><span className="muted">→ {a.employer_name}</span></li>
            ))}
            {(followUps ?? []).map((f) => (
              <li key={f.id} className="flex gap-2 items-baseline"><span className="badge badge-warn">Follow up</span><span>{f.employer_name}</span><span className="muted">{f.contact_name ?? f.subject}</span></li>
            ))}
            {(approvals ?? []).length + (followUps ?? []).length === 0 && <li className="muted">Nothing waiting.</li>}
          </ul>
        </section>

        <section className="card">
          <div className="flex justify-between items-baseline mb-2"><h2 className="font-semibold">Data quality</h2><Link className="text-xs underline" href="/data-quality">All</Link></div>
          <p className="muted text-xs mb-2">Duplicates, stale records, missing travel times and failed sources.</p>
          {dqCounts.size > 0 ? (
            <ul className="space-y-1 text-sm">
              {[...dqCounts.entries()].sort((a, b) => b[1] - a[1]).map(([issue, n]) => (
                <li key={issue} className="flex justify-between"><span>{humanise(issue)}</span><span className="badge">{n}</span></li>
              ))}
            </ul>
          ) : <p className="muted">No issues detected.</p>}
        </section>
      </div>
    </div>
  );
}
