import Link from "next/link";
import { humanise } from "@/lib/utils";

export const STATUS_LABEL: Record<string, string> = { high: "High priority", recommended: "Recommended", backlog: "Backlog", on_hold: "On hold", dismissed: "Dismissed" };
const STATUS_CLASS: Record<string, string> = { high: "badge-danger", recommended: "badge-accent", backlog: "", on_hold: "badge-warn", dismissed: "" };

export function PriorityBadge({ status, manual }: { status: string | null; manual?: boolean }) {
  if (!status) return null;
  return <span className={`badge ${STATUS_CLASS[status] ?? ""}`}>{STATUS_LABEL[status] ?? humanise(status)}{manual ? " (your decision)" : ""}</span>;
}

/** Stage 2 suitability and Stage 3 priority are different measures and are always shown apart. */
export function ScorePair({ suitability, priority, override }: { suitability: number | null; priority: number | null; override?: number | null }) {
  return (
    <div className="text-xs space-y-0.5 whitespace-nowrap">
      <div><span className="muted">Suitability</span> <span className="badge">{suitability == null ? "—" : Math.round(suitability)}</span></div>
      <div><span className="muted">Priority</span> <span className="badge badge-accent">{priority == null ? "no score yet" : Math.round(priority)}</span>{override != null && <span className="muted"> (your override)</span>}</div>
    </div>
  );
}

export function Deadline({ at, daysLeft, live }: { at: string | null; daysLeft: number | null; live: boolean | null }) {
  if (!at) return <span className="muted">unknown</span>;
  const d = at.slice(0, 10);
  if (live === false || (daysLeft != null && daysLeft < 0)) return <span className="text-danger">{d} · passed</span>;
  return <span className={daysLeft != null && daysLeft <= 3 ? "text-danger" : daysLeft != null && daysLeft <= 7 ? "text-warn" : ""}>{d} · {daysLeft === 0 ? "today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"}`}</span>;
}

export function Warnings({ warnings }: { warnings: unknown }) {
  const list = (warnings ?? []) as { code: string; text: string; severity: string }[];
  const shown = list.filter((w) => w.severity !== "info");
  if (shown.length === 0) return null;
  return <ul className="text-xs space-y-0.5 mt-1">{shown.slice(0, 3).map((w) => <li key={w.code} className={w.severity === "blocker" ? "text-danger" : "text-warn"}>{w.severity === "blocker" ? "⛔" : "⚠"} {w.text}</li>)}{shown.length > 3 && <li className="muted">+{shown.length - 3} more</li>}</ul>;
}

export const ItemLink = ({ id, children }: { id: string; children: React.ReactNode }) => <Link className="underline font-medium" href={`/priorities/${id}`}>{children}</Link>;
