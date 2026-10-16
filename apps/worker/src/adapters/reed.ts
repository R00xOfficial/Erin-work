import { PRIORITY_SEARCH_TERMS } from "@ajis/shared";
import { fetchJson } from "../lib/http.js";
import { env } from "../lib/env.js";
import type { Adapter, RawVacancy } from "./types.js";

interface ReedJob { jobId: number; employerName?: string; jobTitle: string; locationName?: string; minimumSalary?: number; maximumSalary?: number; currency?: string; expirationDate?: string; date?: string; jobDescription?: string; applications?: number; jobUrl: string }
interface ReedResponse { results?: ReedJob[]; totalResults?: number }

/** Reed Jobseeker API. Basic auth, key as username. Self-imposed 1 req/s. Description is a snippet; full text needs /jobs/{id}. */
export const reed: Adapter = {
  code: "reed",
  async *discover(ctx) {
    const key = env().REED_API_KEY;
    if (!key) return;
    const headers = { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` };
    const cfg = ctx.config as { locationName?: string; distanceFromLocation?: number; resultsToTake?: number; graduate?: boolean; queries?: string[]; fetch_details?: boolean };
    const queries = cfg.queries ?? [...PRIORITY_SEARCH_TERMS];
    const seen = new Set<number>();
    for (const q of queries) {
      if (!(await ctx.countRequest())) return;
      const url = new URL("https://www.reed.co.uk/api/1.0/search");
      url.searchParams.set("keywords", q);
      url.searchParams.set("locationName", cfg.locationName ?? "London");
      url.searchParams.set("distanceFromLocation", String(cfg.distanceFromLocation ?? 40));
      url.searchParams.set("resultsToTake", String(cfg.resultsToTake ?? 100));
      if (cfg.graduate) url.searchParams.set("graduate", "true");
      const { data, status } = await fetchJson<ReedResponse>(url.toString(), { headers, minIntervalMs: Math.max(ctx.minIntervalMs, 1000) });
      if (status === 429) throw new Error("Reed rate limit (429)");
      for (const j of data?.results ?? []) {
        if (seen.has(j.jobId)) continue;
        seen.add(j.jobId);
        let description = j.jobDescription ?? null;
        let truncated = true;
        if (cfg.fetch_details && (await ctx.countRequest())) {
          const { data: full } = await fetchJson<{ jobDescription?: string; applicationCount?: number }>(`https://www.reed.co.uk/api/1.0/jobs/${j.jobId}`, { headers, minIntervalMs: 1000 });
          if (full?.jobDescription) { description = full.jobDescription.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); truncated = false; }
        }
        const v: RawVacancy = {
          kind: "vacancy", title: j.jobTitle, url: j.jobUrl, employerName: j.employerName ?? null, description, descriptionIsTruncated: truncated,
          locationText: j.locationName ?? null, postcode: null, lat: null, lng: null, postedAt: j.date ? toIso(j.date) : null, closingAt: j.expirationDate ? toIso(j.expirationDate) : null,
          salaryMin: j.minimumSalary ?? null, salaryMax: j.maximumSalary ?? null, salaryText: null, employmentType: "unknown",
          externalRef: `reed:${j.jobId}`, applicationUrl: j.jobUrl, applicationEmail: null, postedByAgency: false, raw: j,
        };
        yield v;
      }
    }
  },
};

function toIso(d: string): string | null {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`).toISOString();
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}
