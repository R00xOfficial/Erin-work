"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { documentInputSchema, type DocumentKind } from "@ajis/shared";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";

export async function uploadDocument(formData: FormData) {
  const { supabase } = await requireUser();
  const input = documentInputSchema.parse({ kind: formData.get("kind"), version_label: formData.get("version_label"), notes: formData.get("notes") || null });
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file");
  if (file.size > 25 * 1024 * 1024) throw new Error("File too large (25 MB max)");
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${input.kind}/${input.version_label.replace(/[^\w.\-]+/g, "_")}/${safeName}`;
  const service = createServiceSupabase();
  const { error: upErr } = await service.storage.from("documents").upload(path, bytes, { contentType: file.type || "application/octet-stream", upsert: true });
  if (upErr) throw new Error(upErr.message);
  const makeCurrent = formData.get("is_current") === "on";
  if (makeCurrent) await supabase.from("documents").update({ is_current: false }).eq("kind", input.kind).eq("is_current", true);
  const { error } = await supabase.from("documents").insert({ kind: input.kind, version_label: input.version_label, storage_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size, sha256, is_current: makeCurrent, notes: input.notes ?? null });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/documents");
}

export async function setCurrentDocument(id: string, kind: DocumentKind) {
  const { supabase } = await requireUser();
  await supabase.from("documents").update({ is_current: false }).eq("kind", kind).eq("is_current", true);
  const { error } = await supabase.from("documents").update({ is_current: true }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/documents");
}

export async function deleteDocument(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("documents").update({ deleted_at: new Date().toISOString(), is_current: false }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/documents");
}

export async function documentSignedUrl(path: string) {
  const service = createServiceSupabase();
  const { data, error } = await service.storage.from("documents").createSignedUrl(path, 600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
