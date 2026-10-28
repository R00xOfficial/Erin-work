import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, humanise } from "@/lib/utils";
import { Deadline, ItemLink, PriorityBadge, ScorePair, Warnings } from "@/components/priorities/bits";
import {
  acceptAction, addAction, completeAction, dismissAction, dismissAllNotifications, dismissNotification, editAction, followRecommendation, markNotificationRead, promoteItem, refreshPlan, rescheduleAction, togglePin, toggleFavourite,
} from "@/server/actions/priorities";

export const dynamic = "force-dynamic";
type SP = Record<string, string | undefined>;
const TABS: [string, string][] = [["queue", "Priority queue"], ["plan", "Action planner"], ["calendar", "Deadline calendar"], ["outreach", "Employer outreach"], ["backlog", "Backlog & on hold"], ["history", "Decision history"]];
const DAY = 86_400_000;
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
const dayName = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

export default async function PrioritiesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "queue";
  const { supabase } = await requireUser();
  const [{ data: c }, { data: notes }] = await Promise.all([
    supabase.from("v_stage3_counts").select("*").maybeSingle(),
    supabase.from("notifications").select("*").is("dismissed_at", null).order("created_at", { ascending: false }).limit(30),
  ]);
  const unread = (notes ?? []).filter((n) => !n.read_at);
  const digest = (notes ?? []).find((n) => n.kind === "digest");
  const urgent = unread.filter((n) => n.urgency === "urgent" && n.kind !== "digest");
  const routine = unread.filter((n) => n.urgency !== "urgent" && n.kind !== "digest");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold mr-auto">Prioritise</h1><Link className="btn" href="/research">Research &amp; scoring</Link><Link className="btn" href="/settings/planner">Planner settings</Link></div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-8">
        <Tile label="High priority" value={c?.high} to="/priorities" /><Tile label="Recommended" value={c?.recommended} to="/priorities" />
        <Tile label="Needs my decision" value={c?.needs_review} to="/priorities" /><Tile label="Closing within 7 days" value={c?.deadlines_7d} to="/priorities?tab=calendar" />
        <Tile label="Planned today" value={c?.planned_today} to="/priorities?tab=plan" /><Tile label="Suggested actions" value={c?.suggested_actions} to="/priorities?tab=plan&range=week" />
        <Tile label="Backlog" value={c?.backlog} to="/priorities?tab=backlog" /><Tile label="On hold" value={c?.on_hold} to="/priorities?tab=backlog" />
      </div>

      {(urgent.length > 0 || routine.length > 0 || digest) && (
        <section className="card space-y-2">
          <div className="flex items-center gap-2"><h2 className="font-semibold mr-auto">Reminders</h2>{unread.length > 0 && <form action={dismissAllNotifications}><button className="btn btn-sm">Clear all</button></form>}</div>
          {digest && !digest.read_at && <div className="text-sm"><strong>{digest.title}.</strong> {digest.body} <form action={markNotificationRead.bind(null, digest.id)} className="inline"><button className="btn btn-sm ml-1">Got it</button></form></div>}
          {urgent.map((n) => <Note key={n.id} n={n} urgent />)}
          {routine.length > 0 && <details><summary className="cursor-pointer text-sm">{routine.length} routine reminder{routine.length === 1 ? "" : "s"}</summary><div className="mt-2 space-y-1">{routine.slice(0, 20).map((n) => <Note key={n.id} n={n} />)}</div></details>}
        </section>
      )}

      <nav className="flex flex-wrap gap-1 border-b border-border">{TABS.map(([k, l]) => <Link key={k} href={`/priorities?tab=${k}`} className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === k ? "border-accent font-semibold" : "border-transparent muted"}`}>{l}</Link>)}</nav>

      {tab === "queue" && <Queue />}
      {tab === "plan" && <Plan range={sp.range === "week" ? "week" : "today"} />}
      {tab === "calendar" && <Calendar />}
      {tab === "outreach" && <Outreach />}
      {tab === "backlog" && <Backlog />}
      {tab === "history" && <History />}
    </div>
  );
}

function Tile({ label, value, to }: { label: string; value: number | null | undefined; to: string }) {
  return <Link href={to} className="card block hover:bg-surface-2"><div className="text-2xl font-semibold">{value ?? "—"}</div><div className="muted text-xs">{label}</div></Link>;
}
function Note({ n, urgent }: { n: { id: string; title: string; body: string | null; due_at: string | null; item_id: string | null }; urgent?: boolean }) {
  return (
    <div className="text-sm flex flex-wrap items-center gap-2">
      <span className={urgent ? "text-danger font-medium" : ""}>{n.title}</span>{n.body && <span className="muted">{n.body}</span>}
      {n.item_id && <Link className="underline" href={`/priorities/${n.item_id}`}>Open</Link>}
      <form action={dismissNotification.bind(null, n.id)} className="ml-auto"><button className="btn btn-sm">Dismiss</button></form>
    </div>
  );
}

type QueueRow = {
  id: string | null; kind: string | null; name: string | null; employer_name: string | null; status: string | null; manual_status: string | null; score: number | null; override_score: number | null; score_used: number | null; suitability_total: number | null;
  deadline_at: string | null; days_left: number | null; live: boolean | null; pinned: boolean | null; favourite: boolean | null; needs_review_reason: string | null; warnings: unknown; rationale: string[] | null; effort: unknown;
  hold_until: string | null; hold_condition: string | null; manual_reason: string | null; dismissed_reason: string | null; outbound_count: number | null; last_outbound_at: string | null; components: unknown;
};

async function Queue() {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("v_priority_queue").select("*").in("status", ["high", "recommended"]).order("pinned", { ascending: false }).order("score_used", { ascending: false, nullsFirst: false }).limit(150);
  const { data: review } = await supabase.from("v_priority_queue").select("*").not("needs_review_reason", "is", null).neq("status", "dismissed").limit(30);
  const rows = (data ?? []) as QueueRow[];
  return (
    <>
      {(review ?? []).length > 0 && (
        <section className="card border-warn space-y-1">
          <h2 className="font-semibold">Something changed: needs your decision</h2>
          <ul className="text-sm space-y-1">{(review as QueueRow[]).map((r) => <li key={r.id}><ItemLink id={r.id!}>{r.name}</ItemLink> <span className="muted">— {r.needs_review_reason}</span></li>)}</ul>
        </section>
      )}
      <p className="muted text-xs">Ranked by priority (what to act on first), not by suitability alone. Suitability comes from Stage 2 and is shown separately. Pinned items stay on top. Your decisions are never changed by recalculation.</p>
      <div className="card p-0 overflow-x-auto">
        <table>
          <thead><tr><th></th><th>Opportunity</th><th>Scores</th><th>Closing date</th><th>Effort (estimate)</th><th>Why</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const eff = r.effort as { totalMinutes?: number } | null;
              return (
                <tr key={r.id} className={r.live === false ? "opacity-60" : ""}>
                  <td className="whitespace-nowrap"><form action={togglePin.bind(null, r.id!)} className="inline"><button className="btn btn-sm" title="Pin to top">{r.pinned ? "📌" : "pin"}</button></form> <form action={toggleFavourite.bind(null, r.id!)} className="inline"><button className="btn btn-sm" title="Favourite">{r.favourite ? "★" : "☆"}</button></form></td>
                  <td><ItemLink id={r.id!}>{r.name}</ItemLink> <span className="badge">{r.kind === "employer" ? "speculative" : "vacancy"}</span>{r.employer_name && <div className="muted text-xs">{r.employer_name}</div>}<div className="mt-1"><PriorityBadge status={r.status} manual={!!r.manual_status} /></div><Warnings warnings={r.warnings} /></td>
                  <td><ScorePair suitability={r.suitability_total} priority={r.score} override={r.override_score} /></td>
                  <td>{r.kind === "employer" ? <span className="muted">n/a</span> : <Deadline at={r.deadline_at} daysLeft={r.days_left} live={r.live} />}</td>
                  <td className="text-sm">{eff?.totalMinutes ? `~${eff.totalMinutes} min` : <span className="muted">unknown</span>}</td>
                  <td className="text-xs max-w-xs">{(r.rationale ?? []).slice(0, 2).map((x, i) => <div key={i}>{x}</div>)}</td>
                  <td><form action={promoteItem.bind(null, r.id!)} className="inline"><input type="hidden" name="reason" value="Promoted from the queue" />{r.status !== "high" && <button className="btn btn-sm">Promote</button>}</form></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={7} className="muted text-center py-8">Nothing is prioritised yet. Items appear here after you review their research in Stage 2 and choose “Save for Stage 3”.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function Plan({ range }: { range: "today" | "week" }) {
  const { supabase } = await requireUser();
  const today = londonToday();
  const end = range === "today" ? today : addDays(today, 6);
  const [{ data: prefs }, { data: actions }, { data: tasks }, { data: dl }] = await Promise.all([
    supabase.from("planner_preferences").select("*").eq("id", true).maybeSingle(),
    supabase.from("plan_actions").select("*, priority_items(id)").in("status", ["suggested", "accepted"]).order("planned_for", { ascending: true, nullsFirst: false }).limit(200),
    supabase.from("tasks").select("id, title, due_at, task_type, status").in("status", ["open", "in_progress"]).not("due_at", "is", null).lte("due_at", new Date(new Date(`${end}T00:00:00Z`).getTime() + DAY).toISOString()).order("due_at").limit(50),
    supabase.from("v_priority_queue").select("id, name, deadline_at, days_left, status").eq("live", true).neq("status", "dismissed").not("deadline_at", "is", null).gte("deadline_at", new Date().toISOString()).lte("deadline_at", new Date(new Date(`${end}T00:00:00Z`).getTime() + DAY).toISOString()).order("deadline_at").limit(30),
  ]);
  const cap = Math.round(Number(prefs?.hours_per_day ?? 2) * 60);
  const inRange = (actions ?? []).filter((a) => a.planned_for && a.planned_for <= end);
  const late = inRange.filter((a) => a.status === "accepted" && a.planned_for! < today);
  const unscheduled = (actions ?? []).filter((a) => !a.planned_for);
  const days: string[] = []; for (let d = today; d <= end; d = addDays(d, 1)) days.push(d);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link className={`btn btn-sm ${range === "today" ? "btn-primary" : ""}`} href="/priorities?tab=plan">Today</Link><Link className={`btn btn-sm ${range === "week" ? "btn-primary" : ""}`} href="/priorities?tab=plan&range=week">This week</Link>
        <span className="muted text-xs">Time you have set aside: {prefs?.hours_per_day ?? 2} h a day. Up to {prefs?.max_applications_per_week ?? 3} applications, {prefs?.max_outreach_per_week ?? 5} approaches and {prefs?.max_research_per_week ?? 6} research items a week. Effort figures are estimates.</span>
        <form action={refreshPlan} className="ml-auto"><button className="btn btn-sm">Refresh suggestions</button></form>
      </div>
      {range === "week" && dl && dl.length > 0 && <section className="card text-sm"><strong>Closing this week:</strong> {dl.map((d) => <Link key={d.id} className="underline mr-3" href={`/priorities/${d.id}`}>{d.name} ({d.deadline_at!.slice(0, 10)})</Link>)}</section>}
      {late.length > 0 && <section className="card border-warn space-y-1"><h2 className="font-semibold">Planned earlier, not done</h2>{late.map((a) => <ActionRow key={a.id} a={a} today={today} />)}</section>}
      {(tasks ?? []).length > 0 && (
        <section className="card space-y-1"><h2 className="font-semibold">Tasks with a due date</h2>
          <ul className="text-sm space-y-1">{(tasks ?? []).map((t) => <li key={t.id}><span className={new Date(t.due_at!).getTime() < Date.now() - DAY ? "text-danger" : ""}>{t.due_at!.slice(0, 10)}</span> · {t.title} <Link className="underline muted" href="/tasks">manage</Link></li>)}</ul>
        </section>
      )}
      {days.map((d) => {
        const list = inRange.filter((a) => a.planned_for === d && !(a.status === "accepted" && d < today));
        const mins = list.reduce((a, x) => a + (x.estimated_minutes ?? 0), 0);
        return (
          <section key={d} className="card space-y-2">
            <div className="flex items-center gap-2"><h2 className="font-semibold">{d === today ? "Today" : dayName(d)}</h2><span className={`badge ${mins > cap ? "badge-warn" : ""}`}>{mins} / {cap} min</span>{!(prefs?.working_days ?? [1, 2, 3, 4, 5]).includes(((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1) && <span className="muted text-xs">not a working day</span>}</div>
            {list.length === 0 ? <p className="muted text-sm">Nothing planned.</p> : list.map((a) => <ActionRow key={a.id} a={a} today={today} />)}
          </section>
        );
      })}
      {unscheduled.length > 0 && (
        <section className="card space-y-1"><h2 className="font-semibold">Could not fit into this week</h2><p className="muted text-xs">These are suggestions only. Nothing is overbooked; decide what matters or adjust your time in Planner settings.</p>{unscheduled.map((a) => <ActionRow key={a.id} a={a} today={today} />)}</section>
      )}
      <form action={addAction} className="card flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-56"><label>Add your own action</label><input name="title" required placeholder="e.g. Ask Studio X whether the closing date has moved" /></div>
        <div><label>Minutes</label><input name="minutes" type="number" min={0} className="w-24" /></div><div><label>Day</label><input name="planned_for" type="date" /></div>
        <button className="btn btn-primary" type="submit">Add</button>
      </form>
    </>
  );
}

type ActionRowData = { id: string; title: string; reason: string | null; estimated_minutes: number | null; effort_basis: string | null; planned_for: string | null; due_at: string | null; status: string; warning: string | null; user_edited: boolean; kind: string; priority_items: { id: string } | null };
function ActionRow({ a, today }: { a: ActionRowData; today: string }) {
  const href = a.priority_items?.id ? `/priorities/${a.priority_items.id}` : null;
  return (
    <div className="border border-border rounded p-2 text-sm space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`badge ${a.status === "accepted" ? "badge-ok" : ""}`}>{a.status === "accepted" ? "accepted" : "suggested"}</span>
        {href ? <Link className="underline font-medium" href={href}>{a.title}</Link> : <span className="font-medium">{a.title}</span>}
        {a.estimated_minutes != null && <span className="muted text-xs">~{a.estimated_minutes} min{a.effort_basis === "Your own estimate" ? "" : " (estimate)"}</span>}
        {a.due_at && <span className="text-xs text-warn">closes {a.due_at.slice(0, 10)}</span>}
      </div>
      {a.reason && <div className="muted text-xs">{a.reason}</div>}
      {a.warning && <div className="text-warn text-xs">⚠ {a.warning}</div>}
      <div className="flex flex-wrap gap-1 items-center">
        {a.status === "suggested" && <form action={acceptAction.bind(null, a.id)}><button className="btn btn-sm btn-primary">Accept</button></form>}
        <form action={completeAction.bind(null, a.id)}><button className="btn btn-sm">Done</button></form>
        <form action={rescheduleAction.bind(null, a.id)} className="flex gap-1"><input name="planned_for" type="date" min={today} defaultValue={a.planned_for ?? ""} className="w-36" /><button className="btn btn-sm">Reschedule</button></form>
        <details className="relative"><summary className="btn btn-sm cursor-pointer">Edit</summary>
          <form action={editAction.bind(null, a.id)} className="card absolute z-10 w-72 space-y-2"><input name="title" defaultValue={a.title} /><input name="minutes" type="number" min={0} defaultValue={a.estimated_minutes ?? ""} placeholder="Minutes" /><input name="planned_for" type="date" defaultValue={a.planned_for ?? ""} /><button className="btn btn-sm btn-primary" type="submit">Save</button></form></details>
        <details className="relative"><summary className="btn btn-sm cursor-pointer">Dismiss</summary>
          <form action={dismissAction.bind(null, a.id)} className="card absolute z-10 w-64 space-y-2"><input name="reason" placeholder="Why (optional)" /><button className="btn btn-sm" type="submit">Dismiss</button></form></details>
      </div>
    </div>
  );
}

async function Calendar() {
  const { supabase } = await requireUser();
  const today = londonToday();
  const dow = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7);
  const start = addDays(today, -dow);
  const end = addDays(start, 27);
  const [{ data: items }, { data: acts }, { data: apps }, { data: unknown }] = await Promise.all([
    supabase.from("v_priority_queue").select("id, name, deadline_at, status").eq("live", true).neq("status", "dismissed").not("deadline_at", "is", null).gte("deadline_at", `${start}T00:00:00Z`).lte("deadline_at", `${end}T23:59:59Z`).limit(200),
    supabase.from("plan_actions").select("id, title, planned_for, status, priority_items(id)").in("status", ["accepted"]).gte("planned_for", start).lte("planned_for", end).limit(200),
    supabase.from("applications").select("id, deadline_at, submitted_at, employers(legal_name, display_name)").not("deadline_at", "is", null).is("submitted_at", null).gte("deadline_at", `${start}T00:00:00Z`).lte("deadline_at", `${end}T23:59:59Z`).limit(100),
    supabase.from("v_priority_queue").select("id, name").eq("kind", "vacancy").eq("live", true).in("status", ["high", "recommended"]).is("deadline_at", null).limit(50),
  ]);
  const cells: { d: string; entries: { key: string; text: string; href: string | null; tone: string }[] }[] = [];
  for (let k = 0; k < 28; k++) {
    const d = addDays(start, k);
    const entries = [
      ...(items ?? []).filter((x) => x.deadline_at!.slice(0, 10) === d).map((x) => ({ key: `i${x.id}`, text: `Closes: ${x.name}`, href: `/priorities/${x.id}`, tone: "text-danger" })),
      ...(apps ?? []).filter((x) => x.deadline_at!.slice(0, 10) === d).map((x) => ({ key: `a${x.id}`, text: `Application due: ${(x.employers as { legal_name: string; display_name: string | null } | null)?.display_name ?? (x.employers as { legal_name: string } | null)?.legal_name ?? ""}`, href: `/applications/${x.id}`, tone: "text-warn" })),
      ...(acts ?? []).filter((x) => x.planned_for === d).map((x) => ({ key: `p${x.id}`, text: x.title, href: (x.priority_items as { id: string } | null)?.id ? `/priorities/${(x.priority_items as { id: string }).id}` : null, tone: "" })),
    ];
    cells.push({ d, entries });
  }
  return (
    <>
      <p className="muted text-xs">Known closing dates (red), application deadlines on record (amber) and the actions you accepted for each day. A vacancy with no recorded closing date is never placed on the calendar: it appears in the list below instead.</p>
      <div className="grid grid-cols-7 gap-1 text-xs">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((h) => <div key={h} className="muted px-1">{h}</div>)}
        {cells.map(({ d, entries }) => (
          <div key={d} className={`card p-1 min-h-20 ${d === today ? "border-accent" : ""}`}>
            <div className="muted">{d.slice(8)}{d.slice(8) === "01" || d === start ? ` ${new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`))}` : ""}</div>
            {entries.slice(0, 4).map((e) => <div key={e.key} className={`truncate ${e.tone}`}>{e.href ? <Link className="underline" href={e.href} title={e.text}>{e.text}</Link> : e.text}</div>)}
            {entries.length > 4 && <div className="muted">+{entries.length - 4} more</div>}
          </div>
        ))}
      </div>
      <section className="card"><h2 className="font-semibold mb-1">Active vacancies with no closing date on record</h2>
        {(unknown ?? []).length === 0 ? <p className="muted text-sm">None.</p> : <ul className="text-sm space-y-1 list-disc pl-5">{(unknown ?? []).map((u) => <li key={u.id}><Link className="underline" href={`/priorities/${u.id}`}>{u.name}</Link> <span className="muted">— unknown: verify before relying on it</span></li>)}</ul>}
      </section>
    </>
  );
}

async function Outreach() {
  const { supabase } = await requireUser();
  const [{ data: active }, { data: held }] = await Promise.all([
    supabase.from("v_priority_queue").select("*").eq("kind", "employer").in("status", ["high", "recommended"]).order("pinned", { ascending: false }).order("score_used", { ascending: false, nullsFirst: false }).limit(100),
    supabase.from("v_priority_queue").select("*").eq("kind", "employer").eq("status", "on_hold").order("hold_until", { ascending: true, nullsFirst: false }).limit(100),
  ]);
  const basis = (c: unknown) => { const items = ((c ?? {}) as { items?: { key: string; reasons: string[] }[] }).items ?? []; return items.find((i) => i.key === "receptiveness")?.reasons[0] ?? null; };
  return (
    <>
      <p className="muted text-xs">Practices worth approaching speculatively. Being in the database is not evidence an employer is hiring: each row says whether recruitment is confirmed or only a hypothesis. Nothing is sent from here; outreach goes through its own approval step.</p>
      <div className="card p-0 overflow-x-auto">
        <table>
          <thead><tr><th>Practice</th><th>Scores</th><th>Basis for approaching</th><th>Contact history</th><th></th></tr></thead>
          <tbody>
            {((active ?? []) as QueueRow[]).map((r) => (
              <tr key={r.id}>
                <td><ItemLink id={r.id!}>{r.name}</ItemLink><div className="mt-1"><PriorityBadge status={r.status} manual={!!r.manual_status} /></div><Warnings warnings={r.warnings} /></td>
                <td><ScorePair suitability={r.suitability_total} priority={r.score} override={r.override_score} /></td>
                <td className="text-xs max-w-sm">{basis(r.components) ?? "—"}</td>
                <td className="text-xs">{(r.outbound_count ?? 0) > 0 ? `${r.outbound_count} message(s), last ${r.last_outbound_at ? fmtDate(r.last_outbound_at) : "?"}` : "Never contacted"}</td>
                <td><form action={togglePin.bind(null, r.id!)}><button className="btn btn-sm">{r.pinned ? "Unpin" : "Pin"}</button></form></td>
              </tr>
            ))}
            {(active ?? []).length === 0 && <tr><td colSpan={5} className="muted text-center py-8">No speculative targets are ready. Save employers for Stage 3 from their Research page.</td></tr>}
          </tbody>
        </table>
      </div>
      {(held ?? []).length > 0 && (
        <section className="card space-y-1"><h2 className="font-semibold">Held back</h2><p className="muted text-xs">Not recommended again until the date shown, unless you record a reason to approach sooner.</p>
          <ul className="text-sm space-y-1">{((held ?? []) as QueueRow[]).map((r) => <li key={r.id}><ItemLink id={r.id!}>{r.name}</ItemLink> <span className="muted">— {r.manual_reason ?? ((r.components as { hold?: { reason?: string } } | null)?.hold?.reason ?? "on hold")}{r.hold_until ? ` · reconsider after ${r.hold_until}` : ""}</span></li>)}</ul>
        </section>
      )}
    </>
  );
}

async function Backlog() {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("v_priority_queue").select("*").in("status", ["backlog", "on_hold"]).order("status").order("score_used", { ascending: false, nullsFirst: false }).limit(200);
  const rows = (data ?? []) as QueueRow[];
  return (
    <>
      <p className="muted text-xs">Backlog: worth revisiting later. On hold: cannot progress yet, with the reason and what would reopen it.</p>
      <div className="card p-0 overflow-x-auto">
        <table>
          <thead><tr><th>Opportunity</th><th>Status</th><th>Scores</th><th>Reason / what would reopen it</th><th>Reconsider</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const hold = (r.components as { hold?: { reason: string | null; condition: string | null } } | null)?.hold;
              return (
                <tr key={r.id}>
                  <td><ItemLink id={r.id!}>{r.name}</ItemLink><div className="muted text-xs">{r.kind === "employer" ? "speculative" : r.employer_name}</div></td>
                  <td><PriorityBadge status={r.status} manual={!!r.manual_status} /></td>
                  <td><ScorePair suitability={r.suitability_total} priority={r.score} override={r.override_score} /></td>
                  <td className="text-xs max-w-sm">{r.status === "on_hold" ? <><div>{r.manual_reason ?? hold?.reason ?? "—"}</div><div className="muted">{r.hold_condition ?? hold?.condition ?? ""}</div></> : (r.rationale ?? []).slice(0, 2).join(" ")}</td>
                  <td className="text-xs">{r.hold_until ?? "no date set"}</td>
                  <td className="whitespace-nowrap"><form action={followRecommendation.bind(null, r.id!)} className="inline"><button className="btn btn-sm">Use recommendation</button></form> <form action={promoteItem.bind(null, r.id!)} className="inline"><input type="hidden" name="reason" value="Promoted from the backlog" /><button className="btn btn-sm">Promote</button></form></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="muted text-center py-8">Nothing in the backlog or on hold.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function History() {
  const { supabase } = await requireUser();
  const [{ data: events }, { data: dismissed }] = await Promise.all([
    supabase.from("priority_events").select("id, item_id, event, actor, from_status, to_status, score_before, score_after, reason, created_at").order("created_at", { ascending: false }).limit(120),
    supabase.from("v_priority_queue").select("id, name, dismissed_reason, manual_reason, updated_at").eq("status", "dismissed").order("updated_at", { ascending: false }).limit(50),
  ]);
  const ids = [...new Set((events ?? []).map((e) => e.item_id))];
  const names = new Map<string, string>();
  if (ids.length) for (const r of (await supabase.from("v_priority_queue").select("id, name").in("id", ids)).data ?? []) names.set(r.id!, r.name ?? "");
  return (
    <>
      <div className="card p-0 overflow-x-auto">
        <table>
          <thead><tr><th>When</th><th>Opportunity</th><th>What</th><th>Who</th><th>Reason</th></tr></thead>
          <tbody>
            {(events ?? []).map((e) => (
              <tr key={e.id}>
                <td className="muted whitespace-nowrap">{fmtDateTime(e.created_at)}</td>
                <td><ItemLink id={e.item_id}>{names.get(e.item_id) ?? "Opportunity"}</ItemLink></td>
                <td>{humanise(e.event)}{e.to_status && <span className="muted"> → {humanise(e.to_status)}</span>}{e.score_before != null && e.score_after != null && <span className="muted"> ({Math.round(Number(e.score_before))} → {Math.round(Number(e.score_after))})</span>}</td>
                <td className="muted">{e.actor === "user" ? "you" : "system"}</td>
                <td className="text-xs max-w-md">{e.reason ?? ""}</td>
              </tr>
            ))}
            {(events ?? []).length === 0 && <tr><td colSpan={5} className="muted text-center py-8">No decisions or changes recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <section className="card"><h2 className="font-semibold mb-1">Dismissed</h2>
        {(dismissed ?? []).length === 0 ? <p className="muted text-sm">Nothing dismissed.</p> : <ul className="text-sm space-y-1">{(dismissed ?? []).map((d) => <li key={d.id}><ItemLink id={d.id!}>{d.name}</ItemLink> <span className="muted">— {d.dismissed_reason ?? d.manual_reason ?? "no reason recorded"} · {fmtDate(d.updated_at)}</span></li>)}</ul>}
      </section>
    </>
  );
}
