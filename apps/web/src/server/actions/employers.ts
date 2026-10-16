"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { employerInputSchema, stageChangeSchema, officeInputSchema, suppressionInputSchema, canonicaliseUrl, urlHash, normaliseCompanyName, extractDomain, EMPLOYER_OUTREACH_STAGES } from "@ajis/shared";
import type { TablesUpdate } from "@ajis/db";
import { requireUser } from "@/lib/supabase/server";
import { requestJob } from "@/server/actions/jobs";

function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return typeof v === "string" ? v : null;
}

export async function createEmployer(formData: FormData) {
  const { supabase } = await requireUser();
  const input = employerInputSchema.parse({
    legal_name: str(formData, "legal_name"),
    display_name: str(formData, "display_name"),
    website: str(formData, "website"),
    careers_url: str(formData, "careers_url"),
    linkedin_url: str(formData, "linkedin_url"),
    companies_house_number: str(formData, "companies_house_number"),
    practice_type: str(formData, "practice_type") || "architecture_practice",
    size_band: str(formData, "size_band") || "unknown",
    sectors: (str(formData, "sectors") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    generic_email: str(formData, "generic_email"),
    applications_email: str(formData, "applications_email"),
    notes: str(formData, "notes"),
    source_url: str(formData, "source_url"),
    town: str(formData, "town"),
    postcode: str(formData, "postcode"),
  });

  // Duplicate check: CH number, domain, normalised name.
  const norm = normaliseCompanyName(input.legal_name);
  const domain = extractDomain(input.website);
  const dupQuery = supabase.from("employers").select("id, legal_name").is("deleted_at", null);
  const ors: string[] = [`normalised_name.eq.${norm}`];
  if (domain) ors.push(`website_domain.eq.${domain}`);
  if (input.companies_house_number) ors.push(`companies_house_number.eq.${input.companies_house_number.toUpperCase().padStart(8, "0")}`);
  const { data: dups } = await dupQuery.or(ors.join(","));
  if (dups && dups.length > 0) redirect(`/employers/${dups[0]!.id}?duplicate=1`);

  let sourceId: string | null = null;
  if (input.source_url) {
    const canon = canonicaliseUrl(input.source_url);
    if (canon) {
      const { data: src } = await supabase
        .from("sources")
        .upsert({ url: input.source_url, url_hash: urlHash(canon), canonical_url: canon, evidence_type: "user_provided", confidence: 60, entity_type: "employer" }, { onConflict: "url_hash" })
        .select("id")
        .single();
      sourceId = src?.id ?? null;
    }
  }
  const { data: emp, error } = await supabase
    .from("employers")
    .insert({
      legal_name: input.legal_name,
      normalised_name: norm,
      display_name: input.display_name,
      website: input.website,
      careers_url: input.careers_url,
      linkedin_url: input.linkedin_url,
      companies_house_number: input.companies_house_number,
      practice_type: input.practice_type,
      size_band: input.size_band,
      sectors: input.sectors,
      generic_email: input.generic_email,
      applications_email: input.applications_email,
      research_notes: input.notes,
      discovered_via_source_id: sourceId,
      outreach_stage: "awaiting_research",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (sourceId) await supabase.from("sources").update({ entity_id: emp.id }).eq("id", sourceId);
  if (input.town || input.postcode) {
    await supabase.from("offices").insert({ employer_id: emp.id, town: input.town, postcode: input.postcode, is_primary: true, status: "unverified" });
  }
  await supabase.from("tasks").insert({
    title: `Research ${input.legal_name}`,
    task_type: "research",
    entity_type: "employer",
    entity_id: emp.id,
    employer_id: emp.id,
    auto_generated: true,
    dedupe_key: `research:employer:${emp.id}`,
    due_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  });
  if (input.companies_house_number || input.legal_name) await requestJob("enrich.companies_house", { employerId: emp.id }, `ch:${emp.id}`);
  revalidatePath("/employers");
  redirect(`/employers/${emp.id}`);
}

export async function updateEmployer(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  const patch: Record<string, unknown> = {};
  const fields = ["legal_name", "display_name", "website", "careers_url", "linkedin_url", "instagram_url", "companies_house_number", "practice_type", "size_band", "generic_email", "applications_email", "research_notes", "vision_culture", "project_intelligence", "recruitment_intelligence", "hires_part1", "has_graduate_programme", "accepts_speculative", "riba_chartered", "staff_estimate", "training_support", "recruitment_channel", "data_quality"];
  for (const f of fields) {
    if (formData.has(f)) {
      const v = str(formData, f);
      patch[f] = v === "" ? null : v;
    }
  }
  for (const arr of ["sectors", "software", "specialisms", "typical_entry_roles"]) {
    if (formData.has(arr)) patch[arr] = (str(formData, arr) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (patch.staff_estimate != null) patch.staff_estimate = Number(patch.staff_estimate) || null;
  if (formData.has("confidence_score")) patch.confidence_score = Number(str(formData, "confidence_score")) || 0;
  if (formData.get("mark_checked") === "on") patch.last_checked_at = new Date().toISOString();
  const { error } = await supabase.from("employers").update(patch as TablesUpdate<"employers">).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/employers/${id}`);
  revalidatePath("/employers");
}

export async function changeEmployerStage(formData: FormData) {
  const { supabase } = await requireUser();
  const input = stageChangeSchema.parse({ id: str(formData, "id"), stage: str(formData, "stage"), note: str(formData, "note") });
  if (!EMPLOYER_OUTREACH_STAGES.includes(input.stage)) throw new Error("Unknown stage");
  const { error } = await supabase.from("employers").update({ outreach_stage: input.stage }).eq("id", input.id);
  if (error) throw new Error(error.message);
  if (input.note) {
    await supabase.from("activities").insert({ employer_id: input.id, activity_type: "note", direction: "internal", channel: "system", body_text: `Stage → ${input.stage}: ${input.note}` });
  }
  await requestJob("scoring.recompute", { employerId: input.id }, `score:${input.id}`);
  revalidatePath(`/employers/${input.id}`);
  revalidatePath("/employers");
  revalidatePath("/");
}

export async function suppressEmployer(formData: FormData) {
  const { supabase } = await requireUser();
  const input = suppressionInputSchema.parse({ scope: "employer", value: str(formData, "id"), reason: str(formData, "reason") || "user_decision", employer_id: str(formData, "id"), lawful_basis_note: str(formData, "note") });
  const { error } = await supabase.from("suppressions").insert({ scope: "employer", value: input.value, reason: input.reason, employer_id: input.employer_id ?? null, lawful_basis_note: input.lawful_basis_note ?? null, source_description: "Suppressed from employer page" });
  if (error && !error.message.includes("duplicate")) throw new Error(error.message);
  revalidatePath(`/employers/${input.value}`);
  revalidatePath("/employers");
}

export async function addOffice(formData: FormData) {
  const { supabase } = await requireUser();
  const input = officeInputSchema.parse({
    employer_id: str(formData, "employer_id"),
    label: str(formData, "label"),
    address_line1: str(formData, "address_line1"),
    address_line2: str(formData, "address_line2"),
    town: str(formData, "town"),
    county: str(formData, "county"),
    postcode: str(formData, "postcode"),
    office_type: str(formData, "office_type") || "studio",
    working_arrangement: str(formData, "working_arrangement") || "unknown",
    phone: str(formData, "phone"),
    email: str(formData, "email"),
    is_primary: formData.get("is_primary") === "on",
  });
  const { data, error } = await supabase.from("offices").insert({ ...input, status: input.postcode ? "active" : "unverified", evidence_status: "unverified" }).select("id").single();
  if (error) throw new Error(error.message);
  if (input.postcode) await requestJob("enrich.geocode", { officeId: data.id }, `geocode:${data.id}`);
  revalidatePath(`/employers/${input.employer_id}`);
}

export async function updateOffice(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  const patch: Record<string, unknown> = {};
  for (const f of ["label", "address_line1", "address_line2", "town", "county", "postcode", "office_type", "working_arrangement", "phone", "email", "status", "transport_notes"]) {
    if (formData.has(f)) { const v = str(formData, f); patch[f] = v === "" ? null : v; }
  }
  if (formData.has("is_primary")) patch.is_primary = formData.get("is_primary") === "on";
  if (formData.get("mark_verified") === "on") { patch.last_verified_at = new Date().toISOString(); patch.evidence_status = "verified_fact"; patch.status = "active"; }
  const { data, error } = await supabase.from("offices").update(patch as TablesUpdate<"offices">).eq("id", id).select("employer_id, postcode").single();
  if (error) throw new Error(error.message);
  if (patch.postcode) await requestJob("enrich.geocode", { officeId: id }, `geocode:${id}`);
  revalidatePath(`/employers/${data.employer_id}`);
}

export async function deleteOffice(id: string, employerId: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("offices").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/employers/${employerId}`);
}

export async function requestBriefing(employerId: string) {
  await requestJob("ai.employer_briefing", { employerId }, `briefing:${employerId}`);
  revalidatePath(`/employers/${employerId}`);
}

export async function requestRescore(employerId: string) {
  await requestJob("scoring.recompute", { employerId }, `score:${employerId}`);
  revalidatePath(`/employers/${employerId}`);
}

export async function addEmployerNote(formData: FormData) {
  const { supabase } = await requireUser();
  const employerId = str(formData, "employer_id")!;
  const body = (str(formData, "body") ?? "").trim();
  if (!body) return;
  const type = (str(formData, "activity_type") ?? "note") as "note" | "research" | "call" | "linkedin_message" | "meeting";
  const { error } = await supabase.from("activities").insert({ employer_id: employerId, contact_id: str(formData, "contact_id") || null, activity_type: type, direction: type === "note" || type === "research" ? "internal" : "outbound", channel: type === "call" ? "phone" : type === "linkedin_message" ? "linkedin" : type === "meeting" ? "in_person" : "system", body_text: body });
  if (error) throw new Error(error.message);
  revalidatePath(`/employers/${employerId}`);
}

export async function mergeEmployers(keepId: string, mergeId: string) {
  const { supabase } = await requireUser();
  if (keepId === mergeId) return;
  const { data: merged } = await supabase.from("employers").select("legal_name, display_name").eq("id", mergeId).single();
  for (const table of ["offices", "contacts", "vacancies", "applications", "activities", "hiring_signals", "research_notes", "employer_scores", "tasks", "planning_applications"] as const) {
    const { error } = await supabase.from(table).update({ employer_id: keepId }).eq("employer_id", mergeId);
    if (error && !error.message.includes("duplicate")) throw new Error(`${table}: ${error.message}`);
  }
  if (merged) {
    await supabase.from("employer_aliases").upsert({ employer_id: keepId, alias: merged.legal_name, normalised_alias: normaliseCompanyName(merged.legal_name) }, { onConflict: "normalised_alias" });
  }
  await supabase.from("employers").update({ deleted_at: new Date().toISOString(), record_status: `merged_into:${keepId}` }).eq("id", mergeId);
  revalidatePath("/employers");
  revalidatePath("/data-quality");
  redirect(`/employers/${keepId}`);
}
