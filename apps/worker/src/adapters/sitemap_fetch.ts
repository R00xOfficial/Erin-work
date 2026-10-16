import * as cheerio from "cheerio";
import { classifyTitle, canonicaliseUrl } from "@ajis/shared";
import { politeFetch } from "../lib/http.js";
import { extractMainText, extractLinks } from "../lib/extract.js";
import { db } from "../lib/db.js";
import type { Adapter, AdapterContext, RawVacancy } from "./types.js";

/**
 * robots-respecting fetch of a jobs sitemap or listing page(s), then each new job page.
 * Only pages whose URL looks like a job page are fetched; already-known canonical URLs are skipped
 * unless lastmod is newer than our last check. Per-host crawl delay comes from robots.txt via politeFetch.
 */
export function sitemapAdapter(code: string): Adapter {
  return {
    code,
    async *discover(ctx: AdapterContext) {
      const cfg = ctx.config as { sitemap_url?: string; listing_url?: string; category_urls?: string[]; max_pages?: number; posted_by_agency?: boolean; respect_lastmod?: boolean; job_url_pattern?: string };
      const jobUrlRe = cfg.job_url_pattern ? new RegExp(cfg.job_url_pattern, "i") : /\/(job|jobs|vacanc|career|position)[s]?\/[^/]+/i;
      const candidates = new Map<string, string | null>(); // url -> lastmod
      const startUrls: string[] = [];
      if (cfg.sitemap_url) startUrls.push(cfg.sitemap_url);
      if (cfg.listing_url) for (let p = 1; p <= (cfg.max_pages ?? 3); p++) startUrls.push(p === 1 ? cfg.listing_url : `${cfg.listing_url}${cfg.listing_url.includes("?") ? "&" : "?"}page=${p}`);
      for (const u of cfg.category_urls ?? []) startUrls.push(u);
      for (const start of startUrls) {
        if (!(await ctx.countRequest())) return;
        const res = await politeFetch(start, { minIntervalMs: ctx.minIntervalMs });
        if (res.skipped) throw new Error(`robots: ${res.skipped} for ${start}`);
        if (!res.ok) { ctx.log("start url failed", { start, status: res.status }); continue; }
        if (/<urlset|<sitemapindex/i.test(res.text)) {
          const $ = cheerio.load(res.text, { xml: true });
          const nested = $("sitemap > loc").map((_, el) => $(el).text().trim()).get();
          for (const n of nested.filter((u) => /job/i.test(u)).slice(0, 3)) {
            if (!(await ctx.countRequest())) return;
            const r2 = await politeFetch(n, { minIntervalMs: ctx.minIntervalMs });
            if (!r2.ok) continue;
            const $2 = cheerio.load(r2.text, { xml: true });
            $2("url").each((_, el) => { const loc = $2(el).find("loc").text().trim(); if (loc && jobUrlRe.test(loc)) candidates.set(loc, $2(el).find("lastmod").text().trim() || null); });
          }
          $("url").each((_, el) => { const loc = $(el).find("loc").text().trim(); if (loc && jobUrlRe.test(loc)) candidates.set(loc, $(el).find("lastmod").text().trim() || null); });
        } else {
          for (const l of extractLinks(res.text, res.url)) if (jobUrlRe.test(l) && new URL(l).hostname === new URL(start).hostname) candidates.set(l, null);
        }
      }
      ctx.log("candidate job urls", { count: candidates.size });
      // Skip URLs we already hold unless lastmod moved on.
      const canon = [...candidates.keys()].map((u) => canonicaliseUrl(u)).filter((x): x is string => !!x);
      const { data: known } = canon.length ? await db().from("vacancies").select("canonical_url, last_checked_at").in("canonical_url", canon) : { data: [] as { canonical_url: string | null; last_checked_at: string | null }[] };
      const knownMap = new Map((known ?? []).map((k) => [k.canonical_url, k.last_checked_at]));
      let fetched = 0;
      for (const [url, lastmod] of candidates) {
        const c = canonicaliseUrl(url);
        const lastChecked = c ? knownMap.get(c) : undefined;
        if (lastChecked !== undefined && (!cfg.respect_lastmod || !lastmod || new Date(lastmod) <= new Date(lastChecked ?? 0))) continue;
        if (fetched >= 40) break; // keep each run modest
        if (!(await ctx.countRequest())) return;
        const page = await politeFetch(url, { minIntervalMs: ctx.minIntervalMs });
        fetched++;
        if (!page.ok || !page.text) continue;
        const { title, text } = extractMainText(page.text, page.url);
        const $ = cheerio.load(page.text);
        const h1 = $("h1").first().text().trim();
        const jobTitle = h1 || title || "";
        if (!jobTitle) continue;
        // Only keep pages that read like an architecture-relevant role; others are noise for this user.
        const cls = classifyTitle(jobTitle);
        if (cls.family === "unknown" && !/architect|design|bim|cad|planning|urban/i.test(jobTitle)) continue;
        const ld = parseJsonLd($);
        const v: RawVacancy = {
          kind: "vacancy", title: jobTitle, url: page.url,
          employerName: cfg.posted_by_agency ? null : ld?.hiringOrganization?.name ?? guessEmployer($) ?? null,
          description: ld?.description?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || text.slice(0, 20_000), descriptionIsTruncated: false,
          locationText: ld?.jobLocation?.address?.addressLocality ?? ld?.jobLocation?.address?.addressRegion ?? null,
          postcode: ld?.jobLocation?.address?.postalCode ?? null, lat: null, lng: null,
          postedAt: ld?.datePosted ? new Date(ld.datePosted).toISOString() : lastmod ? new Date(lastmod).toISOString() : null,
          closingAt: ld?.validThrough ? new Date(ld.validThrough).toISOString() : null,
          salaryMin: ld?.baseSalary?.value?.minValue ?? null, salaryMax: ld?.baseSalary?.value?.maxValue ?? null, salaryText: null,
          employmentType: mapEmployment(ld?.employmentType), externalRef: null, applicationUrl: page.url, applicationEmail: null,
          postedByAgency: cfg.posted_by_agency ?? false, raw: { lastmod, jsonld: ld ?? null },
        };
        yield v;
      }
    },
  };
}

interface JobPosting { title?: string; description?: string; datePosted?: string; validThrough?: string; employmentType?: string | string[]; hiringOrganization?: { name?: string }; jobLocation?: { address?: { addressLocality?: string; addressRegion?: string; postalCode?: string } }; baseSalary?: { value?: { minValue?: number; maxValue?: number } } }
function parseJsonLd($: cheerio.CheerioAPI): JobPosting | null {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(el).text());
      const list = Array.isArray(data) ? data : data["@graph"] ?? [data];
      const jp = list.find((d: { "@type"?: string }) => d["@type"] === "JobPosting");
      if (jp) return jp as JobPosting;
    } catch { /* ignore */ }
  }
  return null;
}
function guessEmployer($: cheerio.CheerioAPI): string | null {
  const sel = ['[class*="company"]', '[class*="employer"]', '[itemprop="hiringOrganization"]', ".organisation", ".practice"];
  for (const s of sel) { const t = $(s).first().text().trim(); if (t && t.length < 80) return t; }
  return null;
}
function mapEmployment(t: string | string[] | undefined): RawVacancy["employmentType"] {
  const s = (Array.isArray(t) ? t.join(" ") : t ?? "").toUpperCase();
  if (s.includes("INTERN")) return "internship";
  if (s.includes("TEMPORARY")) return "temporary";
  if (s.includes("CONTRACT")) return "contract";
  if (s.includes("PART_TIME")) return "part_time";
  if (s.includes("FULL_TIME") || s.includes("PERMANENT")) return "permanent";
  return "unknown";
}
