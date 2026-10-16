"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { requestJob } from "@/server/actions/jobs";

export async function runSourceNow(code: string) {
  await requestJob(`discovery.${code}`, { sourceCode: code, manual: true }, `discovery:${code}`);
  revalidatePath("/sources");
}

export async function toggleSource(id: string, enabled: boolean) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("source_definitions").update({ enabled, disabled_reason: enabled ? null : "Disabled from dashboard", consecutive_failures: enabled ? 0 : undefined }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/sources");
}
