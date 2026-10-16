import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.js";

export type Db = SupabaseClient<Database>;

export interface SupabaseEnv {
  url: string;
  anonKey?: string;
  serviceRoleKey?: string;
}

export function readSupabaseEnv(env: NodeJS.ProcessEnv = process.env): SupabaseEnv {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL is not set");
  return { url, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
}

/**
 * Service-role client for the worker. Bypasses RLS — never ship this key to a browser.
 */
export function createServiceClient(env: SupabaseEnv = readSupabaseEnv()): Db {
  if (!env.serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient<Database>(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-ajis-client": "worker" } },
  });
}
