/**
 * Run a single job handler immediately without pg-boss, for local verification:
 *   pnpm worker:once scoring.recompute '{"all":true}'
 *   pnpm worker:once enrich.geocode '{"officeId":"..."}'
 */
import { HANDLERS } from "./jobs/index.js";
import { logger } from "./lib/logger.js";
import { closeDb } from "./lib/db.js";

const [, , name, payloadRaw] = process.argv;
if (!name || !(name in HANDLERS)) {
  console.error(`Usage: pnpm worker:once <job> [json-payload]\nJobs: ${Object.keys(HANDLERS).join(", ")}`);
  process.exit(2);
}
const payload = payloadRaw ? (JSON.parse(payloadRaw) as Record<string, unknown>) : {};
const handler = HANDLERS[name as keyof typeof HANDLERS]!;
handler({ id: "once", name, data: payload } as never)
  .then((r) => {
    logger.info({ job: name, result: r ?? null }, "done");
    return closeDb();
  })
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err, job: name }, "failed");
    process.exit(1);
  });
