import Link from "next/link";
import { notFound } from "next/navigation";
import { CONTACT_CHANNELS, EMAIL_VERIFICATION, HIRING_AUTHORITY, RELATIONSHIP_STATUSES, ROLE_CATEGORIES } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, humanise } from "@/lib/utils";
import { EvidenceBadge, StatusBadge } from "@/components/badges";
import { setDoNotContact, updateContact } from "@/server/actions/contacts";

export const dynamic = "force-dynamic";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data: c } = await supabase.from("contacts").select("*, employers(id, legal_name, display_name, website_domain), sources(url)").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!c) notFound();
  const [{ data: activities }, { data: suppressions }] = await Promise.all([
    supabase.from("activities").select("*").eq("contact_id", id).order("occurred_at", { ascending: false }),
    supabase.from("suppressions").select("*").or(`contact_id.eq.${id}${c.email ? `,and(scope.eq.email,value.eq.${c.email.toLowerCase()})` : ""}`),
  ]);
  const e = c.employers as { id: string; legal_name: string; display_name: string | null; website_domain: string | null };
  const src = c.sources as { url: string } | null;
  const domainOk = c.email && e.website_domain ? c.email.toLowerCase().endsWith(`@${e.website_domain}`) || c.email.toLowerCase().endsWith(`.${e.website_domain}`) : false;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-start">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">{c.full_name}</h1>
          <div className="muted text-sm flex flex-wrap gap-2 mt-1">
            <span>{c.role_title ?? humanise(c.role_category)}</span>
            <Link className="underline" href={`/employers/${e.id}?tab=contacts`}>{e.display_name ?? e.legal_name}</Link>
            {c.official_profile_url && <a className="underline" href={c.official_profile_url} target="_blank" rel="noreferrer">official profile</a>}
            {c.linkedin_url && <a className="underline" href={c.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a>}
            {src && <a className="underline" href={src.url} target="_blank" rel="noreferrer">source</a>}
          </div>
        </div>
        <div className="flex gap-2 items-center"><EvidenceBadge status={c.evidence_status} /><StatusBadge value={c.email_verification} />{c.do_not_contact && <span className="badge badge-danger">Do not contact</span>}</div>
      </div>
      {c.email && !domainOk && c.email_verification !== "confirmed_by_reply" && <div className="card border-warn text-sm">This email is not on the employer's domain ({e.website_domain ?? "unknown"}). The pre-send check will block it until the person replies to you or you confirm the domain.</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="font-semibold mb-2">Details</h2>
          <form action={updateContact.bind(null, c.id)} className="grid-form text-sm">
            <div><label>Full name</label><input name="full_name" defaultValue={c.full_name} /></div>
            <div><label>Role title</label><input name="role_title" defaultValue={c.role_title ?? ""} /></div>
            <div><label>Role category</label><select name="role_category" defaultValue={c.role_category}>{ROLE_CATEGORIES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
            <div><label>Department</label><input name="department" defaultValue={c.department ?? ""} /></div>
            <div><label>Hiring authority</label><select name="hiring_authority" defaultValue={c.hiring_authority}>{HIRING_AUTHORITY.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
            <div><label>Relevance rank (1 best)</label><input name="relevance_rank" type="number" min={1} max={10} defaultValue={c.relevance_rank} /></div>
            <div><label>Business email</label><input name="email" defaultValue={c.email ?? ""} /></div>
            <div><label>Email source</label><input name="email_source" defaultValue={c.email_source ?? ""} placeholder="staff page / signature / reply" /></div>
            <div><label>Email verification</label><select name="email_verification" defaultValue={c.email_verification}>{EMAIL_VERIFICATION.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
            <div><label>Preferred channel</label><select name="preferred_channel" defaultValue={c.preferred_channel ?? ""}><option value="">—</option>{CONTACT_CHANNELS.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
            <div><label>Relationship</label><select name="relationship_status" defaultValue={c.relationship_status}>{RELATIONSHIP_STATUSES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
            <div><label>Office phone</label><input name="phone" defaultValue={c.phone ?? ""} /></div>
            <div><label>Official profile URL</label><input name="official_profile_url" defaultValue={c.official_profile_url ?? ""} /></div>
            <div><label>LinkedIn</label><input name="linkedin_url" defaultValue={c.linkedin_url ?? ""} /></div>
            <div className="col-span-full"><label>Why this person is relevant</label><input name="relevance_notes" defaultValue={c.relevance_notes ?? ""} /></div>
            <div className="col-span-full"><label>Notes</label><textarea name="notes" rows={3} defaultValue={c.notes ?? ""} /></div>
            <div className="col-span-full"><button className="btn btn-primary" type="submit">Save</button></div>
          </form>
        </section>
        <div className="space-y-4">
          <section className="card text-sm space-y-1">
            <h2 className="font-semibold mb-2">Compliance</h2>
            <div><span className="muted">Lawful basis:</span> {c.lawful_basis_note}</div>
            <div><span className="muted">Retention:</span> {c.retention_rule}</div>
            <div><span className="muted">First contacted:</span> {fmtDate(c.first_contacted_at)} · <span className="muted">last:</span> {fmtDate(c.last_contacted_at)} · <span className="muted">last reply:</span> {fmtDate(c.last_reply_at)}</div>
            {(suppressions ?? []).length > 0 && <ul className="mt-2">{suppressions!.map((s) => <li key={s.id} className="text-danger">Suppressed ({s.scope}: {s.value}) — {humanise(s.reason)} on {fmtDate(s.created_at)}</li>)}</ul>}
            {!c.do_not_contact && (
              <div className="flex gap-2 mt-3">
                <form action={setDoNotContact.bind(null, c.id, "requested_no_contact")}><button className="btn btn-sm btn-danger" type="submit">They asked not to be contacted</button></form>
                <form action={setDoNotContact.bind(null, c.id, "user_decision")}><button className="btn btn-sm" type="submit">My decision: do not contact</button></form>
              </div>
            )}
          </section>
          <section className="card">
            <h2 className="font-semibold mb-2">Interaction history</h2>
            <ul className="text-sm space-y-1">
              {(activities ?? []).map((a) => <li key={a.id} className="flex gap-2"><span className="muted whitespace-nowrap">{fmtDateTime(a.occurred_at)}</span><span className="badge">{humanise(a.activity_type)}</span><span>{a.subject ?? a.body_text?.slice(0, 120)}</span><StatusBadge value={a.direction === "internal" ? null : a.delivery_result} /></li>)}
              {(activities ?? []).length === 0 && <li className="muted">No interactions yet.</li>}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
