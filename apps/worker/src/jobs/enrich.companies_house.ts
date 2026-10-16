import { normaliseCompanyName, canonicaliseUrl, urlHash } from "@ajis/shared";
import { db } from "../lib/db.js";
import { env } from "../lib/env.js";
import { fetchJson } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import type { Job } from "./index.js";

interface Payload { employerId?: string; all?: boolean }
const BASE = "https://api.company-information.service.gov.uk";

function authHeader() {
  const key = env().COMPANIES_HOUSE_API_KEY;
  if (!key) return null;
  return { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` };
}

interface ChSearch { items?: { company_number: string; title: string; company_status: string; company_type: string; date_of_creation?: string; address_snippet?: string; address?: { postal_code?: string; locality?: string } }[] }
interface ChCompany { company_name: string; company_number: string; company_status: string; type: string; date_of_creation?: string; sic_codes?: string[]; registered_office_address?: { address_line_1?: string; address_line_2?: string; locality?: string; region?: string; postal_code?: string }; previous_company_names?: { name: string }[]; links?: { self?: string } }
interface ChOfficers { items?: { name: string; officer_role: string; appointed_on?: string; resigned_on?: string }[] }

/**
 * Companies House Public Data API (600 req / 5 min). Verifies corporate identity. Records officers as
 * CLAIMS only — a director is not automatically the right hiring contact, so no contacts are created.
 */
async function enrichOne(employerId: string, headers: Record<string, string>) {
  const { data: e } = await db().from("employers").select("id, legal_name, companies_house_number, website_domain").eq("id", employerId).is("deleted_at", null).maybeSingle();
  if (!e) return { employerId, skipped: "missing" };
  let number = e.companies_house_number;
  let matchedBy: string | null = number ? "existing_number" : null;
  if (!number) {
    const { data } = await fetchJson<ChSearch>(`${BASE}/search/companies?q=${encodeURIComponent(e.legal_name)}&items_per_page=10`, { headers, minIntervalMs: 600 });
    const norm = normaliseCompanyName(e.legal_name);
    const hit = (data?.items ?? []).find((i) => normaliseCompanyName(i.title) === norm && i.company_status === "active") ?? (data?.items ?? []).find((i) => normaliseCompanyName(i.title) === norm);
    if (!hit) {
      await db().from("claims").upsert({ entity_type: "employer", entity_id: employerId, field_name: "companies_house.match", value: "no exact name match", evidence_status: "unverified", extracted_by: "adapter", confidence: 30 }, { onConflict: "entity_type,entity_id,field_name,source_id", ignoreDuplicates: false });
      return { employerId, skipped: "no exact match" };
    }
    number = hit.company_number;
    matchedBy = "exact_name_search";
  }
  const { data: co } = await fetchJson<ChCompany>(`${BASE}/company/${number}`, { headers, minIntervalMs: 600 });
  if (!co) return { employerId, skipped: "company fetch failed" };
  const { data: off } = await fetchJson<ChOfficers>(`${BASE}/company/${number}/officers?items_per_page=20`, { headers, minIntervalMs: 600 });
  const srcUrl = `https://find-and-update.company-information.service.gov.uk/company/${number}`;
  const canon = canonicaliseUrl(srcUrl)!;
  const { data: src } = await db().from("sources").upsert({ url: srcUrl, url_hash: urlHash(canon), canonical_url: canon, host: "find-and-update.company-information.service.gov.uk", publisher: "Companies House", evidence_type: "government_record", confidence: 95, verification_status: "verified", entity_type: "employer", entity_id: employerId, last_fetched_at: new Date().toISOString(), fetch_status: "ok" }, { onConflict: "url_hash" }).select("id").single();
  const sourceId = src?.id ?? null;
  const addr = co.registered_office_address;
  const claims = [
    ["companies_house.number", co.company_number],
    ["companies_house.name", co.company_name],
    ["companies_house.status", co.company_status],
    ["companies_house.type", co.type],
    ["companies_house.incorporated", co.date_of_creation ?? null],
    ["companies_house.sic_codes", co.sic_codes ?? []],
    ["companies_house.registered_office", addr ? [addr.address_line_1, addr.address_line_2, addr.locality, addr.region, addr.postal_code].filter(Boolean).join(", ") : null],
    ["companies_house.previous_names", (co.previous_company_names ?? []).map((p) => p.name)],
    ["companies_house.active_officers", (off?.items ?? []).filter((o) => !o.resigned_on).map((o) => `${o.name} (${o.officer_role})`)],
    ["companies_house.matched_by", matchedBy],
  ] as const;
  for (const [field, value] of claims) {
    await db().from("claims").upsert({ entity_type: "employer", entity_id: employerId, field_name: field, value: value as never, evidence_status: "verified_fact", source_id: sourceId, extracted_by: "adapter", confidence: 95 }, { onConflict: "entity_type,entity_id,field_name,source_id" });
  }
  const isArch = (co.sic_codes ?? []).some((s) => s.startsWith("7111"));
  await db().from("employers").update({
    companies_house_number: co.company_number,
    company_status: co.company_status,
    legal_form: co.type,
    date_established: co.date_of_creation ?? null,
    previous_names: (co.previous_company_names ?? []).map((p) => p.name),
    is_architecture_practice: isArch ? true : undefined,
    last_checked_at: new Date().toISOString(),
    confidence_score: undefined,
  }).eq("id", employerId);
  // Registered office is a registered office, not a workplace: record it as such, never as the studio.
  if (addr?.postal_code) {
    await db().from("offices").upsert({ employer_id: employerId, label: "Registered office (Companies House)", address_line1: addr.address_line_1 ?? null, address_line2: addr.address_line_2 ?? null, town: addr.locality ?? null, county: addr.region ?? null, postcode: addr.postal_code, office_type: "registered_office_only", status: "active", evidence_status: "verified_fact", source_id: sourceId, is_primary: false }, { onConflict: "employer_id,postcode,address_line1,town", ignoreDuplicates: true });
  }
  if (co.company_status !== "active") {
    await db().from("hiring_signals").upsert({ employer_id: employerId, signal_type: "leadership_change", strength: "strong", summary: `Companies House status: ${co.company_status}`, source_id: sourceId, evidence_status: "verified_fact" }, { onConflict: "employer_id,signal_type,source_id,observed_on", ignoreDuplicates: true });
    await db().from("tasks").insert({ title: `Companies House shows ${co.company_name} as ${co.company_status} — verify before contacting`, task_type: "verify_employer", entity_type: "employer", entity_id: employerId, employer_id: employerId, auto_generated: true, dedupe_key: `ch_status:${employerId}`, priority: "high" });
  }
  return { employerId, number: co.company_number, status: co.company_status, matchedBy };
}

export async function enrichCompaniesHouse(job: Job<Payload>) {
  const headers = authHeader();
  if (!headers) return { skipped: "COMPANIES_HOUSE_API_KEY not set" };
  if (job.data.employerId) return enrichOne(job.data.employerId, headers);
  const { data: rows } = await db().from("employers").select("id").is("deleted_at", null).not("outreach_stage", "in", "(closed_no_opportunity,suppressed)").order("last_checked_at", { ascending: true, nullsFirst: true }).limit(150);
  let n = 0;
  for (const r of rows ?? []) {
    try { await enrichOne(r.id, headers); n++; } catch (e) { logger.warn({ employerId: r.id, err: (e as Error).message }, "companies house failed"); }
  }
  return { enriched: n };
}
