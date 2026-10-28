import type { CareersExtraction, EmploymentType } from "@ajis/shared";

export interface CareersListing {
  title: string;
  url: string;
  /** True when the page gave the vacancy no link of its own, so `url` is the careers page plus a marker parameter. */
  inline: boolean;
  contextQuote: string | null;
  locationText: string | null;
  employmentType: EmploymentType;
  salaryText: string | null;
  closingAt: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
export const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

/**
 * Keeps only what the page itself supports. A listing needs a title quoted verbatim from the page text; location, salary and
 * context are kept only when they appear in the text; a link is kept only if it was one of the page's own links. Nothing is
 * filled in from the model's own knowledge.
 */
export function validateCareersListings(x: CareersExtraction, pageText: string, pageLinks: Set<string>, careersUrl: string, now = new Date()) {
  const text = norm(pageText);
  const listings: CareersListing[] = [];
  const rejected: { title: string; reason: string }[] = [];
  const seen = new Set<string>();
  const lo = now.getTime() - 86_400_000, hi = now.getTime() + 400 * 86_400_000;
  for (const v of x.vacancies) {
    const title = v.title.replace(/\s+/g, " ").trim();
    const nt = norm(title), nq = norm(v.title_quote);
    if (!text.includes(nq)) { rejected.push({ title, reason: "title quote not found on page" }); continue; }
    if (!nq.includes(nt) && !nt.includes(nq)) { rejected.push({ title, reason: "title does not match its quote" }); continue; }
    const link = v.url && pageLinks.has(v.url) ? v.url : null;
    const inline = !link || link === careersUrl;
    const sep = careersUrl.includes("?") ? "&" : "?";
    const url = inline ? `${careersUrl}${sep}vacancy=${slug(title)}` : link!;
    if (seen.has(url)) { rejected.push({ title, reason: "duplicate of another listing on the page" }); continue; }
    seen.add(url);
    const closing = v.closing_date ? new Date(`${v.closing_date}T23:59:00Z`) : null;
    listings.push({
      title,
      url,
      inline,
      contextQuote: v.context_quote && text.includes(norm(v.context_quote)) ? v.context_quote : null,
      locationText: v.location && text.includes(norm(v.location)) ? v.location : null,
      employmentType: v.employment_type,
      salaryText: v.salary_text && text.includes(norm(v.salary_text)) ? v.salary_text : null,
      closingAt: closing && !Number.isNaN(closing.getTime()) && closing.getTime() >= lo && closing.getTime() <= hi ? closing.toISOString() : null,
    });
  }
  return { listings, rejected };
}
