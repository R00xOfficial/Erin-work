import { FACTOR_LABELS, SCORE_FACTORS, DEFAULT_WEIGHTS, VACANCY_CRITERIA, EMPLOYER_CRITERIA, CRITERION_LABELS, DEFAULT_VACANCY_WEIGHTS, DEFAULT_EMPLOYER_WEIGHTS } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/utils";
import { saveAssessmentWeights, saveWeights } from "@/server/actions/settings";
import { WeightsPreview } from "@/components/settings/weights-preview";

export const dynamic = "force-dynamic";

export default async function ScoringSettings() {
  const { supabase } = await requireUser();
  const [{ data: aw }, { data: active }, { data: history }] = await Promise.all([
    supabase.from("assessment_weights").select("kind, version, weights, created_at").eq("is_active", true),
    supabase.from("scoring_weights").select("*").eq("is_active", true).maybeSingle(),
    supabase.from("scoring_weights").select("version, created_at, notes, is_active").order("version", { ascending: false }).limit(10),
  ]);
  const weights = { ...DEFAULT_WEIGHTS, ...((active?.weights as Record<string, number>) ?? {}) };
  const thresholds = (active?.band_thresholds as { A: number; B: number; minConfidence: number; maxUnknownFactors: number }) ?? { A: 70, B: 50, minConfidence: 40, maxUnknownFactors: 3 };
  const vw = { ...DEFAULT_VACANCY_WEIGHTS, ...((aw ?? []).find((x) => x.kind === "vacancy")?.weights as Record<string, number> | undefined) };
  const ew = { ...DEFAULT_EMPLOYER_WEIGHTS, ...((aw ?? []).find((x) => x.kind === "employer")?.weights as Record<string, number> | undefined) };
  return (
    <div className="space-y-4">
    <div className="grid gap-4 md:grid-cols-2">
      {([["vacancy", "Vacancy suitability (100 points)", VACANCY_CRITERIA, vw], ["employer", "Employer speculative priority (100 points)", EMPLOYER_CRITERIA, ew]] as const).map(([kind, title, keys, w]) => (
        <form key={kind} action={saveAssessmentWeights.bind(null, kind)} className="card space-y-2">
          <h2 className="font-semibold">{title}</h2>
          <p className="muted text-xs">Weights must sum to 100. Saving re-scores every existing assessment from stored data and keeps the previous results in each assessment’s history. The score is decision support, not a prediction of an offer.</p>
          <div className="grid-form">
            {keys.map((k) => <div key={k}><label>{CRITERION_LABELS[k]}</label><input name={k} type="number" min={0} step={1} defaultValue={(w as Record<string, number>)[k]} /></div>)}
            <div className="col-span-full"><label>Why are you changing them?</label><input name="notes" /></div>
          </div>
          <button className="btn btn-primary" type="submit">Save as new version</button>
        </form>
      ))}
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      <form action={saveWeights} className="card lg:col-span-2 space-y-3">
        <p className="muted text-sm">Weights must sum to 100. These are a proposed starting point, not validated hiring probabilities; revisit after two to four weeks of real responses. Saving creates a new version and re-scores every employer.</p>
        <WeightsPreview initial={weights} labels={FACTOR_LABELS} factors={[...SCORE_FACTORS]} />
        <div className="grid-form">
          <div><label>Priority A threshold</label><input name="band_A" type="number" defaultValue={thresholds.A} /></div>
          <div><label>Priority B threshold</label><input name="band_B" type="number" defaultValue={thresholds.B} /></div>
          <div><label>Min confidence (else “research further”)</label><input name="minConfidence" type="number" defaultValue={thresholds.minConfidence} /></div>
          <div><label>Max unknown factors (else “research further”)</label><input name="maxUnknownFactors" type="number" defaultValue={thresholds.maxUnknownFactors} /></div>
          <div className="col-span-full"><label>Why are you changing the weights?</label><input name="notes" /></div>
        </div>
        <button className="btn btn-primary" type="submit">Save as new version</button>
      </form>
      <section className="card text-sm">
        <h2 className="font-semibold mb-2">Versions</h2>
        <ul className="space-y-1">{(history ?? []).map((h) => <li key={h.version}>v{h.version} {h.is_active && <span className="badge badge-ok">active</span>} <span className="muted">{fmtDate(h.created_at)}</span>{h.notes && <div className="muted text-xs">{h.notes}</div>}</li>)}</ul>
        <p className="muted text-xs mt-3">Hard flags (Part 2/3 required, experience, commute, right to work, closed, suppressed) always override the band.</p>
      </section>
    </div>
    </div>
  );
}
