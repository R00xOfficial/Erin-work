/**
 * Merge researched employer records into a deduplicated, validated seed set.
 *
 * Usage (from the repo root, after `pnpm -r --filter './packages/*' build`):
 *   node --experimental-strip-types scripts/seed-research/merge.ts <research_dir> <out_basename>
 *
 * Inputs: <research_dir>/slice_*.jsonl (one JSON object per line, see BRIEF fields) and optional
 *         <research_dir>/liveness.json from liveness.py.
 * Outputs: <out_basename>.csv, <out_basename>.sql, <out_basename>.report.json and
 *          <out_basename>.batches/batch_NN.sql (≈50 employers each, for loading via the SQL API).
 *
 * Rules: shared normalisers decide identity (domain first, then normalised name); the higher-confidence
 * record wins and missing fields are filled from the other; fuzzy name matches are reported, never merged.
 * Generated SQL is idempotent (deterministic ids, on conflict do nothing) and contains no DROP statements.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import * as shared from "../../packages/shared/dist/index.js";

const { canonicaliseUrl, extractDomain, normaliseCompanyName, normalisePostcode, classifyZone, bigramSimilarity, PRACTICE_TYPES, SIZE_BANDS } = shared;

type Rec = {
  name: string; display_name?: string | null; website: string; careers_url?: string | null; town?: string | null; postcode?: string | null;
  county?: string | null; practice_type?: string | null; size_band?: string | null; sectors?: string[] | null; specialisms?: string[] | null;
  hires_part1?: string | null; entry_level_evidence?: string | null; entry_level_evidence_url?: string | null; generic_email?: string | null;
  applications_email?: string | null; companies_house_number?: string | null; source_url?: string | null; notes?: string | null;
  confidence?: number | null; slice?: number | null;
};
type Clean = Rec & { domain: string; norm: string; canonicalWebsite: string; sourceCanonical: string; postcodeNorm: string | null; zone: string; id: string; officeId: string };

const [researchDir, outBase] = process.argv.slice(2);
if (!researchDir || !outBase) { console.error("usage: merge.ts <research_dir> <out_basename>"); process.exit(2); }

const EXISTING_DOMAINS = new Set(["mharchitects.co.uk", "makearchitects.com", "hampshiredesignconsultancy.co.uk", "farrells.com", "donaldinsall.com"]);
const EXISTING_NAMES = new Set(["mh architects", "make architects", "make", "hampshire design consultancy", "farrells", "donald insall associates"].map((n) => normaliseCompanyName(n)));
const RESEARCH_DATE = process.env.RESEARCH_DATE ?? new Date().toISOString().slice(0, 10);

const uuidFrom = (seed: string) => {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const q = (v: string | null | undefined) => (v == null || v === "" ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const arr = (v: string[] | null | undefined) => {
  const clean = (v ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 12);
  return clean.length ? `array[${clean.map((x) => q(x)).join(",")}]::text[]` : "'{}'::text[]";
};
const emailOk = (e: string | null | undefined, domain: string) => {
  if (!e) return null;
  const m = e.trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(m)) return null;
  // Only business addresses on the employer's own domain (or a subdomain of it).
  const d = m.split("@")[1]!;
  return d === domain || d.endsWith(`.${domain}`) ? m : null;
};

// ---- read
const dropped: { name: string; reason: string; slice?: number | null }[] = [];
const raw: Rec[] = [];
let badLines = 0;
for (const f of readdirSync(researchDir).filter((x) => /^slice_\d+\.jsonl$/.test(x)).sort()) {
  for (const line of readFileSync(join(researchDir, f), "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { raw.push(JSON.parse(t) as Rec); } catch { badLines++; }
  }
}
const liveness: Record<string, { ok: boolean; status: number; final_url: string | null; reason: string | null }> =
  existsSync(join(researchDir, "liveness.json")) ? JSON.parse(readFileSync(join(researchDir, "liveness.json"), "utf8")) : {};

// ---- validate + normalise
const cleaned: Clean[] = [];
for (const r of raw) {
  const name = (r.name ?? "").trim();
  const website = (r.website ?? "").trim();
  if (!name || !website) { dropped.push({ name: name || "(no name)", reason: "missing name or website", slice: r.slice }); continue; }
  const canonicalWebsite = canonicaliseUrl(website);
  const domain = extractDomain(website);
  if (!canonicalWebsite || !domain) { dropped.push({ name, reason: `bad website ${website}`, slice: r.slice }); continue; }
  if (!r.town || !r.town.trim()) { dropped.push({ name, reason: "missing town", slice: r.slice }); continue; }
  const minConfidence = Number(process.env.MIN_CONFIDENCE ?? 0);
  if (Number(r.confidence ?? 60) < minConfidence) { dropped.push({ name, reason: `confidence below ${minConfidence}`, slice: r.slice }); continue; }
  const live = liveness[website];
  if (live && !live.ok) { dropped.push({ name, reason: `website not live (${live.reason})`, slice: r.slice }); continue; }
  const norm = normaliseCompanyName(name);
  if (EXISTING_DOMAINS.has(domain) || EXISTING_NAMES.has(norm)) { dropped.push({ name, reason: "already in database", slice: r.slice }); continue; }
  const practiceType = (PRACTICE_TYPES as readonly string[]).includes(r.practice_type ?? "") ? r.practice_type! : "architecture_practice";
  const sizeBand = (SIZE_BANDS as readonly string[]).includes(r.size_band ?? "") ? r.size_band! : "unknown";
  const postcodeNorm = normalisePostcode(r.postcode);
  const sourceCanonical = canonicaliseUrl(r.source_url ?? "") ?? canonicalWebsite;
  cleaned.push({
    ...r, name, website, practice_type: practiceType, size_band: sizeBand, town: r.town.trim(), domain, norm, canonicalWebsite, sourceCanonical, postcodeNorm,
    zone: classifyZone(postcodeNorm ?? r.postcode, r.town), id: uuidFrom(`ajis-employer:${domain}`), officeId: uuidFrom(`ajis-office:${domain}`),
    hires_part1: r.hires_part1 === "yes" && r.entry_level_evidence_url ? "yes" : "unknown",
    confidence: Math.max(0, Math.min(100, Number(r.confidence ?? 60) || 60)),
  });
}

// ---- dedupe (domain, then normalised name); keep higher confidence, fill gaps
const byKey = new Map<string, Clean>();
const keyOf = new Map<string, string>();
let dupes = 0;
const fill = (a: Clean, b: Clean): Clean => {
  const [win, lose] = (a.confidence ?? 0) >= (b.confidence ?? 0) ? [a, b] : [b, a];
  const out: Clean = { ...win };
  for (const k of Object.keys(lose) as (keyof Clean)[]) {
    const v = out[k];
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) (out as Record<string, unknown>)[k] = lose[k];
  }
  return out;
};
for (const c of cleaned) {
  const existingKey = keyOf.get(`d:${c.domain}`) ?? keyOf.get(`n:${c.norm}`);
  if (existingKey) {
    dupes++;
    const merged = fill(byKey.get(existingKey)!, c);
    byKey.set(existingKey, merged);
    keyOf.set(`d:${c.domain}`, existingKey);
    keyOf.set(`n:${c.norm}`, existingKey);
    continue;
  }
  const key = c.domain;
  byKey.set(key, c);
  keyOf.set(`d:${c.domain}`, key);
  keyOf.set(`n:${c.norm}`, key);
}
const final = [...byKey.values()].sort((a, b) => a.zone.localeCompare(b.zone) || a.name.localeCompare(b.name));

// fuzzy candidates (report only)
const fuzzy: { a: string; b: string; similarity: number }[] = [];
for (let i = 0; i < final.length; i++) for (let j = i + 1; j < final.length; j++) {
  const s = bigramSimilarity(final[i]!.norm, final[j]!.norm);
  if (s >= 0.85) fuzzy.push({ a: final[i]!.name, b: final[j]!.name, similarity: Math.round(s * 100) / 100 });
}

// ---- CSV (compatible with /employers/import, plus extra research columns)
const csvCols = ["name", "website", "town", "postcode", "county", "zone", "practice_type", "size_band", "sectors", "specialisms", "hires_part1", "entry_level_evidence", "entry_level_evidence_url", "careers_url", "generic_email", "applications_email", "companies_house_number", "source_url", "notes", "confidence", "research_date"];
const csvEsc = (v: unknown) => {
  const s = Array.isArray(v) ? v.join(";") : v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = [csvCols.join(",")].concat(final.map((r) => [
  r.name, r.website, r.town, r.postcodeNorm ?? r.postcode ?? "", r.county, r.zone, r.practice_type, r.size_band, r.sectors ?? [], r.specialisms ?? [], r.hires_part1,
  r.entry_level_evidence, r.entry_level_evidence_url, r.careers_url, emailOk(r.generic_email, r.domain), emailOk(r.applications_email, r.domain),
  r.companies_house_number, r.source_url ?? r.website, r.notes, r.confidence, RESEARCH_DATE,
].map(csvEsc).join(","))).join("\n") + "\n";

// ---- SQL
const sqlFor = (r: Clean): string => {
  const src = r.sourceCanonical;
  const srcHash = sha(src);
  const evidenceCanon = r.entry_level_evidence_url ? canonicaliseUrl(r.entry_level_evidence_url) : null;
  const ch = r.companies_house_number && /^[A-Z0-9]{2,8}$/i.test(r.companies_house_number.trim()) ? r.companies_house_number.trim().toUpperCase() : null;
  const generic = emailOk(r.generic_email, r.domain);
  const apps = emailOk(r.applications_email, r.domain);
  const notes = [r.notes, `Researched ${RESEARCH_DATE} from the employer's own website (seed research, slice ${r.slice ?? "?"}).`].filter(Boolean).join(" ");
  const parts: string[] = [];
  parts.push(`-- ${r.name} (${r.domain}) zone ${r.zone}`);
  parts.push(`insert into public.sources (id, url, url_hash, canonical_url, publisher, title, evidence_type, confidence, verification_status, entity_type, entity_id, claims_summary, last_fetched_at, fetch_status, recheck_interval, next_check_at)
values (${q(uuidFrom(`ajis-source:${srcHash}`))}, ${q(r.source_url ?? r.website)}, ${q(srcHash)}, ${q(src)}, ${q(r.display_name ?? r.name)}, 'Seed research source', 'primary_official', ${r.confidence}, 'verified', 'employer', ${q(r.id)}, 'Studio location and current trading verified on the official website during seed research.', ${q(`${RESEARCH_DATE}T12:00:00Z`)}, 'ok', interval '30 days', ${q(`${RESEARCH_DATE}T12:00:00Z`)}::timestamptz + interval '30 days')
on conflict (url_hash) do nothing;`);
  parts.push(`insert into public.employers (id, legal_name, display_name, practice_type, is_architecture_practice, website, careers_url, size_band, sectors, specialisms, hires_part1, hires_part1_evidence, recruitment_intelligence, recruitment_intelligence_evidence, generic_email, applications_email, companies_house_number, research_notes, confidence_score, data_quality, last_checked_at, outreach_stage, discovered_via_source_id)
values (${q(r.id)}, ${q(r.name)}, ${q(r.display_name ?? null)}, ${q(r.practice_type)}::public.practice_type, ${r.practice_type === "architecture_practice" ? "true" : "null"}, ${q(r.website)}, ${q(r.careers_url ?? null)}, ${q(r.size_band)}::public.size_band, ${arr(r.sectors)}, ${arr(r.specialisms)}, ${q(r.hires_part1)}::public.yes_no_unknown, ${r.hires_part1 === "yes" ? "'verified_fact'" : "'unverified'"}::public.evidence_status, ${q(r.entry_level_evidence ?? null)}, ${r.entry_level_evidence ? "'verified_fact'" : "'unverified'"}::public.evidence_status, ${q(generic)}, ${q(apps)}, ${q(ch)}, ${q(notes)}, ${Math.min(r.confidence ?? 60, 70)}, 'fair', ${q(`${RESEARCH_DATE}T12:00:00Z`)}, 'awaiting_research', (select id from public.sources where url_hash = ${q(srcHash)}))
on conflict do nothing;`);
  parts.push(`insert into public.offices (id, employer_id, label, town, county, postcode, office_type, status, is_primary, evidence_status, source_id, last_verified_at)
select ${q(r.officeId)}, ${q(r.id)}, ${q(`${r.town} studio`)}, ${q(r.town)}, ${q(r.county ?? null)}, ${q(r.postcodeNorm)}, 'studio', ${r.postcodeNorm ? "'active'" : "'unverified'"}, true, ${r.postcodeNorm ? "'verified_fact'" : "'unverified'"}, (select id from public.sources where url_hash = ${q(srcHash)}), ${r.postcodeNorm ? q(`${RESEARCH_DATE}T12:00:00Z`) : "null"}
where exists (select 1 from public.employers where id = ${q(r.id)})
on conflict do nothing;`);
  if (r.entry_level_evidence && evidenceCanon) {
    const evHash = sha(evidenceCanon);
    if (evHash !== srcHash) {
      parts.push(`insert into public.sources (id, url, url_hash, canonical_url, publisher, title, evidence_type, confidence, verification_status, entity_type, entity_id, claims_summary, last_fetched_at, fetch_status)
select ${q(uuidFrom(`ajis-source:${evHash}`))}, ${q(r.entry_level_evidence_url!)}, ${q(evHash)}, ${q(evidenceCanon)}, ${q(r.display_name ?? r.name)}, 'Entry-level evidence', 'primary_official', ${r.confidence}, 'verified', 'employer', ${q(r.id)}, ${q(r.entry_level_evidence)}, ${q(`${RESEARCH_DATE}T12:00:00Z`)}, 'ok'
where exists (select 1 from public.employers where id = ${q(r.id)})
on conflict (url_hash) do nothing;`);
    }
    parts.push(`insert into public.claims (entity_type, entity_id, field_name, value, evidence_status, source_id, quote, extracted_by, confidence)
select 'employer', ${q(r.id)}, 'entry_level_evidence', to_jsonb(${q(r.entry_level_evidence)}::text), 'verified_fact', (select id from public.sources where url_hash = ${q(evHash)}), ${q(r.entry_level_evidence)}, 'human', ${r.confidence}
where exists (select 1 from public.employers where id = ${q(r.id)})
on conflict do nothing;`);
  }
  parts.push(`insert into public.tasks (title, task_type, entity_type, entity_id, employer_id, priority, auto_generated, dedupe_key, due_at)
select ${q(`Research ${r.name}: confirm team size, juniors employed, best contact route`)}, 'research', 'employer', ${q(r.id)}, ${q(r.id)}, ${r.hires_part1 === "yes" ? "'high'" : "'normal'"}, true, ${q(`research:employer:${r.id}`)}, now() + interval '7 days'
where exists (select 1 from public.employers where id = ${q(r.id)})
on conflict (dedupe_key) where dedupe_key is not null and status in ('open','in_progress','snoozed') do nothing;`);
  return parts.join("\n");
};

const header = `-- Seed research: ${final.length} employers researched ${RESEARCH_DATE}.
-- Each record was verified on the employer's own website (studio location + currently trading).
-- These are EMPLOYERS TO RESEARCH, not vacancies. Idempotent: deterministic ids, on conflict do nothing, no DROP statements.
-- Apply after supabase/seed.sql:  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f ${outBase.split("/").pop()}.sql
`;
mkdirSync(dirname(outBase), { recursive: true });
writeFileSync(`${outBase}.csv`, csv);
writeFileSync(`${outBase}.sql`, header + final.map(sqlFor).join("\n\n") + "\n");
const batchDir = `${outBase}.batches`;
if (existsSync(batchDir)) rmSync(batchDir, { recursive: true });
mkdirSync(batchDir, { recursive: true });
for (let i = 0; i < final.length; i += 50) {
  writeFileSync(join(batchDir, `batch_${String(i / 50 + 1).padStart(2, "0")}.sql`), final.slice(i, i + 50).map(sqlFor).join("\n\n") + "\n");
}
// Compact loaders: the same rows as the full SQL, as JSON inside one DO block per chunk. Used to load through
// SQL APIs with request-size limits. Produces identical employer/office ids; source ids are looked up by url_hash.
const compact = (r: Clean) => {
  const evidenceCanon = r.entry_level_evidence_url ? canonicaliseUrl(r.entry_level_evidence_url) : null;
  const ch = r.companies_house_number && /^[A-Z0-9]{2,8}$/i.test(r.companies_house_number.trim()) ? r.companies_house_number.trim().toUpperCase() : null;
  const lower = (v: string[] | null | undefined) => (v ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 12);
  return {
    id: r.id, oid: r.officeId, n: r.name, dn: r.display_name ?? null, w: r.website, cu: r.careers_url ?? null, t: r.town, c: r.county ?? null,
    pc: r.postcodeNorm, pt: r.practice_type, sb: r.size_band, sec: lower(r.sectors), sp: lower(r.specialisms), h: r.hires_part1,
    ev: r.entry_level_evidence ?? null, evu: r.entry_level_evidence && evidenceCanon ? r.entry_level_evidence_url : null, evc: r.entry_level_evidence ? evidenceCanon : null,
    ge: emailOk(r.generic_email, r.domain), ae: emailOk(r.applications_email, r.domain), ch, su: r.source_url ?? r.website, sc: r.sourceCanonical,
    no: [r.notes, `Researched ${RESEARCH_DATE} from the employer's own website (seed research, slice ${r.slice ?? "?"}).`].filter(Boolean).join(" "), cf: r.confidence,
  };
};
const loaderBody = readFileSync(join(dirname(new URL(import.meta.url).pathname), "load_template.sql"), "utf8").replaceAll("__RESEARCH_DATE__", RESEARCH_DATE);
const CHUNK = Number(process.env.LOAD_CHUNK ?? 140);
for (let i = 0; i < final.length; i += CHUNK) {
  const json = "[\n" + final.slice(i, i + CHUNK).map((r) => JSON.stringify(compact(r))).join(",\n") + "\n]";
  if (json.includes("$j$")) throw new Error("dollar-quote tag collision");
  writeFileSync(join(batchDir, `load_${String(i / CHUNK + 1).padStart(2, "0")}.sql`), loaderBody.replace("__JSON__", json));
}
const count = <K extends string>(f: (r: Clean) => K) => final.reduce<Record<string, number>>((m, r) => { const k = f(r); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const report = {
  research_date: RESEARCH_DATE, raw_records: raw.length, bad_json_lines: badLines, after_validation: cleaned.length, duplicates_merged: dupes, final: final.length,
  dropped_count: dropped.length, dropped_by_reason: dropped.reduce<Record<string, number>>((m, d) => { const k = d.reason.replace(/\(.*\)/, "").replace(/bad website .*/, "bad website").trim(); m[k] = (m[k] ?? 0) + 1; return m; }, {}),
  by_zone: count((r) => r.zone), by_practice_type: count((r) => r.practice_type ?? "?"), by_slice: count((r) => String(r.slice ?? "?")),
  with_postcode: final.filter((r) => r.postcodeNorm).length, with_entry_evidence: final.filter((r) => r.entry_level_evidence).length,
  with_generic_or_apps_email: final.filter((r) => emailOk(r.generic_email, r.domain) || emailOk(r.applications_email, r.domain)).length,
  fuzzy_name_pairs: fuzzy, dropped,
};
writeFileSync(`${outBase}.report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...report, dropped: undefined, fuzzy_name_pairs: fuzzy.length }, null, 1));
