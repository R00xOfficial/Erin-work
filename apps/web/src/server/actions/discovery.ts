"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { queueResearch } from "@/server/research-queue";

type Client = Awaited<ReturnType<typeof requireUser>>["supabase"];
const now = () => new Date().toISOString();

function refresh(...extra: string[]) {
  for (const p of ["/discovery", "/vacancies", "/employers", "/", ...extra]) revalidatePath(p);
}

/** Stage 2 picks up saved items from the research task list; open one per employer if it is not there already. */
async function ensureResearchTask(supabase: Client, employerId: string, name: string) {
  const dedupeKey = `research:employer:${employerId}`;
  const { data: existing } = await supabase.from("tasks").select("id").eq("dedupe_key", dedupeKey).in("status", ["open", "in_progress", "snoozed"]).limit(1);
  if (existing && existing.length > 0) return;
  await supabase.from("tasks").insert({ title: `Research ${name}`, task_type: "research", entity_type: "employer", entity_id: employerId, employer_id: employerId, auto_generated: true, dedupe_key: dedupeKey });
}

export async function saveVacancy(id: string) {
  const { supabase } = await requireUser();
  const { data: v, error } = await supabase.from("vacancies").update({ discovery_state: "saved", saved_at: now(), dismissed_at: null, dismissed_reason: null, reviewed_at: now() }).eq("id", id).select("employer_id, employer_name_raw").single();
  if (error) throw new Error(error.message);
  if (v.employer_id) {
    const { data: e } = await supabase.from("employers").select("legal_name, display_name").eq("id", v.employer_id).maybeSingle();
    await ensureResearchTask(supabase, v.employer_id, e?.display_name ?? e?.legal_name ?? v.employer_name_raw ?? "employer");
  }
  await queueResearch(supabase, "vacancy", id, { trigger: "saved" });
  refresh(`/vacancies/${id}`, "/research");
}

/** "Not interested". Leaves the vacancy's real status (open / closed / ...) and all history untouched. */
export async function dismissVacancy(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("vacancies").update({ discovery_state: "dismissed", dismissed_at: now(), reviewed_at: now() }).eq("id", id);
  if (error) throw new Error(error.message);
  refresh(`/vacancies/${id}`);
}

export async function restoreVacancy(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("vacancies").update({ discovery_state: "new", dismissed_at: null, dismissed_reason: null, saved_at: null }).eq("id", id);
  if (error) throw new Error(error.message);
  refresh(`/vacancies/${id}`);
}

export async function saveEmployer(id: string) {
  const { supabase } = await requireUser();
  const { data: e, error } = await supabase.from("employers").update({ discovery_state: "saved", saved_at: now(), dismissed_at: null, dismissed_reason: null, reviewed_at: now() }).eq("id", id).select("legal_name, display_name").single();
  if (error) throw new Error(error.message);
  await ensureResearchTask(supabase, id, e.display_name ?? e.legal_name);
  await queueResearch(supabase, "employer", id, { trigger: "saved" });
  refresh(`/employers/${id}`, "/research");
}

export async function dismissEmployer(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("employers").update({ discovery_state: "dismissed", dismissed_at: now(), reviewed_at: now() }).eq("id", id);
  if (error) throw new Error(error.message);
  refresh(`/employers/${id}`);
}

export async function restoreEmployer(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("employers").update({ discovery_state: "new", dismissed_at: null, dismissed_reason: null, saved_at: null }).eq("id", id);
  if (error) throw new Error(error.message);
  refresh(`/employers/${id}`);
}

export async function markEmployerReviewed(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("employers").update({ reviewed_at: now() }).eq("id", id);
  if (error) throw new Error(error.message);
  refresh();
}
