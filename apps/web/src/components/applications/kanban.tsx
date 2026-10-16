"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { DndContext, type DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import type { ApplicationStage } from "@ajis/shared";
import { moveApplicationStage } from "@/server/actions/applications";
import { fmtDate } from "@/lib/utils";

export interface KanbanCard {
  id: string;
  stage: string;
  employer: string;
  title: string;
  type: string;
  deadline: string | null;
  nextAction: string | null;
  nextActionDue: string | null;
  stageChangedAt: string;
}

function Card({ card }: { card: KanbanCard }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const overdue = card.nextActionDue && new Date(card.nextActionDue) < new Date();
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className={`card p-2 text-xs space-y-1 cursor-grab ${isDragging ? "opacity-60 shadow-lg" : ""}`}>
      <div className="font-semibold leading-tight">{card.employer}</div>
      <div className="muted leading-tight">{card.title}</div>
      <div className="flex flex-wrap gap-1 items-center">
        <span className="badge">{card.type}</span>
        {card.deadline && <span className="badge badge-warn">due {fmtDate(card.deadline)}</span>}
        {card.nextAction && <span className={`badge ${overdue ? "badge-danger" : ""}`}>{card.nextAction}</span>}
      </div>
      <Link href={`/applications/${card.id}`} className="underline" onPointerDown={(e) => e.stopPropagation()}>Open</Link>
    </div>
  );
}

function Column({ stage, label, cards }: { stage: string; label: string; cards: KanbanCard[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <div ref={setNodeRef} className={`flex-shrink-0 w-56 rounded-lg border border-border p-2 space-y-2 min-h-40 ${isOver ? "bg-accent-soft" : "bg-surface-2"}`}>
      <div className="flex justify-between items-baseline"><span className="text-xs font-semibold">{label}</span><span className="muted text-xs">{cards.length}</span></div>
      {cards.map((c) => <Card key={c.id} card={c} />)}
    </div>
  );
}

export function KanbanBoard({ stages, cards: initial }: { stages: { stage: ApplicationStage; label: string }[]; cards: KanbanCard[] }) {
  const [cards, setCards] = useState(initial);
  const [, start] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  function onDragEnd(ev: DragEndEvent) {
    const over = ev.over?.id as ApplicationStage | undefined;
    const id = String(ev.active.id);
    if (!over) return;
    const card = cards.find((c) => c.id === id);
    if (!card || card.stage === over) return;
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, stage: over } : c)));
    start(async () => {
      try { await moveApplicationStage(id, over); } catch (e) { alert((e as Error).message); setCards(initial); }
    });
  }
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((s) => <Column key={s.stage} stage={s.stage} label={s.label} cards={cards.filter((c) => c.stage === s.stage)} />)}
      </div>
    </DndContext>
  );
}
