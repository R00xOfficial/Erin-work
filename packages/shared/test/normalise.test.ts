import { describe, expect, it } from "vitest";
import { canonicaliseUrl, extractDomain, normaliseCompanyName, normalisePostcode, postcodeDistrict, postcodeArea, urlHash } from "../src/index.js";

describe("normaliseCompanyName", () => {
  it("strips legal suffixes and punctuation but keeps descriptive words", () => {
    expect(normaliseCompanyName("Make Architects Ltd.")).toBe("make architects");
    expect(normaliseCompanyName("Donald Insall Associates LLP")).toBe("donald insall associates");
    expect(normaliseCompanyName("Farrells")).toBe("farrells");
    expect(normaliseCompanyName("MH Architects")).not.toBe("mh");
  });
  it("normalises ampersands and accents", () => {
    expect(normaliseCompanyName("Allies & Morrison")).toBe("allies and morrison");
    expect(normaliseCompanyName("Café Studio Limited")).toBe("cafe studio");
  });
});

describe("extractDomain", () => {
  it("handles UK second-level domains and www", () => {
    expect(extractDomain("https://www.makearchitects.com/careers")).toBe("makearchitects.com");
    expect(extractDomain("http://jobs.example.co.uk/x")).toBe("example.co.uk");
    expect(extractDomain("hampshiredesignconsultancy.co.uk")).toBe("hampshiredesignconsultancy.co.uk");
    expect(extractDomain("")).toBeNull();
  });
});

describe("canonicaliseUrl", () => {
  it("strips tracking params, fragments, www, and sorts params", () => {
    const a = canonicaliseUrl("HTTP://www.Example.com/jobs/123/?utm_source=x&b=2&a=1#top");
    const b = canonicaliseUrl("https://example.com/jobs/123?a=1&b=2");
    expect(a).toBe("https://example.com/jobs/123?a=1&b=2");
    expect(a).toBe(b);
    expect(urlHash(a!)).toBe(urlHash(b!));
  });
  it("rejects non-http", () => {
    expect(canonicaliseUrl("mailto:x@y.com")).toBeNull();
    expect(canonicaliseUrl("   ")).toBeNull();
  });
});

describe("postcodes", () => {
  it("normalises and splits", () => {
    expect(normalisePostcode("gu314aa")).toBe("GU31 4AA");
    expect(normalisePostcode("SW1A1AA")).toBe("SW1A 1AA");
    expect(normalisePostcode("not a postcode")).toBeNull();
    expect(postcodeDistrict("GU31 4AA")).toBe("GU31");
    expect(postcodeDistrict("GU31")).toBe("GU31");
    expect(postcodeArea("SW1A 1AA")).toBe("SW");
  });
});
