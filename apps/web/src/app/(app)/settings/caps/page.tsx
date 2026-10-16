import { DEFAULT_SETTINGS } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { saveCaps } from "@/server/actions/settings";

export const dynamic = "force-dynamic";

export default async function CapsSettings() {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("settings").select("key, value, description");
  const get = (k: keyof typeof DEFAULT_SETTINGS) => (data?.find((r) => r.key === k)?.value as number | undefined) ?? (DEFAULT_SETTINGS[k] as number);
  return (
    <form action={saveCaps} className="card grid-form max-w-3xl">
      <p className="col-span-full muted text-sm">Adjust how much you research and send each day without touching the system. Caps are enforced by the pre-send checklist in the database, counted in Europe/London time.</p>
      <div><label>Daily outbound email cap</label><input name="daily_send_cap" type="number" min={0} defaultValue={get("daily_send_cap")} /></div>
      <div><label>Weekly outbound email cap</label><input name="weekly_send_cap" type="number" min={0} defaultValue={get("weekly_send_cap")} /></div>
      <div><label>Follow-up after (days, no reply)</label><input name="follow_up_days" type="number" min={1} defaultValue={get("follow_up_days")} /></div>
      <div><label>Approval valid for (hours)</label><input name="approval_ttl_hours" type="number" min={1} defaultValue={get("approval_ttl_hours")} /></div>
      <div><label>AI runs per day</label><input name="ai_daily_cap" type="number" min={0} defaultValue={get("ai_daily_cap")} /></div>
      <div><label>Daily research target (employers)</label><input name="daily_research_target" type="number" min={0} defaultValue={get("daily_research_target")} /></div>
      <div className="col-span-full"><button className="btn btn-primary" type="submit">Save</button></div>
    </form>
  );
}
