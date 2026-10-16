import type { EmploymentType } from "@ajis/shared";

/** A vacancy as seen at a source, before normalisation and deduplication. */
export interface RawVacancy {
  kind: "vacancy";
  title: string;
  url: string;
  employerName: string | null;
  description: string | null;
  descriptionIsTruncated: boolean;
  locationText: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  postedAt: string | null;
  closingAt: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryText: string | null;
  employmentType: EmploymentType;
  externalRef: string | null;
  applicationUrl: string | null;
  applicationEmail: string | null;
  postedByAgency: boolean;
  raw: unknown;
}

/** A non-vacancy observation (planning application, press item) attributable to an employer. */
export interface RawSignal {
  kind: "signal";
  employerId: string;
  signalType: "planning_agent_activity" | "project_announcement" | "press" | "new_office";
  strength: "weak" | "moderate" | "strong";
  summary: string;
  url: string | null;
  observedOn: string | null;
  raw: unknown;
}

export interface AdapterContext {
  sourceCode: string;
  sourceDefinitionId: string;
  config: Record<string, unknown>;
  minIntervalMs: number;
  dailyRequestCap: number | null;
  requestsToday: number;
  countRequest: () => Promise<boolean>; // returns false when the daily cap is hit
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface Adapter {
  code: string;
  discover(ctx: AdapterContext): AsyncGenerator<RawVacancy | RawSignal>;
}
