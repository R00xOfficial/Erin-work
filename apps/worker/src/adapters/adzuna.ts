import { PRIORITY_SEARCH_TERMS } from "@ajis/shared";
import { fetchJson } from "../lib/http.js";
import { env } from "../lib/env.js";
import type { Adapter, RawVacancy } from "./types.js";

interface AdzunaResult { id: string; title: string; redirect_url: string; description?: string; created?: string; company?: { display_name?: string }; location?: { display_name?: string; area?: string[] }; latitude?: number; longitude?: number; salary_min?: number; salary_max?: number; salary_is_predicted?: string; contract_type?: string; contract_time?: string; category?: { tag?: string } }
interface AdzunaResponse { results?: AdzunaResult[]; count?: number }

/**
 * Adzuna Jobs API (gb). Free developer key, 25/min, 250/day. Descriptions are truncated snippets so
 * description_is_truncated=true; redirect_url is the canonical identity. Attribution is shown in the UI.
 */
export const adzuna: Adapter = {
  code: "adzuna",
  async *discover(ctx) {
    const appId = env().ADZUNA_APP_ID, appKey = env().ADZUNA_APP_KEY;
    if (!appId || !appKey) return;
    const cfg = ctx.config as { where?: string; distance_km?: number; max_days_old?: number; results_per_page?: number; pages?: number; queries?: string[] };
    const queries = cfg.queries ?? [...PRIORITY_SEARCH_TERMS];
    const pages = cfg.pages ?? 2;
    for (const q of queries) {
      for (let page = 1; page <= pages; page++) {
        if (!(await ctx.countRequest())) return;
        const url = new URL(`https://api.adzuna.com/v1/api/jobs/gb/search/${page}`);
        url.searchParams.set("app_id", appId);
        url.searchParams.set("app_key", appKey);
        url.searchParams.set("what", q);
        url.searchParams.set("where", cfg.where ?? "London");
        url.searchParams.set("distance", String(cfg.distance_km ?? 60));
        url.searchParams.set("max_days_old", String(cfg.max_days_old ?? 14));
        url.searchParams.set("results_per_page", String(cfg.results_per_page ?? 50));
        url.searchParams.set("sort_by", "date");
        url.searchParams.set("content-type", "application/json");
        const { data, status } = await fetchJson<AdzunaResponse>(url.toString(), { minIntervalMs: Math.max(ctx.minIntervalMs, 2500) });
        if (status === 429) throw new Error("Adzuna rate limit (429)");
        if (!data?.results?.length) break;
        for (const r of data.results) {
          const v: RawVacancy = {
            kind: "vacancy", title: r.title, url: r.redirect_url, employerName: r.company?.display_name ?? null,
            description: r.description ?? null, descriptionIsTruncated: true,
            locationText: r.location?.display_name ?? null, postcode: null, lat: r.latitude ?? null, lng: r.longitude ?? null,
            postedAt: r.created ?? null, closingAt: null,
            salaryMin: r.salary_is_predicted === "1" ? null : r.salary_min ?? null, salaryMax: r.salary_is_predicted === "1" ? null : r.salary_max ?? null,
            salaryText: r.salary_is_predicted === "1" && r.salary_min ? `Adzuna estimate ~£${Math.round(r.salary_min)}` : null,
            employmentType: r.contract_type === "permanent" ? "permanent" : r.contract_type === "contract" ? "contract" : r.contract_time === "part_time" ? "part_time" : "unknown",
            externalRef: `adzuna:${r.id}`, applicationUrl: r.redirect_url, applicationEmail: null, postedByAgency: false, raw: r,
          };
          yield v;
        }
        if (data.results.length < (cfg.results_per_page ?? 50)) break;
      }
    }
  },
};
