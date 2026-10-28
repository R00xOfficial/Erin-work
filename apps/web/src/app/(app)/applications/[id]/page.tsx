import Link from "next/link";
import { notFound } from "next/navigation";
import { APPLICATION_STAGES, OUTCOME_LABELS, applicationReadiness, nextAction, selectableStages, type ApplicationStage } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, humanise } from "@/lib/utils";
import { StageBadge } from "@/components/badges";
import * as act from "@/server/actions/applications";

export const dynamic = "force-dynamic";

const DRAFT_KINDS = ["cover_letter", "speculative_email", "recruiter_intro", "answer", "interview_prep", "follow_up", "thank_you"] as const;
const LOG_KINDS = [["note", "Note"], ["email_sent", "Email I sent"], ["email_received", "Email I received"], ["call", "Phone call"], ["meeting", "Meeting"], ["interview_invitation", "Interview invitation"], ["assessment_request", "Assessment request"], ["employer_feedback", "Employer feedback"], ["follow_up", "Follow-up I made"]] as const;
const SUBMIT_METHODS = ["email", "portal", "post", "in_person", "other"] as const;
const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

type Flag = { code: string; excerpt: string; message: string };
type SnapDoc = { document_id: string; kind: string; version_label: string; file_name: string; sha256: string };

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data: a } = await supabase.from("applications").select("*, employers(id, legal_name, display_name, applications_email), vacancies(id, title, original_url, closing_at, status, application_route, application_email, application_url, hard_flags, portfolio_requirements)").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!a) notFound();
  const [{ data: interviews }, { data: docs }, { data: transitions }, { data: activities }, { data: checklist }, { data: drafts }, { data: followups }, { data: snippets }] = await Promise.all([
    supabase.from("interviews").select("*").eq("application_id", id).order("round"),
    supabase.from("documents").select("id, kind, version_label, is_current, file_name, sha256").is("deleted_at", null).order("kind").order("created_at", { ascending: false }),
    supabase.from("stage_transitions").select("*").eq("pipeline", "application").eq("entity_id", id).order("changed_at"),
    supabase.from("activities").select("id, activity_type, direction, subject, body_text, occurred_at, origin, confirmation, delivery_result, approval_status, attachments").eq("application_id", id).order("occurred_at", { ascending: false }),
    supabase.from("application_checklist_items").select("*").eq("application_id", id).order("sort"),
    supabase.from("application_drafts").select("*").eq("application_id", id).neq("status", "discarded").order("created_at", { ascending: false }),
    supabase.from("application_followups").select("*").eq("application_id", id).order("due_at"),
    supabase.from("reusable_snippets").select("id").not("approved_at", "is", null),
  ]);
  const e = a.employers as { id: string; legal_name: string; display_name: string | null; applications_email: string | null };
  const v = a.vacancies as { id: string; title: string; original_url: string; closing_at: string | null; status: string; application_route: string; application_email: string | null; application_url: string | null; hard_flags: string[]; portfolio_requirements: string | null } | null;
  const confirmed = !!a.submission_confirmed_at;
  const stage = a.stage as ApplicationStage;
  const priority = (a.priority_snapshot ?? null) as null | { status?: string; score?: number; rationale?: string[]; warnings?: unknown[]; computed_at?: string; suitability_total?: number };
  const research = (a.research_snapshot ?? null) as null | { total?: number; completeness?: number; confidence?: string; blockers?: { text: string }[]; missing?: { text?: string }[] };
  const sent = (a.submitted_snapshot ?? null) as null | { documents?: SnapDoc[]; cover_letter_text?: string | null; drafts?: { id: string; kind: string; subject: string | null; body: string }[]; method?: string; recipient?: string; confirmed_by?: string };
  const listingClosed = !!v && ["closed", "filled", "withdrawn"].includes(v.status);
  const items = checklist ?? [];
  const prep = items.filter((c) => !c.interview_id);
  const openFollowups = (followups ?? []).filter((f) => f.status === "open" || f.status === "snoozed");
  const now = new Date();

  const message = (drafts ?? []).filter((d) => ["cover_letter", "speculative_email", "recruiter_intro"].includes(d.kind));
  const readiness = applicationReadiness({
    now, deadline: a.deadline_at ? new Date(a.deadline_at) : null, openRequiredChecklist: prep.filter((c) => c.required && !c.done).map((c) => c.label), cvSelected: !!a.cv_document_id, recipientKnown: !!a.recipient, methodKnown: !!a.submitted_via || !!a.recipient,
    messageFinal: message.some((d) => d.status === "final") || !!a.cover_letter_text, messageRequired: true, unacknowledgedDraftFlags: (drafts ?? []).filter((d) => ((d.flags ?? []) as unknown[]).length > 0 && !d.flags_acknowledged_at && d.status !== "final").length,
    stage2Blockers: (research?.blockers ?? []).map((b) => b.text), listingClosed,
  });
  const nextInterview = (interviews ?? []).filter((i) => i.scheduled_at && new Date(i.scheduled_at) > now && i.outcome === "pending").sort((x, y) => x.scheduled_at!.localeCompare(y.scheduled_at!))[0];
  const nf = openFollowups.filter((f) => f.status === "open").sort((x, y) => x.due_at.localeCompare(y.due_at))[0];
  const next = nextAction({ now, stage, deadline: a.deadline_at ? new Date(a.deadline_at) : null, openRequiredChecklist: prep.filter((c) => c.required && !c.done).length, nextInterviewAt: nextInterview?.scheduled_at ? new Date(nextInterview.scheduled_at) : null, nextFollowUp: nf ? { dueAt: new Date(nf.due_at), title: nf.title } : null, offerDecisionDeadline: a.offer_decision_deadline ? new Date(a.offer_decision_deadline) : null, listingClosed, submitted: confirmed });

  // One chronological record. Entries are labelled by where they came from: synced from a mailbox, or logged by Erin.
  type Entry = { at: string; kind: "activity" | "stage"; title: string; body?: string | null; origin?: string; confirmation?: string | null; extra?: string };
  const timeline: Entry[] = [
    ...(activities ?? []).map((x): Entry => ({ at: x.occurred_at, kind: "activity", title: x.subject ?? humanise(x.activity_type), body: x.body_text, origin: x.origin, confirmation: x.confirmation, extra: `${humanise(x.activity_type)} · ${humanise(x.direction)}${x.approval_status === "pending_approval" ? " · awaiting your approval" : ""}` })),
    ...(transitions ?? []).map((t): Entry => ({ at: t.changed_at, kind: "stage", title: `Stage: ${t.from_stage ? `${humanise(t.from_stage)} → ` : ""}${humanise(t.to_stage)}`, body: t.note })),
  ].sort((x, y) => y.at.localeCompare(x.at));

  const docOptions = (kind: string, current: string | null) => (docs ?? []).filter((d) => d.kind === kind).map((d) => <option key={d.id} value={d.id} selected={d.id === current}>{d.version_label}{d.is_current ? " (current)" : ""}</option>);
  const A = id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-start">
        <div className="mr-auto">
          <div className="muted text-xs"><Link className="underline" href="/applications">Applications</Link></div>
          <h1 className="text-xl font-semibold">{v?.title ?? `${humanise(a.application_type)} application`}</h1>
          <div className="muted text-sm flex flex-wrap gap-2 mt-1">
            <Link className="underline" href={`/employers/${e.id}`}>{e.display_name ?? e.legal_name}</Link>
            {v && <Link className="underline" href={`/vacancies/${v.id}`}>vacancy</Link>}
            {v && <a className="underline" href={v.original_url} target="_blank" rel="noreferrer">listing</a>}
            <span>{humanise(a.application_type)}</span>
            {a.deadline_at && <span className="text-warn">closes {fmtDateTime(a.deadline_at)}</span>}
            {listingClosed && <span className="badge">listing closed</span>}
          </div>
        </div>
        <StageBadge stage={stage} />
        {confirmed ? <span className="badge badge-ok">Submission confirmed {fmtDate(a.submitted_at)}</span> : <span className="badge">Not submitted</span>}
      </div>
      {v && v.hard_flags.length > 0 && <div className="card border-danger text-sm"><strong>Eligibility flags on this vacancy:</strong> {v.hard_flags.join(", ")}. Check before submitting.</div>}
      {listingClosed && !confirmed && <div className="card border-warn text-sm">The vacancy is recorded as {v!.status}. Check before putting in more work.</div>}
      {listingClosed && confirmed && !["offer_accepted", "offer_declined", "rejected", "withdrawn", "vacancy_closed", "closed_without_response"].includes(stage) && <div className="card text-sm">The listing has closed. That is not an outcome: record one below only when you know it.</div>}

      <section className="card flex flex-wrap gap-4 items-center">
        <div className="mr-auto"><div className="text-xs muted">Next step</div><div className="font-medium">{next.label}</div><div className="muted text-xs">{next.reason}</div></div>
        <form action={act.changeApplicationStage} className="flex gap-2 items-end">
          <input type="hidden" name="id" value={a.id} />
          <div><label>Stage</label><select name="stage" defaultValue={stage}>{selectableStages(stage, confirmed, APPLICATION_STAGES).filter((s) => !["offer_accepted", "offer_declined", "rejected", "withdrawn", "vacancy_closed", "closed_without_response", "offer_received"].includes(s) || s === stage).map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select></div>
          <div className="w-48"><label>Note</label><input name="note" /></div>
          <button className="btn">Change</button>
        </form>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {/* Why this application, and what research said at the time. Snapshots: later recalculation does not rewrite them. */}
          <section className="card space-y-2">
            <h2 className="font-semibold">Why this application</h2>
            {a.selection_reason && <p className="text-sm">{a.selection_reason}</p>}
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div><div className="muted text-xs">Priority when selected (Stage 3)</div>{priority ? <><div>{humanise(priority.status)}{priority.score != null ? ` · ${Math.round(priority.score)}/100` : ""}</div><div className="muted text-xs">as at {fmtDate(priority.computed_at)}</div></> : <div className="muted">Not started from the priority list.</div>}</div>
              <div><div className="muted text-xs">Research when selected (Stage 2)</div>{research ? <><div>{research.total != null ? `Suitability ${Math.round(research.total)}/100` : "Not scored"} · {research.confidence ?? "confidence unknown"}</div>{(research.blockers ?? []).map((b, i) => <div key={i} className="text-warn text-xs">Blocker: {b.text}</div>)}</> : <div className="muted">No research recorded.</div>}</div>
            </div>
            <div className="flex gap-3 text-xs"><Link className="underline" href={`/employers/${e.id}`}>Employer record</Link>{v && <Link className="underline" href={`/research/vacancies/${v.id}`}>Research &amp; assessment</Link>}</div>
            {a.repeat_reason && <p className="text-xs muted">Repeat approach confirmed: {a.repeat_reason}</p>}
          </section>

          {/* Readiness */}
          {!confirmed && (
            <section className="card space-y-2">
              <h2 className="font-semibold">Ready for review?</h2>
              {readiness.issues.length === 0 ? <p className="text-sm">Nothing is outstanding.</p> : <ul className="text-sm space-y-1">{readiness.issues.map((i, n) => <li key={n}><span className={`badge mr-2 ${i.severity === "blocker" ? "badge-danger" : "badge-warn"}`}>{i.severity === "blocker" ? "Must fix" : "Check"}</span>{i.text}</li>)}</ul>}
              <div className="flex gap-2 items-center">
                {stage !== "ready_to_submit" ? <form action={act.markReadyForReview.bind(null, A)}><button className="btn btn-primary" disabled={!readiness.ready}>Mark ready for review</button></form> : <form action={act.backToPreparing.bind(null, A)}><button className="btn">Back to preparing</button></form>}
                <span className="muted text-xs">“Ready for review” means prepared. It does not mean sent.</span>
              </div>
            </section>
          )}

          {/* Checklist */}
          <section className="card space-y-2">
            <h2 className="font-semibold">Checklist <span className="muted text-xs font-normal">{prep.filter((c) => c.done).length}/{prep.length}</span></h2>
            <ul className="space-y-1">{prep.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                <form action={act.toggleChecklistItem.bind(null, c.id, A)}><button className="btn btn-sm" aria-label={c.done ? "Mark not done" : "Mark done"}>{c.done ? "☑" : "☐"}</button></form>
                <span className={c.done ? "line-through muted" : ""}>{c.label}</span>
                {!c.required && <span className="badge">optional</span>}
                {c.due_at && <span className="muted text-xs">due {fmtDate(c.due_at)}</span>}
                <details className="ml-auto"><summary className="text-xs cursor-pointer">Edit</summary>
                  <form action={act.updateChecklistItem.bind(null, c.id, A)} className="grid-form mt-1">
                    <div><label>Label</label><input name="label" defaultValue={c.label} /></div><div><label>Due</label><input type="date" name="due_at" defaultValue={c.due_at?.slice(0, 10) ?? ""} /></div><div><label>Notes</label><input name="notes" defaultValue={c.notes ?? ""} /></div>
                    <label className="flex gap-2 items-center"><input type="checkbox" name="required" defaultChecked={c.required} className="w-auto" /> Required</label>
                    <div className="flex gap-2"><button className="btn btn-sm">Save</button><button className="btn btn-sm" formAction={act.deleteChecklistItem.bind(null, c.id, A)}>Remove</button></div>
                  </form></details>
              </li>))}</ul>
            <form action={act.addChecklistItem.bind(null, A)} className="flex flex-wrap gap-2 items-end"><div className="flex-1 min-w-56"><label>Add an item</label><input name="label" /></div><label className="flex gap-2 items-center text-xs"><input type="checkbox" name="required" defaultChecked className="w-auto" /> Required</label><button className="btn btn-sm">Add</button></form>
          </section>

          {/* Documents, recipient, instructions */}
          <section className="card space-y-3">
            <h2 className="font-semibold">Documents, recipient and instructions</h2>
            {confirmed ? (
              <div className="text-sm space-y-2">
                <p className="muted text-xs">Frozen at submission. Changing the base CV or editing drafts later does not alter this record.</p>
                <ul className="space-y-1">{(sent?.documents ?? []).map((d) => <li key={d.document_id}><span className="badge mr-2">{humanise(d.kind)}</span>{d.version_label} · {d.file_name} <a className="underline ml-2" href={`/api/documents/${d.document_id}`}>Open</a> <span className="muted text-xs">sha {d.sha256.slice(0, 10)}</span></li>)}</ul>
                {sent?.cover_letter_text && <details><summary className="cursor-pointer text-xs">Cover letter as sent</summary><pre className="whitespace-pre-wrap text-sm mt-1">{sent.cover_letter_text}</pre></details>}
                {(sent?.drafts ?? []).map((d) => <details key={d.id}><summary className="cursor-pointer text-xs">{humanise(d.kind)} as sent</summary><pre className="whitespace-pre-wrap text-sm mt-1">{d.body}</pre></details>)}
                <div className="text-xs muted">Sent to {a.submitted_to} by {humanise(a.submitted_via)} · confirmed by {a.submission_confirmed_by === "integration" ? "a synchronised sent email" : "you"}{a.confirmation_ref ? ` · ref ${a.confirmation_ref}` : ""}</div>
              </div>
            ) : (
              <form action={act.updateApplication.bind(null, A)} className="grid-form">
                <div><label>CV version</label><select name="cv_document_id" defaultValue={a.cv_document_id ?? ""}><option value="">— none —</option>{docOptions("cv", a.cv_document_id)}</select></div>
                <div><label>Portfolio version</label><select name="portfolio_document_id" defaultValue={a.portfolio_document_id ?? ""}><option value="">— none —</option>{docOptions("portfolio", a.portfolio_document_id)}</select></div>
                <div><label>Recipient or portal</label><input name="recipient" defaultValue={a.recipient ?? ""} placeholder="email address or portal link" /></div>
                <div><label>Closing date</label><input type="datetime-local" name="deadline_at" defaultValue={a.deadline_at ? a.deadline_at.slice(0, 16) : ""} /></div>
                <div className="col-span-full"><label>Submission instructions (from the listing or employer)</label><textarea name="submission_instructions" rows={2} defaultValue={a.submission_instructions ?? ""} /></div>
                <div><label>What the employer said about response time</label><input name="response_timeframe_text" defaultValue={a.response_timeframe_text ?? ""} placeholder="e.g. “we reply within 3 weeks”" /></div>
                <div><label>Expect a reply by</label><input type="date" name="response_expected_by" defaultValue={a.response_expected_by ?? ""} /></div>
                <div className="col-span-full"><label>Portfolio projects to include (one per line)</label><textarea name="portfolio_projects" rows={2} defaultValue={((a.portfolio_projects ?? []) as string[]).join("\n")} />{v?.portfolio_requirements && <p className="muted text-xs mt-1">Listing asks for: {v.portfolio_requirements}</p>}</div>
                <div className="col-span-full"><label>Application answers (draft text; final wording goes in a draft below)</label><textarea name="application_answers" rows={2} defaultValue={((a.application_answers ?? {}) as { text?: string }).text ?? ""} /></div>
                <div className="col-span-full"><label>Notes</label><textarea name="notes" rows={2} defaultValue={a.notes ?? ""} /></div>
                <div className="col-span-full"><button className="btn btn-primary">Save</button></div>
              </form>
            )}
          </section>

          {/* Drafts */}
          <section className="card space-y-3">
            <h2 className="font-semibold">Drafts</h2>
            <p className="muted text-xs">Drafts use only facts you have approved (your profile, approved snippets, verified employer facts). Anything the checker cannot support is flagged. A draft is not a message: nothing is sent until you approve an email on the Outreach page.</p>
            {(drafts ?? []).map((d) => {
              const flags = (d.flags ?? []) as Flag[];
              return (
                <details key={d.id} className="rounded border border-border p-2" open={d.status !== "final" && d.generation_state === "ready"}>
                  <summary className="cursor-pointer text-sm"><span className="badge mr-2">{humanise(d.kind)}</span>{d.title ?? d.subject ?? ""} <span className={`badge ml-2 ${d.status === "final" ? "badge-ok" : ""}`}>{d.status === "final" ? "Final" : "Draft"}</span>{d.source === "ai" && <span className="badge ml-1">AI-assisted</span>}{flags.length > 0 && <span className="badge badge-warn ml-1">{flags.length} to check</span>}{d.generation_state !== "ready" && <span className="badge ml-1">{humanise(d.generation_state)}</span>}</summary>
                  {d.generation_error && <p className="text-danger text-xs mt-1">{d.generation_error}</p>}
                  {flags.length > 0 && <ul className="text-xs mt-2 space-y-1">{flags.map((f, i) => <li key={i} className="text-warn">“{f.excerpt}” — {f.message}</li>)}</ul>}
                  {flags.length > 0 && !d.flags_acknowledged_at && d.status !== "final" && <form action={act.acknowledgeDraftFlags.bind(null, d.id, A)} className="mt-1"><button className="btn btn-sm">I have checked these claims</button></form>}
                  {d.status === "final" ? (
                    <div className="mt-2 space-y-2">{d.subject && <div className="text-sm font-medium">{d.subject}</div>}<pre className="whitespace-pre-wrap text-sm">{d.body}</pre>
                      <div className="flex flex-wrap gap-2"><form action={act.reopenDraft.bind(null, d.id, A)}><button className="btn btn-sm">Reopen to edit</button></form>
                        {!confirmed && ["cover_letter"].includes(d.kind) && <form action={act.useDraftAsCoverLetter.bind(null, d.id, A)}><button className="btn btn-sm">Use as the cover letter</button></form>}</div>
                      {["cover_letter", "speculative_email", "recruiter_intro", "follow_up", "thank_you"].includes(d.kind) && (
                        <form action={act.createEmailForApproval.bind(null, d.id, A)} className="flex flex-wrap gap-2 items-end border-t border-border pt-2"><div><label>Send to (you approve it on the Outreach page first)</label><input type="email" name="to" defaultValue={a.recipient?.includes("@") ? a.recipient : ""} required /></div><button className="btn btn-sm btn-primary">Prepare email for approval</button></form>)}
                    </div>
                  ) : d.generation_state === "ready" ? (
                    <form action={act.saveDraft.bind(null, d.id, A)} className="space-y-2 mt-2"><div><label>Subject</label><input name="subject" defaultValue={d.subject ?? ""} /></div><div><label>Body</label><textarea name="body" rows={12} defaultValue={d.body} /></div>
                      <div className="flex flex-wrap gap-2"><button className="btn btn-sm">Save edits</button><button className="btn btn-sm btn-primary" formAction={act.finaliseDraft.bind(null, d.id, A)}>Mark final</button><button className="btn btn-sm" formAction={act.discardDraft.bind(null, d.id, A)}>Discard</button></div></form>
                  ) : <form action={act.discardDraft.bind(null, d.id, A)} className="mt-2"><button className="btn btn-sm">Discard</button></form>}
                </details>);
            })}
            {(drafts ?? []).length === 0 && <p className="muted text-sm">No drafts yet.</p>}
            {!confirmed && (
              <div className="grid gap-3 md:grid-cols-2">
                <form action={act.requestDraft.bind(null, A)} className="rounded border border-border p-2 space-y-2"><div className="text-sm font-medium">Ask for a draft</div>
                  <div><label>Type</label><select name="kind">{DRAFT_KINDS.map((k) => <option key={k} value={k}>{humanise(k)}</option>)}</select></div><div><label>Question to answer (for “answer”)</label><textarea name="question" rows={2} /></div><button className="btn btn-sm btn-primary">Generate draft</button>
                  {(snippets ?? []).length === 0 && <p className="muted text-xs">No approved reusable snippets yet; drafts will rely on your approved profile.</p>}</form>
                <form action={act.createManualDraft.bind(null, A)} className="rounded border border-border p-2 space-y-2"><div className="text-sm font-medium">Write one yourself</div>
                  <div><label>Type</label><select name="kind">{DRAFT_KINDS.map((k) => <option key={k} value={k}>{humanise(k)}</option>)}</select></div><div><label>Subject</label><input name="subject" /></div><div><label>Text</label><textarea name="body" rows={3} /></div><button className="btn btn-sm">Save draft</button></form>
              </div>)}
          </section>

          {/* Interviews and assessments */}
          <section className="card space-y-3">
            <h2 className="font-semibold">Interviews and assessments</h2>
            {(interviews ?? []).map((i) => {
              const list = items.filter((c) => c.interview_id === i.id);
              return (
                <details key={i.id} className="rounded border border-border p-2" open={i.outcome === "pending"}>
                  <summary className="cursor-pointer text-sm"><span className="badge mr-2">{i.kind === "assessment" ? "Assessment" : `Round ${i.round}`}</span>{i.title ?? humanise(i.format)} · {i.scheduled_at ? fmtDateTime(i.scheduled_at) : "no date yet"}{i.deadline_at ? ` · due ${fmtDateTime(i.deadline_at)}` : ""} <span className="badge ml-2">{humanise(i.outcome)}</span></summary>
                  <ul className="mt-2 space-y-1">{list.map((c) => <li key={c.id} className="flex items-center gap-2 text-sm"><form action={act.toggleChecklistItem.bind(null, c.id, A)}><button className="btn btn-sm">{c.done ? "☑" : "☐"}</button></form><span className={c.done ? "line-through muted" : ""}>{c.label}</span></li>)}</ul>
                  <form action={act.updateInterview.bind(null, i.id)} className="grid-form mt-2">
                    <div><label>Title</label><input name="title" defaultValue={i.title ?? ""} /></div><div><label>When</label><input type="datetime-local" name="scheduled_at" defaultValue={i.scheduled_at?.slice(0, 16) ?? ""} /></div>
                    <div><label>Submit by (assessments)</label><input type="datetime-local" name="deadline_at" defaultValue={i.deadline_at?.slice(0, 16) ?? ""} /></div><div><label>Minutes</label><input type="number" name="duration_minutes" defaultValue={i.duration_minutes ?? ""} /></div>
                    <div><label>Location or link</label><input name="location" defaultValue={i.location ?? ""} /></div><div><label>Interviewers</label><input name="interviewers" defaultValue={i.interviewers ?? ""} /></div><div><label>Contact details</label><input name="contact_details" defaultValue={i.contact_details ?? ""} /></div>
                    <div><label>Outcome</label><select name="outcome" defaultValue={i.outcome}>{["pending", "progressed", "rejected", "offer", "withdrawn"].map((o) => <option key={o} value={o}>{humanise(o)}</option>)}</select></div>
                    <div className="col-span-full"><label>Instructions from the employer</label><textarea name="instructions" rows={2} defaultValue={i.instructions ?? ""} /></div>
                    <div className="col-span-full"><label>Preparation notes</label><textarea name="prep_notes" rows={2} defaultValue={i.prep_notes ?? ""} /></div>
                    <div><label>Questions to ask</label><textarea name="questions_to_ask" rows={2} defaultValue={i.questions_to_ask ?? ""} /></div><div><label>Questions they asked</label><textarea name="questions_asked" rows={2} defaultValue={i.questions_asked ?? ""} /></div>
                    <div className="col-span-full"><label>Notes and feedback</label><textarea name="notes" rows={2} defaultValue={i.notes ?? ""} /></div>
                    <div className="col-span-full flex gap-2 items-center"><button className="btn btn-sm btn-primary">Save</button>{!i.thank_you_sent_at ? <button className="btn btn-sm" formAction={act.markThankYouSent.bind(null, i.id, A)}>I sent a thank-you</button> : <span className="muted text-xs">Thank-you logged {fmtDate(i.thank_you_sent_at)}</span>}</div>
                  </form>
                </details>);
            })}
            {(interviews ?? []).length === 0 && <p className="muted text-sm">None recorded.</p>}
            <details><summary className="cursor-pointer text-sm">Record an interview or assessment</summary>
              <form action={act.addInterview} className="grid-form mt-2"><input type="hidden" name="application_id" value={A} />
                <div><label>Type</label><select name="kind"><option value="interview">Interview</option><option value="assessment">Assessment or task</option></select></div><div><label>Title</label><input name="title" /></div>
                <div><label>Format</label><select name="format">{["phone", "video", "in_person", "portfolio_review", "assessment"].map((f) => <option key={f} value={f}>{humanise(f)}</option>)}</select></div>
                <div><label>When</label><input type="datetime-local" name="scheduled_at" /></div><div><label>Submit by</label><input type="datetime-local" name="deadline_at" /></div><div><label>Minutes</label><input type="number" name="duration_minutes" /></div>
                <div><label>Location or link</label><input name="location" /></div><div><label>Interviewers</label><input name="interviewers" /></div><div><label>Contact details</label><input name="contact_details" /></div>
                <div className="col-span-full"><label>Instructions</label><textarea name="instructions" rows={2} /></div><div className="col-span-full"><button className="btn btn-primary">Record</button></div></form></details>
          </section>
        </div>

        <div className="space-y-4">
          {/* Submission */}
          {!confirmed && !["rejected", "withdrawn", "vacancy_closed", "closed_without_response"].includes(stage) && (
            <section className="card space-y-2">
              <h2 className="font-semibold">Record that you submitted it</h2>
              <p className="muted text-xs">Only do this once you have actually sent it. The system never assumes it. The documents and wording currently selected are frozen as the record of what was sent.</p>
              <form action={act.confirmSubmission.bind(null, A)} className="space-y-2">
                <div><label>Date and time sent</label><input type="datetime-local" name="submitted_at" defaultValue={localNow()} max={localNow()} required /></div>
                <div><label>Method</label><select name="method" defaultValue={a.submitted_via ?? "email"}>{SUBMIT_METHODS.map((m) => <option key={m} value={m}>{humanise(m)}</option>)}</select></div>
                <div><label>Sent to</label><input name="recipient" defaultValue={a.recipient ?? ""} required /></div>
                <div><label>Confirmation reference (optional)</label><input name="confirmation_ref" /></div>
                <div><label>Evidence or notes (optional)</label><textarea name="evidence" rows={2} /></div>
                <label className="flex gap-2 items-start text-xs"><input type="checkbox" name="confirm" required className="w-auto mt-0.5" /> I have actually submitted this application.</label>
                <button className="btn btn-primary w-full">Confirm submission</button>
              </form>
            </section>
          )}
          {confirmed && ["submitted", "awaiting_response", "acknowledged", "shortlisted"].includes(stage) && (
            <details className="card"><summary className="cursor-pointer text-sm">Submission recorded by mistake?</summary>
              <form action={act.correctSubmission.bind(null, A)} className="space-y-2 mt-2"><p className="muted text-xs">This removes the confirmation and returns the application to “Ready for review”. A note stays in the timeline.</p><div><label>Reason (required)</label><input name="reason" required /></div><button className="btn btn-sm">Correct the submission record</button></form></details>
          )}

          {/* Follow-ups */}
          <section className="card space-y-2">
            <h2 className="font-semibold">Follow-ups and reminders</h2>
            {(followups ?? []).filter((f) => f.status === "open" || f.status === "snoozed").map((f) => (
              <div key={f.id} className="rounded border border-border p-2 text-sm space-y-1">
                <div className="font-medium">{f.title}</div>
                <div className="text-xs muted">{fmtDate(f.due_at)}{f.status === "snoozed" && f.snoozed_until ? ` · snoozed to ${fmtDate(f.snoozed_until)}` : ""} · <span className={`badge ${f.basis === "rule_suggestion" ? "badge-warn" : ""}`}>{f.basis === "rule_suggestion" ? "Suggestion from your rules" : f.basis === "employer_stated" ? "Employer's timeframe" : "Set by you"}</span></div>
                {f.basis_note && <div className="text-xs muted">{f.basis_note}</div>}
                <form action={act.completeFollowUp.bind(null, f.id, A)} className="space-y-1"><input name="note" placeholder="Note (optional)" /><label className="flex gap-2 items-center text-xs"><input type="checkbox" name="i_sent_one" className="w-auto" /> I sent a follow-up (log it)</label><button className="btn btn-sm">Mark done</button></form>
                <div className="flex flex-wrap gap-1"><form action={act.snoozeFollowUp.bind(null, f.id, A, 3)}><button className="btn btn-sm">Snooze 3d</button></form><form action={act.snoozeFollowUp.bind(null, f.id, A, 7)}><button className="btn btn-sm">Snooze 7d</button></form><form action={act.dismissFollowUp.bind(null, f.id, A)}><button className="btn btn-sm">Dismiss</button></form></div>
                <form action={act.rescheduleFollowUp.bind(null, f.id, A)} className="flex gap-1"><input type="date" name="due_at" required /><button className="btn btn-sm">Reschedule</button></form>
              </div>))}
            {openFollowups.length === 0 && <p className="muted text-sm">None planned. Reminders are never sent for you.</p>}
            <details><summary className="cursor-pointer text-xs">Add one</summary><form action={act.addFollowUp.bind(null, A)} className="space-y-2 mt-2"><div><label>What</label><input name="title" required /></div><div><label>Kind</label><select name="kind"><option value="custom">Reminder</option><option value="awaiting_response">Chase a reply</option><option value="info_requested">Send requested information</option></select></div><div><label>When</label><input type="date" name="due_at" required /></div><button className="btn btn-sm">Add</button></form></details>
          </section>

          {/* Outcome */}
          <section className="card space-y-2">
            <h2 className="font-semibold">Outcome</h2>
            {a.outcome_at && <p className="text-sm">{OUTCOME_LABELS[stage] ?? humanise(stage)} · {fmtDate(a.outcome_at)}</p>}
            {a.offer ? <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(a.offer, null, 1)}</pre> : null}
            {(a.feedback || a.outcome_reason || a.lessons_learned) && <div className="text-xs space-y-1">{a.feedback && <div><strong>Feedback:</strong> {a.feedback}</div>}{a.outcome_reason && <div><strong>Reason:</strong> {a.outcome_reason}</div>}{a.lessons_learned && <div><strong>Lessons:</strong> {a.lessons_learned}</div>}</div>}
            <details><summary className="cursor-pointer text-sm">Record or change the outcome</summary>
              <form action={act.recordOutcome.bind(null, A)} className="space-y-2 mt-2">
                <div><label>Outcome</label><select name="stage" defaultValue="">{[["offer_received", "Offer received"], ["rejected", "Rejected by the employer"], ["withdrawn", "I withdrew"], ["vacancy_closed", "Vacancy closed, outcome not known"], ["closed_without_response", "No response after follow-ups"], ["offer_accepted", "Offer accepted"], ["offer_declined", "Offer declined"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                <div><label>Date</label><input type="date" name="outcome_at" /></div>
                <div><label>Feedback from the employer</label><textarea name="feedback" rows={2} /></div><div><label>Reason</label><input name="reason" /></div><div><label>Lessons for next time</label><textarea name="lessons" rows={2} /></div>
                <div className="rounded border border-border p-2 space-y-1"><div className="text-xs muted">If an offer</div><input name="offer_salary" placeholder="Salary" /><input name="offer_start" type="date" /><input name="offer_deadline" type="date" title="Decision deadline" /><textarea name="offer_notes" rows={2} placeholder="Terms and notes" /></div>
                <label className="flex gap-2 items-start text-xs"><input type="checkbox" name="confirm" className="w-auto mt-0.5" /> This decision is mine and is final (required for accept, decline and withdraw).</label>
                <button className="btn btn-sm btn-primary">Save outcome</button></form></details>
          </section>

          {/* Log + timeline */}
          <section className="card space-y-2">
            <h2 className="font-semibold">Communication timeline</h2>
            <details><summary className="cursor-pointer text-sm">Log something that happened</summary>
              <form action={act.logInteraction.bind(null, A)} className="space-y-2 mt-2">
                <div><label>What</label><select name="type">{LOG_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div><div><label>When</label><input type="datetime-local" name="occurred_at" defaultValue={localNow()} /></div>
                <div><label>Summary</label><input name="summary" required /></div><div><label>Details</label><textarea name="details" rows={3} /></div>
                <label className="flex gap-2 items-center text-xs"><input type="checkbox" name="is_acknowledgement" className="w-auto" /> It acknowledges my application</label>
                <label className="flex gap-2 items-center text-xs"><input type="checkbox" name="asks_for_info" className="w-auto" /> They asked for more information</label>
                <div><label>Information due (optional)</label><input type="date" name="info_due" /></div>
                <button className="btn btn-sm btn-primary">Add to timeline</button></form></details>
            <ol className="space-y-2">{timeline.map((t, i) => (
              <li key={i} className="border-l-2 border-border pl-3 text-sm">
                <div className="flex flex-wrap gap-2 items-center"><span className="text-xs muted">{fmtDateTime(t.at)}</span>
                  {t.kind === "activity" && (t.origin === "synced" ? <span className="badge badge-ok" title="Read from your mailbox">Synced</span> : t.origin === "system" ? <span className="badge">System</span> : <span className="badge">Logged by you</span>)}
                  {t.confirmation === "integration" && <span className="badge badge-ok">Verified by integration</span>}</div>
                <div className="font-medium">{t.title}</div>{t.extra && <div className="text-xs muted">{t.extra}</div>}{t.body && <p className="text-xs whitespace-pre-wrap muted">{t.body}</p>}
              </li>))}
              {timeline.length === 0 && <li className="muted text-sm">Nothing recorded yet.</li>}</ol>
          </section>
        </div>
      </div>
    </div>
  );
}
