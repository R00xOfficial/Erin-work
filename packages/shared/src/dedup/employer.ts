import { normaliseCompanyName, extractDomain } from "../normalise/name.js";

export interface EmployerCandidate {
  id: string;
  normalisedName: string;
  companiesHouseNumber: string | null;
  websiteDomain: string | null;
  aliases: string[];
}

export interface EmployerMatchQuery {
  name: string;
  companiesHouseNumber?: string | null;
  website?: string | null;
}

export type EmployerMatch =
  | { kind: "exact"; by: "companies_house" | "domain" | "name" | "alias"; id: string }
  | { kind: "fuzzy"; id: string; similarity: number }
  | { kind: "none" };

/** Dice coefficient on character bigrams — a cheap stand-in for pg_trgm similarity in app code. */
export function bigramSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const out = new Map<string, number>();
    const padded = `  ${s} `;
    for (let i = 0; i < padded.length - 1; i++) {
      const g = padded.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  const total = [...ga.values()].reduce((x, y) => x + y, 0) + [...gb.values()].reduce((x, y) => x + y, 0);
  return total === 0 ? 0 : (2 * inter) / total;
}

export const FUZZY_MATCH_THRESHOLD = 0.85;

/**
 * Match order from the plan: Companies House number → website domain → normalised name/alias →
 * fuzzy (flag only; the caller must never auto-merge a fuzzy match).
 */
export function matchEmployer(q: EmployerMatchQuery, candidates: EmployerCandidate[]): EmployerMatch {
  const ch = q.companiesHouseNumber?.trim().toUpperCase().padStart(8, "0") ?? null;
  if (ch) {
    const hit = candidates.find((c) => c.companiesHouseNumber && c.companiesHouseNumber.toUpperCase().padStart(8, "0") === ch);
    if (hit) return { kind: "exact", by: "companies_house", id: hit.id };
  }
  const domain = extractDomain(q.website);
  if (domain) {
    const hit = candidates.find((c) => c.websiteDomain === domain);
    if (hit) return { kind: "exact", by: "domain", id: hit.id };
  }
  const norm = normaliseCompanyName(q.name);
  if (norm) {
    const byName = candidates.find((c) => c.normalisedName === norm);
    if (byName) return { kind: "exact", by: "name", id: byName.id };
    const byAlias = candidates.find((c) => c.aliases.some((a) => normaliseCompanyName(a) === norm));
    if (byAlias) return { kind: "exact", by: "alias", id: byAlias.id };
    let best: { id: string; similarity: number } | null = null;
    for (const c of candidates) {
      const s = bigramSimilarity(norm, c.normalisedName);
      if (s >= FUZZY_MATCH_THRESHOLD && (!best || s > best.similarity)) best = { id: c.id, similarity: s };
    }
    if (best) return { kind: "fuzzy", ...best };
  }
  return { kind: "none" };
}
