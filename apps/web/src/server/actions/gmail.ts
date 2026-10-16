"use server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";
import { requestJob } from "@/server/actions/jobs";

const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify", "openid", "email"];

export async function startGmailConnect() {
  await requireUser();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri) throw new Error("Google OAuth is not configured");
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("ajis_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  if (process.env.OUTREACH_MAILBOX) url.searchParams.set("login_hint", process.env.OUTREACH_MAILBOX);
  redirect(url.toString());
}

export async function disconnectGmail() {
  await requireUser();
  const service = createServiceSupabase();
  // Mark revoked rather than delete so history (last_history_id) survives a reconnect.
  const { error } = await service.schema("private" as never).from("oauth_credentials" as never).update({ status: "revoked", encrypted_access_token: null, encrypted_refresh_token: null } as never).eq("provider", "gmail");
  if (error) throw new Error(error.message);
  revalidatePath("/settings/gmail");
}

export async function requestGmailSync() {
  await requestJob("gmail.sync", { manual: true }, "gmail:sync");
  revalidatePath("/settings/gmail");
}
