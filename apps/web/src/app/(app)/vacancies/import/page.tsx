import { EMPLOYMENT_TYPES } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { importVacancy } from "@/server/actions/vacancies";
import { humanise } from "@/lib/utils";

export default async function ImportVacancyPage({ searchParams }: { searchParams: Promise<{ employer_id?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const { data: employers } = await supabase.from("employers").select("id, legal_name, display_name").is("deleted_at", null).order("legal_name").limit(1000);
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Paste a vacancy</h1>
      <p className="muted text-sm">Use this for Indeed, LinkedIn, Dezeen Jobs and any other site the system must not fetch automatically. The original description is stored verbatim with the URL and a timestamp; the worker extracts requirements afterwards. Duplicate URLs are detected.</p>
      <form action={importVacancy} className="card grid-form">
        <div className="col-span-full"><label>Listing URL *</label><input name="url" type="url" required placeholder="https://..." /></div>
        <div className="col-span-full"><label>Exact job title *</label><input name="title" required /></div>
        <div><label>Employer (existing)</label><select name="employer_id" defaultValue={sp.employer_id ?? ""}><option value="">— not in database —</option>{(employers ?? []).map((e) => <option key={e.id} value={e.id}>{e.display_name ?? e.legal_name}</option>)}</select></div>
        <div><label>Employer name as advertised</label><input name="employer_name" placeholder="If not in the database, or anonymised agency ad" /></div>
        <div><label>Source</label><input name="source_label" placeholder="Indeed / LinkedIn / Dezeen Jobs / company careers page" /></div>
        <div><label>Employment type</label><select name="employment_type" defaultValue="unknown">{EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
        <div><label>Location text</label><input name="location_text" placeholder="London EC1 / Petersfield" /></div>
        <div><label>Postcode (if known)</label><input name="postcode" /></div>
        <div><label>Closing date</label><input name="closing_at" type="date" /></div>
        <div><label>Salary as advertised</label><input name="salary_text" placeholder="£26,000–£28,000" /></div>
        <div><label>Application email (if given)</label><input name="application_email" type="email" /></div>
        <div className="col-span-full"><label>Original job description (paste verbatim)</label><textarea name="description" rows={14} /></div>
        <div className="col-span-full"><button className="btn btn-primary" type="submit">Save vacancy</button></div>
      </form>
    </div>
  );
}
