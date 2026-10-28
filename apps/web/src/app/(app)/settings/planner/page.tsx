import { CRITERION_LABELS, DEFAULT_PRIORITY_CONFIG, EMPLOYER_PRIORITY_KEYS, PRIORITY_LABELS, VACANCY_PRIORITY_KEYS } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { savePlannerPrefs, savePriorityModel } from "@/server/actions/priorities";

export const dynamic = "force-dynamic";
const DAYS: [number, string][] = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];

export default async function PlannerSettings() {
  const { supabase } = await requireUser();
  const [{ data: p }, { data: models }] = await Promise.all([
    supabase.from("planner_preferences").select("*").eq("id", true).maybeSingle(),
    supabase.from("prioritisation_models").select("kind, version, weights, config").eq("is_active", true),
  ]);
  const model = (k: string) => (models ?? []).find((m) => m.kind === k);
  void CRITERION_LABELS;
  return (
    <div className="space-y-4 max-w-5xl">
      <form action={savePlannerPrefs} className="card grid-form">
        <div className="col-span-full"><h2 className="font-semibold">Your time and workload</h2><p className="muted text-xs">The planner fits suggestions into this. More tasks is not better: it will leave things unscheduled rather than overload you.</p></div>
        <div><label>Hours available per working day</label><input name="hours_per_day" type="number" step="0.5" min={0} max={16} defaultValue={String(p?.hours_per_day ?? 2)} /></div>
        <div><label>Applications to prepare per week (max)</label><input name="max_applications_per_week" type="number" min={0} defaultValue={p?.max_applications_per_week ?? 3} /></div>
        <div><label>Speculative approaches per week (max)</label><input name="max_outreach_per_week" type="number" min={0} defaultValue={p?.max_outreach_per_week ?? 5} /></div>
        <div><label>Employers to research per week (max)</label><input name="max_research_per_week" type="number" min={0} defaultValue={p?.max_research_per_week ?? 6} /></div>
        <div><label>Days before recommending the same employer again</label><input name="recontact_cooldown_days" type="number" min={0} defaultValue={p?.recontact_cooldown_days ?? 60} /></div>
        <fieldset className="col-span-full"><label>Working days</label><div className="flex flex-wrap gap-3">{DAYS.map(([n, l]) => <label key={n} className="flex items-center gap-1 m-0"><input type="checkbox" name="working_days" value={n} defaultChecked={(p?.working_days ?? [1, 2, 3, 4, 5]).includes(n)} /> {l}</label>)}</div></fieldset>
        <div className="col-span-full"><h2 className="font-semibold mt-2">Reminders</h2><p className="muted text-xs">Reminders are created only from dates that are actually stored. Routine ones are grouped into one summary.</p></div>
        <div><label>Remind before a closing date (days, comma separated)</label><input name="reminder_deadline_days" defaultValue={(p?.reminder_deadline_days ?? [7, 3, 1]).join(", ")} /></div>
        <div><label>Summary</label><select name="digest_frequency" defaultValue={p?.digest_frequency ?? "daily"}><option value="daily">Every day</option><option value="weekly">Mondays only</option><option value="off">Off</option></select></div>
        <div><label>Summary from (hour, UK time)</label><input name="digest_hour" type="number" min={0} max={23} defaultValue={p?.digest_hour ?? 8} /></div>
        <div className="col-span-full flex flex-wrap gap-4">
          {([["remind_tasks_due", "Tasks due today"], ["remind_overdue", "Overdue or missed actions"], ["remind_decisions", "Decisions needed"], ["remind_status_changes", "Vacancy status changes"], ["remind_reconsider", "Holds due for reconsideration"], ["remind_outreach", "Planned outreach"]] as const).map(([k, l]) => <label key={k} className="flex items-center gap-2 m-0"><input type="checkbox" name={k} defaultChecked={(p as Record<string, unknown> | null)?.[k] !== false} /> {l}</label>)}
        </div>
        <div className="col-span-full"><button className="btn btn-primary" type="submit">Save</button> <span className="muted text-xs ml-2">Reminders appear on the Prioritise page; they are not emailed.</span></div>
      </form>

      <div className="grid gap-4 md:grid-cols-2">
        {([["vacancy", "Vacancy priority model", VACANCY_PRIORITY_KEYS], ["employer", "Speculative employer priority model", EMPLOYER_PRIORITY_KEYS]] as const).map(([kind, title, keys]) => {
          const m = model(kind);
          const w = (m?.weights ?? {}) as Record<string, number>;
          const cfg = { ...DEFAULT_PRIORITY_CONFIG, ...((m?.config ?? {}) as Record<string, number>) };
          return (
            <form key={kind} action={savePriorityModel.bind(null, kind)} className="card space-y-2">
              <h2 className="font-semibold">{title} <span className="muted text-xs">v{m?.version}</span></h2>
              <p className="muted text-xs">Weights must sum to 100. Saving recalculates recommendations; your own decisions are kept.</p>
              <div className="grid-form">{keys.map((k) => <div key={k}><label>{PRIORITY_LABELS[k]}</label><input name={k} type="number" min={0} defaultValue={w[k]} /></div>)}</div>
              <div className="grid-form">
                <div><label>High priority from (score)</label><input name="high_score" type="number" min={0} max={100} defaultValue={cfg.high_score} /></div>
                <div><label>Recommended from (score)</label><input name="recommended_score" type="number" min={0} max={100} defaultValue={cfg.recommended_score} /></div>
                {kind === "vacancy" && <div><label>Treat as urgent within (days)</label><input name="high_deadline_days" type="number" min={0} defaultValue={cfg.high_deadline_days} /></div>}
                <div className="col-span-full"><label>Why are you changing it?</label><input name="notes" /></div>
              </div>
              <button className="btn btn-primary" type="submit">Save as new version</button>
            </form>
          );
        })}
      </div>
    </div>
  );
}
