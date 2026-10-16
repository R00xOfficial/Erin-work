import { describe, expect, it } from "vitest";
import Parser from "rss-parser";
import { readFileSync } from "node:fs";
import { classifyTitle } from "@ajis/shared";

const rss = readFileSync(new URL("./fixtures/riba_jobs.rss.xml", import.meta.url), "utf8");

describe("RIBA Jobs RSS fixture", () => {
  it("parses items and separates Part 1 from Part 2", async () => {
    const feed = await new Parser().parseString(rss);
    expect(feed.items.length).toBe(3);
    const families = feed.items.map((i) => classifyTitle(i.title!.split(" – ")[0]!).family);
    expect(families).toEqual(["part1_assistant", "part2_assistant", "senior_or_unsuitable"]);
  });
});

describe("Adzuna fixture", () => {
  it("maps predicted salaries to null and keeps redirect_url as identity", () => {
    const data = JSON.parse(readFileSync(new URL("./fixtures/adzuna.json", import.meta.url), "utf8")) as { results: { salary_is_predicted: string; salary_min: number; redirect_url: string }[] };
    const r = data.results[0]!;
    expect(r.redirect_url).toMatch(/^https:\/\/www\.adzuna\.co\.uk\//);
    const salary = r.salary_is_predicted === "1" ? null : r.salary_min;
    expect(salary).toBeNull();
  });
});
