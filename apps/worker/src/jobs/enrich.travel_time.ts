import { db } from "../lib/db.js";
import { env } from "../lib/env.js";
import { fetchJson, politeFetch } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import type { Job } from "./index.js";

interface Payload { officeId?: string; all?: boolean; refresh?: boolean }

/** Next Tuesday 09:00 Europe/London as an RFC3339 timestamp (arrival time for transit routing). */
export function nextWeekdayArrival(weekday = 2, hour = 9): Date {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  const delta = (weekday - d.getUTCDay() + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

interface RoutesResponse { routes?: { duration?: string; distanceMeters?: number }[] }

/** Google Routes API computeRoutes. Essentials SKU; TRANSIT and TRAFFIC_UNAWARE drive stay in the free tier. */
async function googleRoute(origin: { lat: number; lng: number }, dest: { lat: number; lng: number }, mode: "TRANSIT" | "DRIVE", arriveBy: Date) {
  const key = env().GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
    travelMode: mode,
    computeAlternativeRoutes: false,
    units: "METRIC",
  };
  if (mode === "TRANSIT") body.arrivalTime = arriveBy.toISOString();
  else body.routingPreference = "TRAFFIC_UNAWARE";
  const r = await politeFetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    api: true, method: "POST", minIntervalMs: 300, body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-goog-api-key": key, "x-goog-fieldmask": "routes.duration,routes.distanceMeters" },
  });
  if (!r.ok) { logger.warn({ status: r.status, mode }, "routes api error"); return null; }
  const data = JSON.parse(r.text) as RoutesResponse;
  const route = data.routes?.[0];
  if (!route?.duration) return null;
  const seconds = Number.parseInt(route.duration.replace("s", ""), 10);
  return { minutes: Math.round(seconds / 60), distanceKm: route.distanceMeters ? route.distanceMeters / 1000 : null, raw: route };
}

interface TflJourney { journeys?: { duration: number }[] }
/** TfL journey planner cross-check (Zones A/B only; returns nothing for Hampshire/West Sussex). */
async function tflJourney(origin: { lat: number; lng: number }, dest: { lat: number; lng: number }) {
  const key = env().TFL_APP_KEY;
  const url = new URL(`https://api.tfl.gov.uk/Journey/JourneyResults/${origin.lat},${origin.lng}/to/${dest.lat},${dest.lng}`);
  url.searchParams.set("timeIs", "Arriving");
  url.searchParams.set("time", "0900");
  if (key) url.searchParams.set("app_key", key);
  const { data, status } = await fetchJson<TflJourney>(url.toString(), { minIntervalMs: 300 });
  if (status !== 200 || !data?.journeys?.length) return null;
  return { minutes: Math.min(...data.journeys.map((j) => j.duration)) };
}

async function computeForOffice(officeId: string, home: { lat: number; lng: number; postcode: string }, refresh: boolean) {
  const { data: o } = await db().from("offices").select("id, lat, lng, zone_code, postcode").eq("id", officeId).maybeSingle();
  if (!o || o.lat == null || o.lng == null) return { officeId, skipped: "not geocoded" };
  const originKey = `home:${home.postcode}`;
  if (!refresh) {
    const { data: existing } = await db().from("travel_times").select("id").eq("office_id", officeId).eq("origin_key", originKey).gt("valid_until", new Date().toISOString()).limit(1);
    if (existing && existing.length) return { officeId, skipped: "fresh" };
  }
  const dest = { lat: Number(o.lat), lng: Number(o.lng) };
  const arriveBy = nextWeekdayArrival();
  const validUntil = new Date(Date.now() + 90 * 86_400_000).toISOString();
  const results: Record<string, number | null> = {};
  if (env().GOOGLE_MAPS_API_KEY) {
    for (const mode of ["TRANSIT", "DRIVE"] as const) {
      const r = await googleRoute(home, dest, mode, arriveBy);
      results[mode] = r?.minutes ?? null;
      if (r) await db().from("travel_times").upsert({ office_id: officeId, origin_key: originKey, origin_postcode: home.postcode, mode: mode === "TRANSIT" ? "public_transport" : "car", minutes: r.minutes, distance_km: r.distanceKm, provider: "google_routes", arrive_by: "09:00", computed_at: new Date().toISOString(), valid_until: validUntil, raw: r.raw as never }, { onConflict: "office_id,origin_key,mode,provider" });
    }
  }
  if (o.zone_code === "A" || o.zone_code === "B") {
    const t = await tflJourney(home, dest);
    results.TFL = t?.minutes ?? null;
    if (t) await db().from("travel_times").upsert({ office_id: officeId, origin_key: originKey, origin_postcode: home.postcode, mode: "public_transport", minutes: t.minutes, provider: "tfl", arrive_by: "09:00", computed_at: new Date().toISOString(), valid_until: validUntil }, { onConflict: "office_id,origin_key,mode,provider" });
  }
  if (!env().GOOGLE_MAPS_API_KEY && results.TFL == null) {
    // No provider available: straight-line estimate so the commute factor is not "unknown" forever. Clearly labelled as manual/estimate.
    const km = haversineKm(home, dest);
    const est = Math.round(km * 2.2 + 15); // crude: ~27 km/h door-to-door + 15 min access, London-ish
    await db().from("travel_times").upsert({ office_id: officeId, origin_key: originKey, origin_postcode: home.postcode, mode: "public_transport", minutes: est, distance_km: km, provider: "manual", arrive_by: "09:00", computed_at: new Date().toISOString(), valid_until: new Date(Date.now() + 7 * 86_400_000).toISOString(), raw: { estimate: true, note: "straight-line estimate; no routing provider configured" } }, { onConflict: "office_id,origin_key,mode,provider" });
    results.ESTIMATE = est;
  }
  const { data: emp } = await db().from("offices").select("employer_id").eq("id", officeId).single();
  if (emp) await db().from("job_requests").insert({ job_name: "scoring.recompute", payload: { employerId: emp.employer_id }, singleton_key: `score:${emp.employer_id}` });
  return { officeId, ...results };
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function enrichTravelTime(job: Job<Payload>) {
  const { data: p } = await db().from("candidate_profile").select("home_postcode, home_lat, home_lng").eq("id", true).maybeSingle();
  if (!p?.home_lat || !p.home_lng || !p.home_postcode) {
    return { skipped: "home not geocoded — set the home postcode in Settings → Candidate profile" };
  }
  const home = { lat: Number(p.home_lat), lng: Number(p.home_lng), postcode: p.home_postcode };
  if (job.data.officeId) return computeForOffice(job.data.officeId, home, job.data.refresh ?? true);
  const { data: offices } = await db().from("offices").select("id").is("deleted_at", null).not("lat", "is", null).limit(500);
  let n = 0;
  for (const o of offices ?? []) {
    try { await computeForOffice(o.id, home, job.data.refresh ?? false); n++; } catch (e) { logger.warn({ officeId: o.id, err: (e as Error).message }, "travel time failed"); }
  }
  return { computed: n };
}
