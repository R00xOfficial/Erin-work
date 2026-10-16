import { classifyZone, normalisePostcode } from "@ajis/shared";
import { db } from "../lib/db.js";
import { fetchJson } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import type { Job } from "./index.js";

interface Payload { officeId?: string; home?: boolean; all?: boolean }
interface PostcodeResult { status: number; result: { postcode: string; latitude: number; longitude: number; admin_district: string; region: string; parliamentary_constituency?: string } | null }

/** postcodes.io — free, OGL, no key. */
export async function geocodePostcode(postcode: string) {
  const pc = normalisePostcode(postcode);
  if (!pc) return null;
  const { data } = await fetchJson<PostcodeResult>(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`, { minIntervalMs: 200 });
  if (!data?.result) return null;
  return { postcode: data.result.postcode, lat: data.result.latitude, lng: data.result.longitude, district: data.result.admin_district, region: data.result.region };
}

async function geocodeOffice(officeId: string) {
  const { data: o } = await db().from("offices").select("id, postcode, town, lat").eq("id", officeId).maybeSingle();
  if (!o || !o.postcode) return { officeId, skipped: "no postcode" };
  const g = await geocodePostcode(o.postcode);
  if (!g) return { officeId, skipped: "postcode not found" };
  await db().from("offices").update({ lat: g.lat, lng: g.lng, postcode: g.postcode, zone_code: classifyZone(g.postcode, o.town), geocoded_at: new Date().toISOString(), county: undefined }).eq("id", officeId);
  // Travel times depend on coordinates.
  await db().from("job_requests").insert({ job_name: "enrich.travel_time", payload: { officeId }, singleton_key: `travel:${officeId}` });
  return { officeId, lat: g.lat, lng: g.lng };
}

export async function enrichGeocode(job: Job<Payload>) {
  if (job.data.home) {
    const { data: p } = await db().from("candidate_profile").select("home_postcode").eq("id", true).maybeSingle();
    if (!p?.home_postcode) return { skipped: "no home postcode" };
    const g = await geocodePostcode(p.home_postcode);
    if (!g) return { skipped: "home postcode not found" };
    await db().from("candidate_profile").update({ home_lat: g.lat, home_lng: g.lng, home_postcode: g.postcode }).eq("id", true);
    return { home: g };
  }
  if (job.data.officeId) return geocodeOffice(job.data.officeId);
  const { data: offices } = await db().from("offices").select("id").is("deleted_at", null).is("lat", null).not("postcode", "is", null).limit(200);
  const out = [];
  for (const o of offices ?? []) {
    try { out.push(await geocodeOffice(o.id)); } catch (e) { logger.warn({ officeId: o.id, err: (e as Error).message }, "geocode failed"); }
  }
  return { geocoded: out.length };
}
