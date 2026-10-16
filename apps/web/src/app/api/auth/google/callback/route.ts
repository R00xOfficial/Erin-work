import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { encrypt, loadKey } from "@ajis/shared";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * OAuth code exchange. Runs server-side only. Stores AES-GCM encrypted tokens in private.oauth_credentials
 * via the service role; the worker decrypts them with the same TOKEN_ENC_KEY.
 */
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/login", req.url));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  const jar = await cookies();
  const expected = jar.get("ajis_oauth_state")?.value;
  jar.delete("ajis_oauth_state");
  const fail = (msg: string) => NextResponse.redirect(new URL(`/settings/gmail?error=${encodeURIComponent(msg)}`, req.url));
  if (err) return fail(`Google returned: ${err}`);
  if (!code || !state || state !== expected) return fail("Invalid OAuth state");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return fail("Google OAuth is not configured");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!tokenRes.ok) return fail(`Token exchange failed (${tokenRes.status})`);
  const tokens = (await tokenRes.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope: string; id_token?: string };
  if (!tokens.refresh_token) return fail("Google did not return a refresh token; remove the app's access at myaccount.google.com/permissions and try again");

  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${tokens.access_token}` } });
  const info = infoRes.ok ? ((await infoRes.json()) as { email?: string }) : {};
  const email = info.email?.toLowerCase();
  if (!email) return fail("Could not read the connected account's email");
  const expectedMailbox = process.env.OUTREACH_MAILBOX?.toLowerCase();
  if (expectedMailbox && email !== expectedMailbox) return fail(`Connected ${email} but OUTREACH_MAILBOX is ${expectedMailbox}. Sign in with the right account.`);

  const key = loadKey(process.env.TOKEN_ENC_KEY);
  const service = createServiceSupabase();
  const row = {
    provider: "gmail",
    account_email: email,
    encrypted_refresh_token: `\\x${encrypt(tokens.refresh_token, key).toString("hex")}`,
    encrypted_access_token: `\\x${encrypt(tokens.access_token, key).toString("hex")}`,
    access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    scopes: tokens.scope.split(" "),
    status: "active",
    last_error: null,
    connected_at: new Date().toISOString(),
  };
  const { error } = await service.schema("private" as never).from("oauth_credentials" as never).upsert(row as never, { onConflict: "provider,account_email" } as never);
  if (error) return fail(error.message);
  await supabase.from("job_requests").insert({ job_name: "gmail.sync", payload: { initial: true }, singleton_key: "gmail:sync" });
  return NextResponse.redirect(new URL("/settings/gmail?connected=1", req.url));
}
