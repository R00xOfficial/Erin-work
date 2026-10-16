import { z } from "zod";

export const SETTING_KEYS = [
  "stop_switch",
  "dry_run",
  "daily_send_cap",
  "weekly_send_cap",
  "follow_up_days",
  "approval_ttl_hours",
  "ai_daily_cap",
  "daily_research_target",
  "gmail_labels",
  "scoring_weights_version",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const settingSchemas = {
  stop_switch: z.boolean(),
  dry_run: z.boolean(),
  daily_send_cap: z.number().int().min(0).max(50),
  weekly_send_cap: z.number().int().min(0).max(250),
  follow_up_days: z.number().int().min(1).max(60),
  approval_ttl_hours: z.number().int().min(1).max(336),
  ai_daily_cap: z.number().int().min(0).max(500),
  daily_research_target: z.number().int().min(0).max(100),
  gmail_labels: z.record(z.string(), z.string()),
  scoring_weights_version: z.number().int().min(1),
} satisfies Record<SettingKey, z.ZodTypeAny>;

export const DEFAULT_SETTINGS: { [K in SettingKey]: z.infer<(typeof settingSchemas)[K]> } = {
  stop_switch: true,
  dry_run: true,
  daily_send_cap: 5,
  weekly_send_cap: 20,
  follow_up_days: 7,
  approval_ttl_hours: 72,
  ai_daily_cap: 40,
  daily_research_target: 10,
  gmail_labels: {},
  scoring_weights_version: 1,
};
