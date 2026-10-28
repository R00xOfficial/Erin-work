import type { PgBoss } from "pg-boss";
import { logger } from "../lib/logger.js";
import { completeJobRequest, drainJobRequests } from "../lib/job_requests.js";
import { QUEUES } from "../queues.js";
import { scoringRecompute } from "./scoring.recompute.js";
import { reviewStaleRecords } from "./review.stale_records.js";
import { enrichGeocode } from "./enrich.geocode.js";
import { enrichTravelTime } from "./enrich.travel_time.js";
import { enrichCompaniesHouse } from "./enrich.companies_house.js";
import { enrichPageCheck } from "./enrich.page_check.js";
import { enrichCareersPages } from "./enrich.careers_pages.js";
import { aiEmployerBriefing } from "./ai.employer_briefing.js";
import { aiVacancyExtract } from "./ai.vacancy_extract.js";
import { discoveryJob } from "./discovery.js";
import { researchVacancy } from "./research.vacancy.js";
import { researchEmployer } from "./research.employer.js";
import { prioritiesRecompute } from "./priorities.recompute.js";
import { plannerGenerate } from "./planner.generate.js";
import { remindersGenerate } from "./reminders.generate.js";
import { assessmentsRecompute } from "./assessments.recompute.js";
import { discoverCareersPages } from "./discovery.careers_pages.js";
import { discoveryEmailAlerts } from "./discovery.email_alerts.js";
import { tasksFollowUps } from "./tasks.follow_ups.js";
import { gmailSync } from "./gmail.sync.js";
import { gmailDraftCreate } from "./gmail.draft_create.js";
import { gmailSend } from "./gmail.send.js";
import { maintenanceSourceHealth } from "./maintenance.source_health.js";
import { deadLetter } from "./dlq.js";

export type Job<T = Record<string, unknown>> = { id: string; name: string; data: T };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler = (job: Job<any>) => Promise<unknown>;

export const HANDLERS: Record<string, Handler> = {
  "discovery.adzuna": discoveryJob("adzuna"),
  "discovery.reed": discoveryJob("reed"),
  "discovery.riba_jobs_rss": discoveryJob("riba_jobs_rss"),
  "discovery.architecture_social": discoveryJob("architecture_social"),
  "discovery.ninebee_careers": discoveryJob("ninebee_careers"),
  "discovery.bd4jobs": discoveryJob("bd4jobs"),
  "discovery.jobsgopublic": discoveryJob("jobsgopublic"),
  "discovery.aj_jobs": discoveryJob("aj_jobs"),
  "discovery.planit": discoveryJob("planit"),
  "discovery.careers_pages": discoverCareersPages,
  "discovery.email_alerts": discoveryEmailAlerts,
  "enrich.companies_house": enrichCompaniesHouse,
  "enrich.geocode": enrichGeocode,
  "enrich.travel_time": enrichTravelTime,
  "enrich.page_check": enrichPageCheck,
  "enrich.careers_pages": enrichCareersPages,
  "ai.employer_briefing": aiEmployerBriefing,
  "ai.vacancy_extract": aiVacancyExtract,
  "research.vacancy": researchVacancy,
  "research.employer": researchEmployer,
  "assessments.recompute": assessmentsRecompute,
  "priorities.recompute": prioritiesRecompute,
  "planner.generate": plannerGenerate,
  "reminders.generate": remindersGenerate,
  "scoring.recompute": scoringRecompute,
  "review.stale_records": reviewStaleRecords,
  "tasks.follow_ups": tasksFollowUps,
  "gmail.sync": gmailSync,
  "gmail.draft_create": gmailDraftCreate,
  "gmail.send": gmailSend,
  "maintenance.source_health": maintenanceSourceHealth,
  dlq: deadLetter,
};

/** Fetch queues run one at a time per process so per-host rate limits hold. */
const SERIAL = new Set(QUEUES.filter((q) => q.name.startsWith("discovery.") || q.name === "enrich.page_check" || q.name === "enrich.careers_pages" || q.name.startsWith("gmail.")).map((q) => q.name));

export async function registerHandlers(boss: PgBoss) {
  for (const [name, handler] of Object.entries(HANDLERS)) {
    await boss.work<Record<string, unknown>>(name, { batchSize: 1, localConcurrency: SERIAL.has(name) ? 1 : 2, pollingIntervalSeconds: name === "gmail.send" ? 2 : 5 }, async (jobs) => {
      for (const job of jobs) {
        const started = Date.now();
        const requestId = (job.data as { requestId?: string }).requestId;
        try {
          const result = await handler(job);
          await completeJobRequest(requestId);
          logger.info({ job: name, id: job.id, ms: Date.now() - started, result: summarise(result) }, "job done");
        } catch (err) {
          await completeJobRequest(requestId, (err as Error).message);
          logger.error({ job: name, id: job.id, ms: Date.now() - started, err: (err as Error).message }, "job failed");
          throw err;
        }
      }
    });
  }
  await boss.work("maintenance.drain_requests", { batchSize: 1, pollingIntervalSeconds: 10 }, async () => {
    const n = await drainJobRequests(boss);
    if (n > 0) logger.info({ n }, "drained job requests");
  });
}

function summarise(r: unknown) {
  if (r == null) return null;
  const s = JSON.stringify(r);
  return s.length > 300 ? `${s.slice(0, 300)}…` : r;
}
