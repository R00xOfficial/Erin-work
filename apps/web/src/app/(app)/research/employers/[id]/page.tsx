import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate, humanise } from "@/lib/utils";
import { EvidenceBadge } from "@/components/badges";
import { AssessmentView } from "@/components/research/assessment-view";

export const dynamic = "force-dynamic";

export default async function EmployerResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data: e } = await supabase.from("employers").select("id, legal_name, display_name, website, careers_url, practice_type, specialisms, sectors, size_band, applications_email, generic_email, discovery_state, research_state, stage3_saved_at, last_checked_at, hires_part1, has_graduate_programme, accepts_speculative").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!e) notFound();
  const [{ data: assessment }, { data: history }, { data: runs }, { data: ready }, { data: prof }, { data: offices }, { data: claims }, { data: vacs }, { data: contacts }] = await Promise.all([
    supabase.from("assessments").select("*").eq("kind", "employer").eq("employer_id", id).is("vacancy_id", null).eq("is_current", true).maybeSingle(),
    supabase.from("assessments").select("id, total, computed_at, profile_version, weights_version, is_current, reviewed_at, completeness, confidence").eq("kind", "employer").eq("employer_id", id).is("vacancy_id", null).order("computed_at", { ascending: false }).limit(15),
    supabase.from("research_runs").select("*").eq("kind", "employer").eq("employer_id", id).is("vacancy_id", null).order("created_at", { ascending: false }).limit(5),
    supabase.from("v_research_employers").select("ready_for_stage3").eq("id", id).maybeSingle(),
    supabase.from("candidate_profile").select("profile_version, approved_version").eq("id", true).maybeSingle(),
    supabase.from("offices").select("town, postcode, zone_code, is_primary").eq("employer_id", id).is("deleted_at", null),
    supabase.from("claims").select("id, field_name, value, evidence_status, quote, extracted_by, updated_at, source_id, sources(url, title)").eq("entity_type", "employer").eq("entity_id", id).eq("is_current", true).order("field_name").limit(60),
    supabase.from("vacancies").select("id, title, status").eq("employer_id", id).is("deleted_at", null).is("duplicate_of_vacancy_id", null).in("status", ["open", "closing_soon", "unverified"]),
    supabase.from("contacts").select("id, full_name, role_title").eq("employer_id", id).is("deleted_at", null).eq("do_not_contact", false).limit(5),
  ]);
  const name = e.display_name ?? e.legal_name;
  return (
    <div className="space-y-4">
      <div>
        <div className="muted text-xs"><Link className="underline" href="/research">Research</Link> / employer</div>
        <h1 className="text-xl font-semibold">{name}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="badge">{humanise(e.practice_type)}</span>
          {e.website && <a className="underline" href={e.website} target="_blank" rel="noopener noreferrer">Website</a>}
          {e.careers_url && <a className="underline" href={e.careers_url} target="_blank" rel="noopener noreferrer">Careers page</a>}
          <Link className="underline" href={`/employers/${e.id}`}>Full employer record</Link>
          <span className="muted">Pages last read {e.last_checked_at ? fmtDate(e.last_checked_at) : "never"}</span>
        </div>
        <div className="muted text-xs mt-1">
          Locations: {(offices ?? []).map((o) => [o.town, o.postcode, o.zone_code && `zone ${o.zone_code}`].filter(Boolean).join(" ")).join(" · ") || "none recorded"} ·
          Specialisms: {e.specialisms.join(", ") || "none recorded"} · Hires Part 1: {e.hires_part1} · Graduate programme: {e.has_graduate_programme} · Speculative applications: {e.accepts_speculative}
        </div>
        <div className="muted text-xs">Recruitment route: {e.applications_email ?? e.generic_email ?? (e.careers_url ? "careers page" : "none recorded")}{(contacts ?? []).length > 0 && ` · people: ${(contacts ?? []).map((c) => `${c.full_name}${c.role_title ? ` (${c.role_title})` : ""}`).join(", ")}`}</div>
        {(vacs ?? []).length > 0 && <div className="text-sm mt-1">Open vacancies (assessed separately): {(vacs ?? []).map((v) => <Link key={v.id} className="underline mr-2" href={`/research/vacancies/${v.id}`}>{v.title}</Link>)}</div>}
      </div>
      <AssessmentView kind="employer" entityId={id} assessment={assessment} history={history ?? []} runs={runs ?? []}
        state={{ research_state: e.research_state, discovery_state: e.discovery_state, stage3_saved_at: e.stage3_saved_at, ready: !!ready?.ready_for_stage3 }}
        profile={{ version: prof?.profile_version ?? 1, approved: prof != null && prof.approved_version === prof.profile_version }} />
      <section className="card p-0 overflow-x-auto">
        <h3 className="font-semibold p-4 pb-1">Evidence on record</h3>
        <p className="muted text-xs px-4 pb-2">Facts the employer published are marked verified or source-supported; anything AI-inferred is labelled as an inference. Open the source to check.</p>
        <table>
          <thead><tr><th>Finding</th><th>Status</th><th>Source</th><th>Updated</th></tr></thead>
          <tbody>
            {(claims ?? []).map((c) => {
              const src = c.sources as { url: string; title: string | null } | null;
              return (
                <tr key={c.id}>
                  <td><div className="text-xs muted">{humanise(c.field_name)}</div><div className="text-sm">{typeof c.value === "string" ? c.value : JSON.stringify(c.value)}</div>{c.quote && <div className="muted text-xs italic">“{c.quote}”</div>}</td>
                  <td><EvidenceBadge status={c.evidence_status} /><div className="muted text-xs">{c.extracted_by === "ai" ? "AI-generated" : c.extracted_by}</div></td>
                  <td>{src ? <a className="underline text-sm" href={src.url} target="_blank" rel="noopener noreferrer">{src.title ?? src.url}</a> : <span className="muted text-sm">no source</span>}</td>
                  <td className="muted whitespace-nowrap">{fmtDate(c.updated_at)}</td>
                </tr>
              );
            })}
            {(claims ?? []).length === 0 && <tr><td colSpan={4} className="muted text-center py-6">No findings recorded yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
