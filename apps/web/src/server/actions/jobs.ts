"use server";
import type { Json } from "@ajis/db";
import { requireUser } from "@/lib/supabase/server";

/**
 * The web app never talks to pg-boss directly. It inserts a job_requests row that the worker
 * drains every 30 seconds (see apps/worker/src/lib/job_requests.ts).
 */
export async function requestJob(jobName: string, payload: Record<string, unknown>, singletonKey?: string) {
  const { supabase } = await requireUser();
  if (singletonKey) {
    const { data: existing } = await supabase.from("job_requests").select("id").eq("singleton_key", singletonKey).eq("status", "pending").limit(1);
    if (existing && existing.length > 0) return existing[0]!.id;
  }
  const { data, error } = await supabase.from("job_requests").insert({ job_name: jobName, payload: payload as Json, singleton_key: singletonKey ?? null }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}
