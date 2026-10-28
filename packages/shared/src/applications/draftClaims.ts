export interface DraftFact { id: string; text: string; source: "profile" | "employer" | "vacancy" | "snippet" | "application"; label?: string }
export interface DraftParagraph { text: string; factual: boolean; fact_ids: string[] }
export interface DraftFlag { code: "unsupported_claim" | "unknown_fact_reference" | "unverified_detail" | "unverified_credential" | "personal_connection"; text: string; excerpt: string }

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");
const CREDENTIAL = /\b(award(?:ed|s)?|won|winner|shortlisted|first[- ]class|2:1|distinction|merit|published|led|managed|directed|founded|scholarship|chartered|registered|licen[cs]e[d]?)\b/gi;
const CONNECTION = /\b(i know|i met|we met|mutual|referred by|recommended by|introduced by|friend of|colleague of|your former|spoke (?:to|with))\b/gi;

/**
 * Checks AI-drafted wording against the facts the model was allowed to use. It cannot prove a draft is true; it makes sure every factual
 * claim points at a real, approved fact, and flags numbers, credentials and personal connections that no fact supports, for Erin to verify or remove.
 */
export function checkDraft(paragraphs: DraftParagraph[], facts: DraftFact[], allowedNames: string[] = []): DraftFlag[] {
  const flags: DraftFlag[] = [];
  const byId = new Map(facts.map((f) => [f.id, f]));
  const corpus = norm([...facts.map((f) => f.text), ...allowedNames].join(" \n "));
  for (const p of paragraphs) {
    const valid = p.fact_ids.filter((id) => byId.has(id));
    for (const id of p.fact_ids) if (!byId.has(id)) flags.push({ code: "unknown_fact_reference", text: `The draft cites a fact (${id}) that was not supplied.`, excerpt: p.text.slice(0, 120) });
    if (p.factual && valid.length === 0) flags.push({ code: "unsupported_claim", text: "This statement is presented as fact but is not backed by any approved information. Verify it or remove it.", excerpt: p.text.slice(0, 160) });
    const t = norm(p.text);
    for (const m of t.matchAll(/\b\d[\d,.:]*\b/g)) if (!corpus.includes(m[0].replace(/[.,:]$/, ""))) flags.push({ code: "unverified_detail", text: `The number "${m[0]}" does not appear in your approved information.`, excerpt: p.text.slice(0, 160) });
    for (const m of t.matchAll(CREDENTIAL)) if (!corpus.includes(m[0].toLowerCase())) flags.push({ code: "unverified_credential", text: `"${m[0]}" is not supported by your approved information.`, excerpt: p.text.slice(0, 160) });
    for (const m of t.matchAll(CONNECTION)) if (!corpus.includes(m[0].toLowerCase())) flags.push({ code: "personal_connection", text: `A personal connection ("${m[0]}") is claimed without any record of it.`, excerpt: p.text.slice(0, 160) });
  }
  const seen = new Set<string>();
  return flags.filter((f) => { const k = `${f.code}|${f.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
