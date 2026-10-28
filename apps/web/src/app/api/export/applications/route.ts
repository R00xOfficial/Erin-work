import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

// A portable copy of application history for backup: records, timeline, interviews, follow-ups, drafts and a manifest of document versions
// with their SHA-256 hashes. The files themselves stay in private storage; the manifest lets a restore be checked against them.
export async function GET() {
  const supabase = await createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Not signed in", { status: 401 });
  const q = async <T,>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) => { const { data, error } = await p; if (error) throw new Error(error.message); return data ?? []; };
  const [applications, checklist, interviews, followups, drafts, activities, documents, snippets] = await Promise.all([
    q(supabase.from("applications").select("*")), q(supabase.from("application_checklist_items").select("*")), q(supabase.from("interviews").select("*")), q(supabase.from("application_followups").select("*")),
    q(supabase.from("application_drafts").select("*")), q(supabase.from("activities").select("id, employer_id, application_id, activity_type, direction, channel, subject, body_text, occurred_at, sent_at, origin, confirmation, delivery_result, approval_status")),
    q(supabase.from("documents").select("id, kind, version_label, file_name, storage_path, sha256, size_bytes, is_current, created_at, deleted_at")), q(supabase.from("reusable_snippets").select("*")),
  ]);
  const body = JSON.stringify({ exported_at: new Date().toISOString(), applications, checklist, interviews, followups, drafts, activities, document_manifest: documents, reusable_snippets: snippets }, null, 2);
  return new NextResponse(body, { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="applications-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" } });
}
