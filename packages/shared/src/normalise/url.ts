import { sha256 } from "../hash.js";

const TRACKING_PARAMS = /^(utm_|gclid$|fbclid$|msclkid$|mc_cid$|mc_eid$|ref$|source$|src$|cmpid$|campaign$|_hs|yclid$|igshid$)/i;

/**
 * Canonicalise a URL for deduplication: https, lowercase host, strip www., drop tracking params,
 * fragments, default ports, trailing slash (except root), and sort remaining params.
 */
export function canonicaliseUrl(input: string): string | null {
  let raw = input.trim();
  if (!raw) return null;
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() ?? null;
  if (scheme && scheme !== "http" && scheme !== "https") return null;
  if (!scheme) raw = `https://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";
  url.username = "";
  url.password = "";
  if (url.port === "443" || url.port === "80") url.port = "";
  const keep: [string, string][] = [];
  for (const [k, v] of url.searchParams.entries()) {
    if (!TRACKING_PARAMS.test(k)) keep.push([k, v]);
  }
  keep.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = "";
  for (const [k, v] of keep) url.searchParams.append(k, v);
  let path = url.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  url.pathname = path;
  return url.toString();
}

export function urlHash(canonicalUrl: string): string {
  return sha256(canonicalUrl);
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
