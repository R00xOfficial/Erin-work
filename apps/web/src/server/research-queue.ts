import type { requireUser } from "@/lib/supabase/server";
import { requestJob } from "@/server/actions/jobs";

type Kind = "vacancy" | "employer";
type Client = Awaited<ReturnType<typeof requireUser>>["supabase"];
const nowIso = () => new Date().toISOString();
const table = (k: Kind) => (k === "vacancy" ? "vacancies" : "employers");

/** Queue a research run. If one is already queued or running for the record, that run is reused rather than duplicated. */
export async function queueResearch(supabase: Client, kind: Kind, entityId: string, opts: { force?: boolean; trigger?: string; retryOf?: string } = {}) {
  const col = kind === "vacancy" ? "vacancy_id" : "employer_id";
  let open = supabase.from("research_runs").select("id").eq("kind", kind).eq(col, entityId).in("status", ["queued", "running"]).gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString()).limit(1);
  if (kind === "employer") open = open.is("vacancy_id", null);
  const { data: existing } = await open;
  if (existing && existing.length > 0) return existing[0]!.id;
  let employerId: string | null = kind === "employer" ? entityId : null;
  if (kind === "vacancy") employerId = (await supabase.from("vacancies").select("employer_id").eq("id", entityId).single()).data?.employer_id ?? null;
  const { data: run, error } = await supabase.from("research_runs").insert({ kind, employer_id: employerId, vacancy_id: kind === "vacancy" ? entityId : null, status: "queued", trigger: opts.trigger ?? (opts.force ? "refresh" : "manual"), retry_of: opts.retryOf ?? null }).select("id").single();
  if (error) throw new Error(error.message);
  await supabase.from(table(kind)).update({ research_state: "queued", research_requested_at: nowIso() }).eq("id", entityId);
  await requestJob(kind === "vacancy" ? "research.vacancy" : "research.employer", { [kind === "vacancy" ? "vacancyId" : "employerId"]: entityId, runId: run.id, force: !!opts.force }, `research:${kind}:${entityId}:${run.id}`);
  return run.id;
}

