import { db } from "../lib/db.js";
import { hasEnv } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { ingestVacancy } from "../pipeline/ingest_vacancy.js";
import { ADAPTERS } from "../adapters/index.js";
import type { AdapterContext } from "../adapters/types.js";
import type { Job } from "./index.js";

/**
 * Generic discovery runner: loads the source definition, checks enablement / env / daily cap,
 * opens a source_runs row, streams items from the adapter into the ingest pipeline, and records
 * counts, errors and consecutive failures.
 */
export function discoveryJob(code: string) {
  return async (job: Job<{ manual?: boolean }>) => {
    const adapter = ADAPTERS[code];
    if (!adapter) throw new Error(`No adapter for ${code}`);
    const { data: def } = await db().from("source_definitions").select("*").eq("code", code).maybeSingle();
    if (!def) throw new Error(`source_definitions row missing for ${code}`);
    if (!def.enabled && !job.data.manual) return { skipped: "disabled" };
    if (def.requires_env.length && !hasEnv(def.requires_env)) {
      await db().from("source_definitions").update({ disabled_reason: `Missing environment: ${def.requires_env.join(", ")}` }).eq("id", def.id);
      return { skipped: `missing env ${def.requires_env.join(",")}` };
    }
    const today = new Date().toISOString().slice(0, 10);
    let requestsToday = def.requests_today_date === today ? def.requests_today : 0;
    const { data: run } = await db().from("source_runs").insert({ source_definition_id: def.id, job_name: `discovery.${code}`, pgboss_job_id: job.id }).select("id").single();
    const runId = run?.id ?? null;
    const counts = { seen: 0, created: 0, updated: 0, duplicate: 0, rejected: 0, signals: 0, requests: 0 };
    const errors: unknown[] = [];
    let status: "succeeded" | "partial" | "failed" | "rate_limited" | "skipped_robots" = "succeeded";
    const ctx: AdapterContext = {
      sourceCode: code,
      sourceDefinitionId: def.id,
      config: (def.config as Record<string, unknown>) ?? {},
      minIntervalMs: def.min_interval_ms,
      dailyRequestCap: def.daily_request_cap,
      requestsToday,
      countRequest: async () => {
        if (def.daily_request_cap != null && requestsToday >= def.daily_request_cap) { status = "rate_limited"; return false; }
        requestsToday++; counts.requests++;
        return true;
      },
      log: (msg, extra) => logger.info({ source: code, ...extra }, msg),
    };
    try {
      for await (const item of adapter.discover(ctx)) {
        counts.seen++;
        try {
          if (item.kind === "vacancy") {
            const r = await ingestVacancy(item, { sourceDefinitionId: def.id, sourceCode: code, sourceRunId: runId, evidenceType: code === "ninebee_careers" ? "recruiter" : "job_board" });
            counts[r.outcome]++;
          } else {
            await db().from("hiring_signals").upsert({ employer_id: item.employerId, signal_type: item.signalType, strength: item.strength, summary: item.summary, observed_on: item.observedOn ?? today, evidence_status: "verified_fact", what_it_might_indicate: "Possible workload growth; verify before assuming recruitment." }, { onConflict: "employer_id,signal_type,source_id,observed_on", ignoreDuplicates: true });
            counts.signals++;
          }
        } catch (e) {
          errors.push({ item: item.kind === "vacancy" ? item.url : item.summary, error: (e as Error).message });
          if (errors.length > 20) break;
        }
      }
      if (errors.length) status = status === "succeeded" ? "partial" : status;
    } catch (e) {
      status = /robots/i.test((e as Error).message) ? "skipped_robots" : "failed";
      errors.push({ fatal: (e as Error).message });
    }
    const failed = status === "failed";
    await db().from("source_runs").update({ status, finished_at: new Date().toISOString(), items_seen: counts.seen, items_new: counts.created, items_changed: counts.updated, items_deduped: counts.duplicate, requests_made: counts.requests, errors: errors as never }).eq("id", runId ?? "");
    await db().from("source_definitions").update({ last_run_at: new Date().toISOString(), last_success_at: failed ? def.last_success_at : new Date().toISOString(), consecutive_failures: failed ? def.consecutive_failures + 1 : 0, requests_today: requestsToday, requests_today_date: today, disabled_reason: failed ? def.disabled_reason : null }).eq("id", def.id);
    if (failed) throw new Error(`discovery ${code} failed: ${JSON.stringify(errors[0])}`);
    return { code, status, ...counts, errors: errors.length };
  };
}
