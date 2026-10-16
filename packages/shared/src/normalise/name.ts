/**
 * Company-name normalisation for deduplication. Mirrors fn_normalise_company_name() in SQL.
 * Strips accents, case, punctuation and legal-form suffixes ONLY (ltd, limited, llp, plc, inc).
 * Never strips descriptive words such as "architects" — "Make Architects" and "Make" are different businesses.
 */
const LEGAL_SUFFIXES = /\b(ltd|limited|llp|lp|plc|inc|incorporated|cic|co|company|uk)\b\.?/g;

export function normaliseCompanyName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** eTLD+1-ish domain extraction good enough for UK practice websites. */
export function extractDomain(urlOrDomain: string | null | undefined): string | null {
  if (!urlOrDomain) return null;
  let host = urlOrDomain.trim().toLowerCase();
  try {
    if (!/^https?:\/\//.test(host)) host = `https://${host}`;
    host = new URL(host).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "");
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const secondLevel = new Set(["co", "org", "ac", "gov", "net", "ltd", "plc", "me", "sch"]);
  const last = parts[parts.length - 1]!;
  const penultimate = parts[parts.length - 2]!;
  if (last.length === 2 && secondLevel.has(penultimate) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

/** Public email providers are never evidence that a contact belongs to an employer's domain. */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.co.uk",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "btinternet.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
]);

export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).trim().toLowerCase() || null;
}
