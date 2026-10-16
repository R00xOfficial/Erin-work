import { createHash } from "node:crypto";

export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Stable hash of normalised whitespace-collapsed text, used for change detection. */
export function contentHash(text: string): string {
  return sha256(text.replace(/\s+/g, " ").trim().toLowerCase());
}
