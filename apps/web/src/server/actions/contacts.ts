"use server";
import { revalidatePath } from "next/cache";
import { contactInputSchema, canonicaliseUrl, urlHash } from "@ajis/shared";
import type { TablesUpdate } from "@ajis/db";
import { requireUser } from "@/lib/supabase/server";

const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v : null; };

export async function createContact(formData: FormData) {
  const { supabase } = await requireUser();
  const input = contactInputSchema.parse({
    employer_id: s(formData, "employer_id"),
    office_id: s(formData, "office_id") || null,
    full_name: s(formData, "full_name"),
    role_title: s(formData, "role_title"),
    role_category: s(formData, "role_category") || "other",
    hiring_authority: s(formData, "hiring_authority") || "unknown",
    relevance_rank: Number(s(formData, "relevance_rank") || 5),
    email: s(formData, "email"),
    linkedin_url: s(formData, "linkedin_url"),
    phone: s(formData, "phone"),
    official_profile_url: s(formData, "official_profile_url"),
    source_url: s(formData, "source_url"),
    notes: s(formData, "notes"),
  });
  let sourceId: string | null = null;
  const src = input.source_url ?? input.official_profile_url;
  if (src) {
    const canon = canonicaliseUrl(src);
    if (canon) {
      const { data } = await supabase.from("sources").upsert({ url: src, url_hash: urlHash(canon), canonical_url: canon, evidence_type: "primary_official", confidence: 60, entity_type: "contact" }, { onConflict: "url_hash" }).select("id").single();
      sourceId = data?.id ?? null;
    }
  }
  const { data, error } = await supabase.from("contacts").insert({
    employer_id: input.employer_id,
    office_id: input.office_id ?? null,
    full_name: input.full_name,
    role_title: input.role_title,
    role_category: input.role_category,
    hiring_authority: input.hiring_authority,
    relevance_rank: input.relevance_rank,
    email: input.email,
    email_source: input.email ? (input.source_url ?? "entered manually") : null,
    linkedin_url: input.linkedin_url,
    phone: input.phone,
    official_profile_url: input.official_profile_url,
    source_id: sourceId,
    evidence_status: sourceId ? "source_supported_summary" : "unverified",
    notes: input.notes,
  }).select("id").single();
  if (error) throw new Error(error.message);
  if (sourceId) await supabase.from("sources").update({ entity_id: data.id }).eq("id", sourceId);
  revalidatePath(`/employers/${input.employer_id}`);
  revalidatePath("/contacts");
}

export async function updateContact(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  const patch: Record<string, unknown> = {};
  for (const f of ["full_name", "role_title", "role_category", "hiring_authority", "department", "email", "email_source", "email_verification", "linkedin_url", "phone", "official_profile_url", "preferred_channel", "relationship_status", "notes", "relevance_notes"]) {
    if (formData.has(f)) { const v = s(formData, f); patch[f] = v === "" ? null : v; }
  }
  if (formData.has("relevance_rank")) patch.relevance_rank = Number(s(formData, "relevance_rank")) || 5;
  if (patch.email_verification === "confirmed_by_reply") patch.email_verified_at = new Date().toISOString();
  const { data, error } = await supabase.from("contacts").update(patch as TablesUpdate<"contacts">).eq("id", id).select("employer_id").single();
  if (error) throw new Error(error.message);
  revalidatePath(`/employers/${data.employer_id}`);
  revalidatePath(`/contacts/${id}`);
  revalidatePath("/contacts");
}

export async function setDoNotContact(id: string, reason: string) {
  const { supabase } = await requireUser();
  const { data: c, error } = await supabase.from("contacts").select("employer_id, email").eq("id", id).single();
  if (error) throw new Error(error.message);
  const { error: e2 } = await supabase.from("suppressions").insert({ scope: "contact", value: id, contact_id: id, employer_id: c.employer_id, reason: reason as "opt_out" | "requested_no_contact" | "user_decision", source_description: "Set from contact page" });
  if (e2 && !e2.message.includes("duplicate")) throw new Error(e2.message);
  if (c.email) {
    const { error: e3 } = await supabase.from("suppressions").insert({ scope: "email", value: c.email.toLowerCase(), contact_id: id, employer_id: c.employer_id, reason: reason as "opt_out" | "requested_no_contact" | "user_decision", source_description: "Set from contact page" });
    if (e3 && !e3.message.includes("duplicate")) throw new Error(e3.message);
  }
  revalidatePath(`/contacts/${id}`);
  revalidatePath(`/employers/${c.employer_id}`);
  revalidatePath("/contacts");
}

export async function deleteContact(id: string) {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("contacts").update({ deleted_at: new Date().toISOString() }).eq("id", id).select("employer_id").single();
  if (error) throw new Error(error.message);
  revalidatePath(`/employers/${data.employer_id}`);
  revalidatePath("/contacts");
}
