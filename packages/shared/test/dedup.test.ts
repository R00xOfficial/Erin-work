import { describe, expect, it } from "vitest";
import { matchEmployer, vacancyFingerprint, bigramSimilarity, type EmployerCandidate } from "../src/index.js";

const candidates: EmployerCandidate[] = [
  { id: "1", normalisedName: "make architects", companiesHouseNumber: "05120005", websiteDomain: "makearchitects.com", aliases: ["Make"] },
  { id: "2", normalisedName: "donald insall associates", companiesHouseNumber: null, websiteDomain: "donaldinsall.com", aliases: [] },
];

describe("matchEmployer", () => {
  it("matches by companies house, domain, name, alias in that order", () => {
    expect(matchEmployer({ name: "Totally Different", companiesHouseNumber: "5120005" }, candidates)).toMatchObject({ kind: "exact", by: "companies_house", id: "1" });
    expect(matchEmployer({ name: "DIA", website: "https://www.donaldinsall.com/about" }, candidates)).toMatchObject({ kind: "exact", by: "domain", id: "2" });
    expect(matchEmployer({ name: "Make Architects Ltd" }, candidates)).toMatchObject({ kind: "exact", by: "name", id: "1" });
    expect(matchEmployer({ name: "Make" }, candidates)).toMatchObject({ kind: "exact", by: "alias", id: "1" });
  });
  it("returns fuzzy (never exact) for near-misses and none otherwise", () => {
    const fuzzy = matchEmployer({ name: "Donald Insall Associate" }, candidates);
    expect(fuzzy.kind).toBe("fuzzy");
    expect(matchEmployer({ name: "Foster + Partners" }, candidates).kind).toBe("none");
    expect(bigramSimilarity("abc", "abc")).toBe(1);
  });
});

describe("vacancyFingerprint", () => {
  it("is stable across boards and title variants", () => {
    const a = vacancyFingerprint({ employerName: "Make Architects Ltd", title: "Part I Architectural Assistant", postcode: "EC1A 1BB" });
    const b = vacancyFingerprint({ employerName: "MAKE ARCHITECTS", title: "Part 1 Architectural Assistant - London", postcode: "EC1A 9ZZ" });
    expect(a).toBe(b);
    const c = vacancyFingerprint({ employerName: "Make Architects", title: "Part 2 Architectural Assistant", postcode: "EC1A 1BB" });
    expect(a).not.toBe(c);
  });
});
