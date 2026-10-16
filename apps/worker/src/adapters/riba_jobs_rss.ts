import Parser from "rss-parser";
import { politeFetch } from "../lib/http.js";
import type { Adapter, RawVacancy } from "./types.js";

/** RIBA Jobs RSS 2.0 feed: https://jobs.architecture.com/jobsrss/?keywords=… — one request per keyword, ≤ every 2 h. */
export const ribaJobsRss: Adapter = {
  code: "riba_jobs_rss",
  async *discover(ctx) {
    const cfg = ctx.config as { feed_url?: string; keywords?: string[] };
    const base = cfg.feed_url ?? "https://jobs.architecture.com/jobsrss/";
    const parser = new Parser({ customFields: { item: ["description", "pubDate", "guid"] } });
    const seen = new Set<string>();
    for (const kw of cfg.keywords ?? ["Part 1", "Architectural Assistant", "Graduate"]) {
      if (!(await ctx.countRequest())) return;
      const url = `${base}?keywords=${encodeURIComponent(kw)}`;
      const res = await politeFetch(url, { api: true, minIntervalMs: Math.max(ctx.minIntervalMs, 3000), headers: { accept: "application/rss+xml, application/xml, text/xml" } });
      if (!res.ok || !res.text) { ctx.log("feed fetch failed", { url, status: res.status }); continue; }
      let feed;
      try { feed = await parser.parseString(res.text); } catch (e) { ctx.log("feed parse failed", { url, err: (e as Error).message }); continue; }
      for (const item of feed.items ?? []) {
        const link = item.link ?? (item.guid as string | undefined);
        if (!link || !item.title || seen.has(link)) continue;
        seen.add(link);
        const desc = (item.contentSnippet ?? (item as { description?: string }).description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        // RIBA Jobs titles are often "Title — Employer, Location"; keep the raw title, try to split employer.
        const m = item.title.match(/^(.*?)\s+[–—-]\s+(.*?)(?:,\s*([^,]+))?$/);
        const v: RawVacancy = {
          kind: "vacancy", title: m?.[1]?.trim() ?? item.title.trim(), url: link, employerName: m?.[2]?.trim() ?? null,
          description: desc || null, descriptionIsTruncated: true, locationText: m?.[3]?.trim() ?? null, postcode: null, lat: null, lng: null,
          postedAt: item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : null), closingAt: null,
          salaryMin: null, salaryMax: null, salaryText: null, employmentType: "unknown", externalRef: (item.guid as string | undefined) ?? null,
          applicationUrl: link, applicationEmail: null, postedByAgency: false, raw: item,
        };
        yield v;
      }
    }
  },
};
