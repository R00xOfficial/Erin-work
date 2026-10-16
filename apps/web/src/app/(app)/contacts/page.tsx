import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate, humanise } from "@/lib/utils";
import { EvidenceBadge, StatusBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; dnc?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  let q = supabase.from("contacts").select("*, employers(id, legal_name, display_name)").is("deleted_at", null).order("relevance_rank").order("full_name").limit(500);
  if (sp.q) q = q.or(`full_name.ilike.%${sp.q}%,email.ilike.%${sp.q}%,role_title.ilike.%${sp.q}%`);
  if (sp.dnc === "1") q = q.eq("do_not_contact", true);
  const { data: rows } = await q;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold mr-auto">Contacts <span className="muted text-sm font-normal">({rows?.length ?? 0})</span></h1>
        <Link href="/contacts?dnc=1" className="btn">Do-not-contact list</Link>
      </div>
      <form className="card flex gap-2" method="get"><input name="q" placeholder="Search name, email, role" defaultValue={sp.q ?? ""} /><button className="btn" type="submit">Search</button></form>
      <p className="muted text-xs">Contacts are added from each employer's page. Professional details only; every record carries a lawful-basis note and retention rule.</p>
      <div className="card p-0 overflow-x-auto">
        <table>
          <thead><tr><th>Name</th><th>Employer</th><th>Role</th><th>Authority</th><th>Rank</th><th>Email</th><th>Verification</th><th>Relationship</th><th>Last contact</th><th>Evidence</th></tr></thead>
          <tbody>
            {(rows ?? []).map((c) => {
              const e = c.employers as { id: string; legal_name: string; display_name: string | null } | null;
              return (
                <tr key={c.id} className={c.do_not_contact ? "opacity-60" : ""}>
                  <td><Link className="underline" href={`/contacts/${c.id}`}>{c.full_name}</Link>{c.do_not_contact && <span className="badge badge-danger ml-1">DNC</span>}</td>
                  <td>{e && <Link className="underline" href={`/employers/${e.id}`}>{e.display_name ?? e.legal_name}</Link>}</td>
                  <td>{c.role_title ?? humanise(c.role_category)}</td>
                  <td className="muted">{humanise(c.hiring_authority)}</td>
                  <td>{c.relevance_rank}</td>
                  <td>{c.email ?? "—"}</td>
                  <td><StatusBadge value={c.email_verification} /></td>
                  <td className="muted">{humanise(c.relationship_status)}</td>
                  <td className="muted">{fmtDate(c.last_contacted_at)}</td>
                  <td><EvidenceBadge status={c.evidence_status} /></td>
                </tr>
              );
            })}
            {(rows ?? []).length === 0 && <tr><td colSpan={10} className="muted text-center py-8">No contacts yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
