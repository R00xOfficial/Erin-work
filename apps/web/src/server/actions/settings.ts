"use server";
import { revalidatePath } from "next/cache";
import { candidateProfileSchema, settingSchemas, validateWeights, SCORE_FACTORS, type SettingKey, ROLE_FAMILIES, EMPLOYMENT_TYPES } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { requestJob } from "@/server/actions/jobs";

const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" && v.trim() !== "" ? v.trim() : null; };
const list = (v: string | null) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export async function saveProfile(formData: FormData) {
  const { supabase } = await requireUser();
  const { data: current } = await supabase.from("candidate_profile").select("home_postcode").eq("id", true).maybeSingle();
  const parsed = candidateProfileSchema.parse({
    full_name: s(formData, "full_name"),
    email: s(formData, "email"),
    phone: s(formData, "phone"),
    qualification: s(formData, "qualification") ?? "part1_equivalent",
    qualification_verified: formData.get("qualification_verified") === "on",
    university: s(formData, "university"),
    graduation_year: s(formData, "graduation_year") ? Number(s(formData, "graduation_year")) : null,
    experience_years: Number(s(formData, "experience_years") ?? 0),
    experience_summary: s(formData, "experience_summary"),
    software: list(s(formData, "software")),
    skills: list(s(formData, "skills")),
    sector_interests: list(s(formData, "sector_interests")),
    target_role_families: formData.getAll("target_role_families").filter((x): x is string => typeof x === "string" && (ROLE_FAMILIES as readonly string[]).includes(x)),
    accept_adjacent_entry_roles: formData.get("accept_adjacent_entry_roles") === "on",
    accepted_employment_types: formData.getAll("accepted_employment_types").filter((x): x is string => typeof x === "string" && (EMPLOYMENT_TYPES as readonly string[]).includes(x)),
    working_arrangement_preference: s(formData, "working_arrangement_preference") ?? "unknown",
    objective: s(formData, "objective") ?? "get_into_work_fast",
    home_postcode: s(formData, "home_postcode"),
    max_public_transport_minutes: Number(s(formData, "max_public_transport_minutes") ?? 90),
    max_car_minutes: s(formData, "max_car_minutes") ? Number(s(formData, "max_car_minutes")) : null,
    min_salary_gbp: s(formData, "min_salary_gbp") ? Number(s(formData, "min_salary_gbp")) : null,
    has_uk_right_to_work: formData.get("has_uk_right_to_work") === "on",
    availability_from: s(formData, "availability_from"),
    portfolio_url: s(formData, "portfolio_url"),
    linkedin_url: s(formData, "linkedin_url"),
  });
  const { error } = await supabase.from("candidate_profile").upsert({ id: true, ...parsed }, { onConflict: "id" });
  if (error) throw new Error(error.message);
  if (parsed.home_postcode && parsed.home_postcode !== current?.home_postcode) {
    // Home moved: geocode home and recompute every office's travel time.
    await requestJob("enrich.geocode", { home: true }, "geocode:home");
    await requestJob("enrich.travel_time", { all: true }, "travel:all");
  }
  await requestJob("scoring.recompute", { all: true }, "score:all");
  revalidatePath("/settings/profile");
  revalidatePath("/");
}

export async function saveSetting(key: SettingKey, raw: unknown) {
  const { supabase } = await requireUser();
  const schema = settingSchemas[key];
  const value = schema.parse(raw);
  const { error } = await supabase.from("settings").upsert({ key, value: value as never }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/caps");
  revalidatePath("/settings/gmail");
  revalidatePath("/");
}

export async function saveCaps(formData: FormData) {
  await saveSetting("daily_send_cap", Number(formData.get("daily_send_cap")));
  await saveSetting("weekly_send_cap", Number(formData.get("weekly_send_cap")));
  await saveSetting("follow_up_days", Number(formData.get("follow_up_days")));
  await saveSetting("approval_ttl_hours", Number(formData.get("approval_ttl_hours")));
  await saveSetting("ai_daily_cap", Number(formData.get("ai_daily_cap")));
  await saveSetting("daily_research_target", Number(formData.get("daily_research_target")));
}

export async function setStopSwitch(on: boolean) {
  await saveSetting("stop_switch", on);
}
export async function setDryRun(on: boolean) {
  await saveSetting("dry_run", on);
}

export async function saveWeights(formData: FormData) {
  const { supabase } = await requireUser();
  const weights: Record<string, number> = {};
  for (const f of SCORE_FACTORS) weights[f] = Number(formData.get(f) ?? 0);
  const validated = validateWeights(weights);
  const thresholds = { A: Number(formData.get("band_A") ?? 70), B: Number(formData.get("band_B") ?? 50), minConfidence: Number(formData.get("minConfidence") ?? 40), maxUnknownFactors: Number(formData.get("maxUnknownFactors") ?? 3) };
  const { data: latest } = await supabase.from("scoring_weights").select("version").order("version", { ascending: false }).limit(1).single();
  const version = (latest?.version ?? 0) + 1;
  await supabase.from("scoring_weights").update({ is_active: false }).eq("is_active", true);
  const { error } = await supabase.from("scoring_weights").insert({ version, weights: validated, band_thresholds: thresholds, is_active: true, notes: s(formData, "notes") });
  if (error) throw new Error(error.message);
  await saveSetting("scoring_weights_version", version);
  await requestJob("scoring.recompute", { all: true }, "score:all");
  revalidatePath("/settings/scoring");
}

export async function saveGeoZone(code: string, formData: FormData) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("geo_zones").update({
    postcode_areas: list(s(formData, "postcode_areas")).map((x) => x.toUpperCase()),
    postcode_districts: list(s(formData, "postcode_districts")).map((x) => x.toUpperCase()),
    towns: list(s(formData, "towns")),
    max_pt_minutes: Number(s(formData, "max_pt_minutes") ?? 90),
  }).eq("code", code);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/geography");
}

export async function saveTemplate(formData: FormData) {
  const { supabase } = await requireUser();
  const code = s(formData, "code")!;
  const purpose = s(formData, "purpose")!;
  const subject = s(formData, "subject_tmpl") ?? "";
  const body = s(formData, "body_tmpl") ?? "";
  const vars = [...new Set([...subject.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g), ...body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!))];
  const { data: latest } = await supabase.from("email_templates").select("version").eq("code", code).order("version", { ascending: false }).limit(1).maybeSingle();
  await supabase.from("email_templates").update({ is_active: false }).eq("code", code);
  const { error } = await supabase.from("email_templates").insert({ code, version: (latest?.version ?? 0) + 1, purpose: purpose as "speculative", subject_tmpl: subject, body_tmpl: body, variables: vars, is_active: true, notes: s(formData, "notes") });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/templates");
}
