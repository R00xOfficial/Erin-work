// Statistical safeguards. Every percentage in the product carries its counts, an interval and a plain-language sample label, so 50% of 2 is never
// shown as if it meant the same as 50% of 40.

export type SampleLevel = "none" | "insufficient" | "preliminary" | "moderate" | "reasonable";
export const SAMPLE_LABELS: Record<SampleLevel, string> = {
  none: "No data",
  insufficient: "Too few to interpret",
  preliminary: "Preliminary",
  moderate: "Moderate sample",
  reasonable: "Reasonable sample",
};
export function sampleLevel(n: number): SampleLevel {
  return n <= 0 ? "none" : n < 5 ? "insufficient" : n < 20 ? "preliminary" : n < 40 ? "moderate" : "reasonable";
}

/** 95% Wilson score interval. Behaves sensibly for small n, unlike the normal approximation. */
export function wilson(k: number, n: number): { low: number; high: number } | null {
  if (n <= 0) return null;
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export interface Exclusion { reason: string; count: number }
export interface Rate {
  numerator: number;
  denominator: number;
  /** null when the denominator is zero: "no data", never 0%. */
  rate: number | null;
  low: number | null;
  high: number | null;
  level: SampleLevel;
  /** Records that were left out of the denominator, and why. */
  excluded: Exclusion[];
  /** Records still in progress or too recent to judge. They are neither successes nor failures. */
  pending: number;
}
export function makeRate(numerator: number, denominator: number, opts: { excluded?: Exclusion[]; pending?: number } = {}): Rate {
  const w = wilson(numerator, denominator);
  return {
    numerator, denominator, rate: denominator > 0 ? numerator / denominator : null, low: w?.low ?? null, high: w?.high ?? null, level: sampleLevel(denominator),
    excluded: (opts.excluded ?? []).filter((e) => e.count > 0), pending: opts.pending ?? 0,
  };
}
export const pct = (r: number | null, digits = 0) => (r == null ? "—" : `${(r * 100).toFixed(digits)}%`);
export function describeRate(r: Rate): string {
  if (r.denominator === 0) return "No data yet";
  return `${r.numerator} of ${r.denominator} (${pct(r.rate)}${r.low != null && r.level !== "reasonable" ? `, plausible range ${pct(r.low)}–${pct(r.high)}` : ""})`;
}

/** Whether two rates differ by more than their sample sizes can explain. Overlapping intervals mean no reliable difference. */
export function compareRates(a: Rate, b: Rate): { comparable: boolean; reliableDifference: boolean; note: string } {
  if (a.denominator < 5 || b.denominator < 5) return { comparable: false, reliableDifference: false, note: "At least one side has fewer than 5 records, so no comparison is made." };
  const overlap = a.low! <= b.high! && b.low! <= a.high!;
  return overlap
    ? { comparable: true, reliableDifference: false, note: "The ranges overlap: this difference could easily be chance." }
    : { comparable: true, reliableDifference: true, note: "The ranges do not overlap, but this is an association in your own results, not proof of cause." };
}

export const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export type RecommendationConfidence = "low" | "moderate" | "reasonable";
export const confidenceFor = (n: number): RecommendationConfidence => (n >= 40 ? "reasonable" : n >= 20 ? "moderate" : "low");

// ---- Periods ----------------------------------------------------------------------------------------------------------
const DAY = 86_400_000;
export const startOfDayUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export interface Period {
  start: Date; // inclusive, 00:00 UTC
  end: Date; // inclusive day, as a date at 00:00 UTC
  endExclusive: Date;
  days: number;
  /** The period has not finished yet, so it must not be compared like-for-like with a full one. */
  isPartial: boolean;
  elapsedDays: number;
  previous: { start: Date; endExclusive: Date; days: number };
}
export function makePeriod(start: Date, end: Date, now: Date): Period {
  const s = startOfDayUtc(start), e = startOfDayUtc(end), endExclusive = new Date(e.getTime() + DAY);
  const days = Math.max(1, Math.round((endExclusive.getTime() - s.getTime()) / DAY));
  const isPartial = now.getTime() < endExclusive.getTime();
  const elapsedDays = isPartial ? Math.max(1, Math.min(days, Math.ceil((now.getTime() - s.getTime()) / DAY))) : days;
  // The comparison period is as long as the part of this one that has happened, so partial and full periods are never compared unequally.
  const previous = { start: new Date(s.getTime() - elapsedDays * DAY), endExclusive: s, days: elapsedDays };
  return { start: s, end: e, endExclusive, days, isPartial, elapsedDays, previous };
}
export const inRange = (d: Date | null | undefined, start: Date, endExclusive: Date) => !!d && d.getTime() >= start.getTime() && d.getTime() < endExclusive.getTime();
