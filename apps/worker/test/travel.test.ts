import { describe, expect, it } from "vitest";
import { haversineKm, nextWeekdayArrival } from "../src/jobs/enrich.travel_time.js";

describe("travel helpers", () => {
  it("computes distance London → Guildford ≈ 43 km", () => {
    const km = haversineKm({ lat: 51.5074, lng: -0.1278 }, { lat: 51.2362, lng: -0.5704 });
    expect(km).toBeGreaterThan(40);
    expect(km).toBeLessThan(48);
  });
  it("returns a future Tuesday 09:00 UTC", () => {
    const d = nextWeekdayArrival(2, 9);
    expect(d.getTime()).toBeGreaterThan(Date.now());
    expect(d.getUTCDay()).toBe(2);
    expect(d.getUTCHours()).toBe(9);
  });
});
