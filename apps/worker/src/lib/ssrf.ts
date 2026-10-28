import { lookup } from "node:dns/promises";
import net from "node:net";

// Server-side request forgery guard. URLs reach the worker from places an attacker can influence (scraped pages, employer websites, imported rows),
// so every fetch, and every redirect hop, must resolve to a public internet address.

export function isBlockedIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b, c] = ip.split(".").map(Number) as [number, number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]!);
    const first = parseInt(x.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
  }
  return true; // not an address at all
}

export class BlockedUrlError extends Error {}

/** Throws unless the URL is plain http(s) to a public address. Resolves every address the name maps to; one private answer blocks the lot. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new BlockedUrlError("not a valid URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError(`protocol ${u.protocol} is not allowed`);
  if (u.username || u.password) throw new BlockedUrlError("credentials in URLs are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") throw new BlockedUrlError("internal host names are not allowed");
  if (net.isIP(host)) { if (isBlockedIp(host)) throw new BlockedUrlError("address is not public"); return u; }
  let addrs: { address: string }[];
  try { addrs = await lookup(host, { all: true }); } catch { throw new BlockedUrlError("host could not be resolved"); }
  if (addrs.length === 0 || addrs.some((a) => isBlockedIp(a.address))) throw new BlockedUrlError("host resolves to a non-public address");
  return u;
}

/** Reads a response body but stops at a size cap so a huge or endless response cannot exhaust memory. */
export async function readLimited(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new BlockedUrlError(`response larger than ${maxBytes} bytes`); }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** fetch() with the guard applied to the first URL and to every redirect, and a body size cap. */
export async function safeFetch(url: string, init: RequestInit, opts: { maxRedirects?: number; maxBytes?: number } = {}): Promise<{ res: Response; finalUrl: string; text: string }> {
  let current = (await assertPublicUrl(url)).toString();
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = (await assertPublicUrl(new URL(res.headers.get("location")!, current).toString())).toString();
      await res.body?.cancel();
      continue;
    }
    const text = res.status === 304 || !res.ok ? "" : await readLimited(res, opts.maxBytes ?? 5_000_000);
    return { res, finalUrl: current, text };
  }
  throw new BlockedUrlError("too many redirects");
}
