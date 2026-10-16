import { PRACTICE_TYPES, SIZE_BANDS } from "@ajis/shared";
import { createEmployer } from "@/server/actions/employers";
import { humanise } from "@/lib/utils";

export default function NewEmployerPage() {
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Add employer</h1>
      <p className="muted text-sm">Every business is a potential employer, not a vacancy. Duplicates are detected by Companies House number, website domain and normalised name; you will be redirected to the existing record if one matches.</p>
      <form action={createEmployer} className="card grid-form">
        <div className="col-span-full"><label>Legal / trading name *</label><input name="legal_name" required /></div>
        <div><label>Display name</label><input name="display_name" /></div>
        <div><label>Website</label><input name="website" type="url" placeholder="https://" /></div>
        <div><label>Careers URL</label><input name="careers_url" type="url" /></div>
        <div><label>LinkedIn company URL</label><input name="linkedin_url" type="url" /></div>
        <div><label>Companies House number</label><input name="companies_house_number" placeholder="e.g. 05120005" /></div>
        <div><label>Employer category</label><select name="practice_type" defaultValue="architecture_practice">{PRACTICE_TYPES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
        <div><label>Size band</label><select name="size_band" defaultValue="unknown">{SIZE_BANDS.map((s) => <option key={s} value={s}>{s === "unknown" ? "Unknown" : s.replace("_plus", "+").replace("_", "–")}</option>)}</select></div>
        <div><label>Sectors (comma separated)</label><input name="sectors" placeholder="residential, education" /></div>
        <div><label>General email</label><input name="generic_email" type="email" /></div>
        <div><label>Applications email</label><input name="applications_email" type="email" /></div>
        <div><label>Office town</label><input name="town" placeholder="London" /></div>
        <div><label>Office postcode</label><input name="postcode" placeholder="EC1A 1BB" /></div>
        <div className="col-span-full"><label>Where did you find this employer? (source URL)</label><input name="source_url" type="url" placeholder="https://www.architecture.com/find-an-architect/..." /></div>
        <div className="col-span-full"><label>Research notes (facts only; interpretation goes in fit notes)</label><textarea name="notes" rows={3} /></div>
        <div className="col-span-full"><button className="btn btn-primary" type="submit">Create employer</button></div>
      </form>
    </div>
  );
}
