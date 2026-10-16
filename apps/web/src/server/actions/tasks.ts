"use server";
import { revalidatePath } from "next/cache";
import { taskInputSchema } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";

export async function completeTask(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/");
  revalidatePath("/tasks");
}

export async function snoozeTask(id: string, days: number) {
  const { supabase } = await requireUser();
  const until = new Date(Date.now() + days * 86_400_000).toISOString();
  const { error } = await supabase.from("tasks").update({ status: "snoozed", snoozed_until: until, due_at: until }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function cancelTask(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("tasks").update({ status: "cancelled" }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function createTask(formData: FormData) {
  const { supabase } = await requireUser();
  const parsed = taskInputSchema.parse({
    title: formData.get("title"),
    task_type: formData.get("task_type") || "other",
    priority: formData.get("priority") || "normal",
    due_at: formData.get("due_at") || null,
    entity_type: formData.get("entity_type") || null,
    entity_id: formData.get("entity_id") || null,
    notes: formData.get("notes") || null,
  });
  const { error } = await supabase.from("tasks").insert({
    title: parsed.title,
    task_type: parsed.task_type,
    priority: parsed.priority,
    due_at: parsed.due_at ? new Date(parsed.due_at).toISOString() : null,
    entity_type: parsed.entity_type ?? null,
    entity_id: parsed.entity_id ?? null,
    employer_id: parsed.entity_type === "employer" ? parsed.entity_id ?? null : null,
    notes: parsed.notes ?? null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/tasks");
  revalidatePath("/");
}
