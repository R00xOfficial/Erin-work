import { contentHash, hostOf, extractDomain } from "@ajis/shared";
import { db } from "../lib/db.js";
import { politeFetch } from "../lib/http.js";
import { extractMainText } from "../lib/extract.js";
import { logger } from "../lib/logger.js";
import type { Job } from "./index.js";

interface Payload { sourceId?: string; limit?: number }
const MIN_INTERVAL_H = 6, MAX_INTERVAL_D = 14;

/**
 * Changed-page detection for tracked sources (careers pages, vacancy listings, practice homepages).
 * ETag / If-Modified-Since → 304 doubles the interval (max 14 d); a content change halves it (min 6 h),
 * stores a snapshot hash and raises a careers_page_changed signal + downstream extraction for vacancies.
 */
export async function checkSource(sourceId: string) {
  const { data: s } = await db().from("sources").select("*").eq("id", sourceId).maybeSingle();
  if (!s || s.fetch_status === "disabled") return { sourceId, skipped: "disabled" };
  const url = s.canonical_url ?? s.url;
  const host = hostOf(url);
  if (!host) return { sourceId, skipped: "bad url" };
  const res = await politeFetch(url, { etag: s.etag, lastModified: s.last_modified });
  const now = new Date();
  const interval = (hours: number) => `${Math.round(hours)} hours`;
  const currentH = parseIntervalHours(s.recheck_interval) ?? 24 * 7;
  if (res.skipped) {
    await db().from("sources").update({ fetch_status: res.skipped === "robots_disallow" ? "forbidden" : s.fetch_status, fetch_error: res.skipped, last_fetched_at: now.toISOString(), next_check_at: new Date(now.getTime() + 7 * 86_400_000).toISOString(), host }).eq("id", sourceId);
    return { sourceId, skipped: res.skipped };
  }
  if (res.notModified) {
    const nextH = Math.min(currentH * 2, MAX_INTERVAL_D * 24);
    await db().from("sources").update({ fetch_status: "unchanged", http_status: 304, last_fetched_at: now.toISOString(), recheck_interval: interval(nextH), next_check_at: new Date(now.getTime() + nextH * 3600_000).toISOString(), fetch_error: null, host }).eq("id", sourceId);
    return { sourceId, status: 304, nextHours: nextH };
  }
  if (!res.ok) {
    const gone = res.status === 404 || res.status === 410;
    const forbidden = res.status === 403 || res.status === 401;
    await db().from("sources").update({ fetch_status: gone ? "gone" : forbidden ? "forbidden" : "error", http_status: res.status, fetch_error: `HTTP ${res.status}`, last_fetched_at: now.toISOString(), next_check_at: new Date(now.getTime() + (forbidden ? 30 : 3) * 86_400_000).toISOString(), host }).eq("id", sourceId);
    if (gone && s.entity_type === "vacancy" && s.entity_id) {
      await db().from("vacancies").update({ disappeared_at: now.toISOString(), status: "closed", last_checked_at: now.toISOString() }).eq("id", s.entity_id).in("status", ["open", "closing_soon", "unverified"]);
    }
    return { sourceId, status: res.status };
  }
  const { title, text } = extractMainText(res.text, url);
  const hash = contentHash(text);
  const changed = s.content_hash != null && s.content_hash !== hash;
  const first = s.content_hash == null;
  const nextH = changed ? Math.max(currentH / 2, MIN_INTERVAL_H) : Math.min(currentH * 2, MAX_INTERVAL_D * 24);
  await db().from("sources").update({
    fetch_status: changed ? "changed" : "ok", http_status: res.status, etag: res.headers.get("etag"), last_modified: res.headers.get("last-modified"), content_hash: hash, title: title ?? s.title,
    last_fetched_at: now.toISOString(), last_changed_at: changed || first ? now.toISOString() : s.last_changed_at, recheck_interval: interval(nextH), next_check_at: new Date(now.getTime() + nextH * 3600_000).toISOString(), fetch_error: null, host,
  }).eq("id", sourceId);
  if (s.entity_type === "vacancy" && s.entity_id) {
    await db().from("vacancy_snapshots").upsert({ vacancy_id: s.entity_id, content_hash: hash, description: text.slice(0, 50_000), source_url: url }, { onConflict: "vacancy_id,content_hash", ignoreDuplicates: true });
    await db().from("vacancies").update({ last_checked_at: now.toISOString(), last_verified_at: now.toISOString(), ...(first || changed ? { description_snapshot: text.slice(0, 50_000), description_hash: hash, description_snapshot_at: now.toISOString(), description_is_truncated: false } : {}) }).eq("id", s.entity_id);
    if (first || changed) await db().from("job_requests").insert({ job_name: "ai.vacancy_extract", payload: { vacancyId: s.entity_id }, singleton_key: `extract:${s.entity_id}` });
  }
  if (changed && s.entity_type === "employer" && s.entity_id) {
    const isCareers = /career|job|vacanc|join|recruit|work-with-us|opportunit/i.test(url);
    await db().from("hiring_signals").upsert({ employer_id: s.entity_id, signal_type: isCareers ? "careers_page_changed" : "press", strength: isCareers ? "moderate" : "weak", summary: `${isCareers ? "Careers page" : "Tracked page"} changed: ${title ?? url}`, source_id: sourceId, evidence_status: "verified_fact" }, { onConflict: "employer_id,signal_type,source_id,observed_on", ignoreDuplicates: true });
    await db().from("tasks").insert({ title: `Tracked page changed — re-check ${extractDomain(url) ?? url}`, task_type: "research", entity_type: "employer", entity_id: s.entity_id, employer_id: s.entity_id, auto_generated: true, dedupe_key: `page_changed:${sourceId}`, priority: isCareers ? "high" : "low" });
    await db().from("job_requests").insert({ job_name: "scoring.recompute", payload: { employerId: s.entity_id }, singleton_key: `score:${s.entity_id}` });
  }
  return { sourceId, status: res.status, changed, first, nextHours: nextH };
}

function parseIntervalHours(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = v.match(/(\d+)\s*(day|hour|min)/i);
  if (m) {
    const n = Number(m[1]);
    return m[2]!.toLowerCase().startsWith("day") ? n * 24 : m[2]!.toLowerCase().startsWith("hour") ? n : n / 60;
  }
  const hms = v.match(/^(\d+):(\d+):(\d+)$/);
  if (hms) return Number(hms[1]);
  return null;
}

export async function enrichPageCheck(job: Job<Payload>) {
  if (job.data.sourceId) return checkSource(job.data.sourceId);
  const { data: due } = await db().from("sources").select("id").neq("fetch_status", "disabled").or(`next_check_at.is.null,next_check_at.lte.${new Date().toISOString()}`).not("entity_type", "is", null).order("next_check_at", { ascending: true, nullsFirst: true }).limit(job.data.limit ?? 50);
  const out: unknown[] = [];
  for (const s of due ?? []) {
    try { out.push(await checkSource(s.id)); } catch (e) { logger.warn({ sourceId: s.id, err: (e as Error).message }, "page check failed"); await db().from("sources").update({ fetch_status: "error", fetch_error: (e as Error).message, next_check_at: new Date(Date.now() + 86_400_000).toISOString() }).eq("id", s.id); }
  }
  return { checked: out.length };
}
