import { importEmployersCsv } from "@/server/actions/imports";
import { requireUser } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ImportEmployersPage({ searchParams }: { searchParams: Promise<{ import?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const { data: imports } = await supabase.from("imports").select("*").order("created_at", { ascending: false }).limit(10);
  const { data: rows } = sp.import ? await supabase.from("import_rows").select("*").eq("import_id", sp.import).order("row_no") : { data: null };
  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-xl font-semibold">Import employers</h1>
      <p className="muted text-sm">Paste CSV or tab-separated rows with a header. Recognised columns: <code>name, website, town, postcode, practice_type, companies_house_number, sectors, source_url, notes</code>. Every row is matched by Companies House number, domain and normalised name before anything is created, so re-importing the same list is safe. RIBA directory results must be typed or pasted by you — the directory's terms forbid automated copying.</p>
      <form action={importEmployersCsv} className="card space-y-2">
        <textarea name="csv" rows={12} placeholder={"name,website,town,postcode,practice_type,source_url\nExample Architects,https://example.co.uk,Guildford,GU1 3AA,architecture_practice,https://www.architecture.com/find-an-architect/..."} required />
        <div className="flex gap-2 items-center"><input name="default_source_url" placeholder="Default source URL for all rows (optional)" /><button className="btn btn-primary whitespace-nowrap" type="submit">Import</button></div>
      </form>
      {rows && (
        <section className="card p-0 overflow-x-auto">
          <h2 className="font-semibold p-4 pb-2">Import results</h2>
          <table><thead><tr><th>#</th><th>Name</th><th>Result</th><th>Message</th></tr></thead><tbody>
            {rows.map((r) => <tr key={r.id}><td>{r.row_no}</td><td>{(r.raw as { name?: string }).name}</td><td><span className={`badge ${r.result === "created" ? "badge-ok" : r.result === "rejected" ? "badge-danger" : ""}`}>{r.result}</span></td><td className="muted">{r.message}{r.entity_id && <a className="underline ml-2" href={`/employers/${r.entity_id}`}>open</a>}</td></tr>)}
          </tbody></table>
        </section>
      )}
      <section className="card p-0 overflow-x-auto">
        <h2 className="font-semibold p-4 pb-2">Previous imports</h2>
        <table><thead><tr><th>When</th><th>Kind</th><th>Rows</th><th>Created</th><th>Duplicates</th><th>Rejected</th></tr></thead><tbody>
          {(imports ?? []).map((i) => <tr key={i.id}><td className="muted">{fmtDateTime(i.created_at)}</td><td>{i.kind}</td><td>{i.row_count}</td><td>{i.created_count}</td><td>{i.duplicate_count}</td><td>{i.rejected_count}</td></tr>)}
        </tbody></table>
      </section>
    </div>
  );
}
