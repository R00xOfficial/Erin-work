import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { createApplication, loadStartContext } from "@/server/actions/applications";
import { fmtDate, humanise } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function NewApplicationPage({ searchParams }: { searchParams: Promise<{ employer_id?: string; vacancy_id?: string; priority_item_id?: string; type?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  let employerId = sp.employer_id ?? null, vacancyId = sp.vacancy_id ?? null;
  if (sp.priority_item_id) {
    const { data: p } = await supabase.from("priority_items").select("employer_id, vacancy_id").eq("id", sp.priority_item_id).maybeSingle();
    employerId = p?.employer_id ?? employerId; vacancyId = p?.vacancy_id ?? vacancyId;
  }
  if (!employerId) redirect("/priorities");
  if (vacancyId) {
    const { data: existing } = await supabase.from("applications").select("id").eq("vacancy_id", vacancyId).is("deleted_at", null).maybeSingle();
    if (existing) redirect(`/applications/${existing.id}`);
  }
  const type = vacancyId ? "advertised" : "speculative";
  const [{ data: emp }, { data: vac }, ctx] = await Promise.all([
    supabase.from("employers").select("id, display_name, legal_name, is_suppressed").eq("id", employerId).single(),
    vacancyId ? supabase.from("vacancies").select("title, status, closing_at, location_text").eq("id", vacancyId).single() : Promise.resolve({ data: null }),
    loadStartContext(employerId, type),
  ]);
  const name = emp?.display_name ?? emp?.legal_name ?? "this employer";
  const closed = !!vac && ["closed", "filled", "withdrawn"].includes(vac.status);
  const passed = !!vac?.closing_at && new Date(vac.closing_at) < new Date();

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="muted text-xs"><Link className="underline" href="/applications">Applications</Link> / start</div>
      <h1 className="text-xl font-semibold">{type === "speculative" ? "Start a speculative application" : "Start an application"}: {name}</h1>
      {vac && <p className="text-sm">{vac.title}{vac.location_text ? ` · ${vac.location_text}` : ""}{vac.closing_at ? ` · closes ${fmtDate(vac.closing_at)}` : " · no closing date recorded"}</p>}
      {type === "speculative" && <p className="muted text-xs">There is no vacancy recorded, so this is tracked as a speculative approach. Employers can have several applications; this one is its own record.</p>}
      {emp?.is_suppressed && <div className="card border-danger text-sm">This employer is on your suppression list. An application cannot be started.</div>}
      {closed && <div className="card border-danger text-sm">The vacancy is recorded as {vac!.status}. An application cannot be started from it.</div>}
      {passed && !closed && <div className="card border-danger text-sm">The closing date has passed.</div>}

      {(ctx.applications.length > 0 || ctx.contacts.length > 0) && (
        <section className="card space-y-2">
          <h2 className="font-semibold text-sm">Earlier contact with this employer</h2>
          <ul className="text-sm space-y-1">
            {ctx.applications.map((a) => <li key={a.id}><Link className="underline" href={`/applications/${a.id}`}>{humanise(a.applicationType)} application</Link>{a.vacancyTitle ? ` · ${a.vacancyTitle}` : ""} · {humanise(a.stage)} <span className="muted">· started {fmtDate(a.createdAt)}{a.submittedAt ? `, submitted ${fmtDate(a.submittedAt)}` : ""}</span></li>)}
            {ctx.contacts.map((c, i) => <li key={i}>Email sent {fmtDate(c.sentAt)}{c.subject ? ` · ${c.subject}` : ""}</li>)}
          </ul>
          {ctx.reasons.map((r) => <p key={r} className="text-sm text-warn">{r}</p>)}
        </section>
      )}

      {!emp?.is_suppressed && !closed && !passed && (
        <form action={createApplication} className="card grid-form">
          <input type="hidden" name="employer_id" value={employerId} />
          {vacancyId && <input type="hidden" name="vacancy_id" value={vacancyId} />}
          {sp.priority_item_id && <input type="hidden" name="priority_item_id" value={sp.priority_item_id} />}
          <div className="col-span-full"><label>Why this one? (optional; the Stage 3 rationale is used if left blank)</label><textarea name="selection_reason" rows={2} /></div>
          <div className="col-span-full"><label>Notes</label><textarea name="notes" rows={2} /></div>
          {ctx.needsConfirmation && (
            <div className="col-span-full space-y-2 rounded border border-warn p-3">
              <label className="flex gap-2 items-start"><input type="checkbox" name="confirm_repeat" required className="w-auto mt-1" /> I know about the history above and want to go ahead anyway.</label>
              <div><label>Why is another approach appropriate? (required)</label><input name="repeat_reason" required /></div>
            </div>
          )}
          <div className="col-span-full flex gap-2"><button className="btn btn-primary">Create application</button><Link href="/applications" className="btn">Cancel</Link></div>
          <p className="col-span-full muted text-xs">This creates a record and a preparation checklist. It does not contact the employer or mark anything as submitted.</p>
        </form>
      )}
    </div>
  );
}
