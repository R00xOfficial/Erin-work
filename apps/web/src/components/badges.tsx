import { humanise } from "@/lib/utils";

export function BandBadge({ band }: { band: string | null | undefined }) {
  if (!band) return <span className="badge">Unscored</span>;
  const cls = band === "A" ? "badge-ok" : band === "B" ? "badge-accent" : band === "C" ? "" : "badge-warn";
  return <span className={`badge ${cls}`}>{band === "research_further" ? "Research further" : `Priority ${band}`}</span>;
}

const STAGE_CLASS: Record<string, string> = {
  suppressed: "badge-danger",
  closed_no_opportunity: "",
  replied: "badge-ok",
  conversation_in_progress: "badge-ok",
  cv_requested: "badge-ok",
  informal_interview: "badge-ok",
  opportunity_identified: "badge-ok",
  follow_up_due: "badge-warn",
  contact_approved: "badge-accent",
  ready_to_contact: "badge-accent",
  email_sent: "badge-accent",
  offer_received: "badge-ok",
  offer_accepted: "badge-ok",
  rejected: "badge-danger",
  shortlisted: "badge-ok",
  interview_1: "badge-ok",
  further_interview: "badge-ok",
  submitted: "badge-accent",
  acknowledged: "badge-accent",
};
export function StageBadge({ stage }: { stage: string }) {
  return <span className={`badge ${STAGE_CLASS[stage] ?? ""}`}>{humanise(stage)}</span>;
}

export function EvidenceBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const cls = status === "verified_fact" ? "badge-ok" : status === "source_supported_summary" ? "badge-accent" : status === "conflicting_sources" ? "badge-danger" : status === "inference" ? "badge-warn" : "";
  return <span className={`badge ${cls}`} title="Evidence status">{humanise(status)}</span>;
}

export function EligibilityBadge({ status, flags }: { status: string; flags?: string[] | null }) {
  const cls = status === "eligible" ? "badge-ok" : status === "ineligible" ? "badge-danger" : "badge-warn";
  return (
    <span className="inline-flex flex-wrap gap-1">
      <span className={`badge ${cls}`}>{humanise(status)}</span>
      {(flags ?? []).map((f) => <span key={f} className="badge badge-danger">{humanise(f)}</span>)}
    </span>
  );
}

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="badge">—</span>;
  const ok = ["open", "sent", "delivered", "active", "succeeded", "done", "approved", "eligible", "replied"];
  const bad = ["closed", "filled", "withdrawn", "bounced", "failed", "blocked", "rejected", "error", "forbidden", "gone", "needs_reauth", "revoked"];
  const warn = ["closing_soon", "unverified", "pending", "pending_approval", "drafted", "partial", "rate_limited", "snoozed", "needs_review", "awaiting_reply", "simulated"];
  const cls = ok.includes(value) ? "badge-ok" : bad.includes(value) ? "badge-danger" : warn.includes(value) ? "badge-warn" : "";
  return <span className={`badge ${cls}`}>{humanise(value)}</span>;
}
