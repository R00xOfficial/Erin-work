import { describe, expect, it } from "vitest";
import type { VacancyResearch } from "@ajis/shared";
import { validateVacancyResearch } from "../src/research/validate.js";

const TEXT = `Part 1 Architectural Assistant. Essential: RIBA Part 1 and proficiency in Revit. Desirable: Rhino. We offer mentoring towards Part 2. Hybrid working, two days at home. No experience necessary.`;
const base = (o: Partial<VacancyResearch> = {}): VacancyResearch => ({
  requirements: [], entry_level: { value: "unclear", quote: null }, training_statements: [], working_pattern: { value: "unknown", quote: null }, material_notes: [], ...o,
});

describe("validateVacancyResearch", () => {
  it("keeps requirements quoted from the vacancy and marks fair paraphrases as summaries", () => {
    const r = validateVacancyResearch(base({ requirements: [
      { kind: "software", necessity: "essential", text: "Revit", quote: "proficiency in Revit" },
      { kind: "qualification", necessity: "essential", text: "Part 1 qualification", quote: "RIBA Part 1" },
    ] }), TEXT);
    expect(r.requirements).toHaveLength(2);
    expect(r.requirements[0]!.evidenceStatus).toBe("verified_fact");
    expect(r.requirements[1]!.evidenceStatus).toBe("source_supported_summary");
  });
  it("drops anything whose quote is not in the vacancy text (e.g. borrowed from another vacancy)", () => {
    const r = validateVacancyResearch(base({ requirements: [
      { kind: "registration", necessity: "essential", text: "ARB registration", quote: "must be ARB registered" },
      { kind: "software", necessity: "desirable", text: "Rhino", quote: "Desirable: Rhino" },
    ], entry_level: { value: "no", quote: "five years' experience" } }), TEXT);
    expect(r.requirements.map((x) => x.text)).toEqual(["Rhino"]);
    expect(r.entryLevel).toEqual({ value: "unclear", quote: null });
    expect(r.rejected.map((x) => x.what)).toEqual(expect.arrayContaining(["ARB registration"]));
  });
  it("accepts matching entry-level, training and working pattern evidence, ignoring case and spacing", () => {
    const r = validateVacancyResearch(base({
      entry_level: { value: "yes", quote: "No experience   necessary" },
      training_statements: [{ text: "Mentoring towards Part 2", quote: "mentoring towards part 2" }],
      working_pattern: { value: "hybrid", quote: "Hybrid working, two days at home" },
    }), TEXT);
    expect(r.entryLevel.value).toBe("yes");
    expect(r.training).toHaveLength(1);
    expect(r.workingPattern.value).toBe("hybrid");
  });
  it("collapses duplicate requirements", () => {
    const dup = { kind: "software" as const, necessity: "essential" as const, text: "Revit", quote: "proficiency in Revit" };
    expect(validateVacancyResearch(base({ requirements: [dup, { ...dup }] }), TEXT).requirements).toHaveLength(1);
  });
});
