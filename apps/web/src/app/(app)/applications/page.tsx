import Link from "next/link";
import { APPLICATION_STAGES } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { KanbanBoard, type KanbanCard } from "@/components/applications/kanban";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const [{ data: apps, error }, { data: meta }] = await Promise.all([
    supabase.from("applications").select("id, stage, application_type, deadline_at, next_action, next_action_due, submitted_at, stage_changed_at, employers(display_name, legal_name), vacancies(title)").is("deleted_at", null).order("stage_changed_at", { ascending: false }),
    supabase.from("pipeline_stage_meta").select("stage, label, sort_order, is_terminal").eq("pipeline", "application").order("sort_order"),
  ]);
  if (error) throw new Error(error.message);
  const cards: KanbanCard[] = (apps ?? []).map((a) => {
    const e = a.employers as { display_name: string | null; legal_name: string } | null;
    const v = a.vacancies as { title: string } | null;
    return { id: a.id, stage: a.stage, employer: e?.display_name ?? e?.legal_name ?? "—", title: v?.title ?? `${a.application_type} application`, type: a.application_type, deadline: a.deadline_at, nextAction: a.next_action, nextActionDue: a.next_action_due, stageChangedAt: a.stage_changed_at };
  });
  const showClosed = sp.view === "all";
  const stages = (meta ?? []).filter((m) => showClosed || !m.is_terminal).map((m) => ({ stage: m.stage as (typeof APPLICATION_STAGES)[number], label: m.label }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold mr-auto">Applications <span className="muted text-sm font-normal">({cards.length})</span></h1>
        <Link href={showClosed ? "/applications" : "/applications?view=all"} className="btn">{showClosed ? "Hide closed" : "Show closed"}</Link>
        <Link href="/vacancies" className="btn btn-primary">Start from a vacancy</Link>
      </div>
      <p className="muted text-xs">Drag a card to change its stage. Applications are separate from employer outreach: a speculative conversation and a formal application at the same practice are tracked independently.</p>
      <KanbanBoard stages={stages} cards={cards} />
    </div>
  );
}
