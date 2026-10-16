import Link from "next/link";
import { TASK_PRIORITIES, TASK_TYPES } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { fmtDateTime, humanise } from "@/lib/utils";
import { cancelTask, completeTask, createTask, snoozeTask } from "@/server/actions/tasks";

export const dynamic = "force-dynamic";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  let q = supabase.from("tasks").select("*, employers(id, legal_name, display_name)").order("priority").order("due_at", { ascending: true, nullsFirst: false }).limit(300);
  q = sp.status === "done" ? q.in("status", ["done", "cancelled"]) : q.in("status", ["open", "in_progress", "snoozed"]);
  if (sp.type) q = q.eq("task_type", sp.type as (typeof TASK_TYPES)[number]);
  const { data: tasks } = await q;
  const now = Date.now();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold mr-auto">Tasks <span className="muted text-sm font-normal">({tasks?.length ?? 0})</span></h1>
        <Link href="/tasks" className="btn">Open</Link>
        <Link href="/tasks?status=done" className="btn">Done</Link>
      </div>
      <form action={createTask} className="card flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-64"><label>New task</label><input name="title" required placeholder="e.g. Check Make Architects careers page" /></div>
        <div><label>Type</label><select name="task_type" defaultValue="other">{TASK_TYPES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
        <div><label>Priority</label><select name="priority" defaultValue="normal">{TASK_PRIORITIES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
        <div><label>Due</label><input name="due_at" type="datetime-local" /></div>
        <button className="btn btn-primary" type="submit">Add</button>
      </form>
      <div className="card p-0 overflow-x-auto">
        <table>
          <thead><tr><th>Priority</th><th>Task</th><th>Type</th><th>Employer</th><th>Due</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(tasks ?? []).map((t) => {
              const e = t.employers as { id: string; legal_name: string; display_name: string | null } | null;
              const overdue = t.due_at && new Date(t.due_at).getTime() < now && t.status !== "done";
              return (
                <tr key={t.id}>
                  <td><span className={`badge ${t.priority === "high" ? "badge-danger" : t.priority === "low" ? "" : "badge-accent"}`}>{t.priority}</span></td>
                  <td>{t.title}{t.auto_generated && <span className="muted text-xs ml-1">(auto)</span>}{t.notes && <div className="muted text-xs">{t.notes}</div>}</td>
                  <td className="muted">{humanise(t.task_type)}</td>
                  <td>{e ? <Link className="underline" href={`/employers/${e.id}`}>{e.display_name ?? e.legal_name}</Link> : t.entity_type === "application" && t.entity_id ? <Link className="underline" href={`/applications/${t.entity_id}`}>application</Link> : t.entity_type === "vacancy" && t.entity_id ? <Link className="underline" href={`/vacancies/${t.entity_id}`}>vacancy</Link> : "—"}</td>
                  <td className={overdue ? "text-danger" : "muted"}>{fmtDateTime(t.due_at)}</td>
                  <td><span className="badge">{humanise(t.status)}</span></td>
                  <td className="whitespace-nowrap">
                    {t.status !== "done" && t.status !== "cancelled" && (
                      <>
                        <form action={completeTask.bind(null, t.id)} className="inline"><button className="btn btn-sm">Done</button></form>
                        <form action={snoozeTask.bind(null, t.id, 2)} className="inline ml-1"><button className="btn btn-sm">+2d</button></form>
                        <form action={cancelTask.bind(null, t.id)} className="inline ml-1"><button className="btn btn-sm">Cancel</button></form>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {(tasks ?? []).length === 0 && <tr><td colSpan={7} className="muted text-center py-8">No tasks.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
