import Link from "next/link";
import type { Tables } from "@ajis/db";
import { fmtDate, fmtDateTime, humanise } from "@/lib/utils";
import { EvidenceBadge } from "@/components/badges";
import {
  addRequirement, correctRequirement, markAssessmentReviewed, requestEmployerResearch, requestVacancyResearch, retryRun, returnToDiscovery, reviewRequirement, saveForStage3,
} from "@/server/actions/research";
import { dismissEmployer, dismissVacancy } from "@/server/actions/discovery";

type Criterion = { criterion: string; label: string; weight: number; score: number | null; points: number | null; known: boolean; reasons: string[]; evidence: string[]; unverified: string[] };
type CriteriaDoc = { items: Criterion[]; assessedWeight: number; range: { low: number; high: number }; preliminary: boolean; recommendation: string };
type Blocker = { code: string; text: string; evidence: string | null };
type Step = { step: string; status: string; detail?: string; sources?: { url: string; ok: boolean; status?: number; official?: boolean; error?: string }[]; at: string };

export interface AssessmentViewProps {
  kind: "vacancy" | "employer";
  entityId: string;
  assessment: Tables<"assessments"> | null;
  history: Pick<Tables<"assessments">, "id" | "total" | "computed_at" | "profile_version" | "weights_version" | "is_current" | "reviewed_at" | "completeness" | "confidence">[];
  requirements?: Tables<"vacancy_requirements">[];
  sourceUrls?: Record<string, string>;
  runs: Tables<"research_runs">[];
  state: { research_state: string; discovery_state: string; stage3_saved_at: string | null; ready: boolean };
  profile: { version: number; approved: boolean };
}

const scoreClass = (n: number | null) => (n == null ? "" : n >= 70 ? "badge-ok" : n >= 50 ? "badge-accent" : "badge-warn");

export function AssessmentView({ kind, entityId, assessment: a, history, requirements = [], sourceUrls = {}, runs, state, profile }: AssessmentViewProps) {
  const doc = (a?.criteria ?? null) as unknown as CriteriaDoc | null;
  const blockers = ((a?.blockers ?? []) as unknown as Blocker[]);
  const conflicts = ((a?.conflicts ?? []) as unknown as { field: string; detail: string }[]);
  const latestRun = runs[0];
  const research = kind === "vacancy" ? requestVacancyResearch : requestEmployerResearch;
  const running = state.research_state === "queued" || state.research_state === "running";
  const label = kind === "vacancy" ? "Suitability" : "Speculative priority";

  return (
    <div className="space-y-4">
      {!profile.approved && (
        <div className="card text-sm border-warn">Your candidate profile (version {profile.version}) has not been approved, so these assessments are preliminary and cannot be saved for Stage 3. <Link className="underline" href="/settings/profile">Review and approve it</Link>.</div>
      )}

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold mr-auto">{label} assessment</h2>
          <span className="badge">{humanise(state.research_state)}</span>
          {state.ready && <span className="badge badge-ok">ready for Stage 3</span>}
          {state.stage3_saved_at && <span className="badge badge-accent">saved for Stage 3 {fmtDate(state.stage3_saved_at)}</span>}
        </div>

        {!a ? (
          <p className="muted text-sm">{running ? "Research is queued or running. This page shows real results once it finishes." : "Not researched yet. Run the research to read the sources and produce an assessment."}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-6">
              <div>
                <div className="text-4xl font-semibold">{doc && doc.assessedWeight === 0 ? "—" : Number(a.total).toFixed(0)}<span className="text-base muted"> / 100</span></div>
                <div className="muted text-xs">{doc && doc.assessedWeight === 0 ? "nothing could be assessed yet" : `over the ${doc?.assessedWeight}% of the model that could be assessed`}</div>
                {doc && doc.assessedWeight > 0 && doc.assessedWeight < 100 && <div className="muted text-xs">range if every unknown scored 0–100: {doc.range.low}–{doc.range.high}</div>}
              </div>
              <div className="text-sm space-y-1">
                <div>Research completeness <span className={`badge ${scoreClass(Number(a.completeness))}`}>{Number(a.completeness).toFixed(0)}%</span></div>
                <div>Evidence confidence <span className={`badge ${scoreClass(Number(a.confidence))}`}>{Number(a.confidence).toFixed(0)}%</span></div>
                {doc?.preliminary && <div><span className="badge badge-warn">preliminary</span> <span className="muted text-xs">less than 60% assessed or complete</span></div>}
              </div>
              <div className="text-sm max-w-md"><strong>{doc?.recommendation}</strong></div>
            </div>
            <p className="muted text-xs">Computed {fmtDateTime(a.computed_at)} from your profile v{a.profile_version}{a.profile_approved ? "" : " (not approved)"} and weights v{a.weights_version}. The score is decision support, not a prediction of an offer, and does not compare with {kind === "vacancy" ? "employer speculative scores" : "vacancy scores"}.</p>
          </>
        )}
      </section>

      {blockers.length > 0 && (
        <section className="card border-danger">
          <h3 className="font-semibold text-danger mb-1">Potential blockers <span className="badge badge-danger">{blockers.length}</span></h3>
          <p className="muted text-xs mb-2">Shown separately from the score: a high total never hides these.</p>
          <ul className="text-sm space-y-1 list-disc pl-5">{blockers.map((b, i) => <li key={i}>{b.text}{b.evidence && <span className="muted"> — “{b.evidence}”</span>}</li>)}</ul>
        </section>
      )}

      {conflicts.length > 0 && (
        <section className="card border-warn">
          <h3 className="font-semibold mb-1">Sources disagree <span className="badge badge-warn">{conflicts.length}</span></h3>
          <ul className="text-sm space-y-1 list-disc pl-5">{conflicts.map((c, i) => <li key={i}><strong>{c.field}:</strong> {c.detail}</li>)}</ul>
          <p className="muted text-xs mt-1">Both versions are kept; nothing was chosen to improve the score. Correct the record once you know which is right.</p>
        </section>
      )}

      {a && doc && (
        <section className="card p-0 overflow-x-auto">
          <h3 className="font-semibold p-4 pb-2">Score breakdown</h3>
          <table>
            <thead><tr><th>Criterion</th><th>Weight</th><th>Score</th><th>Points</th><th>Why</th></tr></thead>
            <tbody>
              {doc.items.map((c) => (
                <tr key={c.criterion} className={c.known ? "" : "opacity-80"}>
                  <td className="font-medium">{c.label}</td>
                  <td>{c.weight}</td>
                  <td>{c.known ? <span className={`badge ${scoreClass(c.score)}`}>{c.score}</span> : <span className="badge">unknown</span>}</td>
                  <td>{c.points != null ? `${c.points} / ${c.weight}` : <span className="muted">not counted</span>}</td>
                  <td className="text-sm">
                    <ul className="space-y-0.5">{c.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                    {c.evidence.length > 0 && <div className="muted text-xs mt-1">Evidence: {c.evidence.slice(0, 4).map((q, i) => <em key={i}>“{q}” </em>)}</div>}
                    {c.unverified.length > 0 && <div className="text-xs mt-1 text-warn">Unverified: {c.unverified.join("; ")}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {a && (
        <div className="grid gap-4 md:grid-cols-2">
          <ListCard title="Strongest reasons to pursue" items={a.strengths} empty="None established yet." />
          <ListCard title="Missing or unverified" items={a.missing} empty="Nothing outstanding." tone="warn" />
          {kind === "vacancy" && <ListCard title="Skills or qualifications you could develop" items={a.develop} empty="None identified." />}
          <ListCard title={kind === "vacancy" ? "Questions to resolve before applying" : "Questions to resolve before approaching"} items={a.questions} empty="None." />
          <ListCard title="Recommended next steps" items={a.next_steps} empty="None." />
        </div>
      )}

      {kind === "vacancy" && (
        <section className="card p-0 overflow-x-auto">
          <h3 className="font-semibold p-4 pb-1">Requirements the vacancy states</h3>
          <p className="muted text-xs px-4 pb-2">Each is quoted from this vacancy’s own text. Confirm, correct, dispute or reject them; your decisions outrank the AI and are kept when research is refreshed.</p>
          <table>
            <thead><tr><th>Requirement</th><th>Type</th><th>Evidence</th><th>Your review</th><th></th></tr></thead>
            <tbody>
              {requirements.map((r) => (
                <tr key={r.id} className={r.review === "rejected" ? "opacity-50" : ""}>
                  <td>
                    <div className="font-medium">{r.text}</div>
                    {r.quote && <div className="muted text-xs italic">“{r.quote}”{r.source_id && sourceUrls[r.source_id] && <> — <a className="underline" href={sourceUrls[r.source_id]} target="_blank" rel="noopener noreferrer">source</a></>}</div>}
                  </td>
                  <td><span className={`badge ${r.necessity === "essential" ? "badge-danger" : r.necessity === "desirable" ? "badge-accent" : ""}`}>{r.necessity}</span> <span className="badge">{r.kind}</span></td>
                  <td><EvidenceBadge status={r.evidence_status} /> <span className="muted text-xs">{r.extracted_by === "human" ? "added by you" : "AI-extracted"}</span></td>
                  <td><span className={`badge ${r.review === "confirmed" || r.review === "corrected" ? "badge-ok" : r.review === "disputed" ? "badge-warn" : ""}`}>{r.review}</span>{r.review_note && <div className="muted text-xs">{r.review_note}</div>}</td>
                  <td className="whitespace-nowrap">
                    <div className="flex gap-1 flex-wrap">
                      <form action={reviewRequirement.bind(null, r.id, "confirmed")}><button className="btn btn-sm">Confirm</button></form>
                      <form action={reviewRequirement.bind(null, r.id, "disputed")}><button className="btn btn-sm">Dispute</button></form>
                      <form action={reviewRequirement.bind(null, r.id, "rejected")}><button className="btn btn-sm">Reject</button></form>
                      <details className="relative">
                        <summary className="btn btn-sm cursor-pointer">Correct</summary>
                        <form action={correctRequirement.bind(null, r.id)} className="card absolute right-0 z-10 w-72 space-y-2 text-sm">
                          <input name="text" defaultValue={r.text} />
                          <select name="kind" defaultValue={r.kind}>{["qualification", "registration", "experience", "skill", "software", "other"].map((k) => <option key={k}>{k}</option>)}</select>
                          <select name="necessity" defaultValue={r.necessity}>{["essential", "desirable", "unclear"].map((k) => <option key={k}>{k}</option>)}</select>
                          <input name="note" placeholder="Why (optional)" />
                          <button className="btn btn-sm btn-primary" type="submit">Save correction</button>
                        </form>
                      </details>
                    </div>
                  </td>
                </tr>
              ))}
              {requirements.length === 0 && <tr><td colSpan={5} className="muted text-center py-6">No requirements recorded yet. {running ? "Research is in progress." : "Run the research, or add one below."}</td></tr>}
            </tbody>
          </table>
          <form action={addRequirement.bind(null, entityId)} className="grid-form p-4 border-t border-border">
            <div className="col-span-full muted text-xs">Add a requirement you have seen on the advert yourself:</div>
            <div className="md:col-span-2"><input name="text" placeholder="e.g. Full UK driving licence" /></div>
            <div><select name="kind" defaultValue="other">{["qualification", "registration", "experience", "skill", "software", "other"].map((k) => <option key={k}>{k}</option>)}</select></div>
            <div><select name="necessity" defaultValue="essential">{["essential", "desirable", "unclear"].map((k) => <option key={k}>{k}</option>)}</select></div>
            <div className="md:col-span-3"><input name="quote" placeholder="Exact wording from the advert (optional)" /></div>
            <div><button className="btn btn-sm" type="submit">Add</button></div>
          </form>
        </section>
      )}

      <section className="card space-y-2">
        <h3 className="font-semibold">Research runs</h3>
        <div className="flex flex-wrap gap-2">
          <form action={research.bind(null, entityId, false)}><button className="btn btn-primary" disabled={running}>{a ? "Research again" : "Run research"}</button></form>
          <form action={research.bind(null, entityId, true)}><button className="btn" disabled={running}>Refresh (re-read sources)</button></form>
          {latestRun && (latestRun.status === "failed" || latestRun.status === "partial") && <form action={retryRun.bind(null, latestRun.id)}><button className="btn" disabled={running}>Retry failed run</button></form>}
        </div>
        {latestRun && latestRun.status === "queued" && Date.now() - new Date(latestRun.created_at).getTime() > 15 * 60_000 && <p className="text-warn text-sm">Queued for over 15 minutes: the worker may not be running. Retry once it is.</p>}
        <ul className="text-sm space-y-3">
          {runs.map((r) => (
            <li key={r.id}>
              <div><span className={`badge ${r.status === "succeeded" ? "badge-ok" : r.status === "failed" ? "badge-danger" : r.status === "partial" ? "badge-warn" : ""}`}>{r.status}</span> <span className="muted">{fmtDateTime(r.created_at)} · {r.trigger}{r.completeness != null && ` · ${Number(r.completeness).toFixed(0)}% complete`}</span></div>
              {r.error && <div className="text-warn text-xs">{r.error}</div>}
              <ul className="ml-4 mt-1 space-y-0.5 text-xs">
                {((r.steps ?? []) as unknown as Step[]).map((s, i) => (
                  <li key={i}><span className={s.status === "failed" ? "text-danger" : s.status === "skipped" ? "muted" : ""}>{s.status === "failed" ? "✗" : s.status === "skipped" ? "–" : "✓"} {humanise(s.step)}</span>{s.detail && <span className="muted"> — {s.detail}</span>}
                    {(s.sources ?? []).map((src, j) => <div key={j} className="ml-4 muted">{src.ok ? "read" : "could not read"} <a className="underline" href={src.url} target="_blank" rel="noopener noreferrer">{src.url}</a>{src.official ? " (official)" : ""}{!src.ok && ` — ${src.error ?? `HTTP ${src.status ?? "?"}`}`}</div>)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {runs.length === 0 && <li className="muted">No research has run yet.</li>}
        </ul>
        <p className="muted text-xs">Research reads public pages only, respects robots.txt, never contacts the employer and never sends your details anywhere. A blocked page lowers completeness; it is never treated as “no problem found”.</p>
      </section>

      {a && (
        <section className="card space-y-2">
          <h3 className="font-semibold">Your review</h3>
          {a.reviewed_at ? <p className="text-sm">Reviewed {fmtDateTime(a.reviewed_at)}.{a.review_note && <> “{a.review_note}”</>} A change to the vacancy, your profile, the weights or a requirement creates a new assessment that needs reviewing again.</p> : (
            <form action={markAssessmentReviewed.bind(null, a.id)} className="flex flex-wrap gap-2">
              <input name="review_note" placeholder="Note (optional)" className="flex-1 min-w-48" />
              <button className="btn btn-primary" type="submit">Mark research as reviewed</button>
            </form>
          )}
        </section>
      )}

      <section className="card space-y-2">
        <h3 className="font-semibold">Next</h3>
        <div className="flex flex-wrap gap-2 items-center">
          <form action={saveForStage3.bind(null, kind, entityId)}><button className="btn btn-primary" disabled={!state.ready || !!state.stage3_saved_at}>Save for Stage 3</button></form>
          <form action={returnToDiscovery.bind(null, kind, entityId)}><button className="btn">Return to Discovery</button></form>
          <form action={(kind === "vacancy" ? dismissVacancy : dismissEmployer).bind(null, entityId)}><button className="btn">Dismiss</button></form>
          {!state.ready && <span className="muted text-xs">Stage 3 needs: a reviewed assessment, an approved profile, at least 60% completeness, no conflicting sources or open disputes, and a run that did not fail.</span>}
        </div>
      </section>

      {history.length > 1 && (
        <section className="card p-0 overflow-x-auto">
          <h3 className="font-semibold p-4 pb-2">Assessment history</h3>
          <table>
            <thead><tr><th>Computed</th><th>Score</th><th>Completeness</th><th>Profile</th><th>Weights</th><th></th></tr></thead>
            <tbody>{history.map((h) => <tr key={h.id}><td>{fmtDateTime(h.computed_at)}</td><td>{Number(h.total).toFixed(0)}</td><td>{Number(h.completeness).toFixed(0)}%</td><td>v{h.profile_version}</td><td>v{h.weights_version}</td><td>{h.is_current ? <span className="badge badge-ok">current</span> : <span className="muted text-xs">superseded</span>}{h.reviewed_at && <span className="badge ml-1">reviewed</span>}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function ListCard({ title, items, empty, tone }: { title: string; items: string[]; empty: string; tone?: "warn" }) {
  return (
    <section className="card">
      <h3 className="font-semibold mb-1">{title}</h3>
      {items.length === 0 ? <p className="muted text-sm">{empty}</p> : <ul className={`text-sm space-y-1 list-disc pl-5 ${tone === "warn" ? "text-warn" : ""}`}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>}
    </section>
  );
}
