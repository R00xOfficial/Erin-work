import type { PgBoss } from "pg-boss";

/**
 * Every queue the worker knows about, with its pg-boss policy and (optional) cron schedule.
 * Schedules are Europe/London. Web-originated requests (job_requests) may target any queue here.
 */
export interface QueueDef {
  name: string;
  policy?: "standard" | "short" | "singleton" | "stately";
  cron?: string;
  retryLimit?: number;
  retryDelay?: number;
  expireInSeconds?: number;
  /** Payload used when the schedule fires. */
  scheduleData?: Record<string, unknown>;
}

export const QUEUES: QueueDef[] = [
  // discovery
  { name: "discovery.adzuna", policy: "singleton", cron: "15 6,18 * * *", retryLimit: 2 },
  { name: "discovery.reed", policy: "singleton", cron: "25 6,18 * * *", retryLimit: 2 },
  { name: "discovery.riba_jobs_rss", policy: "singleton", cron: "5 */2 * * *", retryLimit: 2 },
  { name: "discovery.architecture_social", policy: "singleton", cron: "40 3 * * *", retryLimit: 1, expireInSeconds: 1800 },
  { name: "discovery.ninebee_careers", policy: "singleton", cron: "45 3 * * *", retryLimit: 1, expireInSeconds: 1800 },
  { name: "discovery.bd4jobs", policy: "singleton", cron: "50 3 * * *", retryLimit: 1, expireInSeconds: 1800 },
  { name: "discovery.jobsgopublic", policy: "singleton", cron: "55 3 * * *", retryLimit: 1, expireInSeconds: 1800 },
  { name: "discovery.aj_jobs", policy: "singleton", cron: "0 4 * * *", retryLimit: 1, expireInSeconds: 1800 },
  { name: "discovery.planit", policy: "singleton", cron: "50 2 * * *", retryLimit: 1, expireInSeconds: 1800 },
  { name: "discovery.careers_pages", policy: "singleton", cron: "15 5 * * *", retryLimit: 1, expireInSeconds: 3300 },
  { name: "discovery.email_alerts", policy: "standard", retryLimit: 2 },
  // enrichment
  { name: "enrich.companies_house", policy: "stately", cron: "0 4 * * 1", retryLimit: 3, scheduleData: { all: true } },
  { name: "enrich.geocode", policy: "stately", retryLimit: 3 },
  { name: "enrich.travel_time", policy: "stately", cron: "0 5 1 * *", retryLimit: 3, scheduleData: { all: true, refresh: true } },
  { name: "enrich.careers_pages", policy: "singleton", cron: "30 4 * * *", retryLimit: 1, expireInSeconds: 3000 },
  { name: "enrich.page_check", policy: "singleton", cron: "10 * * * *", retryLimit: 1, expireInSeconds: 1800 },
  // ai
  { name: "ai.employer_briefing", policy: "stately", retryLimit: 1, expireInSeconds: 600 },
  { name: "ai.vacancy_extract", policy: "stately", retryLimit: 1, expireInSeconds: 300 },
  // research and assessment (Stage 2)
  { name: "research.vacancy", policy: "standard", retryLimit: 1, expireInSeconds: 900 },
  { name: "research.employer", policy: "standard", retryLimit: 1, expireInSeconds: 1200 },
  { name: "assessments.recompute", policy: "standard", cron: "40 3 * * *", retryLimit: 1, expireInSeconds: 1200, scheduleData: { all: true, reason: "nightly" } },
  // scoring / review / tasks
  { name: "scoring.recompute", policy: "standard", cron: "30 3 * * *", retryLimit: 2, scheduleData: { all: true } },
  { name: "review.stale_records", policy: "singleton", cron: "0 7 * * *", retryLimit: 1 },
  { name: "tasks.follow_ups", policy: "singleton", cron: "20 * * * *", retryLimit: 1 },
  // gmail
  { name: "gmail.sync", policy: "singleton", cron: "*/10 * * * *", retryLimit: 1, expireInSeconds: 300 },
  { name: "gmail.draft_create", policy: "stately", retryLimit: 2 },
  { name: "gmail.send", policy: "stately", retryLimit: 0, expireInSeconds: 120 },
  // maintenance
  { name: "maintenance.source_health", policy: "singleton", cron: "35 * * * *", retryLimit: 0 },
  { name: "maintenance.drain_requests", policy: "singleton", cron: "*/1 * * * *", retryLimit: 0, expireInSeconds: 55 },
  { name: "dlq", policy: "standard", retryLimit: 0 },
];

export const KNOWN_QUEUES = new Set(QUEUES.map((q) => q.name));

export async function ensureQueues(boss: PgBoss) {
  for (const q of QUEUES) {
    await boss.createQueue(q.name, {
      policy: q.policy ?? "standard",
      retryLimit: q.retryLimit ?? 3,
      retryDelay: q.retryDelay ?? 30,
      retryBackoff: true,
      retryDelayMax: 900,
      expireInSeconds: q.expireInSeconds ?? 600,
      deadLetter: q.name === "dlq" ? undefined : "dlq",
    } as never);
  }
}

export async function ensureSchedules(boss: PgBoss, tz = "Europe/London") {
  const existing = await boss.getSchedules();
  const wanted = new Map(QUEUES.filter((q) => q.cron).map((q) => [q.name, q]));
  for (const s of existing) {
    if (!wanted.has(s.name)) await boss.unschedule(s.name);
  }
  for (const q of wanted.values()) {
    await boss.schedule(q.name, q.cron!, q.scheduleData ?? {}, { tz });
  }
}
