import { NextResponse } from "next/server";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";

// Documents are never public. This checks the signed-in user (RLS applies to the lookup), then redirects to a link that expires in a minute.
// Superseded and deleted versions stay reachable on purpose: a submitted application must still be able to show exactly what was sent.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Not signed in", { status: 401 });
  const { data: doc } = await supabase.from("documents").select("storage_bucket, storage_path, file_name").eq("id", id).maybeSingle();
  if (!doc) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await createServiceSupabase().storage.from(doc.storage_bucket).createSignedUrl(doc.storage_path, 60, { download: doc.file_name });
  if (error || !data) return new NextResponse("The stored file could not be found", { status: 404 });
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "Cache-Control": "no-store" } });
}
