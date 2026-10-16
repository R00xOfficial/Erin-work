"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { canonicaliseUrl, urlHash, normaliseCompanyName, extractDomain, matchEmployer, PRACTICE_TYPES, type EmployerCandidate } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";

function parseDelimited(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = lines[0]!.includes("\t") ? "\t" : ",";
  const split = (line: string) => {
    const out: string[] = []; let cur = ""; let inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === delim && !inQ) { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const headers = split(lines[0]!).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [headers[i] ?? `col${i}`, v])));
}

export async function importEmployersCsv(formData: FormData) {
  const { supabase } = await requireUser();
  const text = String(formData.get("csv") ?? "");
  const defaultSource = String(formData.get("default_source_url") ?? "").trim() || null;
  const rows = parseDelimited(text);
  const { data: imp, error } = await supabase.from("imports").insert({ kind: "csv_employers", row_count: rows.length }).select("id").single();
  if (error) throw new Error(error.message);
  const { data: existing } = await supabase.from("employers").select("id, normalised_name, companies_house_number, website_domain, employer_aliases(alias)").is("deleted_at", null);
  const candidates: EmployerCandidate[] = (existing ?? []).map((e) => ({ id: e.id, normalisedName: e.normalised_name, companiesHouseNumber: e.companies_house_number, websiteDomain: e.website_domain, aliases: (e.employer_aliases as { alias: string }[]).map((a) => a.alias) }));
  let created = 0, dup = 0, rejected = 0;
  const { data: manualDef } = await supabase.from("source_definitions").select("id").eq("code", "manual_import").single();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const name = r.name ?? r.legal_name ?? r.practice ?? r.employer ?? "";
    const row_no = i + 1;
    if (!name) { rejected++; await supabase.from("import_rows").insert({ import_id: imp.id, row_no, raw: r, result: "rejected", message: "Missing name" }); continue; }
    const match = matchEmployer({ name, companiesHouseNumber: r.companies_house_number || null, website: r.website || null }, candidates);
    if (match.kind === "exact") { dup++; await supabase.from("import_rows").insert({ import_id: imp.id, row_no, raw: r, result: "duplicate", entity_type: "employer", entity_id: match.id, message: `Matched existing employer by ${match.by}` }); continue; }
    if (match.kind === "fuzzy") { dup++; await supabase.from("import_rows").insert({ import_id: imp.id, row_no, raw: r, result: "duplicate", entity_type: "employer", entity_id: match.id, message: `Possible duplicate (similarity ${match.similarity.toFixed(2)}) — not created; merge or add manually` }); continue; }
    const practiceType = (PRACTICE_TYPES as readonly string[]).includes(r.practice_type ?? "") ? r.practice_type : "architecture_practice";
    let sourceId: string | null = null;
    const srcUrl = r.source_url || defaultSource;
    if (srcUrl) {
      const canon = canonicaliseUrl(srcUrl);
      if (canon) {
        const { data: s } = await supabase.from("sources").upsert({ url: srcUrl, url_hash: urlHash(canon), canonical_url: canon, evidence_type: srcUrl.includes("architecture.com") ? "directory" : "user_provided", confidence: 55, entity_type: "employer", source_definition_id: manualDef?.id ?? null }, { onConflict: "url_hash" }).select("id").single();
        sourceId = s?.id ?? null;
      }
    }
    const { data: e, error: ie } = await supabase.from("employers").insert({
      legal_name: name, normalised_name: normaliseCompanyName(name), website: r.website || null, companies_house_number: r.companies_house_number || null, practice_type: practiceType as (typeof PRACTICE_TYPES)[number],
      sectors: (r.sectors ?? "").split(/[;|]/).map((x) => x.trim()).filter(Boolean), research_notes: r.notes || null, discovered_via_source_id: sourceId, outreach_stage: "awaiting_research",
    }).select("id").single();
    if (ie) { rejected++; await supabase.from("import_rows").insert({ import_id: imp.id, row_no, raw: r, result: "rejected", message: ie.message }); continue; }
    created++;
    candidates.push({ id: e.id, normalisedName: normaliseCompanyName(name), companiesHouseNumber: r.companies_house_number || null, websiteDomain: extractDomain(r.website || null), aliases: [] });
    if (sourceId) await supabase.from("sources").update({ entity_id: e.id }).eq("id", sourceId);
    if (r.town || r.postcode) await supabase.from("offices").insert({ employer_id: e.id, town: r.town || null, postcode: r.postcode || null, is_primary: true });
    await supabase.from("tasks").insert({ title: `Research ${name}`, task_type: "research", entity_type: "employer", entity_id: e.id, employer_id: e.id, auto_generated: true, dedupe_key: `research:employer:${e.id}` });
    await supabase.from("import_rows").insert({ import_id: imp.id, row_no, raw: r, result: "created", entity_type: "employer", entity_id: e.id });
  }
  await supabase.from("imports").update({ created_count: created, duplicate_count: dup, rejected_count: rejected, completed_at: new Date().toISOString() }).eq("id", imp.id);
  revalidatePath("/employers");
  redirect(`/employers/import?import=${imp.id}`);
}
