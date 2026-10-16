import Link from "next/link";
import { ROLE_FAMILIES, VACANCY_STATUSES, ELIGIBILITY_STATUSES } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate, fmtMoney, humanise } from "@/lib/utils";
import { EligibilityBadge, StatusBadge } from "@/components/badges";
import { markVacancyReviewed } from "@/server/actions/vacancies";

export const dynamic = "force-dynamic";
type SP = { q?: string; status?: string; eligibility?: string; family?: string; filter?: string; zone?: string };

export default async function VacanciesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  let q = supabase.from("vacancies").select("id, title, status, eligibility_status, hard_flags, role_family, location_text, zone_code, first_seen_at, closing_at, salary_min, salary_max, salary_period, salary_text, discovery_source, reviewed_at, employer_id, employer_name_raw, employer_match_status, duplicate_of_vacancy_id, employers!employer_id(display_name, legal_name)").is("deleted_at", null).is("duplicate_of_vacancy_id", null).order("first_seen_at", { ascending: false }).limit(300);
  if (sp.q) q = q.textSearch("search_vector", sp.q, { type: "websearch", config: "english" });
  if (sp.status) q = q.eq("status", sp.status as (typeof VACANCY_STATUSES)[number]); else if (sp.filter !== "all") q = q.in("status", ["open", "closing_soon", "unverified"]);
  if (sp.eligibility) q = q.eq("eligibility_status", sp.eligibility as (typeof ELIGIBILITY_STATUSES)[number]);
  if (sp.family) q = q.eq("role_family", sp.family as (typeof ROLE_FAMILIES)[number]);
  if (sp.filter === "unreviewed") q = q.is("reviewed_at", null);
  if (sp.zone) q = q.eq("zone_code", sp.zone);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold mr-auto">Vacancies <span className="muted text-sm font-normal">({rows?.length ?? 0})</span></h1>
        <Link href="/vacancies?filter=unreviewed" className="btn">Unreviewed</Link>
        <Link href="/vacancies?filter=all" className="btn">Include closed</Link>
        <Link href="/vacancies/import" className="btn btn-primary">Paste a vacancy</Link>
      </div>
      <form className="card grid gap-2 grid-cols-2 md:grid-cols-6" method="get">
        <input name="q" placeholder="Search title, employer, description" defaultValue={sp.q ?? ""} className="col-span-2" />
        <select name="status" defaultValue={sp.status ?? ""}><option value="">Open / unverified</option>{VACANCY_STATUSES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select>
        <select name="eligibility" defaultValue={sp.eligibility ?? ""}><option value="">Any eligibility</option>{ELIGIBILITY_STATUSES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select>
        <select name="family" defaultValue={sp.family ?? ""}><option value="">Any role family</option>{ROLE_FAMILIES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select>
        <div className="flex gap-2"><select name="zone" defaultValue={sp.zone ?? ""}><option value="">Any zone</option>{["A", "B", "C", "EXT", "OUT"].map((z) => <option key={z} value={z}>Zone {z}</option>)}</select><button className="btn" type="submit">Filter</button></div>
      </form>
      <div className="card p-0 overflow-x-auto">
        <table>
          <thead><tr><th>Title</th><th>Employer</th><th>Family</th><th>Status</th><th>Eligibility</th><th>Location</th><th>Salary</th><th>Closing</th><th>Found</th><th></th></tr></thead>
          <tbody>
            {(rows ?? []).map((v) => {
              const emp = v.employers as { display_name: string | null; legal_name: string } | null;
              return (
                <tr key={v.id} className={v.reviewed_at ? "" : "font-medium"}>
                  <td><Link className="underline" href={`/vacancies/${v.id}`}>{v.title}</Link>{!v.reviewed_at && <span className="badge badge-accent ml-1">new</span>}</td>
                  <td>{v.employer_id ? <Link className="underline" href={`/employers/${v.employer_id}`}>{emp?.display_name ?? emp?.legal_name}</Link> : <span className="muted">{v.employer_name_raw ?? "unmatched"} {v.employer_match_status === "agency_anonymised" && "(agency)"}</span>}</td>
                  <td className="muted">{humanise(v.role_family)}</td>
                  <td><StatusBadge value={v.status} /></td>
                  <td><EligibilityBadge status={v.eligibility_status} flags={v.hard_flags} /></td>
                  <td className="muted">{v.location_text ?? "—"} {v.zone_code && <span className="badge">{v.zone_code}</span>}</td>
                  <td>{v.salary_min != null || v.salary_max != null ? fmtMoney(Number(v.salary_min), v.salary_max == null ? null : Number(v.salary_max), v.salary_period) : (v.salary_text ?? "—")}</td>
                  <td className="muted whitespace-nowrap">{fmtDate(v.closing_at)}</td>
                  <td className="muted whitespace-nowrap">{fmtDate(v.first_seen_at)} <span className="text-xs">{v.discovery_source}</span></td>
                  <td>{!v.reviewed_at && <form action={markVacancyReviewed.bind(null, v.id)}><button className="btn btn-sm">Reviewed</button></form>}</td>
                </tr>
              );
            })}
            {(rows ?? []).length === 0 && <tr><td colSpan={10} className="muted text-center py-8">No vacancies. Paste one, or enable a discovery source under Sources.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
