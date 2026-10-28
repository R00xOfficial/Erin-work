import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { all } from "@/server/insights";

// Full portable copy of Erin's data: employers, offices, contacts, vacancies, research, priorities, applications and their history, feedback and a
// manifest of stored documents with SHA-256 hashes (the files themselves stay in private storage; the manifest lets a restore be verified).
// Excluded on purpose: OAuth tokens, API keys, raw email bodies from the mailbox sync and AI prompt/response logs.
const TABLES = ["employers", "offices", "contacts", "vacancies", "research_notes", "assessments", "priority_items", "applications", "application_checklist_items", "application_followups", "application_drafts", "application_feedback", "interviews", "tasks", "stage_transitions", "insight_recommendations", "profile_suggestions", "strategy_changes", "insight_reports", "reusable_snippets", "candidate_profile"] as const;

export async function GET() {
  const supabase = await createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Not signed in", { status: 401 });
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), format_version: 1 };
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    const rows = await all((f, to) => supabase.from(t).select("*").order("id", { ascending: true }).range(f, to));
    out[t] = rows; counts[t] = rows.length;
  }
  const docs = await all((f, to) => supabase.from("documents").select("id, kind, version_label, file_name, storage_path, sha256, size_bytes, is_current, created_at, deleted_at").order("created_at").range(f, to));
  out.document_manifest = docs; counts.document_manifest = docs.length;
  out.row_counts = counts;
  await supabase.from("export_history").insert({ kind: "everything", sections: Object.keys(counts), row_counts: counts });
  return new NextResponse(JSON.stringify(out), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="erin-work-full-export-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" } });
}
