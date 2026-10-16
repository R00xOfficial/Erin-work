import Link from "next/link";
import { EMPLOYER_OUTREACH_STAGES, PRACTICE_TYPES, SCORE_BANDS } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate, humanise } from "@/lib/utils";
import { BandBadge, StageBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

type SP = { q?: string; stage?: string; band?: string; type?: string; zone?: string; sort?: string };

export default async function EmployersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  let query = supabase
    .from("employers")
    .select("id, legal_name, display_name, practice_type, outreach_stage, latest_score, latest_band, data_quality, confidence_score, last_checked_at, next_review_at, website_domain, offices!offices_employer_id_fkey(town, zone_code, is_primary, deleted_at)")
    .is("deleted_at", null)
    .limit(300);
  if (sp.q) query = query.textSearch("search_vector", sp.q, { type: "websearch", config: "english" });
  if (sp.stage) query = query.eq("outreach_stage", sp.stage as (typeof EMPLOYER_OUTREACH_STAGES)[number]);
  if (sp.band) query = query.eq("latest_band", sp.band as (typeof SCORE_BANDS)[number]);
  if (sp.type) query = query.eq("practice_type", sp.type as (typeof PRACTICE_TYPES)[number]);
  query = sp.sort === "name" ? query.order("legal_name") : sp.sort === "checked" ? query.order("last_checked_at", { ascending: true, nullsFirst: true }) : query.order("latest_score", { ascending: false, nullsFirst: false }).order("legal_name");
  const { data: employers, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (employers ?? []).map((e) => {
    const offices = (e.offices ?? []).filter((o) => !o.deleted_at);
    const primary = offices.find((o) => o.is_primary) ?? offices[0];
    return { ...e, town: primary?.town ?? null, zone: primary?.zone_code ?? null };
  }).filter((r) => !sp.zone || r.zone === sp.zone);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold mr-auto">Employers <span className="muted text-sm font-normal">({rows.length})</span></h1>
        <Link href="/employers/import" className="btn">Import</Link>
        <Link href="/employers/new" className="btn btn-primary">Add employer</Link>
      </div>
      <form className="card grid gap-2 grid-cols-2 md:grid-cols-6" method="get">
        <input name="q" placeholder="Search name, sector, notes" defaultValue={sp.q ?? ""} className="col-span-2" />
        <select name="stage" defaultValue={sp.stage ?? ""}><option value="">Any stage</option>{EMPLOYER_OUTREACH_STAGES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select>
        <select name="band" defaultValue={sp.band ?? ""}><option value="">Any band</option>{SCORE_BANDS.map((b) => <option key={b} value={b}>{b === "research_further" ? "Research further" : `Priority ${b}`}</option>)}</select>
        <select name="type" defaultValue={sp.type ?? ""}><option value="">Any category</option>{PRACTICE_TYPES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select>
        <div className="flex gap-2">
          <select name="zone" defaultValue={sp.zone ?? ""}><option value="">Any zone</option>{["A", "B", "C", "EXT", "OUT"].map((z) => <option key={z} value={z}>Zone {z}</option>)}</select>
          <button className="btn" type="submit">Filter</button>
        </div>
      </form>
      <div className="card p-0 overflow-x-auto">
        <table>
          <thead><tr><th>Employer</th><th>Category</th><th>Town / zone</th><th>Band</th><th>Score</th><th>Stage</th><th>Quality</th><th>Last checked</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td><Link className="font-medium underline" href={`/employers/${e.id}`}>{e.display_name ?? e.legal_name}</Link>{e.website_domain && <div className="muted text-xs">{e.website_domain}</div>}</td>
                <td className="muted">{humanise(e.practice_type)}</td>
                <td>{e.town ?? <span className="muted">—</span>} {e.zone && <span className="badge">{e.zone}</span>}</td>
                <td><BandBadge band={e.latest_band} /></td>
                <td>{e.latest_score ?? <span className="muted">—</span>}</td>
                <td><StageBadge stage={e.outreach_stage} /></td>
                <td className="muted">{humanise(e.data_quality)} · {Math.round(Number(e.confidence_score))}%</td>
                <td className="muted whitespace-nowrap">{fmtDate(e.last_checked_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="muted text-center py-8">No employers match. Add one or import a list.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
