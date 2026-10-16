import { createRequire } from "node:module";

type Robot = { isAllowed(url: string, ua?: string): boolean | undefined; getCrawlDelay(ua?: string): number | undefined };
// robots-parser ships a CommonJS `export =`; load it through require so the call signature is correct under NodeNext ESM.
const robotsParser = createRequire(import.meta.url)("robots-parser") as (url: string, contents: string) => Robot;
import { db } from "./db.js";
import { env } from "./env.js";
import { logger } from "./logger.js";

const CACHE_MS = 24 * 3600_000;

export interface HostPolicy {
  host: string;
  allowed: boolean;
  crawlDelayS: number | null;
  pausedUntil: Date | null;
  robots: Robot | null;
}

const memo = new Map<string, HostPolicy>();

/** Fetches and caches robots.txt for a host (24 h) in host_policies, and returns a policy object. */
export async function hostPolicy(host: string): Promise<HostPolicy> {
  const cached = memo.get(host);
  if (cached) return cached;
  const { data: row } = await db().from("host_policies").select("*").eq("host", host).maybeSingle();
  let robotsTxt = row?.robots_txt ?? null;
  let fetchedAt = row?.robots_fetched_at ? new Date(row.robots_fetched_at) : null;
  if (!robotsTxt || !fetchedAt || Date.now() - fetchedAt.getTime() > CACHE_MS) {
    try {
      const res = await fetch(`https://${host}/robots.txt`, { headers: { "user-agent": env().WORKER_USER_AGENT, accept: "text/plain" }, signal: AbortSignal.timeout(15_000), redirect: "follow" });
      robotsTxt = res.ok ? await res.text() : ""; // 404 → everything allowed
      fetchedAt = new Date();
    } catch (e) {
      logger.warn({ host, err: (e as Error).message }, "robots.txt fetch failed; treating as allow with default delay");
      robotsTxt = robotsTxt ?? "";
      fetchedAt = new Date();
    }
  }
  const parser = robotsParser(`https://${host}/robots.txt`, robotsTxt);
  const ua = env().WORKER_USER_AGENT.split("/")[0] ?? "AJIS";
  const delay = parser.getCrawlDelay(ua) ?? parser.getCrawlDelay("*") ?? null;
  const policy: HostPolicy = { host, allowed: row?.allowed ?? true, crawlDelayS: delay ?? (row?.crawl_delay_s != null ? Number(row.crawl_delay_s) : null), pausedUntil: row?.paused_until ? new Date(row.paused_until) : null, robots: parser };
  await db().from("host_policies").upsert({ host, robots_txt: robotsTxt, robots_fetched_at: fetchedAt.toISOString(), crawl_delay_s: policy.crawlDelayS, user_agent: env().WORKER_USER_AGENT, allowed: policy.allowed }, { onConflict: "host" });
  memo.set(host, policy);
  return policy;
}

/** True if robots.txt allows our UA to fetch the URL and the host is not administratively blocked. */
export async function isAllowed(url: string): Promise<{ allowed: boolean; reason?: string; policy: HostPolicy }> {
  const host = new URL(url).hostname.toLowerCase();
  const policy = await hostPolicy(host);
  if (!policy.allowed) return { allowed: false, reason: "host_blocked_by_policy", policy };
  if (policy.pausedUntil && policy.pausedUntil > new Date()) return { allowed: false, reason: "host_paused_rate_limit", policy };
  const ua = env().WORKER_USER_AGENT.split("/")[0] ?? "AJIS";
  const ok = policy.robots?.isAllowed(url, ua);
  if (ok === false) return { allowed: false, reason: "robots_disallow", policy };
  return { allowed: true, policy };
}

export async function pauseHost(host: string, seconds: number) {
  memo.delete(host);
  await db().from("host_policies").upsert({ host, paused_until: new Date(Date.now() + seconds * 1000).toISOString() }, { onConflict: "host" });
}
