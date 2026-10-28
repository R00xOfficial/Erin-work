import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";

/** Main readable text of an HTML page (for change detection, snapshots and AI input). */
export function extractMainText(html: string, url: string): { title: string | null; text: string } {
  try {
    const { document } = parseHTML(html);
    const base = document.createElement("base");
    base.setAttribute("href", url);
    document.head?.appendChild(base);
    const article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
    if (article?.textContent && article.textContent.trim().length > 200) {
      return { title: article.title ?? null, text: article.textContent.replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim() };
    }
  } catch {
    // fall through to cheerio
  }
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, noscript, svg, iframe").remove();
  const title = $("title").first().text().trim() || null;
  const text = $("main, article, body").first().text().replace(/\s+/g, " ").trim();
  return { title, text };
}

/** All absolute http(s) links on a page, deduplicated. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const out = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const u = new URL(href, baseUrl);
      if (u.protocol === "http:" || u.protocol === "https:") out.add(u.toString());
    } catch {
      // ignore
    }
  });
  return [...out];
}

/** Emails that look like business addresses on a page (used only to populate the applications inbox field, with a source). */
export function extractEmails(text: string): string[] {
  const m = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  return [...new Set(m.map((x) => x.toLowerCase()))].filter((x) => !/\.(png|jpg|svg|gif)$/.test(x));
}

const CAREERS_TEXT = /\b(careers?|vacanc(?:y|ies)|jobs?|join (?:us|our|the)|work (?:with|for) us|opportunit(?:y|ies)|recruitment)\b/i;
const CAREERS_HREF = /(career|vacanc|\/jobs?\b|join-?(us|our|the)|work-?(with|for)-?us|opportunit|recruit)/i;
const ATS_HOSTS = /(^|\.)(workable\.com|bamboohr\.com|teamtailor\.com|recruitee\.com|personio\.(de|com)|breezy\.hr|smartrecruiters\.com|greenhouse\.io|lever\.co|applytojob\.com|hireful\.co\.uk|cvlibrary\.co\.uk|pinpointhq\.com|jobs\.ashbyhq\.com)$/i;

/**
 * Finds the link on a practice's page most likely to be its careers / vacancies page. Only returns a link that is
 * actually present in the page's anchors (never constructs a URL), and only on the same site or a known ATS host.
 */
export function findCareersLink(html: string, baseUrl: string): { url: string; text: string } | null {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const sameSite = (h: string) => h.replace(/^www\./, "") === base.hostname.replace(/^www\./, "");
  let best: { url: string; text: string; score: number } | null = null;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || /^(mailto|tel|javascript):/i.test(href)) return;
    let u: URL;
    try { u = new URL(href, baseUrl); } catch { return; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    if (!sameSite(u.hostname) && !ATS_HOSTS.test(u.hostname)) return;
    const text = $(el).text().replace(/\s+/g, " ").trim().slice(0, 80);
    const textHit = text.length > 0 && text.length <= 40 && CAREERS_TEXT.test(text);
    const hrefHit = CAREERS_HREF.test(u.pathname + u.hostname);
    if (!textHit && !hrefHit) return;
    u.hash = "";
    const score = (textHit ? 3 : 0) + (hrefHit ? 2 : 0) + (ATS_HOSTS.test(u.hostname) ? 1 : 0) - Math.min(u.pathname.split("/").filter(Boolean).length, 4) * 0.25;
    if (!best || score > best.score) best = { url: u.toString(), text, score };
  });
  return best ? { url: (best as { url: string }).url, text: (best as { text: string }).text } : null;
}
