import { describe, expect, it } from "vitest";
import { classifyTitle, experienceYearsFromText, qualificationFromText } from "../src/index.js";

describe("classifyTitle", () => {
  it("separates Part 1 / Part 2 / Part 3", () => {
    expect(classifyTitle("Part 1 Architectural Assistant").family).toBe("part1_assistant");
    expect(classifyTitle("Part I Architectural Assistant").family).toBe("part1_assistant");
    expect(classifyTitle("Year Out Architectural Assistant").family).toBe("part1_assistant");
    expect(classifyTitle("Part 2 Architectural Assistant").family).toBe("part2_assistant");
    expect(classifyTitle("Part II Architectural Assistant").entryLevel).toBe(false);
    expect(classifyTitle("Part 3 Architect").family).toBe("architect_part3");
  });
  it("flags senior roles", () => {
    expect(classifyTitle("Senior Architectural Technician").family).toBe("senior_or_unsuitable");
    expect(classifyTitle("Project Architect").family).toBe("senior_or_unsuitable");
    expect(classifyTitle("Architect").family).toBe("senior_or_unsuitable");
    expect(classifyTitle("Architectural Technician").entryLevel).toBe(false);
  });
  it("recognises adjacent entry routes", () => {
    expect(classifyTitle("Graduate Architectural Technologist").family).toBe("technologist");
    expect(classifyTitle("Junior BIM Technician").family).toBe("bim_cad");
    expect(classifyTitle("Graduate Design Coordinator").family).toBe("design_coordinator");
    expect(classifyTitle("Graduate Urban Designer").family).toBe("urban_design_junior");
    expect(classifyTitle("Architectural Internship").family).toBe("placement_internship");
    expect(classifyTitle("Graduate Architectural Assistant").family).toBe("graduate_assistant");
    expect(classifyTitle("Architectural Assistant").family).toBe("part1_assistant");
    expect(classifyTitle("Planning Assistant").family).toBe("planning_assistant");
  });
});

describe("text extraction", () => {
  it("reads qualification and experience", () => {
    expect(qualificationFromText("You will have completed RIBA Part 2 and have 2 years experience")).toBe("part2");
    expect(qualificationFromText("Part 1 graduates welcome")).toBe("part1");
    expect(experienceYearsFromText("minimum 3 years' relevant experience")).toBe(3);
    expect(experienceYearsFromText("no experience required")).toBeNull();
  });
});
