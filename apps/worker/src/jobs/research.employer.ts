import { db } from "../lib/db.js";
import { env } from "../lib/env.js";
import { RunLog, type SourceAttempt } from "../research/run.js";
import { assessEmployerNow, loadAssessmentProfile } from "../research/store.js";
import { aiEmployerBriefing, type BriefingAttempt } from "./ai.employer_briefing.js";
import { prioritiseEntity } from "../priority/store.js";
import type { Job } from "./index.js";

interface Payload { employerId: string; runId?: string; force?: boolean; trigger?: string }
const RECENT_MS = 30 * 86_400_000;

/** Researches an employer independently of any vacancy, then scores its case for a speculative approach. */
export async function researchEmployer(job: Job<Payload>) {
  const { employerId, force } = job.data;
  const { data: e } = await db().from("employers").select("id, last_checked_at, website").eq("id", employerId).is("deleted_at", null).maybeSingle();
  if (!e) return { skipped: "employer missing" };
  const log = await RunLog.open("employer", { employerId, vacancyId: null }, job.data);
  let assessed = false, completeness: number | null = null;
  try {
    await log.step("briefing", async () => {
      const recent = !force && e.last_checked_at != null && Date.now() - new Date(e.last_checked_at).getTime() < RECENT_MS;
      if (recent) return { status: "skipped", detail: "website read within the last 30 days; use Refresh to force" };
      if (!e.website) return { status: "failed", detail: "no website on record, so the employer's own pages could not be read" };
      if (!env().ANTHROPIC_API_KEY) return { status: "skipped", detail: "ANTHROPIC_API_KEY not set, so the website was not read" };
      const r = (await aiEmployerBriefing({ id: "", name: "ai.employer_briefing", data: { employerId, force } })) as { skipped?: string; attempts?: BriefingAttempt[] } | undefined;
      const sources: SourceAttempt[] = (r?.attempts ?? []).map((a) => ({ url: a.url, ok: a.ok, status: a.status, official: true, error: a.skipped }));
      if (r?.skipped) return { status: "failed", detail: r.skipped, sources };
      return { sources, detail: "official pages read and facts stored with their sources" };
    });
    const done = await log.step("assess", async () => {
      const out = await assessEmployerNow(employerId, { profile: await loadAssessmentProfile(), runId: log.runId, touch: true });
      if (!out) throw new Error("employer disappeared");
      assessed = true; completeness = out.result.completeness;
      return { detail: `${out.changed ? "new assessment stored" : "assessment unchanged"}: ${out.result.total}/100, ${out.result.blockers.length} blocker(s), completeness ${out.result.completeness}%` };
    });
    if (done.status === "failed") assessed = false;
  } catch (err) {
    await log.step("unexpected_error", async () => { throw err; });
  }
  if (assessed) await prioritiseEntity("employer", employerId).catch(() => null);
  const fin = await log.finish({ assessed, completeness, kind: "employer", entityId: employerId });
  await db().from("employers").update({ research_requested_at: null }).eq("id", employerId);
  return { employerId, ...fin, completeness };
}
