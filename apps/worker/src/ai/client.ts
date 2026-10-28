import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { sha256 } from "@ajis/shared";
import { db, getSetting } from "../lib/db.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

let _client: Anthropic | null = null;
export function anthropic(): Anthropic | null {
  const key = env().ANTHROPIC_API_KEY;
  if (!key) return null;
  return (_client ??= new Anthropic({ apiKey: key }));
}

export interface StructuredRunOptions<T> {
  purpose: "employer_briefing" | "vacancy_extraction" | "fit_note" | "email_draft";
  entityType: string;
  entityId: string;
  promptVersion: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** Count only runs of this entity type against a separate daily cap read from this settings key. */
  cap?: { entityType: string; settingKey: string; fallback: number };
}

export type StructuredRunResult<T> = { ok: true; data: T; runId: string; cached: boolean } | { ok: false; reason: string; runId?: string };

/**
 * Runs a structured-output call, validates with zod, records the run in ai_runs. Idempotent on
 * (purpose, entity, input hash): identical inputs return the stored output without a new API call.
 * Enforces the daily AI cap from settings.
 */
export async function runStructured<T>(opts: StructuredRunOptions<T>): Promise<StructuredRunResult<T>> {
  const client = anthropic();
  if (!client) return { ok: false, reason: "ANTHROPIC_API_KEY not set" };
  const model = env().ANTHROPIC_MODEL;
  const inputHash = sha256(`${opts.promptVersion}|${model}|${opts.system}|${opts.user}`);
  const { data: existing } = await db().from("ai_runs").select("id, status, output").eq("purpose", opts.purpose).eq("entity_id", opts.entityId).eq("input_hash", inputHash).maybeSingle();
  if (existing?.status === "succeeded" && existing.output) {
    const parsed = opts.schema.safeParse(existing.output);
    if (parsed.success) return { ok: true, data: parsed.data, runId: existing.id, cached: true };
  }
  const cap = await getSetting<number>(opts.cap?.settingKey ?? "ai_daily_cap", opts.cap?.fallback ?? 40);
  let capQuery = db().from("ai_runs").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 86_400_000).toISOString()).neq("status", "rejected_by_validation");
  capQuery = opts.cap ? capQuery.eq("entity_type", opts.cap.entityType) : capQuery.neq("entity_type", "careers_page");
  const { count } = await capQuery;
  if ((count ?? 0) >= cap) return { ok: false, reason: `AI daily cap (${cap}) reached` };

  const { data: run, error } = existing
    ? await db().from("ai_runs").update({ status: "running", error: null, model, prompt_version: opts.promptVersion }).eq("id", existing.id).select("id").single()
    : await db().from("ai_runs").insert({ purpose: opts.purpose, entity_type: opts.entityType, entity_id: opts.entityId, model, prompt_version: opts.promptVersion, input_hash: inputHash, status: "running" }).select("id").single();
  if (error || !run) return { ok: false, reason: error?.message ?? "could not record run" };

  try {
    const msg = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 4000,
      system: `${opts.system}\n\nRespond with a single JSON object only — no prose, no code fences.`,
      messages: [{ role: "user", content: opts.user }],
    });
    const text = msg.content.filter((c): c is Anthropic.TextBlock => c.type === "text").map((c) => c.text).join("\n").trim();
    const json = extractJson(text);
    const parsed = opts.schema.safeParse(json);
    if (!parsed.success) {
      await db().from("ai_runs").update({ status: "rejected_by_validation", output: json as never, validation_errors: parsed.error.issues as never, input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens, finished_at: new Date().toISOString() }).eq("id", run.id);
      logger.warn({ purpose: opts.purpose, entityId: opts.entityId, issues: parsed.error.issues.slice(0, 5) }, "AI output rejected by schema");
      return { ok: false, reason: "output failed schema validation", runId: run.id };
    }
    await db().from("ai_runs").update({ status: "succeeded", output: parsed.data as never, input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens, finished_at: new Date().toISOString() }).eq("id", run.id);
    return { ok: true, data: parsed.data, runId: run.id, cached: false };
  } catch (e) {
    await db().from("ai_runs").update({ status: "failed", error: (e as Error).message, finished_at: new Date().toISOString() }).eq("id", run.id);
    return { ok: false, reason: (e as Error).message, runId: run.id };
  }
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* ignore */ } }
  return null;
}
