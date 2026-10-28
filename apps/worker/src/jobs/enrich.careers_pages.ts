import { canonicaliseUrl, urlHash } from "@ajis/shared";
import { db } from "../lib/db.js";
import { findCareersLink } from "../lib/extract.js";
import { politeFetch } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import type { Job } from "./index.js";

interface Payload { limit?: number }
const SEARCH_LIMIT = 25;
const RETRY_AFTER_DAYS = 30;

async function trackCareersPage(employerId: string, url: string) {
  const canon = canonicaliseUrl(url);
  if (!canon) return null;
  const { data } = await db().from("sources").upsert(
    { url, url_hash: urlHash(canon), canonical_url: canon, host: new URL(canon).hostname, publisher: "employer careers page", source_kind: "careers_page", evidence_type: "primary_official", confidence: 60, entity_type: "employer", entity_id: employerId, recheck_interval: "3 days", next_check_at: new Date().toISOString() },
    { onConflict: "url_hash", ignoreDuplicates: true },
  ).select("id").maybeSingle();
  return data?.id ?? null;
}

/**
 * Keeps every known careers page under change detection, and looks for the careers page of employers that have a website but
 * no recorded careers URL. A URL is only recorded when the practice's own page links to it; nothing is guessed.
 * Fetches go through politeFetch (robots.txt, per-host spacing). Each employer is searched at most once per 30 days.
 */
export async function enrichCareersPages(job: Job<Payload>) {
  // 1. Track the careers URLs we already hold. page_check picks them up from `sources`.
  const { data: held } = await db().from("employers").select("id, careers_url").is("deleted_at", null).not("careers_url", "is", null).limit(2000);
  const wanted = (held ?? []).flatMap((e) => { const c = e.careers_url ? canonicaliseUrl(e.careers_url) : null; return c ? [{ id: e.id, url: e.careers_url!, hash: urlHash(c) }] : []; });
  const { data: have } = await db().from("sources").select("url_hash").in("url_hash", wanted.map((w) => w.hash));
  const haveSet = new Set((have ?? []).map((h) => h.url_hash));
  let registered = 0;
  for (const w of wanted.filter((x) => !haveSet.has(x.hash))) if (await trackCareersPage(w.id, w.url)) registered++;

  // 2. Look for careers pages on employer sites that do not have one recorded.
  const cutoff = new Date(Date.now() - RETRY_AFTER_DAYS * 86_400_000).toISOString();
  const { data: todo } = await db().from("employers").select("id, website, legal_name").is("deleted_at", null).is("careers_url", null).not("website", "is", null)
    .not("outreach_stage", "in", "(closed_no_opportunity,suppressed)").or(`careers_search_at.is.null,careers_search_at.lt.${cutoff}`)
    .order("careers_search_at", { ascending: true, nullsFirst: true }).limit(job.data.limit ?? SEARCH_LIMIT);
  let found = 0, searched = 0;
  for (const e of todo ?? []) {
    searched++;
    try {
      const res = await politeFetch(e.website!);
      if (res.ok && res.text) {
        const hit = findCareersLink(res.text, res.url || e.website!);
        if (hit) {
          await db().from("employers").update({ careers_url: hit.url }).eq("id", e.id).is("careers_url", null);
          const sourceId = await trackCareersPage(e.id, hit.url);
          await db().from("claims").upsert({ entity_type: "employer", entity_id: e.id, field_name: "careers_url", value: hit.url, evidence_status: "source_supported_summary", source_id: sourceId, extracted_by: "adapter", quote: hit.text ? `Link text on ${e.website}: "${hit.text}"` : null }, { onConflict: "entity_type,entity_id,field_name,source_id" });
          found++;
        }
      }
    } catch (err) {
      logger.warn({ employerId: e.id, err: (err as Error).message }, "careers search failed");
    }
    await db().from("employers").update({ careers_search_at: new Date().toISOString() }).eq("id", e.id);
  }
  return { registered, searched, found };
}
