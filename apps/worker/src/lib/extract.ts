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
