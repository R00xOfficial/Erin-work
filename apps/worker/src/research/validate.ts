import type { VacancyResearch } from "@ajis/shared";

export const norm = (s: string) => s.toLowerCase().replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();

export interface AcceptedRequirement {
  kind: VacancyResearch["requirements"][number]["kind"];
  necessity: VacancyResearch["requirements"][number]["necessity"];
  text: string;
  normalisedText: string;
  quote: string;
  evidenceStatus: "verified_fact" | "source_supported_summary";
}

/**
 * Keeps only findings whose quote appears verbatim in the vacancy's own text. This is what stops requirements being
 * borrowed from another vacancy, from the employer's other pages, or from the model's general knowledge.
 */
export function validateVacancyResearch(x: VacancyResearch, vacancyText: string) {
  const text = norm(vacancyText);
  const found = (q: string | null | undefined) => !!q && text.includes(norm(q));
  const rejected: { what: string; reason: string }[] = [];
  const seen = new Set<string>();
  const requirements: AcceptedRequirement[] = [];
  for (const r of x.requirements) {
    if (!found(r.quote)) { rejected.push({ what: r.text, reason: "quote not found in the vacancy text" }); continue; }
    const key = `${r.kind}|${norm(r.text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    requirements.push({
      kind: r.kind, necessity: r.necessity, text: r.text.trim(), normalisedText: norm(r.text), quote: r.quote.trim(),
      evidenceStatus: r.necessity !== "unclear" && norm(r.quote).includes(norm(r.text)) ? "verified_fact" : "source_supported_summary",
    });
  }
  const entryLevel = x.entry_level.value !== "unclear" && !found(x.entry_level.quote)
    ? (rejected.push({ what: `entry level: ${x.entry_level.value}`, reason: "quote not found in the vacancy text" }), { value: "unclear" as const, quote: null })
    : { value: x.entry_level.value, quote: x.entry_level.quote };
  const training = x.training_statements.filter((t) => found(t.quote) || (rejected.push({ what: t.text, reason: "quote not found in the vacancy text" }), false));
  const notes = x.material_notes.filter((t) => found(t.quote) || (rejected.push({ what: t.text, reason: "quote not found in the vacancy text" }), false));
  const workingPattern = x.working_pattern.value !== "unknown" && !found(x.working_pattern.quote) ? { value: "unknown" as const, quote: null } : x.working_pattern;
  return { requirements, entryLevel, training, notes, workingPattern, rejected };
}
