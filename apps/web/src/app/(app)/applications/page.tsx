import Link from "next/link";
import { PIPELINE_COLUMNS, nextAction, type ApplicationStage } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { StageBadge } from "@/components/badges";
import { fmtDate, fmtDateTime, humanise } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Search = { view?: string; column?: string; employer?: string; location?: string; status?: string; priority?: string; submitted_from?: string; submitted_to?: string; deadline_before?: string };

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const { data: rows, error } = await supabase.from("v_application_pipeline").select("*").order("stage_changed_at", { ascending: false });
  if (error) throw new Error(error.message);
  const { data: offerRows } = await supabase.from("applications").select("id, offer_decision_deadline").eq("stage", "offer_received");
  const offerDeadline = new Map((offerRows ?? []).map((o) => [o.id as string, o.offer_decision_deadline as string | null]));

  const needle = (x?: string) => x?.trim().toLowerCase() ?? "";
  let list = (rows ?? []).filter((r) => {
    if (needle(sp.employer) && !(r.employer_name ?? "").toLowerCase().includes(needle(sp.employer))) return false;
    if (needle(sp.location) && !(r.location_text ?? "").toLowerCase().includes(needle(sp.location))) return false;
    if (sp.status && r.stage !== sp.status) return false;
    if (sp.priority && r.priority_status !== sp.priority) return false;
    if (sp.submitted_from && (!r.submitted_at || r.submitted_at < sp.submitted_from)) return false;
    if (sp.submitted_to && (!r.submitted_at || r.submitted_at > `${sp.submitted_to}T23:59:59`)) return false;
    if (sp.deadline_before && (!r.deadline_at || r.deadline_at > `${sp.deadline_before}T23:59:59`)) return false;
    return true;
  });
  const showClosed = sp.view === "all" || sp.column === "closed" || !!sp.status;
  if (!showClosed) list = list.filter((r) => r.pipeline_column !== "closed");

  const now = new Date();
  const decorated = list.map((r) => ({
    r,
    next: nextAction({
      now, stage: r.stage as ApplicationStage, deadline: r.deadline_at ? new Date(r.deadline_at) : null, openRequiredChecklist: Math.max(0, Number(r.checklist_total ?? 0) - Number(r.checklist_done ?? 0)),
      nextInterviewAt: r.next_interview_at ? new Date(r.next_interview_at) : null, nextFollowUp: r.next_followup_at ? { dueAt: new Date(r.next_followup_at), title: "Follow-up" } : null,
      offerDecisionDeadline: offerDeadline.get(r.id!) ? new Date(offerDeadline.get(r.id!)!) : null, listingClosed: !!r.listing_closed, submitted: !!r.submission_confirmed_at,
    }),
  }));

  const qs = (patch: Partial<Search>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v); const t = p.toString(); return `/applications${t ? `?${t}` : ""}`; };
  const taskView = sp.view === "tasks";
  const tasks = decorated.filter((d) => d.next.urgency !== "none" && d.r.pipeline_column !== "closed").sort((a, b) => ({ overdue: 0, soon: 1, normal: 2, none: 3 }[a.next.urgency] - { overdue: 0, soon: 1, normal: 2, none: 3 }[b.next.urgency]) || (a.next.dueAt?.getTime() ?? Infinity) - (b.next.dueAt?.getTime() ?? Infinity));
  const stages = [...new Set((rows ?? []).map((r) => r.stage).filter((s): s is NonNullable<typeof s> => !!s))];
  const statuses = [...new Set((rows ?? []).map((r) => r.priority_status).filter(Boolean))];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold mr-auto">Applications <span className="muted text-sm font-normal">({list.length})</span></h1>
        <Link href={qs({ view: undefined })} className={`btn ${!taskView ? "btn-primary" : ""}`}>Pipeline</Link>
        <Link href={qs({ view: "tasks" })} className={`btn ${taskView ? "btn-primary" : ""}`}>Tasks</Link>
        {!showClosed && <Link href={qs({ view: sp.view === "tasks" ? "tasks" : "all" })} className="btn">Show closed</Link>}
        <Link href="/priorities" className="btn">Start from priorities</Link>
        <a href="/api/export/applications" className="btn">Export</a>
      </div>
      <p className="muted text-xs">Applications are separate from employer outreach. Nothing here counts as submitted until you confirm it, and a stage never changes just because time has passed.</p>

      <form className="card p-3 grid gap-2 sm:grid-cols-4 text-xs" method="get">
        {sp.view && <input type="hidden" name="view" value={sp.view} />}
        <label>Employer<input className="input" name="employer" defaultValue={sp.employer ?? ""} /></label>
        <label>Location<input className="input" name="location" defaultValue={sp.location ?? ""} /></label>
        <label>Status<select className="input" name="status" defaultValue={sp.status ?? ""}><option value="">Any</option>{stages.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select></label>
        <label>Priority<select className="input" name="priority" defaultValue={sp.priority ?? ""}><option value="">Any</option>{statuses.map((s) => <option key={s!} value={s!}>{humanise(s)}</option>)}</select></label>
        <label>Submitted from<input type="date" className="input" name="submitted_from" defaultValue={sp.submitted_from ?? ""} /></label>
        <label>Submitted to<input type="date" className="input" name="submitted_to" defaultValue={sp.submitted_to ?? ""} /></label>
        <label>Closing on or before<input type="date" className="input" name="deadline_before" defaultValue={sp.deadline_before ?? ""} /></label>
        <div className="flex items-end gap-2"><button className="btn btn-primary">Filter</button><Link href="/applications" className="btn">Clear</Link></div>
      </form>

      {taskView ? (
        <div className="card divide-y divide-border">
          {tasks.length === 0 && <p className="p-4 muted text-sm">Nothing has a next step right now.</p>}
          {tasks.map(({ r, next }) => (
            <Link key={r.id} href={`/applications/${r.id}`} className="flex flex-wrap items-center gap-2 p-3 hover:bg-surface-2">
              <span className={`badge ${next.urgency === "overdue" ? "badge-danger" : next.urgency === "soon" ? "badge-warn" : ""}`}>{next.urgency === "overdue" ? "Overdue" : next.urgency === "soon" ? "Soon" : "Planned"}</span>
              <span className="font-medium text-sm">{next.label}</span>
              <span className="muted text-xs">{r.employer_name}{r.vacancy_title ? ` · ${r.vacancy_title}` : ""}</span>
              <span className="muted text-xs ml-auto">{next.dueAt ? fmtDateTime(next.dueAt) : "no date"}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {PIPELINE_COLUMNS.filter((c) => showClosed || c.key !== "closed").map((col) => {
            const items = decorated.filter((d) => d.r.pipeline_column === col.key);
            return (
              <div key={col.key} className="flex-shrink-0 w-64 rounded-lg border border-border bg-surface-2 p-2 space-y-2 min-h-40">
                <div className="flex justify-between items-baseline"><span className="text-xs font-semibold">{col.label}</span><span className="muted text-xs">{items.length}</span></div>
                {items.map(({ r, next }) => (
                  <Link key={r.id} href={`/applications/${r.id}`} className="card p-2 text-xs space-y-1 block hover:border-accent">
                    <div className="font-semibold leading-tight">{r.employer_name}</div>
                    <div className="muted leading-tight">{r.vacancy_title ?? `${humanise(r.application_type)} application`}</div>
                    <div className="flex flex-wrap gap-1 items-center">
                      <StageBadge stage={r.stage!} />
                      {r.deadline_at && <span className="badge badge-warn">closes {fmtDate(r.deadline_at)}</span>}
                      {r.listing_closed && <span className="badge">listing closed</span>}
                      {r.submitted_at && <span className="badge">sent {fmtDate(r.submitted_at)}</span>}
                      {r.submitted_at && !r.submission_confirmed_at && <span className="badge badge-warn">unconfirmed</span>}
                    </div>
                    {next.urgency !== "none" && <div className={next.urgency === "overdue" ? "text-danger" : ""}>{next.label}{next.dueAt ? ` · ${fmtDate(next.dueAt)}` : ""}</div>}
                  </Link>
                ))}
                {items.length === 0 && <p className="muted text-xs px-1">None</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
