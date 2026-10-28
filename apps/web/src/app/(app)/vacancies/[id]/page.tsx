import Link from "next/link";
import { notFound } from "next/navigation";
import { APPLICATION_ROUTES, EMPLOYMENT_TYPES, QUALIFICATIONS_REQUIRED, SENIORITIES, VACANCY_STATUSES, WORKING_ARRANGEMENTS } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, humanise } from "@/lib/utils";
import { EligibilityBadge, EvidenceBadge, StatusBadge } from "@/components/badges";
import { restoreVacancy, saveVacancy, dismissVacancy } from "@/server/actions/discovery";
import { closeVacancy, createEmployerFromVacancy, linkVacancyEmployer, recheckEligibility, updateVacancy } from "@/server/actions/vacancies";
import { createApplication } from "@/server/actions/applications";

export const dynamic = "force-dynamic";

export default async function VacancyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ duplicate?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const { data: v } = await supabase.from("vacancies").select("*, employers!employer_id(id, legal_name, display_name, website_domain)").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!v) notFound();
  const [{ data: app }, { data: claims }, { data: snapshots }, { data: candidates }, { data: dupes }] = await Promise.all([
    supabase.from("applications").select("id, stage").eq("vacancy_id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("claims").select("*").eq("entity_type", "vacancy").eq("entity_id", id).eq("is_current", true).order("field_name"),
    supabase.from("vacancy_snapshots").select("id, content_hash, captured_at, source_url").eq("vacancy_id", id).order("captured_at", { ascending: false }),
    v.employer_id ? Promise.resolve({ data: [] }) : supabase.from("employers").select("id, legal_name, display_name").is("deleted_at", null).order("legal_name").limit(1000),
    v.dedup_fingerprint ? supabase.from("vacancies").select("id, title, discovery_source, first_seen_at").eq("dedup_fingerprint", v.dedup_fingerprint).neq("id", id).is("deleted_at", null) : Promise.resolve({ data: [] }),
  ]);
  const emp = v.employers as { id: string; legal_name: string; display_name: string | null } | null;
  return (
    <div className="space-y-4">
      {sp.duplicate && <div className="card border-warn text-sm">This URL was already in the database; you were taken to the existing record.</div>}
      <div className="flex flex-wrap gap-3 items-start">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">{v.title}</h1>
          <div className="muted text-sm flex flex-wrap gap-2 mt-1">
            {emp ? <Link className="underline" href={`/employers/${emp.id}`}>{emp.display_name ?? emp.legal_name}</Link> : <span>{v.employer_name_raw ?? "Employer unmatched"}</span>}
            <a className="underline" href={v.original_url} target="_blank" rel="noreferrer">original listing</a>
            <span>via {v.discovery_source ?? "unknown"}</span>
            <span>first seen {fmtDate(v.first_seen_at)}</span>
            {v.last_verified_at && <span>verified {fmtDate(v.last_verified_at)}</span>}
            {v.disappeared_at && <span className="text-danger">listing disappeared {fmtDate(v.disappeared_at)}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center"><StatusBadge value={v.status} /><EligibilityBadge status={v.eligibility_status} flags={v.hard_flags} /><span className="badge">{humanise(v.role_family)}</span></div>
      </div>
      {v.eligibility_reasons.length > 0 && <div className="card text-sm"><strong>Eligibility notes:</strong> {v.eligibility_reasons.join(" ")}</div>}

      <div className="card flex flex-wrap gap-2">
        {app ? <Link className="btn btn-primary" href={`/applications/${app.id}`}>Application: {humanise(app.stage)}</Link> : v.employer_id ? (
          <form action={createApplication}><input type="hidden" name="employer_id" value={v.employer_id} /><input type="hidden" name="vacancy_id" value={v.id} /><input type="hidden" name="application_type" value="advertised" /><button className="btn btn-primary" type="submit" disabled={v.eligibility_status === "ineligible"}>Create application</button></form>
        ) : <span className="muted text-sm self-center">Link an employer to create an application.</span>}
        <form action={recheckEligibility.bind(null, v.id)}><button className="btn" type="submit">Re-check eligibility</button></form>
        <form action={closeVacancy.bind(null, v.id, "closed")}><button className="btn" type="submit">Mark closed</button></form>
        <form action={closeVacancy.bind(null, v.id, "withdrawn")}><button className="btn" type="submit">Withdrawn by employer</button></form>
        {v.discovery_state === "dismissed" ? (
          <form action={restoreVacancy.bind(null, v.id)}><button className="btn" type="submit">Restore to discovery</button></form>
        ) : (
          <>
            {v.discovery_state !== "saved" && <form action={saveVacancy.bind(null, v.id)}><button className="btn" type="submit">Save for research</button></form>}
            <form action={dismissVacancy.bind(null, v.id)}><button className="btn" type="submit">Not relevant</button></form>
          </>
        )}
      </div>

      {!v.employer_id && (
        <section className="card flex flex-wrap gap-3 items-end">
          <h2 className="font-semibold w-full">Match employer</h2>
          <form action={async (fd: FormData) => { "use server"; const eid = String(fd.get("employer_id") ?? ""); if (eid) await linkVacancyEmployer(id, eid); }} className="flex gap-2 items-end">
            <div className="w-72"><label>Existing employer</label><select name="employer_id" defaultValue=""><option value="">—</option>{(candidates ?? []).map((e) => <option key={e.id} value={e.id}>{e.display_name ?? e.legal_name}</option>)}</select></div>
            <button className="btn" type="submit">Link</button>
          </form>
          {v.employer_name_raw && <form action={createEmployerFromVacancy.bind(null, v.id)}><button className="btn" type="submit">Create employer “{v.employer_name_raw}”</button></form>}
        </section>
      )}

      {(dupes ?? []).length > 0 && <div className="card text-sm"><strong>Same role on other boards:</strong> {dupes!.map((d) => <Link key={d.id} className="underline mr-2" href={`/vacancies/${d.id}`}>{d.discovery_source ?? d.title} ({fmtDate(d.first_seen_at)})</Link>)}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="font-semibold mb-2">Requirements and terms</h2>
          <form action={updateVacancy.bind(null, v.id)} className="grid-form text-sm">
            <div className="col-span-full"><label>Title</label><input name="title" defaultValue={v.title} /></div>
            <div><label>Status</label><select name="status" defaultValue={v.status}>{VACANCY_STATUSES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select></div>
            <div><label>Employment type</label><select name="employment_type" defaultValue={v.employment_type}>{EMPLOYMENT_TYPES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select></div>
            <div><label>Seniority</label><select name="seniority" defaultValue={v.seniority}>{SENIORITIES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select></div>
            <div><label>Qualification required</label><select name="qualification_required" defaultValue={v.qualification_required}>{QUALIFICATIONS_REQUIRED.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select></div>
            <div><label>Experience min (years)</label><input name="experience_years_min" type="number" defaultValue={v.experience_years_min ?? ""} /></div>
            <div><label>Experience max</label><input name="experience_years_max" type="number" defaultValue={v.experience_years_max ?? ""} /></div>
            <div><label>Salary min</label><input name="salary_min" type="number" defaultValue={v.salary_min ?? ""} /></div>
            <div><label>Salary max</label><input name="salary_max" type="number" defaultValue={v.salary_max ?? ""} /></div>
            <div><label>Salary text</label><input name="salary_text" defaultValue={v.salary_text ?? ""} /></div>
            <div><label>Hours</label><input name="hours_text" defaultValue={v.hours_text ?? ""} /></div>
            <div><label>Hybrid policy</label><select name="hybrid_policy" defaultValue={v.hybrid_policy}>{WORKING_ARRANGEMENTS.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select></div>
            <div><label>Office attendance</label><input name="office_attendance_text" defaultValue={v.office_attendance_text ?? ""} /></div>
            <div><label>Location</label><input name="location_text" defaultValue={v.location_text ?? ""} /></div>
            <div><label>Postcode</label><input name="postcode" defaultValue={v.postcode ?? ""} /></div>
            <div><label>Posted</label><input name="posted_at" type="date" defaultValue={v.posted_at?.slice(0, 10) ?? ""} /></div>
            <div><label>Closing</label><input name="closing_at" type="date" defaultValue={v.closing_at?.slice(0, 10) ?? ""} /></div>
            <div><label>Application route</label><select name="application_route" defaultValue={v.application_route}>{APPLICATION_ROUTES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select></div>
            <div><label>Application email</label><input name="application_email" defaultValue={v.application_email ?? ""} /></div>
            <div className="col-span-full"><label>Application URL</label><input name="application_url" defaultValue={v.application_url ?? ""} /></div>
            <div><label>Software requested</label><input name="software_requested" defaultValue={v.software_requested.join(", ")} /></div>
            <div><label>Skills requested</label><input name="skills_requested" defaultValue={v.skills_requested.join(", ")} /></div>
            <div><label>Sectors</label><input name="sectors_requested" defaultValue={v.sectors_requested.join(", ")} /></div>
            <div><label>Portfolio requirements</label><input name="portfolio_requirements" defaultValue={v.portfolio_requirements ?? ""} /></div>
            <div className="col-span-full flex flex-wrap gap-4 items-center">
              <label className="flex items-center gap-2 m-0"><input type="checkbox" name="right_to_work_required" defaultChecked={v.right_to_work_required ?? false} /> Existing right to work required (no sponsorship)</label>
              <label className="flex items-center gap-2 m-0"><input type="checkbox" name="mark_verified" /> Verified against the listing today</label>
              <label className="flex items-center gap-2 m-0"><input type="checkbox" name="mark_reviewed" defaultChecked={!!v.reviewed_at} /> Reviewed</label>
              <button className="btn btn-primary ml-auto" type="submit">Save</button>
            </div>
          </form>
        </section>
        <div className="space-y-4">
          <section className="card">
            <h2 className="font-semibold mb-2">Original description <span className="muted text-xs font-normal">snapshot {fmtDateTime(v.description_snapshot_at)}{v.description_is_truncated && " · truncated by source"}</span></h2>
            {v.description_snapshot ? <div className="prose text-sm max-h-96 overflow-y-auto border border-border rounded p-3"><p>{v.description_snapshot}</p></div> : <p className="muted text-sm">No description stored. Open the original listing and paste the text via Edit, or let the page-check worker fetch it where permitted.</p>}
            {(snapshots ?? []).length > 1 && <p className="muted text-xs mt-2">{snapshots!.length} snapshots recorded; the listing text changed {snapshots!.length - 1} time(s).</p>}
          </section>
          <section className="card">
            <h2 className="font-semibold mb-2">Extracted claims</h2>
            {(claims ?? []).length === 0 ? <p className="muted text-sm">None yet. The worker's vacancy extraction fills this from the description with quotes.</p> : (
              <table className="text-sm"><tbody>{claims!.map((c) => <tr key={c.id}><td className="font-medium">{c.field_name}</td><td>{typeof c.value === "string" ? c.value : JSON.stringify(c.value)}</td><td><EvidenceBadge status={c.evidence_status} /></td><td className="muted text-xs">{c.quote}</td></tr>)}</tbody></table>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
