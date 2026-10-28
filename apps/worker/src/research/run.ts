import type { Json } from "@ajis/db";
import { db } from "../lib/db.js";

export interface SourceAttempt { url: string; ok: boolean; status?: number; official?: boolean; error?: string }
export interface StepLog { step: string; status: "ok" | "skipped" | "failed"; detail?: string; sources?: SourceAttempt[]; at: string }

/**
 * Step-by-step log of one research attempt. Every step is saved as it completes, so a crash or a blocked site leaves an
 * accurate record of what was and was not read, and the run can be retried.
 */
export class RunLog {
  steps: StepLog[] = [];
  constructor(readonly runId: string) {}

  static async open(kind: "vacancy" | "employer", ids: { employerId: string | null; vacancyId: string | null }, payload: { runId?: string; trigger?: string; force?: boolean }) {
    let id = payload.runId;
    if (id) await db().from("research_runs").update({ status: "running", started_at: new Date().toISOString(), error: null }).eq("id", id);
    else {
      const { data, error } = await db().from("research_runs").insert({ kind, employer_id: ids.employerId, vacancy_id: ids.vacancyId, status: "running", trigger: payload.trigger ?? (payload.force ? "refresh" : "auto"), started_at: new Date().toISOString() }).select("id").single();
      if (error || !data) throw new Error(error?.message ?? "could not open research run");
      id = data.id;
    }
    const table = kind === "vacancy" ? "vacancies" : "employers";
    await db().from(table).update({ research_state: "running" }).eq("id", (kind === "vacancy" ? ids.vacancyId : ids.employerId)!);
    return new RunLog(id!);
  }

  async step(step: string, fn: () => Promise<{ status?: StepLog["status"]; detail?: string; sources?: SourceAttempt[] } | void>): Promise<StepLog> {
    let entry: StepLog;
    try {
      const r = (await fn()) ?? {};
      entry = { step, status: r.status ?? "ok", detail: r.detail, sources: r.sources, at: new Date().toISOString() };
    } catch (e) {
      entry = { step, status: "failed", detail: (e as Error).message.slice(0, 400), at: new Date().toISOString() };
    }
    this.steps.push(entry);
    await db().from("research_runs").update({ steps: this.steps as unknown as Json }).eq("id", this.runId);
    return entry;
  }

  /** succeeded: every step ok or deliberately skipped. partial: something failed but an assessment was produced. failed: no assessment. */
  async finish(opts: { assessed: boolean; completeness: number | null; kind: "vacancy" | "employer"; entityId: string }) {
    const failed = this.steps.filter((s) => s.status === "failed");
    const blocked = this.steps.flatMap((s) => s.sources ?? []).filter((s) => !s.ok);
    const status = !opts.assessed ? "failed" : failed.length || blocked.length ? "partial" : "succeeded";
    const error = failed.length ? failed.map((s) => `${s.step}: ${s.detail ?? "failed"}`).join("; ") : blocked.length ? `${blocked.length} source(s) could not be read` : null;
    await db().from("research_runs").update({ status, completeness: opts.completeness, error, finished_at: new Date().toISOString(), steps: this.steps as unknown as Json }).eq("id", this.runId);
    const table = opts.kind === "vacancy" ? "vacancies" : "employers";
    await db().from(table).update({ research_state: opts.assessed ? "needs_review" : "failed" }).eq("id", opts.entityId);
    return { status, error };
  }
}
