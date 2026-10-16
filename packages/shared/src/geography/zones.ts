import type { GeoZoneCode } from "../enums.js";
import { postcodeDistrict, postcodeArea } from "../normalise/postcode.js";

export interface GeoZone {
  code: GeoZoneCode;
  label: string;
  description: string;
  /** Postcode areas (letters) wholly in the zone. */
  postcodeAreas: string[];
  /** Specific outward codes for areas split between zones. */
  postcodeDistricts: string[];
  towns: string[];
  defaultMaxPublicTransportMinutes: number;
  sortOrder: number;
}

/**
 * Corridor definition from the brief. Zone membership is a first-pass classification;
 * the commute filter (travel_times vs candidate max minutes) makes the final call.
 */
export const GEO_ZONES: GeoZone[] = [
  {
    code: "A",
    label: "Zone A — London",
    description: "All London boroughs, the City of London and Greater London studios.",
    postcodeAreas: ["E", "EC", "N", "NW", "SE", "SW", "W", "WC", "BR", "CR", "DA", "EN", "HA", "IG", "KT", "RM", "SM", "TW", "UB", "WD"],
    postcodeDistricts: [],
    towns: ["London", "Croydon", "Kingston upon Thames", "Richmond", "Wimbledon", "Bromley", "Harrow", "Ealing", "Stratford", "Greenwich"],
    defaultMaxPublicTransportMinutes: 75,
    sortOrder: 1,
  },
  {
    code: "B",
    label: "Zone B — Surrey and the commuter belt",
    description: "Guildford, Woking, Weybridge, Epsom, Leatherhead, Dorking, Reigate, Redhill, Farnham, Aldershot and surrounding towns.",
    postcodeAreas: [],
    postcodeDistricts: [
      "GU1", "GU2", "GU3", "GU4", "GU5", "GU6", "GU7", "GU8", "GU9", "GU10", "GU11", "GU12", "GU14", "GU15", "GU16", "GU21", "GU22", "GU23", "GU24", "GU47", "GU51", "GU52",
      "KT10", "KT11", "KT12", "KT13", "KT14", "KT15", "KT16", "KT17", "KT18", "KT19", "KT20", "KT21", "KT22", "KT23", "KT24",
      "RH1", "RH2", "RH3", "RH4", "RH5", "RH6", "RH7", "RH8", "RH9",
    ],
    towns: ["Guildford", "Woking", "Weybridge", "Epsom", "Leatherhead", "Dorking", "Reigate", "Redhill", "Farnham", "Aldershot", "Godalming", "Camberley", "Farnborough", "Esher", "Cobham"],
    defaultMaxPublicTransportMinutes: 90,
    sortOrder: 2,
  },
  {
    code: "C",
    label: "Zone C — West Sussex and Hampshire",
    description: "Petersfield, Liphook, Haslemere, Midhurst, Chichester, Havant, Waterlooville, Portsmouth and nearby areas.",
    postcodeAreas: ["PO"],
    postcodeDistricts: ["GU26", "GU27", "GU28", "GU29", "GU30", "GU31", "GU32", "GU33", "GU34", "GU35", "BN17", "BN18", "SO32"],
    towns: ["Petersfield", "Liphook", "Haslemere", "Midhurst", "Chichester", "Havant", "Waterlooville", "Portsmouth", "Southsea", "Emsworth", "Bognor Regis", "Alton", "Liss", "Fareham", "Gosport"],
    defaultMaxPublicTransportMinutes: 120,
    sortOrder: 3,
  },
  {
    code: "EXT",
    label: "Extended zone",
    description: "Winchester, Southampton, Crawley, Brighton, Horsham and the wider South East; commute filter decides.",
    postcodeAreas: ["SO", "RH", "BN", "GU", "SL", "RG", "ME", "TN"],
    postcodeDistricts: [],
    towns: ["Winchester", "Southampton", "Crawley", "Brighton", "Horsham", "Eastleigh", "Basingstoke", "Reading", "Maidstone", "Tunbridge Wells", "Worthing", "Gatwick"],
    defaultMaxPublicTransportMinutes: 120,
    sortOrder: 4,
  },
];

const DISTRICT_INDEX = new Map<string, GeoZoneCode>();
const AREA_INDEX = new Map<string, GeoZoneCode>();
const TOWN_INDEX = new Map<string, GeoZoneCode>();
for (const z of GEO_ZONES) {
  for (const d of z.postcodeDistricts) DISTRICT_INDEX.set(d, z.code);
  for (const a of z.postcodeAreas) if (!AREA_INDEX.has(a)) AREA_INDEX.set(a, z.code);
  for (const t of z.towns) TOWN_INDEX.set(t.toLowerCase(), z.code);
}

/** Classify a postcode (full or outward) into a zone. Districts win over areas. */
export function zoneForPostcode(postcode: string | null | undefined): GeoZoneCode {
  const district = postcodeDistrict(postcode);
  if (district && DISTRICT_INDEX.has(district)) return DISTRICT_INDEX.get(district)!;
  const area = postcodeArea(postcode);
  if (area && AREA_INDEX.has(area)) return AREA_INDEX.get(area)!;
  return "OUT";
}

export function zoneForTown(town: string | null | undefined): GeoZoneCode | null {
  if (!town) return null;
  return TOWN_INDEX.get(town.trim().toLowerCase()) ?? null;
}

export function classifyZone(postcode?: string | null, town?: string | null): GeoZoneCode {
  const byPostcode = zoneForPostcode(postcode);
  if (byPostcode !== "OUT") return byPostcode;
  return zoneForTown(town) ?? "OUT";
}
