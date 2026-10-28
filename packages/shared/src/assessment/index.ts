export * from "./types.js";
export * from "./vacancy.js";
export * from "./employer.js";
import { sha256 } from "../hash.js";

/** Key-sorted JSON, so equal inputs always hash equally. Used to decide whether an assessment actually needs rewriting. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}
export const inputsHash = (...parts: unknown[]) => sha256(stableStringify(parts));
