import { google, type gmail_v1 } from "googleapis";
import { decrypt, encrypt, loadKey } from "@ajis/shared";
import { sql, db } from "../db.js";
import { env } from "../env.js";
import { logger } from "../logger.js";

export interface GmailCredential { id: string; account_email: string; status: "active" | "needs_reauth" | "revoked"; last_history_id: string | null; scopes: string[] }

interface CredRow { id: string; account_email: string; status: "active" | "needs_reauth" | "revoked"; last_history_id: string | null; scopes: string[]; encrypted_refresh_token: Uint8Array | null; encrypted_access_token: Uint8Array | null; access_token_expires_at: string | null }

/** Loads the active Gmail credential from the private schema via the direct Postgres connection. */
export async function loadCredential(): Promise<CredRow | null> {
  const rows = await sql()<CredRow[]>`select id, account_email, status, last_history_id, scopes, encrypted_refresh_token, encrypted_access_token, access_token_expires_at from private.oauth_credentials where provider = 'gmail' order by connected_at desc limit 1`;
  return rows[0] ?? null;
}

export async function markCredential(id: string, patch: { status?: string; last_error?: string | null; last_history_id?: string; last_sync_at?: Date }) {
  await sql()`update private.oauth_credentials set
    status = coalesce(${patch.status ?? null}::public.oauth_status, status),
    last_error = ${patch.last_error === undefined ? null : patch.last_error},
    last_history_id = coalesce(${patch.last_history_id ?? null}, last_history_id),
    last_sync_at = coalesce(${patch.last_sync_at ?? null}, last_sync_at)
    where id = ${id}`;
}

async function onReauthNeeded(id: string, reason: string) {
  await markCredential(id, { status: "needs_reauth", last_error: reason });
  await db().from("tasks").insert({ title: "Gmail needs re-authorising — outreach is paused until you reconnect in Settings → Gmail", task_type: "gmail_reauth", priority: "high", auto_generated: true, dedupe_key: "gmail_reauth" });
  logger.warn({ reason }, "gmail credential needs reauth");
}

/** Returns an authenticated Gmail client, refreshing and re-encrypting the access token when needed. */
export async function gmailClient(): Promise<{ gmail: gmail_v1.Gmail; cred: CredRow; reason?: undefined } | { gmail: null; cred: CredRow | null; reason: string }> {
  const cred = await loadCredential();
  if (!cred) return { gmail: null, cred: null, reason: "no gmail credential" };
  if (cred.status !== "active") return { gmail: null, cred, reason: `credential ${cred.status}` };
  if (!cred.encrypted_refresh_token) { await onReauthNeeded(cred.id, "missing refresh token"); return { gmail: null, cred, reason: "missing refresh token" }; }
  const e = env();
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) return { gmail: null, cred, reason: "GOOGLE_CLIENT_ID/SECRET not set" };
  const key = loadKey(e.TOKEN_ENC_KEY);
  const oauth2 = new google.auth.OAuth2(e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET);
  const refresh = decrypt(cred.encrypted_refresh_token, key);
  const access = cred.encrypted_access_token ? decrypt(cred.encrypted_access_token, key) : undefined;
  oauth2.setCredentials({ refresh_token: refresh, access_token: access, expiry_date: cred.access_token_expires_at ? new Date(cred.access_token_expires_at).getTime() : undefined });
  oauth2.on("tokens", async (tokens) => {
    try {
      if (tokens.access_token) {
        await sql()`update private.oauth_credentials set encrypted_access_token = ${encrypt(tokens.access_token, key)}, access_token_expires_at = ${tokens.expiry_date ? new Date(tokens.expiry_date) : null} where id = ${cred.id}`;
      }
      if (tokens.refresh_token) await sql()`update private.oauth_credentials set encrypted_refresh_token = ${encrypt(tokens.refresh_token, key)} where id = ${cred.id}`;
    } catch (err) { logger.error({ err }, "failed to persist refreshed token"); }
  });
  try {
    if (!access || !cred.access_token_expires_at || new Date(cred.access_token_expires_at).getTime() < Date.now() + 60_000) await oauth2.getAccessToken();
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (/invalid_grant|unauthorized_client|revoked/i.test(msg)) await onReauthNeeded(cred.id, msg);
    return { gmail: null, cred, reason: msg };
  }
  return { gmail: google.gmail({ version: "v1", auth: oauth2 }), cred };
}

export const LABELS = { root: "AJIS", sent: "AJIS/Sent", reply: "AJIS/Reply", alert: "AJIS/Alert" } as const;

/** Creates the AJIS labels once and caches their ids in settings.gmail_labels. */
export async function ensureLabels(gmail: gmail_v1.Gmail): Promise<Record<string, string>> {
  const { data: setting } = await db().from("settings").select("value").eq("key", "gmail_labels").maybeSingle();
  const cached = (setting?.value as Record<string, string> | null) ?? {};
  if (Object.values(LABELS).every((l) => cached[l])) return cached;
  const { data } = await gmail.users.labels.list({ userId: "me" });
  const byName = new Map((data.labels ?? []).map((l) => [l.name!, l.id!]));
  const out: Record<string, string> = { ...cached };
  for (const name of Object.values(LABELS)) {
    const existingId = byName.get(name);
    if (existingId) { out[name] = existingId; continue; }
    const created = await gmail.users.labels.create({ userId: "me", requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" } });
    if (created.data.id) out[name] = created.data.id;
  }
  await db().from("settings").upsert({ key: "gmail_labels", value: out as never }, { onConflict: "key" });
  return out;
}

export function headerOf(msg: gmail_v1.Schema$Message, name: string): string | null {
  const h = msg.payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

export function parseAddress(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(/<([^>]+)>/);
  return (m?.[1] ?? v).trim().toLowerCase();
}

/** Plain-text body of a Gmail message (text/plain preferred, falls back to stripped HTML). */
export function bodyText(msg: gmail_v1.Schema$Message): string {
  const parts: gmail_v1.Schema$MessagePart[] = [];
  const walk = (p?: gmail_v1.Schema$MessagePart) => { if (!p) return; parts.push(p); p.parts?.forEach(walk); };
  walk(msg.payload);
  const decode = (d?: string | null) => (d ? Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "");
  const plain = parts.find((p) => p.mimeType === "text/plain" && p.body?.data);
  if (plain) return decode(plain.body!.data);
  const html = parts.find((p) => p.mimeType === "text/html" && p.body?.data);
  if (html) return decode(html.body!.data).replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return msg.snippet ?? "";
}
