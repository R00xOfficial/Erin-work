import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { fmtDateTime, humanise } from "@/lib/utils";
import { StatusBadge } from "@/components/badges";
import { createFollowUpDraft } from "@/server/actions/outreach";

export const dynamic = "force-dynamic";

export default async function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const { supabase } = await requireUser();
  const { data: thread } = await supabase.from("email_threads").select("*, employers(id, legal_name, display_name), contacts(full_name, email)").eq("provider_thread_id", threadId).maybeSingle();
  const { data: messages } = await supabase.from("activities").select("*").eq("provider_thread_id", threadId).order("occurred_at");
  if (!thread && (messages ?? []).length === 0) notFound();
  const e = thread?.employers as { id: string; legal_name: string; display_name: string | null } | null;
  const c = thread?.contacts as { full_name: string; email: string | null } | null;
  const lastOutbound = [...(messages ?? [])].reverse().find((m) => m.direction === "outbound" && ["sent", "delivered"].includes(m.delivery_result));
  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap gap-3 items-start">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">{thread?.subject ?? messages?.[0]?.subject}</h1>
          <div className="muted text-sm flex gap-2 mt-1">{e && <Link className="underline" href={`/employers/${e.id}?tab=outreach`}>{e.display_name ?? e.legal_name}</Link>}{c && <span>{c.full_name} {c.email && `<${c.email}>`}</span>}</div>
        </div>
        {thread && <StatusBadge value={thread.status} />}
        {lastOutbound && thread?.status === "awaiting_reply" && <form action={createFollowUpDraft.bind(null, lastOutbound.id)}><button className="btn btn-sm">Draft follow-up</button></form>}
      </div>
      <div className="space-y-3">
        {(messages ?? []).map((m) => (
          <article key={m.id} className={`card ${m.direction === "inbound" ? "border-accent" : ""}`}>
            <div className="flex flex-wrap gap-2 items-center text-xs muted mb-2">
              <span className="badge">{m.direction}</span>
              <span>{m.direction === "outbound" ? `to ${m.recipient_email}` : `from ${m.sender_email ?? "?"}`}</span>
              <span>{fmtDateTime(m.sent_at ?? m.occurred_at)}</span>
              <StatusBadge value={m.delivery_result} />
              {m.opt_out_detected && <span className="badge badge-danger">opt-out detected</span>}
              <span className="ml-auto">{humanise(m.activity_type)}</span>
            </div>
            <div className="font-medium mb-1">{m.subject}</div>
            <div className="prose text-sm"><p>{m.body_text}</p></div>
          </article>
        ))}
      </div>
    </div>
  );
}
