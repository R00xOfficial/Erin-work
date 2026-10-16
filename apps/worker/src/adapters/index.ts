import type { Adapter } from "./types.js";
import { adzuna } from "./adzuna.js";
import { reed } from "./reed.js";
import { ribaJobsRss } from "./riba_jobs_rss.js";
import { sitemapAdapter } from "./sitemap_fetch.js";
import { planit } from "./planit.js";

export const ADAPTERS: Record<string, Adapter> = {
  adzuna,
  reed,
  riba_jobs_rss: ribaJobsRss,
  architecture_social: sitemapAdapter("architecture_social"),
  ninebee_careers: sitemapAdapter("ninebee_careers"),
  bd4jobs: sitemapAdapter("bd4jobs"),
  jobsgopublic: sitemapAdapter("jobsgopublic"),
  aj_jobs: sitemapAdapter("aj_jobs"),
  planit,
};
