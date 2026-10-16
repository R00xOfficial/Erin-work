import { env } from "./env.js";
import { logger } from "./logger.js";
import { isAllowed, pauseHost } from "./robots.js";

/**
 * Polite HTTP client: per-host serialisation with a minimum interval (robots Crawl-delay or the
 * source's min_interval_ms, default 2 s), honours Retry-After, pauses a host on 429, never retries a 403.
 */
const lastRequestAt = new Map<string, number>();
const hostQueues = new Map<string, Promise<unknown>>();

export interface FetchOptions {
  minIntervalMs?: number;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
  timeoutMs?: number;
  /** Skip robots.txt (for documented APIs with their own ToS). */
  api?: boolean;
  etag?: string | null;
  lastModified?: string | null;
}

export interface FetchResult {
  status: number;
  ok: boolean;
  notModified: boolean;
  text: string;
  headers: Headers;
  url: string;
  skipped?: string;
}

async function throttle(host: string, minIntervalMs: number) {
  const prev = hostQueues.get(host) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  hostQueues.set(host, prev.then(() => mine));
  await prev;
  const last = lastRequestAt.get(host) ?? 0;
  const wait = Math.max(0, last + minIntervalMs - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt.set(host, Date.now());
  return release;
}

export async function politeFetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const host = new URL(url).hostname.toLowerCase();
  let minInterval = opts.minIntervalMs ?? 2000;
  if (!opts.api) {
    const check = await isAllowed(url);
    if (!check.allowed) {
      logger.info({ url, reason: check.reason }, "fetch skipped");
      return { status: 0, ok: false, notModified: false, text: "", headers: new Headers(), url, skipped: check.reason };
    }
    if (check.policy.crawlDelayS != null) minInterval = Math.max(minInterval, check.policy.crawlDelayS * 1000);
  }
  const release = await throttle(host, minInterval);
  try {
    const headers: Record<string, string> = { "user-agent": env().WORKER_USER_AGENT, accept: "text/html,application/xhtml+xml,application/xml,application/json,text/plain;q=0.9,*/*;q=0.8", "accept-language": "en-GB,en;q=0.9", ...(opts.headers ?? {}) };
    if (opts.etag) headers["if-none-match"] = opts.etag;
    if (opts.lastModified) headers["if-modified-since"] = opts.lastModified;
    const res = await fetch(url, { method: opts.method ?? "GET", headers, body: opts.body, redirect: "follow", signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
    if (res.status === 429 || res.status === 503) {
      const ra = Number(res.headers.get("retry-after"));
      const pause = Number.isFinite(ra) && ra > 0 ? ra : 600;
      await pauseHost(host, pause);
      logger.warn({ host, status: res.status, pause }, "rate limited; host paused");
    }
    if (res.status === 304) return { status: 304, ok: true, notModified: true, text: "", headers: res.headers, url: res.url };
    const text = res.ok ? await res.text() : "";
    return { status: res.status, ok: res.ok, notModified: false, text, headers: res.headers, url: res.url };
  } finally {
    release();
  }
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<{ status: number; data: T | null; headers: Headers }> {
  const r = await politeFetch(url, { ...opts, api: true, headers: { accept: "application/json", ...(opts.headers ?? {}) } });
  if (!r.ok || !r.text) return { status: r.status, data: null, headers: r.headers };
  try {
    return { status: r.status, data: JSON.parse(r.text) as T, headers: r.headers };
  } catch {
    return { status: r.status, data: null, headers: r.headers };
  }
}
