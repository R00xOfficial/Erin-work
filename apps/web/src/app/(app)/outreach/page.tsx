import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, humanise } from "@/lib/utils";
import { StatusBadge } from "@/components/badges";
import { approveDraft, createFollowUpDraft, editDraft, markFollowUpDone, rejectDraft } from "@/server/actions/outreach";

export const dynamic = "force-dynamic";

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab ?? "approvals";
  const { supabase } = await requireUser();
  const [{ data: counts }, { data: pending }, { data: followUps }, { data: sent }, { data: threads }, { data: cred }] = await Promise.all([
    supabase.from("v_dashboard_counts").select("stop_switch, dry_run, approvals_pending, follow_ups_due").maybeSingle(),
    supabase.from("activities").select("*, employers(id, legal_name, display_name, website_domain, outreach_stage), contacts(full_name, email_verification), vacancies(title, hard_flags)").eq("approval_status", "pending_approval").in("delivery_result", ["pending", "drafted", "blocked"]).order("created_at"),
    supabase.from("v_queue_follow_up").select("*"),
    supabase.from("activities").select("id, subject, recipient_email, sent_at, delivery_result, blocked_reasons, provider_thread_id, reply_received, employers(id, legal_name, display_name)").eq("direction", "outbound").eq("channel", "email").in("delivery_result", ["sent", "delivered", "simulated", "bounced", "failed", "blocked", "cancelled"]).order("created_at", { ascending: false }).limit(50),
    supabase.from("email_threads").select("*, employers(id, legal_name, display_name)").order("last_message_at", { ascending: false }).limit(50),
    supabase.from("oauth_credential_status").select("status, account_email").eq("provider", "gmail").maybeSingle(),
  ]);
  const tabs = [["approvals", `Approval queue (${pending?.length ?? 0})`], ["follow-ups", `Follow-ups due (${followUps?.length ?? 0})`], ["sent", "Sent & blocked"], ["threads", "Threads"]] as const;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold mr-auto">Outreach</h1>
        <span className={`badge ${cred?.status === "active" ? "badge-ok" : "badge-danger"}`}>Gmail: {cred ? `${cred.account_email} · ${humanise(cred.status)}` : "not connected"}</span>
        {counts?.stop_switch && <span className="badge badge-danger">Stop switch on</span>}
        {counts?.dry_run && <span className="badge badge-warn">Dry run</span>}
        <Link href="/settings/gmail" className="btn btn-sm">Gmail settings</Link>
      </div>
      <nav className="tabs">{tabs.map(([k, label]) => <Link key={k} href={`/outreach?tab=${k}`} aria-current={tab === k ? "page" : undefined}>{label}</Link>)}</nav>

      {tab === "approvals" && (
        <div className="space-y-4">
          <p className="muted text-xs">Nothing is sent without your approval here. Each card shows the recipient, source evidence, message, attachments and the reason for contacting the employer. Blocked reasons come from the pre-send checklist.</p>
          {(pending ?? []).length === 0 && <p className="card muted">No drafts awaiting approval. Create one from an employer's Outreach tab.</p>}
          {(pending ?? []).map((a) => {
            const e = a.employers as { id: string; legal_name: string; display_name: string | null; website_domain: string | null; outreach_stage: string } | null;
            const c = a.contacts as { full_name: string; email_verification: string } | null;
            const v = a.vacancies as { title: string; hard_flags: string[] } | null;
            const atts = (a.attachments as { file_name: string; kind: string }[]) ?? [];
            const rendered = a.delivery_result === "drafted" || a.delivery_result === "blocked";
            return (
              <section key={a.id} className="card space-y-3">
                <div className="flex flex-wrap gap-2 items-center">
                  <Link className="font-semibold underline" href={`/employers/${e?.id}`}>{e?.display_name ?? e?.legal_name}</Link>
                  <span className="badge">{humanise(e?.outreach_stage ?? "")}</span>
                  <span className="muted text-sm">→ {c ? `${c.full_name} <${a.recipient_email}>` : a.recipient_email ?? "no recipient"}</span>
                  <span className="badge">{a.template_code} v{a.template_version}</span>
                  {v && <span className="badge badge-accent">{v.title}</span>}
                  <StatusBadge value={a.delivery_result} />
                  <span className="muted text-xs ml-auto">created {fmtDateTime(a.created_at)}</span>
                </div>
                {e?.outreach_stage !== "contact_approved" && !a.in_reply_to && <p className="text-warn text-sm">Employer stage must be “Contact approved” before this can be sent. Change it on the employer page.</p>}
                {a.blocked_reasons.length > 0 && <p className="text-danger text-sm">Checklist blocked: {a.blocked_reasons.map((r) => humanise(r)).join(", ")}</p>}
                {v && v.hard_flags.length > 0 && <p className="text-danger text-sm">Vacancy hard flags: {v.hard_flags.join(", ")}</p>}
                {rendered ? (
                  <form action={editDraft.bind(null, a.id)} className="space-y-2">
                    <div><label>Subject</label><input name="subject" defaultValue={a.subject ?? ""} /></div>
                    <div><label>Body</label><textarea name="body_text" rows={12} defaultValue={a.body_text ?? ""} /></div>
                    <div className="flex flex-wrap gap-2 items-center">
                      <span className="muted text-xs">Attachments: {atts.length ? atts.map((x) => `${x.kind}: ${x.file_name}`).join(", ") : "none"}</span>
                      <button className="btn btn-sm ml-auto" type="submit">Save edits & re-render</button>
                    </div>
                  </form>
                ) : <p className="muted text-sm">Waiting for the worker to render the template and create the Gmail draft…</p>}
                <div className="flex flex-wrap gap-2">
                  <form action={approveDraft.bind(null, a.id)}><button className="btn btn-primary" type="submit" disabled={!rendered}>Approve & send</button></form>
                  <form action={async (fd: FormData) => { "use server"; await rejectDraft(a.id, String(fd.get("note") ?? "")); }} className="flex gap-2"><input name="note" placeholder="Reason (optional)" className="w-64" /><button className="btn btn-danger" type="submit">Reject</button></form>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {tab === "follow-ups" && (
        <div className="card p-0 overflow-x-auto">
          <table>
            <thead><tr><th>Employer</th><th>Contact</th><th>Original subject</th><th>Sent</th><th>Due</th><th>Stage</th><th></th></tr></thead>
            <tbody>
              {(followUps ?? []).map((f) => (
                <tr key={f.id}>
                  <td><Link className="underline" href={`/employers/${f.employer_id}`}>{f.employer_name}</Link></td>
                  <td>{f.contact_name ?? "—"}</td>
                  <td>{f.subject}</td>
                  <td className="muted">{fmtDate(f.sent_at)}</td>
                  <td className="text-warn">{fmtDate(f.follow_up_due_at)}</td>
                  <td><span className="badge">{humanise(f.outreach_stage ?? "")}</span></td>
                  <td className="whitespace-nowrap">
                    <form action={createFollowUpDraft.bind(null, f.id!)} className="inline"><button className="btn btn-sm btn-primary">Draft follow-up</button></form>
                    <form action={markFollowUpDone.bind(null, f.id!)} className="inline ml-1"><button className="btn btn-sm">Skip</button></form>
                  </td>
                </tr>
              ))}
              {(followUps ?? []).length === 0 && <tr><td colSpan={7} className="muted text-center py-8">No follow-ups due. Follow-ups are created {`{follow_up_days}`} days after a sent email with no reply, bounce or opt-out.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "sent" && (
        <div className="card p-0 overflow-x-auto">
          <table>
            <thead><tr><th>When</th><th>Employer</th><th>Recipient</th><th>Subject</th><th>Result</th><th>Reply</th><th></th></tr></thead>
            <tbody>
              {(sent ?? []).map((a) => {
                const e = a.employers as { id: string; legal_name: string; display_name: string | null } | null;
                return (
                  <tr key={a.id}>
                    <td className="muted whitespace-nowrap">{fmtDateTime(a.sent_at)}</td>
                    <td>{e && <Link className="underline" href={`/employers/${e.id}`}>{e.display_name ?? e.legal_name}</Link>}</td>
                    <td>{a.recipient_email}</td>
                    <td>{a.subject}</td>
                    <td><StatusBadge value={a.delivery_result} />{a.blocked_reasons.length > 0 && <div className="text-danger text-xs">{a.blocked_reasons.join(", ")}</div>}</td>
                    <td>{a.reply_received ? <span className="badge badge-ok">replied</span> : <span className="muted">—</span>}</td>
                    <td>{a.provider_thread_id && <Link className="btn btn-sm" href={`/outreach/threads/${a.provider_thread_id}`}>Thread</Link>}</td>
                  </tr>
                );
              })}
              {(sent ?? []).length === 0 && <tr><td colSpan={7} className="muted text-center py-8">Nothing sent yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "threads" && (
        <div className="card p-0 overflow-x-auto">
          <table>
            <thead><tr><th>Employer</th><th>Subject</th><th>Status</th><th>Messages</th><th>Last</th><th></th></tr></thead>
            <tbody>
              {(threads ?? []).map((t) => {
                const e = t.employers as { id: string; legal_name: string; display_name: string | null } | null;
                return (
                  <tr key={t.id}>
                    <td>{e && <Link className="underline" href={`/employers/${e.id}`}>{e.display_name ?? e.legal_name}</Link>}</td>
                    <td>{t.subject}</td>
                    <td><StatusBadge value={t.status} /></td>
                    <td>{t.message_count} ({t.last_direction})</td>
                    <td className="muted">{fmtDateTime(t.last_message_at)}</td>
                    <td><Link className="btn btn-sm" href={`/outreach/threads/${t.provider_thread_id}`}>Open</Link></td>
                  </tr>
                );
              })}
              {(threads ?? []).length === 0 && <tr><td colSpan={6} className="muted text-center py-8">No email threads yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
