import Link from "next/link";
import { notFound } from "next/navigation";
import { APPLICATION_STAGES, INTERVIEW_FORMATS } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, humanise } from "@/lib/utils";
import { StageBadge, StatusBadge } from "@/components/badges";
import { addInterview, changeApplicationStage, logSubmission, updateApplication, updateInterview } from "@/server/actions/applications";

export const dynamic = "force-dynamic";

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data: a } = await supabase.from("applications").select("*, employers(id, legal_name, display_name, applications_email), vacancies(id, title, original_url, closing_at, application_route, application_email, application_url, hard_flags, eligibility_status, portfolio_requirements)").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!a) notFound();
  const [{ data: interviews }, { data: docs }, { data: transitions }, { data: activities }] = await Promise.all([
    supabase.from("interviews").select("*").eq("application_id", id).order("round"),
    supabase.from("documents").select("id, kind, version_label, is_current").is("deleted_at", null).order("kind"),
    supabase.from("stage_transitions").select("*").eq("pipeline", "application").eq("entity_id", id).order("changed_at"),
    supabase.from("activities").select("*").eq("application_id", id).order("occurred_at", { ascending: false }),
  ]);
  const e = a.employers as { id: string; legal_name: string; display_name: string | null; applications_email: string | null };
  const v = a.vacancies as { id: string; title: string; original_url: string; closing_at: string | null; application_route: string; application_email: string | null; application_url: string | null; hard_flags: string[]; eligibility_status: string; portfolio_requirements: string | null } | null;
  const snapshot = (a.documents_snapshot as { kind: string; version_label: string; file_name: string }[]) ?? [];
  const isSubmitted = ["submitted", "acknowledged", "shortlisted", "interview_1", "further_interview", "offer_received", "offer_accepted", "rejected", "closed_without_response"].includes(a.stage);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-start">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">{v?.title ?? `${humanise(a.application_type)} application`}</h1>
          <div className="muted text-sm flex flex-wrap gap-2 mt-1">
            <Link className="underline" href={`/employers/${e.id}`}>{e.display_name ?? e.legal_name}</Link>
            {v && <Link className="underline" href={`/vacancies/${v.id}`}>vacancy</Link>}
            {v && <a className="underline" href={v.original_url} target="_blank" rel="noreferrer">listing</a>}
            <span>{humanise(a.application_type)}</span>
            {a.deadline_at && <span className="text-warn">deadline {fmtDateTime(a.deadline_at)}</span>}
          </div>
        </div>
        <StageBadge stage={a.stage} />
      </div>
      {v && v.hard_flags.length > 0 && <div className="card border-danger text-sm"><strong>Hard eligibility flags on this vacancy:</strong> {v.hard_flags.join(", ")}. Check before submitting.</div>}

      <div className="card flex flex-wrap gap-2 items-end">
        <form action={changeApplicationStage} className="flex gap-2 items-end">
          <input type="hidden" name="id" value={a.id} />
          <div><label>Stage</label><select name="stage" defaultValue={a.stage} className="min-w-56">{APPLICATION_STAGES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select></div>
          <div className="w-64"><label>Note</label><input name="note" placeholder="optional" /></div>
          <button className="btn" type="submit">Update stage</button>
        </form>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="font-semibold mb-2">Preparation</h2>
          <form action={updateApplication.bind(null, a.id)} className="grid-form text-sm">
            <div><label>CV version</label><select name="cv_document_id" defaultValue={a.cv_document_id ?? ""}><option value="">—</option>{(docs ?? []).filter((d) => d.kind === "cv").map((d) => <option key={d.id} value={d.id}>{d.version_label}{d.is_current ? " (current)" : ""}</option>)}</select></div>
            <div><label>Portfolio version</label><select name="portfolio_document_id" defaultValue={a.portfolio_document_id ?? ""}><option value="">—</option>{(docs ?? []).filter((d) => d.kind === "portfolio").map((d) => <option key={d.id} value={d.id}>{d.version_label}</option>)}</select></div>
            <div><label>Cover letter file</label><select name="cover_letter_document_id" defaultValue={a.cover_letter_document_id ?? ""}><option value="">—</option>{(docs ?? []).filter((d) => d.kind === "cover_letter").map((d) => <option key={d.id} value={d.id}>{d.version_label}</option>)}</select></div>
            <div><label>Deadline</label><input name="deadline_at" type="datetime-local" defaultValue={a.deadline_at ? a.deadline_at.slice(0, 16) : ""} /></div>
            <div className="col-span-full"><label>Cover letter / tailored text</label><textarea name="cover_letter_text" rows={8} defaultValue={a.cover_letter_text ?? ""} /></div>
            <div className="col-span-full"><label>Tailoring notes (which project, which skills, what gap you addressed)</label><textarea name="tailoring_notes" rows={3} defaultValue={a.tailoring_notes ?? ""} /></div>
            <div className="col-span-full"><label>Answers to application questions</label><textarea name="application_answers" rows={3} defaultValue={(a.application_answers as { text?: string } | null)?.text ?? ""} /></div>
            <div><label>Salary expectation stated</label><input name="salary_expectation" defaultValue={a.salary_expectation ?? ""} /></div>
            <div><label>Availability stated</label><input name="availability_stated" defaultValue={a.availability_stated ?? ""} /></div>
            <div><label>Right-to-work answer</label><input name="right_to_work_answer" defaultValue={a.right_to_work_answer ?? ""} /></div>
            <div><label>Next action</label><input name="next_action" defaultValue={a.next_action ?? ""} /></div>
            <div><label>Next action due</label><input name="next_action_due" type="datetime-local" defaultValue={a.next_action_due ? a.next_action_due.slice(0, 16) : ""} /></div>
            <div className="col-span-full"><label>Notes</label><textarea name="notes" rows={2} defaultValue={a.notes ?? ""} /></div>
            <div className="col-span-full"><button className="btn btn-primary" type="submit">Save</button></div>
          </form>
        </section>

        <div className="space-y-4">
          {!isSubmitted ? (
            <section className="card">
              <h2 className="font-semibold mb-2">Log submission</h2>
              <p className="muted text-xs mb-2">Records the exact documents attached at this moment so you always know which CV version the company received. {v?.application_route && v.application_route !== "unknown" && <>Listing says: apply via <strong>{v.application_route}</strong>{v.application_email ? ` (${v.application_email})` : ""}{v.application_url ? <> — <a className="underline" href={v.application_url} target="_blank" rel="noreferrer">link</a></> : ""}.</>}</p>
              <form action={logSubmission} className="grid-form text-sm">
                <input type="hidden" name="id" value={a.id} />
                <div><label>Submitted via</label><select name="submitted_via" defaultValue={v?.application_route === "email" ? "email" : "portal"}>{["portal", "email", "ats", "agency", "linkedin", "in_person"].map((x) => <option key={x} value={x}>{humanise(x)}</option>)}</select></div>
                <div><label>Submitted to (email / portal)</label><input name="submitted_to" defaultValue={v?.application_email ?? e.applications_email ?? ""} /></div>
                <div><label>Confirmation reference</label><input name="confirmation_ref" /></div>
                <div className="col-span-full"><label>Notes</label><input name="notes" /></div>
                <div className="col-span-full"><button className="btn btn-primary" type="submit">Mark as submitted</button></div>
              </form>
            </section>
          ) : (
            <section className="card text-sm space-y-1">
              <h2 className="font-semibold mb-2">Submission</h2>
              <div className="flex justify-between"><span className="muted">Submitted</span><span>{fmtDateTime(a.submitted_at)}</span></div>
              <div className="flex justify-between"><span className="muted">Via</span><span>{a.submitted_via ?? "—"} {a.submitted_to ? `→ ${a.submitted_to}` : ""}</span></div>
              <div className="flex justify-between"><span className="muted">Reference</span><span>{a.confirmation_ref ?? "—"}</span></div>
              <div className="flex justify-between"><span className="muted">Acknowledged</span><span>{fmtDateTime(a.acknowledged_at)}</span></div>
              <div><span className="muted">Documents sent:</span> {snapshot.length ? snapshot.map((d) => `${d.kind} ${d.version_label}`).join(", ") : "—"}</div>
            </section>
          )}

          <section className="card">
            <h2 className="font-semibold mb-2">Interviews</h2>
            {(interviews ?? []).map((i) => (
              <form key={i.id} action={updateInterview.bind(null, i.id)} className="grid-form text-sm border-b border-border pb-3 mb-3">
                <div className="col-span-full font-medium">Round {i.round} <StatusBadge value={i.outcome} /></div>
                <div><label>When</label><input name="scheduled_at" type="datetime-local" defaultValue={i.scheduled_at ? i.scheduled_at.slice(0, 16) : ""} /></div>
                <div><label>Format</label><select name="format" defaultValue={i.format}>{INTERVIEW_FORMATS.map((f) => <option key={f} value={f}>{humanise(f)}</option>)}</select></div>
                <div><label>Location / link</label><input name="location" defaultValue={i.location ?? ""} /></div>
                <div><label>Interviewers</label><input name="interviewers" defaultValue={i.interviewers ?? ""} /></div>
                <div><label>Outcome</label><select name="outcome" defaultValue={i.outcome}>{["pending", "progressed", "rejected", "offer", "withdrawn"].map((f) => <option key={f} value={f}>{humanise(f)}</option>)}</select></div>
                <div className="col-span-full"><label>Preparation notes</label><textarea name="prep_notes" rows={2} defaultValue={i.prep_notes ?? ""} /></div>
                <div className="col-span-full"><label>Questions asked / feedback</label><textarea name="feedback" rows={2} defaultValue={i.feedback ?? ""} /></div>
                <div className="col-span-full"><button className="btn btn-sm" type="submit">Save round {i.round}</button></div>
              </form>
            ))}
            <form action={addInterview} className="grid-form text-sm">
              <input type="hidden" name="application_id" value={a.id} />
              <div><label>When</label><input name="scheduled_at" type="datetime-local" /></div>
              <div><label>Format</label><select name="format" defaultValue="in_person">{INTERVIEW_FORMATS.map((f) => <option key={f} value={f}>{humanise(f)}</option>)}</select></div>
              <div><label>Location / link</label><input name="location" /></div>
              <div><label>Interviewers</label><input name="interviewers" /></div>
              <div className="col-span-full"><button className="btn" type="submit">Add interview round</button> <span className="muted text-xs ml-2">Creates a preparation task the day before.</span></div>
            </form>
          </section>

          <section className="card">
            <h2 className="font-semibold mb-2">Outcome</h2>
            <form action={updateApplication.bind(null, a.id)} className="grid-form text-sm">
              <div className="col-span-full"><label>Feedback received</label><textarea name="feedback" rows={2} defaultValue={a.feedback ?? ""} /></div>
              <div><label>Rejection reason (if given)</label><input name="outcome_reason" defaultValue={a.outcome_reason ?? ""} /></div>
              <div><label>Offer decision deadline</label><input name="offer_decision_deadline" type="datetime-local" defaultValue={a.offer_decision_deadline ? a.offer_decision_deadline.slice(0, 16) : ""} /></div>
              <div><label>Offer salary</label><input name="offer_salary" defaultValue={(a.offer as { salary?: string } | null)?.salary ?? ""} /></div>
              <div><label>Offer notes</label><input name="offer_notes" defaultValue={(a.offer as { notes?: string } | null)?.notes ?? ""} /></div>
              <div className="col-span-full"><label>Lessons learned</label><textarea name="lessons_learned" rows={2} defaultValue={a.lessons_learned ?? ""} /></div>
              <div className="col-span-full"><button className="btn" type="submit">Save outcome</button></div>
            </form>
          </section>
        </div>
      </div>

      <section className="card">
        <h2 className="font-semibold mb-2">History</h2>
        <ul className="text-sm space-y-1">
          {(transitions ?? []).map((t) => <li key={t.id} className="flex gap-2"><span className="muted whitespace-nowrap">{fmtDateTime(t.changed_at)}</span><span>{t.from_stage ? `${humanise(t.from_stage)} → ` : ""}{humanise(t.to_stage)}</span>{t.note && <span className="muted">— {t.note}</span>}</li>)}
          {(activities ?? []).map((ac) => <li key={ac.id} className="flex gap-2"><span className="muted whitespace-nowrap">{fmtDateTime(ac.occurred_at)}</span><span className="badge">{humanise(ac.activity_type)}</span><span>{ac.subject ?? ac.body_text}</span><StatusBadge value={ac.direction === "internal" ? null : ac.delivery_result} /></li>)}
        </ul>
        <p className="muted text-xs mt-2">Created {fmtDate(a.created_at)}.</p>
      </section>
    </div>
  );
}
