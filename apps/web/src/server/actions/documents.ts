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
  // Check the file's real contents, not just its name: only PDF and Word documents are accepted.
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const isPdf = bytes.subarray(0, 5).toString("latin1") === "%PDF-", isZip = bytes[0] === 0x50 && bytes[1] === 0x4b, isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf;
  if (!((ext === "pdf" && isPdf) || (ext === "docx" && isZip) || (ext === "doc" && isOle))) throw new Error("Only PDF, DOC and DOCX files are accepted, and the file contents must match its type.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  // The content hash is part of the path, so a stored file is never overwritten: a submitted application keeps pointing at exactly the bytes it was sent with.
  const path = `${input.kind}/${input.version_label.replace(/[^\w.\-]+/g, "_")}/${sha256.slice(0, 12)}-${safeName}`;
  const service = createServiceSupabase();
  const { error: upErr } = await service.storage.from("documents").upload(path, bytes, { contentType: file.type || "application/octet-stream", upsert: false });
  if (upErr && !/already exists|Duplicate/i.test(upErr.message)) throw new Error(upErr.message);
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

// Reusable wording (availability, right-to-work, standard answers). Drafting only uses a snippet after Erin has approved the current wording;
// editing it withdraws that approval.
const SNIPPET_KINDS = ["answer", "bio", "availability", "right_to_work", "salary", "other"] as const;
export async function saveSnippet(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id") ?? ""), label = String(formData.get("label") ?? "").trim(), body = String(formData.get("body") ?? "").trim();
  const kind = SNIPPET_KINDS.find((k) => k === formData.get("kind")) ?? "other";
  if (!label || !body) throw new Error("Give the snippet a label and some text.");
  const { error } = id ? await supabase.from("reusable_snippets").update({ label, body, kind, approved_at: null }).eq("id", id) : await supabase.from("reusable_snippets").insert({ label, body, kind });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/documents");
}
export async function approveSnippet(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("reusable_snippets").update({ approved_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/documents");
}
export async function deleteSnippet(id: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("reusable_snippets").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/documents");
}
