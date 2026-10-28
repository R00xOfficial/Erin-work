import { CANDIDATE_QUALIFICATIONS, EMPLOYMENT_TYPES, ROLE_FAMILIES, WORKING_ARRANGEMENTS, DEFAULT_CANDIDATE_PROFILE } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { humanise } from "@/lib/utils";
import { approveProfile, saveProfile } from "@/server/actions/settings";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ProfileSettings() {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("candidate_profile").select("*").eq("id", true).maybeSingle();
  const p = { ...DEFAULT_CANDIDATE_PROFILE, ...(data ?? {}) };
  const approved = data != null && data.approved_version === data.profile_version;
  return (
    <div className="space-y-4 max-w-5xl">
    <section className={`card text-sm flex flex-wrap items-center gap-3 ${approved ? "" : "border-warn"}`}>
      <div className="mr-auto">
        <strong>Profile version {data?.profile_version ?? 1}</strong>{" "}
        {approved ? <span className="badge badge-ok">approved {data?.approved_at ? fmtDateTime(data.approved_at) : ""}</span> : <span className="badge badge-warn">not approved</span>}
        <p className="muted text-xs mt-1">Assessments compare vacancies only with what is recorded here, and never assume a skill or qualification that is not. Approving confirms this version is accurate; editing any fit-related field creates a new version that needs approving again.</p>
      </div>
      {!approved && <form action={approveProfile}><button className="btn btn-primary" type="submit">Approve this version</button></form>}
    </section>
    <form action={saveProfile} className="card grid-form">
      <p className="col-span-full muted text-sm">This profile drives eligibility (hard flags) and scoring. Hard flags are evaluated before any score: a Part 2-only vacancy stays ineligible however good the employer looks.</p>
      <div><label>Full name</label><input name="full_name" defaultValue={p.full_name ?? ""} /></div>
      <div><label>Email (for signatures)</label><input name="email" type="email" defaultValue={p.email ?? ""} /></div>
      <div><label>Phone (for signatures)</label><input name="phone" defaultValue={p.phone ?? ""} /></div>
      <div><label>Qualification</label><select name="qualification" defaultValue={p.qualification}>{CANDIDATE_QUALIFICATIONS.map((q) => <option key={q} value={q}>{humanise(q)}</option>)}</select></div>
      <div><label>University</label><input name="university" defaultValue={p.university ?? ""} /></div>
      <div><label>Graduation year</label><input name="graduation_year" type="number" defaultValue={p.graduation_year ?? ""} /></div>
      <div><label>Years of relevant practice experience</label><input name="experience_years" type="number" step="0.5" defaultValue={String(p.experience_years)} /></div>
      <div className="col-span-full"><label>Experience summary</label><textarea name="experience_summary" rows={2} defaultValue={p.experience_summary ?? ""} /></div>
      <div className="col-span-full"><label>Software (comma separated)</label><input name="software" defaultValue={p.software.join(", ")} /></div>
      <div className="col-span-full"><label>Skills</label><input name="skills" defaultValue={p.skills.join(", ")} /></div>
      <div className="col-span-full"><label>Sector interests</label><input name="sector_interests" defaultValue={p.sector_interests.join(", ")} /></div>
      <fieldset className="col-span-full"><label>Target role families</label><div className="flex flex-wrap gap-3">{ROLE_FAMILIES.filter((f) => !["senior_or_unsuitable", "unknown", "architect_part3"].includes(f)).map((f) => <label key={f} className="flex items-center gap-1 m-0"><input type="checkbox" name="target_role_families" value={f} defaultChecked={p.target_role_families.includes(f)} /> {humanise(f)}</label>)}</div></fieldset>
      <fieldset className="col-span-full"><label>Accepted employment types</label><div className="flex flex-wrap gap-3">{EMPLOYMENT_TYPES.filter((t) => t !== "unknown").map((t) => <label key={t} className="flex items-center gap-1 m-0"><input type="checkbox" name="accepted_employment_types" value={t} defaultChecked={p.accepted_employment_types.includes(t)} /> {humanise(t)}</label>)}</div></fieldset>
      <div><label>Working arrangement preference</label><select name="working_arrangement_preference" defaultValue={p.working_arrangement_preference}>{WORKING_ARRANGEMENTS.map((w) => <option key={w} value={w}>{w === "unknown" ? "Any arrangement" : humanise(w)}</option>)}</select></div>
      <div><label>Main objective</label><select name="objective" defaultValue={p.objective}>{["get_into_work_fast", "long_term_progression", "design_led", "technical_bim", "maximise_opportunities"].map((o) => <option key={o} value={o}>{humanise(o)}</option>)}</select></div>
      <div><label>Home postcode (commute origin)</label><input name="home_postcode" defaultValue={p.home_postcode ?? ""} placeholder="e.g. SE1 7PB" /></div>
      <div><label>Max one-way commute, public transport (min)</label><input name="max_public_transport_minutes" type="number" defaultValue={p.max_public_transport_minutes} /></div>
      <div><label>Max one-way commute, car (min, blank = none)</label><input name="max_car_minutes" type="number" defaultValue={p.max_car_minutes ?? ""} /></div>
      <div><label>Minimum salary £ (blank = flexible)</label><input name="min_salary_gbp" type="number" defaultValue={p.min_salary_gbp ?? ""} /></div>
      <div><label>Available from</label><input name="availability_from" type="date" defaultValue={p.availability_from ?? ""} /></div>
      <div><label>Portfolio URL</label><input name="portfolio_url" defaultValue={p.portfolio_url ?? ""} /></div>
      <div><label>LinkedIn URL</label><input name="linkedin_url" defaultValue={p.linkedin_url ?? ""} /></div>
      <div className="col-span-full flex flex-wrap gap-4">
        <label className="flex items-center gap-2 m-0"><input type="checkbox" name="accept_adjacent_entry_roles" defaultChecked={p.accept_adjacent_entry_roles} /> Consider all entry routes (technician, BIM, planning, coordination), not only Part 1 assistant roles</label>
        <label className="flex items-center gap-2 m-0"><input type="checkbox" name="has_uk_right_to_work" defaultChecked={p.has_uk_right_to_work} /> I have the right to work in the UK</label>
        <label className="flex items-center gap-2 m-0"><input type="checkbox" name="qualification_verified" defaultChecked={p.qualification_verified} /> Qualification level confirmed (e.g. ARB/RIBA Part 1 prescribed degree)</label>
      </div>
      <div className="col-span-full"><button className="btn btn-primary" type="submit">Save profile</button> <span className="muted text-xs ml-2">Saving queues a re-score of every employer; changing the postcode also queues travel-time recalculation.</span></div>
    </form>
    </div>
  );
}
