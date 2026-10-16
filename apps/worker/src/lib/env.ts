import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  SUPABASE_DB_URL: z.string().min(10),
  TOKEN_ENC_KEY: z.string().optional(),
  OUTREACH_DRY_RUN: z.string().optional(),
  OUTREACH_MAILBOX: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  TFL_APP_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
  ADZUNA_APP_ID: z.string().optional(),
  ADZUNA_APP_KEY: z.string().optional(),
  REED_API_KEY: z.string().optional(),
  COMPANIES_HOUSE_API_KEY: z.string().optional(),
  WORKER_USER_AGENT: z.string().default("AJIS/1.0 (+personal job search tool)"),
  WORKER_LOG_LEVEL: z.string().default("info"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  TZ: z.string().default("Europe/London"),
});

export type Env = z.infer<typeof schema> & { supabaseUrl: string; dryRun: boolean };

let cached: Env | null = null;
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Worker environment is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const supabaseUrl = parsed.data.SUPABASE_URL ?? parsed.data.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("SUPABASE_URL is not set");
  cached = { ...parsed.data, supabaseUrl, dryRun: parsed.data.OUTREACH_DRY_RUN === "true" };
  return cached;
}

/** True when every env var a source definition requires is present. */
export function hasEnv(names: string[]): boolean {
  return names.every((n) => !!process.env[n]);
}
