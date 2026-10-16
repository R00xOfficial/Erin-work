const UK_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/;

/** "gu31 4aa" -> "GU31 4AA"; returns null if not a full UK postcode. */
export function normalisePostcode(input: string | null | undefined): string | null {
  if (!input) return null;
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length < 5 || compact.length > 7) return null;
  const spaced = `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  return UK_POSTCODE.test(spaced) ? spaced : null;
}

/** Outward code, e.g. "GU31 4AA" -> "GU31". Accepts partial postcodes like "GU31". */
export function postcodeDistrict(input: string | null | undefined): string | null {
  if (!input) return null;
  const full = normalisePostcode(input);
  if (full) return full.split(" ")[0]!;
  const partial = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{1,2}\d[A-Z\d]?$/.test(partial) ? partial : null;
}

/** Postcode area letters, e.g. "GU31" -> "GU", "SW1A 1AA" -> "SW". */
export function postcodeArea(input: string | null | undefined): string | null {
  const district = postcodeDistrict(input);
  if (!district) return null;
  const m = district.match(/^([A-Z]{1,2})/);
  return m ? m[1]! : null;
}
