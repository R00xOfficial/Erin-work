import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@ajis/db";
import { env } from "./env.js";

/**
 * Two connections:
 *  - `sql`: raw Postgres via the Supavisor SESSION pooler (needed for pg-boss, row locks, fn_can_send in a transaction).
 *  - `db`: supabase-js with the service role for ordinary reads/writes (bypasses RLS; worker only).
 */
let _sql: ReturnType<typeof postgres> | null = null;
export function sql() {
  if (_sql) return _sql;
  _sql = postgres(env().SUPABASE_DB_URL, { max: 4, idle_timeout: 30, connect_timeout: 20, prepare: true, ssl: env().SUPABASE_DB_URL.includes("supabase.co") || env().SUPABASE_DB_URL.includes("pooler.supabase.com") ? "require" : undefined });
  return _sql;
}

let _db: ReturnType<typeof createClient<Database>> | null = null;
export function db() {
  if (_db) return _db;
  _db = createClient<Database>(env().supabaseUrl, env().SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { "x-ajis-client": "worker" } } });
  return _db;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db().from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T | undefined) ?? fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db().from("settings").upsert({ key, value: value as never }, { onConflict: "key" });
}

export async function closeDb() {
  if (_sql) await _sql.end({ timeout: 5 });
  _sql = null;
}
