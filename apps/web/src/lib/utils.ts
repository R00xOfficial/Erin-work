import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNowStrict, isPast } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtDate(value: string | Date | null | undefined, pattern = "d MMM yyyy"): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, pattern);
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  return fmtDate(value, "d MMM yyyy HH:mm");
}

export function fmtRelative(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const s = formatDistanceToNowStrict(d, { addSuffix: true });
  return isPast(d) ? s : s;
}

export function humanise(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function fmtMoney(min: number | null | undefined, max: number | null | undefined, period?: string | null): string {
  if (min == null && max == null) return "—";
  const f = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
  const range = min != null && max != null && min !== max ? `${f(min)}–${f(max)}` : f((min ?? max)!);
  return period && period !== "unknown" && period !== "year" ? `${range}/${period}` : range;
}
