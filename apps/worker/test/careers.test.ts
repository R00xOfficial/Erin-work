import { describe, expect, it } from "vitest";
import type { CareersExtraction } from "@ajis/shared";
import { validateCareersListings } from "../src/lib/careers.js";
import { extractAnchors } from "../src/lib/extract.js";

const PAGE = `Join the studio. Current vacancies: Part 1 Architectural Assistant — London studio, £28,000 to £30,000 per annum. Apply by 30 November.
Senior Architect (Part 3) in Winchester. We also welcome speculative applications.`;
const CAREERS = "https://example.co.uk/careers";
const links = new Set(["https://example.co.uk/careers/part-1-assistant", CAREERS]);
const v = (o: Partial<CareersExtraction["vacancies"][number]>): CareersExtraction["vacancies"][number] => ({ title: "Part 1 Architectural Assistant", title_quote: "Part 1 Architectural Assistant", context_quote: null, url: null, location: null, employment_type: "unknown", salary_text: null, closing_date: null, ...o });

describe("validateCareersListings", () => {
  it("keeps a listing whose title is quoted from the page and uses only the page's own links", () => {
    const { listings, rejected } = validateCareersListings({ page_lists_current_vacancies: "yes", vacancies: [v({ url: "https://example.co.uk/careers/part-1-assistant", location: "London studio", salary_text: "£28,000 to £30,000 per annum", closing_date: "2026-11-30" })] }, PAGE, links, CAREERS, new Date("2026-10-28"));
    expect(rejected).toEqual([]);
    expect(listings[0]).toMatchObject({ url: "https://example.co.uk/careers/part-1-assistant", inline: false, locationText: "London studio", salaryText: "£28,000 to £30,000 per annum" });
    expect(listings[0]!.closingAt).toBe("2026-11-30T23:59:00.000Z");
  });
  it("rejects a title the page does not contain, however plausible", () => {
    const { listings, rejected } = validateCareersListings({ page_lists_current_vacancies: "yes", vacancies: [v({ title: "Part 2 Architectural Assistant", title_quote: "Part 2 Architectural Assistant" })] }, PAGE, links, CAREERS);
    expect(listings).toEqual([]);
    expect(rejected[0]!.reason).toMatch(/not found/);
  });
  it("drops invented links, salary and location, and gives inline roles a distinct marker URL", () => {
    const { listings } = validateCareersListings({ page_lists_current_vacancies: "yes", vacancies: [
      v({ url: "https://example.co.uk/made-up", salary_text: "£99,000", location: "Paris", closing_date: "2019-01-01" }),
      v({ title: "Senior Architect (Part 3)", title_quote: "Senior Architect (Part 3)" }),
    ] }, PAGE, links, CAREERS, new Date("2026-10-28"));
    expect(listings).toHaveLength(2);
    expect(listings[0]).toMatchObject({ inline: true, salaryText: null, locationText: null, closingAt: null });
    expect(listings[0]!.url).toBe("https://example.co.uk/careers?vacancy=part-1-architectural-assistant");
    expect(listings[1]!.url).not.toBe(listings[0]!.url);
  });
  it("collapses a vacancy listed twice", () => {
    const { listings, rejected } = validateCareersListings({ page_lists_current_vacancies: "yes", vacancies: [v({}), v({})] }, PAGE, links, CAREERS);
    expect(listings).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});

describe("extractAnchors", () => {
  it("returns absolute http(s) links with their text and skips mailto", () => {
    const a = extractAnchors(`<a href="/jobs/1">Part 1 Assistant</a><a href="mailto:x@y.com">Mail</a><a href="/jobs/1#top">again</a>`, "https://example.co.uk/careers");
    expect(a).toEqual([{ url: "https://example.co.uk/jobs/1", text: "Part 1 Assistant" }]);
  });
});
