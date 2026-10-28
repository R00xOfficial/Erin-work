import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, humanise } from "@/lib/utils";
import { Deadline, PriorityBadge, STATUS_LABEL } from "@/components/priorities/bits";
import {
  acknowledgeChange, acceptAction, addAction, clearOverride, completeAction, dismissAction, dismissItem, editAction, followRecommendation, markRecommended, moveToBacklog, overrideScore, promoteItem, putOnHold,
  recordRecontactReason, rescheduleAction, respondToRecommendation, toggleFavourite, togglePin,
} from "@/server/actions/priorities";

export const dynamic = "force-dynamic";
type Comp = { key: string; label: string; weight: number; score: number | null; points: number | null; known: boolean; reasons: string[] };
const DISMISS_REASONS = ["Location", "Unsuitable requirements", "Vacancy expired", "Not relevant to my career goals", "Not interested in this employer", "Other"];

export default async function PriorityDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data: p } = await supabase.from("priority_items").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  const { data: q } = await supabase.from("v_priority_queue").select("name, employer_name, days_left, outbound_count, last_outbound_at, replied").eq("id", id).maybeSingle();
  const employerId = p.employer_id;
  const [{ data: events }, { data: actions }, { data: acts }, { data: prefs }] = await Promise.all([
    supabase.from("priority_events").select("*").eq("item_id", id).order("created_at", { ascending: false }).limit(40),
    supabase.from("plan_actions").select("*").eq("item_id", id).in("status", ["suggested", "accepted", "done"]).order("planned_for", { ascending: true, nullsFirst: false }).limit(30),
    employerId ? supabase.from("activities").select("id, subject, direction, delivery_result, sent_at, reply_received, occurred_at").eq("employer_id", employerId).order("occurred_at", { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
    supabase.from("planner_preferences").select("recontact_cooldown_days").eq("id", true).maybeSingle(),
  ]);
  const comps = (((p.components ?? {}) as { items?: Comp[] }).items ?? []);
  const hold = ((p.components ?? {}) as { hold?: { reason: string | null; condition: string | null; until: string | null } }).hold;
  const warnings = (p.warnings ?? []) as { code: string; text: string; severity: string }[];
  const effort = p.effort as { items?: { task: string; minutes: number; basis: string }[]; totalMinutes?: number } | null;
  const researchHref = p.kind === "vacancy" ? `/research/vacancies/${p.vacancy_id}` : `/research/employers/${p.employer_id}`;
  const recordHref = p.kind === "vacancy" ? `/vacancies/${p.vacancy_id}` : `/employers/${p.employer_id}`;
  const manual = !!p.manual_status;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div>
        <div className="muted text-xs"><Link className="underline" href="/priorities">Prioritise</Link> / {p.kind === "vacancy" ? "vacancy" : "speculative employer"}</div>
        <h1 className="text-xl font-semibold">{q?.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {q?.employer_name && <span className="muted">{q.employer_name}</span>}
          <PriorityBadge status={p.status} manual={manual} />
          {p.pinned && <span className="badge badge-accent">pinned</span>}{p.favourite && <span className="badge">★ favourite</span>}
          {!p.live && <span className="badge badge-danger">not live</span>}
          <Link className="underline" href={researchHref}>Research &amp; assessment</Link><Link className="underline" href={recordHref}>Record</Link>{p.live && <Link className="btn btn-sm btn-primary" href={`/applications/new?priority_item_id=${p.id}`}>Start application</Link>}
        </div>
      </div>

      {p.needs_review_reason && (
        <section className="card border-warn space-y-2">
          <h2 className="font-semibold">Something changed since you last looked</h2>
          <p className="text-sm">{p.needs_review_reason}</p>
          <p className="muted text-xs">{manual ? "Your own decision has been kept; nothing was changed for you." : "The recommendation may have moved. Choose what to do below."}</p>
          <form action={acknowledgeChange.bind(null, id)}><button className="btn btn-sm">I’ve reviewed this</button></form>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-1">
          <h2 className="font-semibold">Stage 2: how suitable it is</h2>
          <div className="text-3xl font-semibold">{p.suitability_total == null ? "—" : Math.round(Number(p.suitability_total))}<span className="text-base muted"> / 100</span></div>
          <p className="muted text-xs">{p.kind === "vacancy" ? "Fit with your profile and the vacancy's requirements." : "How worthwhile a speculative approach is."} Shown from the Stage 2 assessment, never recalculated here. <Link className="underline" href={researchHref}>See the evidence</Link>.</p>
        </section>
        <section className="card space-y-1">
          <h2 className="font-semibold">Stage 3: how urgently to pursue it</h2>
          <div className="text-3xl font-semibold">{p.score == null ? <span className="text-base">no score yet</span> : <>{Math.round(Number(p.score))}<span className="text-base muted"> / 100</span></>}</div>
          {p.override_score != null && <p className="text-sm">You overrode the ranking to <strong>{Number(p.override_score)}</strong>: “{p.override_reason}”</p>}
          <p className="muted text-xs">Model v{p.model_version}, calculated {fmtDateTime(p.computed_at)}. Recommended: <strong>{STATUS_LABEL[p.recommended_status]}</strong>.{manual && <> Your decision: <strong>{STATUS_LABEL[p.manual_status!]}</strong>{p.manual_reason ? ` — ${p.manual_reason}` : ""}.</>}</p>
        </section>
      </div>

      {warnings.length > 0 && (
        <section className="card space-y-1"><h2 className="font-semibold">Warnings</h2>
          <ul className="text-sm space-y-1">{warnings.map((w) => <li key={w.code} className={w.severity === "blocker" ? "text-danger" : w.severity === "warning" ? "text-warn" : "muted"}>{w.severity === "blocker" ? "⛔ Blocker: " : w.severity === "warning" ? "⚠ " : "ℹ "}{w.text}</li>)}</ul>
        </section>
      )}

      {p.status === "on_hold" && (
        <section className="card text-sm"><strong>On hold.</strong> {p.manual_reason ?? hold?.reason ?? ""} {(p.hold_condition ?? hold?.condition) && <>Reopens when: {p.hold_condition ?? hold?.condition}. </>}{p.hold_until && <>Reconsider after {p.hold_until}.</>}</section>
      )}

      <section className="card p-0 overflow-x-auto">
        <h2 className="font-semibold p-4 pb-2">Priority breakdown</h2>
        <table>
          <thead><tr><th>Factor</th><th>Weight</th><th>Score</th><th>Contribution</th><th>Why</th></tr></thead>
          <tbody>
            {comps.map((c) => <tr key={c.key}><td className="font-medium">{c.label}</td><td>{c.weight}%</td><td>{c.known ? c.score : <span className="badge">unknown</span>}</td><td>{c.points != null ? c.points : <span className="muted">not counted</span>}</td><td className="text-sm">{c.reasons.map((r, i) => <div key={i}>{r}</div>)}</td></tr>)}
            {comps.length === 0 && <tr><td colSpan={5} className="muted text-center py-4">No breakdown: a score is not possible until the Stage 2 research is complete.</td></tr>}
          </tbody>
        </table>
        <div className="p-4 pt-2 text-xs muted">{p.rationale.map((r, i) => <div key={i}>{r}</div>)}</div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-1">
          <h2 className="font-semibold">Deadline</h2>
          {p.kind === "employer" ? <p className="muted text-sm">Speculative targets have no closing date.</p> : <p className="text-sm"><Deadline at={p.deadline_at} daysLeft={q?.days_left ?? null} live={p.live} />{p.deadline_at ? <span className="muted"> · source: {p.deadline_source}</span> : <span className="muted"> — not recorded, so it is not assumed to be open-ended. Verify it.</span>}</p>}
        </section>
        <section className="card space-y-1">
          <h2 className="font-semibold">Effort still needed <span className="badge">estimate</span></h2>
          {effort?.items?.length ? <><ul className="text-sm space-y-0.5">{effort.items.map((e) => <li key={e.task}>{humanise(e.task)}: ~{e.minutes} min <span className="muted text-xs">— {e.basis}</span></li>)}</ul><p className="text-sm">About {effort.totalMinutes} minutes in total.</p></> : <p className="muted text-sm">No estimate available.</p>}
          <p className="muted text-xs">Estimates are rough guides, not facts.</p>
        </section>
      </div>

      {p.kind === "employer" && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Contact history</h2>
          <p className="text-sm">{(q?.outbound_count ?? 0) > 0 ? `${q?.outbound_count} message(s) sent, most recently ${q?.last_outbound_at ? fmtDate(q.last_outbound_at) : "?"}.` : "You have not contacted this employer."} {q?.replied && "They have replied."}</p>
          {(acts ?? []).length > 0 && <ul className="text-xs space-y-0.5">{(acts ?? []).map((a) => <li key={a.id}>{fmtDate(a.sent_at ?? a.occurred_at)} · {a.direction} · {a.subject ?? "(no subject)"} · {humanise(a.delivery_result)}{a.reply_received ? " · replied" : ""}</li>)}</ul>}
          {p.recontact_reason ? <p className="text-sm">Reason recorded for approaching again: “{p.recontact_reason}”</p> : (q?.outbound_count ?? 0) > 0 && (
            <form action={recordRecontactReason.bind(null, id)} className="flex gap-2 flex-wrap"><input name="reason" className="flex-1 min-w-56" placeholder={`Why approach again within ${prefs?.recontact_cooldown_days ?? 60} days?`} /><button className="btn btn-sm">Record reason</button></form>
          )}
        </section>
      )}

      <section className="card space-y-3">
        <h2 className="font-semibold">Your decision</h2>
        <p className="muted text-xs">These choices are yours. They are kept when scores are recalculated, and each one is logged with its reason.</p>
        <div className="flex flex-wrap gap-2">
          <form action={togglePin.bind(null, id)}><button className="btn btn-sm">{p.pinned ? "Unpin" : "Pin to top"}</button></form>
          <form action={toggleFavourite.bind(null, id)}><button className="btn btn-sm">{p.favourite ? "Remove favourite" : "★ Favourite"}</button></form>
          <form action={followRecommendation.bind(null, id)}><button className="btn btn-sm">Use the recommendation{manual ? " (drop my decision)" : ""}</button></form>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <form action={promoteItem.bind(null, id)} className="space-y-1"><input name="reason" placeholder="Why (optional)" /><button className="btn btn-sm btn-primary w-full">Promote to high priority</button></form>
          <form action={markRecommended.bind(null, id)} className="space-y-1"><input name="reason" placeholder="Why (optional)" /><button className="btn btn-sm w-full">Mark as recommended</button></form>
          <form action={moveToBacklog.bind(null, id)} className="space-y-1"><input name="reason" placeholder="Why (optional)" /><button className="btn btn-sm w-full">Move to backlog</button></form>
        </div>
        <details className="border border-border rounded p-2"><summary className="cursor-pointer text-sm">Put on hold</summary>
          <form action={putOnHold.bind(null, id)} className="grid-form mt-2"><div className="col-span-full"><label>Reason (required)</label><input name="reason" required /></div><div><label>Reconsider on</label><input name="until" type="date" min={today} /></div><div><label>What would reopen it?</label><input name="condition" /></div><div className="col-span-full"><button className="btn btn-sm">Put on hold</button></div></form></details>
        <details className="border border-border rounded p-2"><summary className="cursor-pointer text-sm">Dismiss</summary>
          <form action={dismissItem.bind(null, id)} className="grid-form mt-2"><div><label>Reason</label><select name="reason">{DISMISS_REASONS.map((r) => <option key={r}>{r}</option>)}</select></div><div className="col-span-full"><button className="btn btn-sm">Dismiss (history is kept)</button></div></form></details>
        <details className="border border-border rounded p-2"><summary className="cursor-pointer text-sm">Override the ranking</summary>
          <form action={overrideScore.bind(null, id)} className="grid-form mt-2"><div><label>Priority score (0–100)</label><input name="score" type="number" min={0} max={100} required defaultValue={p.override_score != null ? Number(p.override_score) : ""} /></div><div><label>Why (required)</label><input name="reason" required /></div><div className="col-span-full flex gap-2"><button className="btn btn-sm">Set override</button></div></form>
          {p.override_score != null && <form action={clearOverride.bind(null, id)} className="mt-2"><button className="btn btn-sm">Remove override</button></form>}</details>
        <details className="border border-border rounded p-2"><summary className="cursor-pointer text-sm">Record whether you accept the recommendation{p.recommendation_response ? ` (currently: ${p.recommendation_response})` : ""}</summary>
          <form className="mt-2 space-y-2"><input name="reason" placeholder="Why (optional)" /><div className="flex gap-2"><button formAction={respondToRecommendation.bind(null, id, "accepted")} className="btn btn-sm btn-primary">Accept</button><button formAction={respondToRecommendation.bind(null, id, "rejected")} className="btn btn-sm">Reject</button></div></form>
          {p.recommendation_response && <p className="muted text-xs mt-1">Last: {p.recommendation_response} ({STATUS_LABEL[p.responded_to_status ?? p.recommended_status]}){p.recommendation_response_reason ? ` — ${p.recommendation_response_reason}` : ""}</p>}</details>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Planned actions</h2>
        {(actions ?? []).length === 0 ? <p className="muted text-sm">None yet.</p> : (actions ?? []).map((a) => (
          <div key={a.id} className="border border-border rounded p-2 text-sm space-y-1">
            <div className="flex flex-wrap items-center gap-2"><span className={`badge ${a.status === "done" ? "badge-ok" : a.status === "accepted" ? "badge-accent" : ""}`}>{a.status}</span><span className="font-medium">{a.title}</span>{a.estimated_minutes != null && <span className="muted text-xs">~{a.estimated_minutes} min (estimate)</span>}{a.planned_for && <span className="muted text-xs">{a.planned_for}</span>}{a.due_at && <span className="text-warn text-xs">closes {fmtDate(a.due_at)}</span>}</div>
            {a.reason && <div className="muted text-xs">{a.reason}</div>}{a.warning && <div className="text-warn text-xs">⚠ {a.warning}</div>}
            {a.status !== "done" && <div className="flex flex-wrap gap-1">
              {a.status === "suggested" && <form action={acceptAction.bind(null, a.id)}><button className="btn btn-sm btn-primary">Accept</button></form>}
              <form action={completeAction.bind(null, a.id)}><button className="btn btn-sm">Done</button></form>
              <form action={rescheduleAction.bind(null, a.id)} className="flex gap-1"><input name="planned_for" type="date" min={today} defaultValue={a.planned_for ?? ""} className="w-36" /><button className="btn btn-sm">Reschedule</button></form>
              <details className="relative"><summary className="btn btn-sm cursor-pointer">Edit</summary><form action={editAction.bind(null, a.id)} className="card absolute z-10 w-72 space-y-2"><input name="title" defaultValue={a.title} /><input name="minutes" type="number" min={0} defaultValue={a.estimated_minutes ?? ""} /><input name="planned_for" type="date" defaultValue={a.planned_for ?? ""} /><button className="btn btn-sm btn-primary">Save</button></form></details>
              <form action={dismissAction.bind(null, a.id)}><input type="hidden" name="reason" value="Dismissed by me" /><button className="btn btn-sm">Dismiss</button></form>
            </div>}
          </div>
        ))}
        <form action={addAction} className="flex flex-wrap gap-2 items-end"><input type="hidden" name="item_id" value={id} /><div className="flex-1 min-w-56"><label>Add an action</label><input name="title" required /></div><div><label>Minutes</label><input name="minutes" type="number" min={0} className="w-24" /></div><div><label>Day</label><input name="planned_for" type="date" min={today} /></div><button className="btn btn-sm">Add</button></form>
      </section>

      <section className="card p-0 overflow-x-auto">
        <h2 className="font-semibold p-4 pb-2">History for this opportunity</h2>
        <table><tbody>
          {(events ?? []).map((e) => <tr key={e.id}><td className="muted whitespace-nowrap">{fmtDateTime(e.created_at)}</td><td>{humanise(e.event)}{e.to_status && <span className="muted"> → {humanise(e.to_status)}</span>}</td><td className="muted">{e.actor === "user" ? "you" : "system"}</td><td className="text-xs">{e.reason}</td></tr>)}
          {(events ?? []).length === 0 && <tr><td className="muted text-center py-4">No history yet.</td></tr>}
        </tbody></table>
      </section>
    </div>
  );
}
