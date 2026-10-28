import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate, humanise } from "@/lib/utils";
import { StatusBadge } from "@/components/badges";
import { AssessmentView } from "@/components/research/assessment-view";

export const dynamic = "force-dynamic";

export default async function VacancyResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data: v } = await supabase.from("vacancies").select("id, title, status, employer_id, employer_name_raw, original_url, canonical_url, location_text, closing_at, first_seen_at, last_verified_at, discovery_state, research_state, stage3_saved_at, employers!employer_id(display_name, legal_name)").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!v) notFound();
  const [{ data: assessment }, { data: history }, { data: reqs }, { data: runs }, { data: ready }, { data: prof }] = await Promise.all([
    supabase.from("assessments").select("*").eq("kind", "vacancy").eq("vacancy_id", id).eq("is_current", true).maybeSingle(),
    supabase.from("assessments").select("id, total, computed_at, profile_version, weights_version, is_current, reviewed_at, completeness, confidence").eq("kind", "vacancy").eq("vacancy_id", id).order("computed_at", { ascending: false }).limit(15),
    supabase.from("vacancy_requirements").select("*").eq("vacancy_id", id).eq("is_current", true).order("necessity").order("created_at"),
    supabase.from("research_runs").select("*").eq("kind", "vacancy").eq("vacancy_id", id).order("created_at", { ascending: false }).limit(5),
    supabase.from("v_research_vacancies").select("ready_for_stage3").eq("id", id).maybeSingle(),
    supabase.from("candidate_profile").select("profile_version, approved_version").eq("id", true).maybeSingle(),
  ]);
  const srcIds = [...new Set((reqs ?? []).map((r) => r.source_id).filter((x): x is string => !!x))];
  const sourceUrls: Record<string, string> = {};
  if (srcIds.length) for (const s of (await supabase.from("sources").select("id, url").in("id", srcIds)).data ?? []) sourceUrls[s.id] = s.url;
  const emp = v.employers as { display_name: string | null; legal_name: string } | null;
  return (
    <div className="space-y-4">
      <div>
        <div className="muted text-xs"><Link className="underline" href="/research">Research</Link> / vacancy</div>
        <h1 className="text-xl font-semibold">{v.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {v.employer_id ? <Link className="underline" href={`/research/employers/${v.employer_id}`}>{emp?.display_name ?? emp?.legal_name}</Link> : <span className="muted">{v.employer_name_raw ?? "employer not matched"}</span>}
          <StatusBadge value={v.status} />
          <span className="muted">{v.location_text ?? "location unknown"} · closing {v.closing_at ? fmtDate(v.closing_at) : "unknown"} · verified {v.last_verified_at ? fmtDate(v.last_verified_at) : "never"}</span>
          <a className="underline" href={v.canonical_url ?? v.original_url} target="_blank" rel="noopener noreferrer">Open official listing</a>
          <Link className="underline" href={`/vacancies/${v.id}`}>Edit vacancy record</Link>
        </div>
        <div className="muted text-xs">Discovery: {humanise(v.discovery_state)}</div>
      </div>
      <AssessmentView kind="vacancy" entityId={id} assessment={assessment} history={history ?? []} requirements={reqs ?? []} sourceUrls={sourceUrls} runs={runs ?? []}
        state={{ research_state: v.research_state, discovery_state: v.discovery_state, stage3_saved_at: v.stage3_saved_at, ready: !!ready?.ready_for_stage3 }}
        profile={{ version: prof?.profile_version ?? 1, approved: prof != null && prof.approved_version === prof.profile_version }} />
    </div>
  );
}
