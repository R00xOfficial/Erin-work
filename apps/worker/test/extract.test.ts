import { describe, expect, it } from "vitest";
import { extractEmails, extractLinks, extractMainText, findCareersLink } from "../src/lib/extract.js";

const html = `<html><head><title>Careers — Example Architects</title></head><body>
<nav><a href="/about">About</a></nav>
<main><h1>Join our studio</h1><p>We are looking for a Part 1 Architectural Assistant to join our London studio. ${"Lorem ipsum dolor sit amet. ".repeat(20)}</p>
<a href="/jobs/part-1-architectural-assistant?utm_source=x">Apply</a><a href="https://other.example.org/x">Other</a><a href="mailto:jobs@example.co.uk">jobs@example.co.uk</a></main>
<footer>© Example Architects Ltd. careers@example.co.uk</footer></body></html>`;

describe("extract", () => {
  it("pulls readable text and the title", () => {
    const r = extractMainText(html, "https://www.example.co.uk/careers");
    expect(r.text).toContain("Part 1 Architectural Assistant");
    expect(r.title).toMatch(/Careers|Join/);
  });
  it("resolves links to absolute http(s) URLs", () => {
    const links = extractLinks(html, "https://www.example.co.uk/careers");
    expect(links).toContain("https://www.example.co.uk/jobs/part-1-architectural-assistant?utm_source=x");
    expect(links).toContain("https://other.example.org/x");
    expect(links.some((l) => l.startsWith("mailto:"))).toBe(false);
  });
  it("finds business emails", () => {
    expect(extractEmails(html)).toEqual(expect.arrayContaining(["jobs@example.co.uk", "careers@example.co.uk"]));
  });

  it("finds the careers link on a practice homepage and ignores off-site and unrelated links", () => {
    const home = `<nav><a href="/projects">Projects</a><a href="https://www.facebook.com/jobs">Jobs on Facebook</a>
      <a href="/studio/careers/">Careers</a><a href="/news/we-are-hiring-blog-post-about-careers-advice">News</a></nav>`;
    expect(findCareersLink(home, "https://www.example.co.uk/")).toEqual({ url: "https://www.example.co.uk/studio/careers/", text: "Careers" });
    expect(findCareersLink(`<a href="/projects">Projects</a>`, "https://www.example.co.uk/")).toBeNull();
  });
  it("accepts a known applicant-tracking host linked from the practice site", () => {
    const home = `<a href="https://example.bamboohr.com/careers">Vacancies</a>`;
    expect(findCareersLink(home, "https://example.co.uk")?.url).toBe("https://example.bamboohr.com/careers");
  });
});
