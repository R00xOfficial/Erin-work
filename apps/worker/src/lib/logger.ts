import pino from "pino";

export const logger = pino({
  level: process.env.WORKER_LOG_LEVEL ?? "info",
  base: { service: "ajis-worker" },
  redact: ["*.access_token", "*.refresh_token", "*.authorization", "*.api_key"],
});
export type Logger = typeof logger;
