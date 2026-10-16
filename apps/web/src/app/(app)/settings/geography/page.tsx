import { requireUser } from "@/lib/supabase/server";
import { saveGeoZone } from "@/server/actions/settings";

export const dynamic = "force-dynamic";

export default async function GeographySettings() {
  const { supabase } = await requireUser();
  const [{ data: zones }, { data: profile }] = await Promise.all([
    supabase.from("geo_zones").select("*").order("sort_order"),
    supabase.from("candidate_profile").select("home_postcode, home_lat, home_lng, max_public_transport_minutes").eq("id", true).maybeSingle(),
  ]);
  return (
    <div className="space-y-4">
      <div className="card text-sm">
        <strong>Home base:</strong> {profile?.home_postcode ?? <span className="text-warn">not set — set it in Candidate profile</span>} {profile?.home_lat && <span className="muted">({profile.home_lat}, {profile.home_lng})</span>} · max {profile?.max_public_transport_minutes ?? 90} min by public transport.
        <p className="muted text-xs mt-1">Zones are a first-pass classification by postcode district, area, then town. The travel-time filter (Google Routes, TfL cross-check) makes the final call per office, so an employer just outside a zone is never discarded for that reason alone.</p>
      </div>
      {(zones ?? []).map((z) => (
        <form key={z.code} action={saveGeoZone.bind(null, z.code)} className="card grid-form">
          <div className="col-span-full"><h2 className="font-semibold">{z.label}</h2><p className="muted text-xs">{z.description}</p></div>
          <div><label>Postcode areas (letters)</label><input name="postcode_areas" defaultValue={z.postcode_areas.join(", ")} /></div>
          <div><label>Max public transport minutes</label><input name="max_pt_minutes" type="number" defaultValue={z.max_pt_minutes} /></div>
          <div className="col-span-full"><label>Postcode districts (outward codes)</label><input name="postcode_districts" defaultValue={z.postcode_districts.join(", ")} /></div>
          <div className="col-span-full"><label>Towns</label><input name="towns" defaultValue={z.towns.join(", ")} /></div>
          <div className="col-span-full"><button className="btn btn-sm" type="submit">Save zone {z.code}</button></div>
        </form>
      ))}
    </div>
  );
}
