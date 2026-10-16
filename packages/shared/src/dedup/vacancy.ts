import { sha256 } from "../hash.js";
import { normaliseCompanyName } from "../normalise/name.js";
import { postcodeDistrict } from "../normalise/postcode.js";

/** Title normalisation for fingerprinting: lowercase, strip punctuation, collapse Part I/1 variants. */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\bpart\s*i\b/g, "part 1")
    .replace(/\bpart\s*ii\b/g, "part 2")
    .replace(/\bpart\s*iii\b/g, "part 3")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an|and|for|in|at|to|of|with|london|uk)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cross-source fingerprint: same employer + same normalised title + same postcode district (or town)
 * within the dedup window is the same vacancy even when posted on different boards.
 */
export function vacancyFingerprint(params: { employerName: string | null; title: string; postcode?: string | null; town?: string | null }): string {
  const employer = params.employerName ? normaliseCompanyName(params.employerName) : "unknown-employer";
  const title = normaliseTitle(params.title);
  const place = postcodeDistrict(params.postcode) ?? (params.town ? params.town.toLowerCase().trim() : "unknown-place");
  return sha256(`${employer}|${title}|${place}`);
}

export const VACANCY_DEDUP_WINDOW_DAYS = 60;
