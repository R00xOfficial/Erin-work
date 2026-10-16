import { describe, expect, it } from "vitest";
import { classifyZone, zoneForPostcode, zoneForTown } from "../src/index.js";

describe("geo zones", () => {
  it("classifies corridor postcodes", () => {
    expect(zoneForPostcode("EC1A 1BB")).toBe("A");
    expect(zoneForPostcode("GU1 3AA")).toBe("B");
    expect(zoneForPostcode("GU31 4AA")).toBe("C");
    expect(zoneForPostcode("PO1 2AA")).toBe("C");
    expect(zoneForPostcode("SO23 9AA")).toBe("EXT");
    expect(zoneForPostcode("M1 1AA")).toBe("OUT");
  });
  it("falls back to town", () => {
    expect(zoneForTown("Petersfield")).toBe("C");
    expect(classifyZone(null, "Chichester")).toBe("C");
    expect(classifyZone(null, "Nowhere")).toBe("OUT");
  });
});
