import { PgBoss } from "pg-boss";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { closeDb } from "./lib/db.js";
import { ensureQueues, ensureSchedules, QUEUES } from "./queues.js";
import { registerHandlers } from "./jobs/index.js";

async function main() {
  const e = env();
  const boss = new PgBoss({
    connectionString: e.SUPABASE_DB_URL,
    schema: "pgboss",
    migrate: true,
    supervise: true,
    schedule: true,
    max: 4,
    application_name: "ajis-worker",
    ssl: e.SUPABASE_DB_URL.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  } as never);
  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
  await boss.start();
  await ensureQueues(boss);
  await ensureSchedules(boss, e.TZ);
  await registerHandlers(boss);
  logger.info({ queues: QUEUES.length, dryRun: e.dryRun, tz: e.TZ }, "worker started");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    try {
      await boss.stop({ graceful: true, timeout: 20_000 });
      await closeDb();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err }, "worker failed to start");
  process.exit(1);
});
