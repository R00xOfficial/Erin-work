import Link from "next/link";
import { notFound } from "next/navigation";
import { EMPLOYER_OUTREACH_STAGES, FACTOR_LABELS, SCORE_FACTORS } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, fmtMoney, humanise } from "@/lib/utils";
import { BandBadge, EligibilityBadge, EvidenceBadge, StageBadge, StatusBadge } from "@/components/badges";
import { addEmployerNote, addOffice, changeEmployerStage, deleteOffice, requestBriefing, requestRescore, suppressEmployer, updateEmployer, updateOffice } from "@/server/actions/employers";
import { createContact, deleteContact, setDoNotContact } from "@/server/actions/contacts";
import { saveResearchNote } from "@/server/actions/research";
import { createDraft } from "@/server/actions/outreach";
import { OFFICE_TYPES, PRACTICE_TYPES, ROLE_CATEGORIES, HIRING_AUTHORITY, SIZE_BANDS, WORKING_ARRANGEMENTS, YES_NO_UNKNOWN, DATA_QUALITY } from "@ajis/shared";

export const dynamic = "force-dynamic";

const TABS = ["overview", "intelligence", "offices", "contacts", "vacancies", "outreach", "fit", "evidence", "score"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { overview: "Overview", intelligence: "Intelligence report", offices: "Offices & commute", contacts: "Contacts", vacancies: "Vacancies", outreach: "Outreach timeline", fit: "Fit & research notes", evidence: "Evidence & claims", score: "Score breakdown" };

export default async function EmployerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; duplicate?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "overview";
  const { supabase } = await requireUser();
  const { data: e } = await supabase.from("employers").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!e) notFound();

  const [offices, contacts, vacancies, activities, notes, scores, claims, sources, signals, applications, templates, documents, profile, travel] = await Promise.all([
    supabase.from("offices").select("*").eq("employer_id", id).is("deleted_at", null).order("is_primary", { ascending: false }),
    supabase.from("contacts").select("*").eq("employer_id", id).is("deleted_at", null).order("relevance_rank"),
    supabase.from("vacancies").select("*").eq("employer_id", id).is("deleted_at", null).order("first_seen_at", { ascending: false }),
    supabase.from("activities").select("*, contacts(full_name)").eq("employer_id", id).order("occurred_at", { ascending: false }).limit(100),
    supabase.from("research_notes").select("*").eq("employer_id", id).eq("is_current", true).is("vacancy_id", null).maybeSingle(),
    supabase.from("employer_scores").select("*").eq("employer_id", id).is("vacancy_id", null).order("computed_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("claims").select("*, sources(url, canonical_url, publisher, evidence_type)").eq("entity_type", "employer").eq("entity_id", id).eq("is_current", true).order("field_name"),
    supabase.from("sources").select("*").eq("entity_type", "employer").eq("entity_id", id).order("discovered_at", { ascending: false }),
    supabase.from("hiring_signals").select("*").eq("employer_id", id).order("observed_on", { ascending: false }).limit(20),
    supabase.from("applications").select("id, stage, application_type, vacancy_id, submitted_at").eq("employer_id", id).is("deleted_at", null),
    supabase.from("email_templates").select("id, code, version, purpose").eq("is_active", true).order("code"),
    supabase.from("documents").select("id, kind, version_label, is_current").is("deleted_at", null).order("kind"),
    supabase.from("candidate_profile").select("*").eq("id", true).maybeSingle(),
    supabase.from("travel_times").select("*").in("office_id", []).limit(0),
  ]);
  const officeIds = (offices.data ?? []).map((o) => o.id);
  const { data: travelTimes } = officeIds.length ? await supabase.from("travel_times").select("*").in("office_id", officeIds) : { data: [] as NonNullable<typeof travel.data> };
  const name = e.display_name ?? e.legal_name;
  const pendingJobs = await supabase.from("job_requests").select("job_name, status").in("status", ["pending", "picked_up"]).contains("payload", { employerId: id });

  return (
    <div className="space-y-4">
      {sp.duplicate && <div className="card border-warn text-sm">An employer matching that name, domain or Companies House number already exists. You were redirected here instead of creating a duplicate.</div>}
      <div className="flex flex-wrap gap-3 items-start">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">{name}</h1>
          <div className="muted text-sm flex flex-wrap gap-2 items-center mt-1">
            <span>{humanise(e.practice_type)}</span>
            {e.website && <a className="underline" href={e.website} target="_blank" rel="noreferrer">{e.website_domain ?? e.website}</a>}
            {e.careers_url && <a className="underline" href={e.careers_url} target="_blank" rel="noreferrer">careers</a>}
            {e.linkedin_url && <a className="underline" href={e.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a>}
            {e.companies_house_number && <a className="underline" href={`https://find-and-update.company-information.service.gov.uk/company/${e.companies_house_number}`} target="_blank" rel="noreferrer">CH {e.companies_house_number}</a>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Link className="btn btn-sm" href={`/research/employers/${e.id}`}>Research &amp; speculative assessment</Link>
          <BandBadge band={e.latest_band} />
          {e.latest_score != null && <span className="badge">{e.latest_score}/100</span>}
          <StageBadge stage={e.outreach_stage} />
          {e.is_suppressed && <span className="badge badge-danger">Suppressed</span>}
        </div>
      </div>

      <div className="card flex flex-wrap gap-2 items-end">
        <form action={changeEmployerStage} className="flex gap-2 items-end">
          <input type="hidden" name="id" value={e.id} />
          <div><label>Outreach stage</label><select name="stage" defaultValue={e.outreach_stage} className="min-w-56">{EMPLOYER_OUTREACH_STAGES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select></div>
          <div className="w-64"><label>Note (optional)</label><input name="note" placeholder="Why?" /></div>
          <button className="btn" type="submit">Update stage</button>
        </form>
        <form action={requestBriefing.bind(null, e.id)}><button className="btn" type="submit" disabled={!e.website}>Generate AI briefing</button></form>
        <form action={requestRescore.bind(null, e.id)}><button className="btn" type="submit">Recompute score</button></form>
        {!e.is_suppressed && (
          <form action={suppressEmployer} className="flex gap-2 items-end">
            <input type="hidden" name="id" value={e.id} />
            <select name="reason" defaultValue="user_decision" className="w-44"><option value="user_decision">Your decision</option><option value="requested_no_contact">They asked</option><option value="opt_out">Opt-out received</option><option value="legal">Legal</option></select>
            <button className="btn btn-danger" type="submit">Suppress</button>
          </form>
        )}
        {(pendingJobs.data ?? []).length > 0 && <span className="badge badge-warn">{pendingJobs.data!.map((j) => j.job_name).join(", ")} queued</span>}
      </div>

      <nav className="tabs">{TABS.map((t) => <Link key={t} href={`/employers/${e.id}?tab=${t}`} aria-current={t === tab ? "page" : undefined}>{TAB_LABELS[t]}</Link>)}</nav>

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="card lg:col-span-2 space-y-3">
            <h2 className="font-semibold">Edit record</h2>
            <form action={updateEmployer.bind(null, e.id)} className="grid-form">
              <div><label>Legal name</label><input name="legal_name" defaultValue={e.legal_name} /></div>
              <div><label>Display name</label><input name="display_name" defaultValue={e.display_name ?? ""} /></div>
              <div><label>Website</label><input name="website" defaultValue={e.website ?? ""} /></div>
              <div><label>Careers URL</label><input name="careers_url" defaultValue={e.careers_url ?? ""} /></div>
              <div><label>LinkedIn</label><input name="linkedin_url" defaultValue={e.linkedin_url ?? ""} /></div>
              <div><label>Instagram</label><input name="instagram_url" defaultValue={e.instagram_url ?? ""} /></div>
              <div><label>Companies House number</label><input name="companies_house_number" defaultValue={e.companies_house_number ?? ""} /></div>
              <div><label>Category</label><select name="practice_type" defaultValue={e.practice_type}>{PRACTICE_TYPES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
              <div><label>Size band</label><select name="size_band" defaultValue={e.size_band}>{SIZE_BANDS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
              <div><label>Staff estimate</label><input name="staff_estimate" type="number" defaultValue={e.staff_estimate ?? ""} /></div>
              <div><label>RIBA Chartered Practice</label><select name="riba_chartered" defaultValue={e.riba_chartered}>{YES_NO_UNKNOWN.map((v) => <option key={v}>{v}</option>)}</select></div>
              <div><label>Employs Part 1 / assistants</label><select name="hires_part1" defaultValue={e.hires_part1}>{YES_NO_UNKNOWN.map((v) => <option key={v}>{v}</option>)}</select></div>
              <div><label>Graduate programme</label><select name="has_graduate_programme" defaultValue={e.has_graduate_programme}>{YES_NO_UNKNOWN.map((v) => <option key={v}>{v}</option>)}</select></div>
              <div><label>Accepts speculative CVs</label><select name="accepts_speculative" defaultValue={e.accepts_speculative}>{YES_NO_UNKNOWN.map((v) => <option key={v}>{v}</option>)}</select></div>
              <div><label>Sectors</label><input name="sectors" defaultValue={e.sectors.join(", ")} /></div>
              <div><label>Specialisms</label><input name="specialisms" defaultValue={e.specialisms.join(", ")} /></div>
              <div><label>Software</label><input name="software" defaultValue={e.software.join(", ")} /></div>
              <div><label>Typical entry roles</label><input name="typical_entry_roles" defaultValue={e.typical_entry_roles.join(", ")} /></div>
              <div><label>General email</label><input name="generic_email" defaultValue={e.generic_email ?? ""} /></div>
              <div><label>Applications email</label><input name="applications_email" defaultValue={e.applications_email ?? ""} /></div>
              <div><label>Recruitment channel</label><input name="recruitment_channel" defaultValue={e.recruitment_channel ?? ""} placeholder="email / portal / agency" /></div>
              <div><label>Training / Part 3 support</label><input name="training_support" defaultValue={e.training_support ?? ""} /></div>
              <div><label>Data quality</label><select name="data_quality" defaultValue={e.data_quality}>{DATA_QUALITY.map((v) => <option key={v}>{v}</option>)}</select></div>
              <div><label>Confidence (0–100)</label><input name="confidence_score" type="number" min={0} max={100} defaultValue={Math.round(Number(e.confidence_score))} /></div>
              <div className="col-span-full"><label>Research notes (observed facts)</label><textarea name="research_notes" rows={4} defaultValue={e.research_notes ?? ""} /></div>
              <div className="col-span-full flex items-center gap-3">
                <label className="flex items-center gap-2 m-0"><input type="checkbox" name="mark_checked" /> Mark as checked today (sets next review +30 days)</label>
                <button className="btn btn-primary ml-auto" type="submit">Save</button>
              </div>
            </form>
          </section>
          <aside className="space-y-4">
            <section className="card text-sm space-y-1">
              <h2 className="font-semibold mb-2">Provenance</h2>
              <div className="flex justify-between"><span className="muted">First discovered</span><span>{fmtDate(e.first_discovered_at)}</span></div>
              <div className="flex justify-between"><span className="muted">Last checked</span><span>{fmtDate(e.last_checked_at)}</span></div>
              <div className="flex justify-between"><span className="muted">Next review</span><span>{fmtDate(e.next_review_at)}</span></div>
              <div className="flex justify-between"><span className="muted">Quality</span><span>{humanise(e.data_quality)} · {Math.round(Number(e.confidence_score))}%</span></div>
              <div className="flex justify-between"><span className="muted">Sources</span><span>{sources.data?.length ?? 0}</span></div>
              <div className="flex justify-between"><span className="muted">Claims</span><span>{claims.data?.length ?? 0}</span></div>
            </section>
            <section className="card text-sm">
              <h2 className="font-semibold mb-2">Pipeline</h2>
              <div className="flex justify-between"><span className="muted">Offices</span><span>{offices.data?.length ?? 0}</span></div>
              <div className="flex justify-between"><span className="muted">Contacts</span><span>{contacts.data?.length ?? 0}</span></div>
              <div className="flex justify-between"><span className="muted">Open vacancies</span><span>{(vacancies.data ?? []).filter((v) => ["open", "closing_soon"].includes(v.status)).length}</span></div>
              <div className="flex justify-between"><span className="muted">Applications</span><span>{applications.data?.length ?? 0}</span></div>
              <div className="flex justify-between"><span className="muted">Activities</span><span>{activities.data?.length ?? 0}</span></div>
            </section>
            <section className="card text-sm">
              <h2 className="font-semibold mb-2">Hiring signals</h2>
              {(signals.data ?? []).length === 0 ? <p className="muted">None recorded.</p> : (
                <ul className="space-y-1">{signals.data!.map((s) => <li key={s.id}><span className={`badge ${s.strength === "strong" ? "badge-ok" : s.strength === "moderate" ? "badge-accent" : ""}`}>{humanise(s.signal_type)}</span> <span>{s.summary}</span> <span className="muted">({fmtDate(s.observed_on)})</span></li>)}</ul>
              )}
              <p className="muted text-xs mt-2">Signals trigger research tasks. They never create vacancies.</p>
            </section>
          </aside>
        </div>
      )}

      {tab === "intelligence" && (
        <div className="grid gap-4 lg:grid-cols-2">
          {([
            ["Business overview / signals", "business_signals", e.business_signals, e.business_signals_evidence],
            ["Design identity and vision", "vision_culture", e.vision_culture, e.vision_culture_evidence],
            ["Project portfolio", "project_intelligence", e.project_intelligence, e.project_intelligence_evidence],
            ["Recruitment intelligence", "recruitment_intelligence", e.recruitment_intelligence, e.recruitment_intelligence_evidence],
          ] as const).map(([label, field, value, evidence]) => (
            <section key={field} className="card">
              <div className="flex justify-between items-baseline mb-2"><h2 className="font-semibold">{label}</h2><EvidenceBadge status={evidence} /></div>
              <form action={updateEmployer.bind(null, e.id)} className="space-y-2">
                <textarea name={field} rows={6} defaultValue={value ?? ""} placeholder="Populated by the AI briefing from fetched sources, or written by you. Facts only." />
                <button className="btn btn-sm" type="submit">Save</button>
              </form>
            </section>
          ))}
          <section className="card lg:col-span-2">
            <h2 className="font-semibold mb-2">Projects, contacts and recommendations from the latest briefing</h2>
            <BriefingClaims claims={claims.data ?? []} />
          </section>
        </div>
      )}

      {tab === "offices" && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {(offices.data ?? []).map((o) => {
              const tt = (travelTimes ?? []).filter((t) => t.office_id === o.id);
              const pt = tt.find((t) => t.mode === "public_transport");
              const car = tt.find((t) => t.mode === "car");
              const limit = profile.data?.max_public_transport_minutes ?? 90;
              return (
                <section key={o.id} className="card space-y-2">
                  <div className="flex gap-2 items-center flex-wrap">
                    <h3 className="font-semibold">{o.label ?? o.town ?? "Office"}</h3>
                    {o.is_primary && <span className="badge badge-accent">Primary</span>}
                    <span className="badge">{humanise(o.office_type)}</span>
                    <StatusBadge value={o.status} />
                    {o.zone_code && <span className="badge">Zone {o.zone_code}</span>}
                    <EvidenceBadge status={o.evidence_status} />
                  </div>
                  <div className="text-sm grid grid-cols-2 gap-2">
                    <div><span className="muted">Public transport</span><div className={pt ? (pt.minutes <= limit ? "text-ok font-semibold" : "text-danger font-semibold") : "muted"}>{pt ? `${pt.minutes} min` : "not computed"}</div></div>
                    <div><span className="muted">Car</span><div>{car ? `${car.minutes} min` : <span className="muted">not computed</span>}</div></div>
                  </div>
                  <form action={updateOffice.bind(null, o.id)} className="grid-form text-sm">
                    <div><label>Label</label><input name="label" defaultValue={o.label ?? ""} /></div>
                    <div><label>Address line 1</label><input name="address_line1" defaultValue={o.address_line1 ?? ""} /></div>
                    <div><label>Town</label><input name="town" defaultValue={o.town ?? ""} /></div>
                    <div><label>Postcode</label><input name="postcode" defaultValue={o.postcode ?? ""} /></div>
                    <div><label>Type</label><select name="office_type" defaultValue={o.office_type}>{OFFICE_TYPES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
                    <div><label>Working arrangement</label><select name="working_arrangement" defaultValue={o.working_arrangement}>{WORKING_ARRANGEMENTS.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
                    <div><label>Status</label><select name="status" defaultValue={o.status}>{["active", "closed", "unverified"].map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
                    <div><label>Transport notes</label><input name="transport_notes" defaultValue={o.transport_notes ?? ""} /></div>
                    <div className="col-span-full flex gap-3 items-center">
                      <label className="flex items-center gap-2 m-0"><input type="checkbox" name="mark_verified" /> Verified against an official source</label>
                      <label className="flex items-center gap-2 m-0"><input type="checkbox" name="is_primary" defaultChecked={o.is_primary} /> Primary</label>
                      <button className="btn btn-sm ml-auto" type="submit">Save</button>
                    </div>
                  </form>
                  <form action={deleteOffice.bind(null, o.id, e.id)}><button className="btn btn-sm btn-danger" type="submit">Remove office</button></form>
                  <p className="muted text-xs">Lat/lng {o.lat ?? "?"}, {o.lng ?? "?"} · geocoded {fmtDate(o.geocoded_at)} · registered offices are not workplaces.</p>
                </section>
              );
            })}
          </div>
          <section className="card">
            <h2 className="font-semibold mb-2">Add office</h2>
            <form action={addOffice} className="grid-form">
              <input type="hidden" name="employer_id" value={e.id} />
              <div><label>Label</label><input name="label" placeholder="London studio" /></div>
              <div><label>Address line 1</label><input name="address_line1" /></div>
              <div><label>Town</label><input name="town" /></div>
              <div><label>County</label><input name="county" /></div>
              <div><label>Postcode</label><input name="postcode" /></div>
              <div><label>Type</label><select name="office_type" defaultValue="studio">{OFFICE_TYPES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
              <div><label>Working arrangement</label><select name="working_arrangement" defaultValue="unknown">{WORKING_ARRANGEMENTS.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
              <div><label>Office email</label><input name="email" type="email" /></div>
              <div className="col-span-full"><button className="btn btn-primary" type="submit">Add office</button> <span className="muted text-xs ml-2">Geocoding and travel times are computed by the worker.</span></div>
            </form>
          </section>
        </div>
      )}

      {tab === "contacts" && (
        <div className="space-y-4">
          <div className="card p-0 overflow-x-auto">
            <table>
              <thead><tr><th>Rank</th><th>Name</th><th>Role</th><th>Authority</th><th>Email</th><th>Verification</th><th>Relationship</th><th>Evidence</th><th></th></tr></thead>
              <tbody>
                {(contacts.data ?? []).map((c) => (
                  <tr key={c.id} className={c.do_not_contact ? "opacity-60" : ""}>
                    <td>{c.relevance_rank}</td>
                    <td><Link className="underline" href={`/contacts/${c.id}`}>{c.full_name}</Link>{c.do_not_contact && <span className="badge badge-danger ml-1">Do not contact</span>}</td>
                    <td>{c.role_title ?? humanise(c.role_category)}</td>
                    <td className="muted">{humanise(c.hiring_authority)}</td>
                    <td>{c.email ?? <span className="muted">—</span>}</td>
                    <td><StatusBadge value={c.email_verification} /></td>
                    <td className="muted">{humanise(c.relationship_status)}</td>
                    <td><EvidenceBadge status={c.evidence_status} /></td>
                    <td className="whitespace-nowrap">
                      {!c.do_not_contact && <form action={setDoNotContact.bind(null, c.id, "user_decision")} className="inline"><button className="btn btn-sm">Do not contact</button></form>}
                      <form action={deleteContact.bind(null, c.id)} className="inline ml-1"><button className="btn btn-sm">Remove</button></form>
                    </td>
                  </tr>
                ))}
                {(contacts.data ?? []).length === 0 && <tr><td colSpan={9} className="muted text-center py-6">No contacts. Rank by relevance, not seniority: a studio manager often beats the CEO.</td></tr>}
              </tbody>
            </table>
          </div>
          <section className="card">
            <h2 className="font-semibold mb-2">Add contact</h2>
            <p className="muted text-xs mb-2">Professional information only. Record where the email came from; the pre-send check requires the address to be on the employer's domain unless the person has replied to you.</p>
            <form action={createContact} className="grid-form">
              <input type="hidden" name="employer_id" value={e.id} />
              <div><label>Full name *</label><input name="full_name" required /></div>
              <div><label>Role title</label><input name="role_title" /></div>
              <div><label>Role category</label><select name="role_category" defaultValue="other">{ROLE_CATEGORIES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
              <div><label>Hiring authority</label><select name="hiring_authority" defaultValue="unknown">{HIRING_AUTHORITY.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
              <div><label>Relevance rank (1 = best)</label><input name="relevance_rank" type="number" min={1} max={10} defaultValue={5} /></div>
              <div><label>Business email</label><input name="email" type="email" /></div>
              <div><label>Official staff-page URL</label><input name="official_profile_url" type="url" /></div>
              <div><label>LinkedIn</label><input name="linkedin_url" type="url" /></div>
              <div><label>Office phone</label><input name="phone" /></div>
              <div><label>Office</label><select name="office_id" defaultValue=""><option value="">—</option>{(offices.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.label ?? o.town}</option>)}</select></div>
              <div className="col-span-full"><label>Source URL for this contact</label><input name="source_url" type="url" /></div>
              <div className="col-span-full"><label>Notes</label><input name="notes" /></div>
              <div className="col-span-full"><button className="btn btn-primary" type="submit">Add contact</button></div>
            </form>
          </section>
        </div>
      )}

      {tab === "vacancies" && (
        <div className="space-y-4">
          <div className="card p-0 overflow-x-auto">
            <table>
              <thead><tr><th>Title</th><th>Status</th><th>Eligibility</th><th>Family</th><th>Salary</th><th>Closing</th><th>Source</th><th></th></tr></thead>
              <tbody>
                {(vacancies.data ?? []).map((v) => {
                  const app = (applications.data ?? []).find((a) => a.vacancy_id === v.id);
                  return (
                    <tr key={v.id}>
                      <td><Link className="underline" href={`/vacancies/${v.id}`}>{v.title}</Link></td>
                      <td><StatusBadge value={v.status} /></td>
                      <td><EligibilityBadge status={v.eligibility_status} flags={v.hard_flags} /></td>
                      <td className="muted">{humanise(v.role_family)}</td>
                      <td>{fmtMoney(v.salary_min == null ? null : Number(v.salary_min), v.salary_max == null ? null : Number(v.salary_max), v.salary_period)}</td>
                      <td className="muted">{fmtDate(v.closing_at)}</td>
                      <td className="muted">{v.discovery_source ?? "—"}</td>
                      <td>{app ? <Link className="btn btn-sm" href={`/applications/${app.id}`}>{humanise(app.stage)}</Link> : (
                        v.eligibility_status === "ineligible" ? <span className="muted text-xs">Ineligible</span> : <Link className="btn btn-sm" href={`/applications/new?employer_id=${e.id}&vacancy_id=${v.id}`}>Start application</Link>
                      )}</td>
                    </tr>
                  );
                })}
                {(vacancies.data ?? []).length === 0 && <tr><td colSpan={8} className="muted text-center py-6">No vacancies recorded for this employer. A potential employer is not a current vacancy.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <Link href={`/vacancies/import?employer_id=${e.id}`} className="btn">Paste a vacancy for this employer</Link>
            {!(applications.data ?? []).some((a) => a.application_type === "speculative" && !["rejected", "withdrawn", "closed_without_response"].includes(a.stage)) && (
              <Link className="btn" href={`/applications/new?employer_id=${e.id}&type=speculative`}>Start speculative application</Link>
            )}
          </div>
        </div>
      )}

      {tab === "outreach" && (
        <div className="space-y-4">
          <section className="card">
            <h2 className="font-semibold mb-2">Draft outreach email</h2>
            <p className="muted text-xs mb-2">Creates a draft in the approval queue. The checklist (suppression, stage, caps, attachments, domain) runs before anything is sent, and the stop switch blocks everything while on.</p>
            <form action={createDraft} className="grid-form">
              <input type="hidden" name="employer_id" value={e.id} />
              <div><label>Template</label><select name="template_code" defaultValue="speculative_intro">{(templates.data ?? []).filter((t) => t.purpose !== "follow_up").map((t) => <option key={t.id} value={t.code}>{t.code} v{t.version}</option>)}</select></div>
              <div><label>Contact</label><select name="contact_id" defaultValue=""><option value="">Applications inbox ({e.applications_email ?? e.generic_email ?? "none on file"})</option>{(contacts.data ?? []).filter((c) => c.email && !c.do_not_contact).map((c) => <option key={c.id} value={c.id}>{c.full_name} — {c.email}</option>)}</select></div>
              <div><label>Vacancy (optional)</label><select name="vacancy_id" defaultValue=""><option value="">— speculative —</option>{(vacancies.data ?? []).filter((v) => ["open", "closing_soon", "unverified"].includes(v.status)).map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}</select></div>
              <div><label>CV</label><select name="cv_document_id" defaultValue={documents.data?.find((d) => d.kind === "cv" && d.is_current)?.id ?? ""}><option value="">— none —</option>{(documents.data ?? []).filter((d) => d.kind === "cv").map((d) => <option key={d.id} value={d.id}>{d.version_label}{d.is_current ? " (current)" : ""}</option>)}</select></div>
              <div><label>Portfolio</label><select name="portfolio_document_id" defaultValue=""><option value="">— link only —</option>{(documents.data ?? []).filter((d) => d.kind === "portfolio").map((d) => <option key={d.id} value={d.id}>{d.version_label}</option>)}</select></div>
              <div className="col-span-full"><button className="btn btn-primary" type="submit" disabled={e.is_suppressed}>Create draft for approval</button></div>
            </form>
          </section>
          <section className="card">
            <h2 className="font-semibold mb-2">Log an activity</h2>
            <form action={addEmployerNote} className="flex flex-wrap gap-2 items-end">
              <input type="hidden" name="employer_id" value={e.id} />
              <div><label>Type</label><select name="activity_type" defaultValue="note">{["note", "research", "call", "linkedin_message", "meeting"].map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select></div>
              <div><label>Contact</label><select name="contact_id" defaultValue=""><option value="">—</option>{(contacts.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></div>
              <div className="flex-1 min-w-64"><label>What happened</label><input name="body" required /></div>
              <button className="btn" type="submit">Log</button>
            </form>
          </section>
          <section className="card p-0 overflow-x-auto">
            <table>
              <thead><tr><th>When</th><th>Type</th><th>Direction</th><th>Contact</th><th>Subject / content</th><th>Delivery</th><th>Follow-up</th></tr></thead>
              <tbody>
                {(activities.data ?? []).map((a) => (
                  <tr key={a.id}>
                    <td className="muted whitespace-nowrap">{fmtDateTime(a.occurred_at)}</td>
                    <td><span className="badge">{humanise(a.activity_type)}</span></td>
                    <td className="muted">{a.direction}</td>
                    <td>{(a.contacts as { full_name: string } | null)?.full_name ?? a.recipient_email ?? "—"}</td>
                    <td><div className="font-medium">{a.subject}</div><div className="muted text-xs line-clamp-2 whitespace-pre-wrap">{a.body_text}</div>{a.blocked_reasons.length > 0 && <div className="text-danger text-xs">Blocked: {a.blocked_reasons.join(", ")}</div>}</td>
                    <td><StatusBadge value={a.delivery_result === "pending" && a.direction === "internal" ? null : a.delivery_result} /></td>
                    <td className="muted">{a.follow_up_due_at ? `${fmtDate(a.follow_up_due_at)}${a.follow_up_done ? " ✓" : ""}` : "—"}</td>
                  </tr>
                ))}
                {(activities.data ?? []).length === 0 && <tr><td colSpan={7} className="muted text-center py-6">No activity yet.</td></tr>}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {tab === "fit" && (
        <section className="card">
          <div className="flex justify-between items-baseline mb-2"><h2 className="font-semibold">Candidate fit and research notes</h2><EvidenceBadge status={notes.data?.evidence_status} /></div>
          <p className="muted text-xs mb-3">Interpretation lives here, separate from observed facts. The personalised opener is what the email template uses. Generated notes must be reviewed before use.</p>
          <form action={saveResearchNote} className="grid-form">
            <input type="hidden" name="employer_id" value={e.id} />
            <div className="col-span-full"><label>Why this employer may be a good fit</label><textarea name="why_fit" rows={3} defaultValue={notes.data?.why_fit ?? ""} /></div>
            <div><label>Most relevant project to reference</label><input name="relevant_project" defaultValue={notes.data?.relevant_project ?? ""} /></div>
            <div><label>Aspect of design philosophy / portfolio that interests you</label><input name="design_interest" defaultValue={notes.data?.design_interest ?? ""} /></div>
            <div><label>Matching skills (comma separated)</label><input name="matching_skills" defaultValue={(notes.data?.matching_skills ?? []).join(", ")} /></div>
            <div><label>Genuine gaps</label><input name="gaps" defaultValue={(notes.data?.gaps ?? []).join(", ")} /></div>
            <div className="col-span-full"><label>Hiring signal summary</label><input name="hiring_signal_summary" defaultValue={notes.data?.hiring_signal_summary ?? ""} /></div>
            <div><label>Best contact</label><select name="best_contact_id" defaultValue={notes.data?.best_contact_id ?? ""}><option value="">—</option>{(contacts.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></div>
            <div><label>Reason for choosing them</label><input name="best_contact_reason" defaultValue={notes.data?.best_contact_reason ?? ""} /></div>
            <div className="col-span-full"><label>Personalised opening sentence (used in the email)</label><textarea name="personalised_opener" rows={2} defaultValue={notes.data?.personalised_opener ?? ""} /></div>
            <div><label>Proposed ask</label><select name="proposed_ask" defaultValue={notes.data?.proposed_ask ?? "speculative_cv"}>{["vacancy_enquiry", "speculative_cv", "portfolio_review", "informal_conversation", "do_not_approach_yet"].map((v) => <option key={v} value={v}>{humanise(v)}</option>)}</select></div>
            <div><label>Evidence status</label><select name="evidence_status" defaultValue={notes.data?.evidence_status ?? "unverified"}>{["verified_fact", "source_supported_summary", "inference", "unverified", "conflicting_sources"].map((v) => <option key={v} value={v}>{humanise(v)}</option>)}</select></div>
            <div className="col-span-full flex items-center gap-3"><label className="flex items-center gap-2 m-0"><input type="checkbox" name="reviewed" defaultChecked={!!notes.data?.reviewed_at} /> Reviewed by me</label><button className="btn btn-primary ml-auto" type="submit">Save notes</button></div>
          </form>
        </section>
      )}

      {tab === "evidence" && (
        <div className="space-y-4">
          <section className="card p-0 overflow-x-auto">
            <h2 className="font-semibold p-4 pb-2">Claims</h2>
            <table>
              <thead><tr><th>Field</th><th>Value</th><th>Evidence</th><th>Source</th><th>By</th><th>Quote</th><th>Date</th></tr></thead>
              <tbody>
                {(claims.data ?? []).map((c) => {
                  const src = c.sources as { url: string; publisher: string | null } | null;
                  return (
                    <tr key={c.id}>
                      <td className="font-medium">{c.field_name}</td>
                      <td className="max-w-md break-words">{typeof c.value === "string" ? c.value : JSON.stringify(c.value)}</td>
                      <td><EvidenceBadge status={c.evidence_status} /></td>
                      <td>{src ? <a className="underline" href={src.url} target="_blank" rel="noreferrer">{src.publisher ?? new URL(src.url).hostname}</a> : <span className="muted">none</span>}</td>
                      <td className="muted">{c.extracted_by}{c.model ? ` (${c.model})` : ""}</td>
                      <td className="muted text-xs max-w-xs">{c.quote}</td>
                      <td className="muted whitespace-nowrap">{fmtDate(c.created_at)}</td>
                    </tr>
                  );
                })}
                {(claims.data ?? []).length === 0 && <tr><td colSpan={7} className="muted text-center py-6">No claims yet. Run the AI briefing or add facts manually via the overview.</td></tr>}
              </tbody>
            </table>
          </section>
          <section className="card p-0 overflow-x-auto">
            <h2 className="font-semibold p-4 pb-2">Sources</h2>
            <table>
              <thead><tr><th>URL</th><th>Type</th><th>Confidence</th><th>Fetched</th><th>Changed</th><th>Status</th><th>Next check</th></tr></thead>
              <tbody>
                {(sources.data ?? []).map((s) => (
                  <tr key={s.id}>
                    <td className="max-w-md break-all"><a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.url}</a></td>
                    <td className="muted">{humanise(s.evidence_type)}</td>
                    <td>{Math.round(Number(s.confidence))}%</td>
                    <td className="muted">{fmtDate(s.last_fetched_at)}</td>
                    <td className="muted">{fmtDate(s.last_changed_at)}</td>
                    <td><StatusBadge value={s.fetch_status} /></td>
                    <td className="muted">{fmtDate(s.next_check_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {tab === "score" && (
        <section className="card">
          <div className="flex items-baseline gap-3 mb-3">
            <h2 className="font-semibold">Opportunity Priority Score</h2>
            <BandBadge band={scores.data?.band} />
            <span className="muted text-xs">computed {fmtDateTime(scores.data?.computed_at)} · weights v{scores.data?.weights_version ?? "?"}</span>
          </div>
          {scores.data ? (
            <>
              <div className="kpi mb-3">{scores.data.total}<span className="muted text-base">/100</span></div>
              <table>
                <thead><tr><th>Factor</th><th>Score</th><th>Reason</th></tr></thead>
                <tbody>
                  {SCORE_FACTORS.map((f) => {
                    const fs = (scores.data!.factor_scores as Record<string, number>)[f];
                    const fr = (scores.data!.factor_reasons as Record<string, string>)[f];
                    const unknown = (scores.data!.unknown_factors ?? []).includes(f);
                    return <tr key={f}><td>{FACTOR_LABELS[f]}</td><td>{unknown ? <span className="badge badge-warn">unknown</span> : fs}</td><td className="muted">{fr}</td></tr>;
                  })}
                </tbody>
              </table>
              {scores.data.hard_flags.length > 0 && <p className="text-danger text-sm mt-3">Hard flags: {scores.data.hard_flags.join(", ")} — these override the score.</p>}
            </>
          ) : <p className="muted">Not scored yet. Click “Recompute score” above; the worker writes the breakdown here.</p>}
          <p className="muted text-xs mt-3">Weights are editable in <Link className="underline" href="/settings/scoring">Settings → Scoring</Link>. The score never replaces the hard eligibility check.</p>
        </section>
      )}
    </div>
  );
}

function BriefingClaims({ claims }: { claims: { field_name: string; value: unknown; evidence_status: string; quote: string | null }[] }) {
  const groups: Record<string, typeof claims> = {};
  for (const c of claims) {
    const key = c.field_name.split(".")[0]!;
    (groups[key] ??= []).push(c);
  }
  const keys = Object.keys(groups).filter((k) => ["project", "contact", "hiring_signal", "outreach_recommendation", "software", "sectors", "potential_role_fit", "unresolved_question"].some((p) => k.startsWith(p)));
  if (keys.length === 0) return <p className="muted text-sm">No briefing claims yet.</p>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {keys.map((k) => (
        <div key={k}>
          <h3 className="font-medium text-sm mb-1">{humanise(k)}</h3>
          <ul className="text-sm space-y-1">
            {groups[k]!.map((c, i) => (
              <li key={i} className="flex gap-2 items-start"><EvidenceBadge status={c.evidence_status} /><span className="break-words">{typeof c.value === "string" ? c.value : JSON.stringify(c.value)}</span></li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
