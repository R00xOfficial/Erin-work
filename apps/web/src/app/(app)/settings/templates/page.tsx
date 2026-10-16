import { TEMPLATE_PURPOSES } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { humanise } from "@/lib/utils";
import { saveTemplate } from "@/server/actions/settings";

export const dynamic = "force-dynamic";

export default async function TemplatesSettings() {
  const { supabase } = await requireUser();
  const { data: templates } = await supabase.from("email_templates").select("*").eq("is_active", true).order("code");
  return (
    <div className="space-y-4">
      <p className="muted text-sm">Templates use <code>{"{{variable}}"}</code> placeholders. Rendering fails (and the send is blocked) if any variable is missing, so personalisation can never silently fall back to generic text. Saving creates a new version; old sends keep their version number.</p>
      {(templates ?? []).map((t) => (
        <form key={t.id} action={saveTemplate} className="card grid-form">
          <input type="hidden" name="code" value={t.code} />
          <div><label>Code</label><input value={t.code} readOnly /></div>
          <div><label>Purpose</label><select name="purpose" defaultValue={t.purpose}>{TEMPLATE_PURPOSES.map((p) => <option key={p} value={p}>{humanise(p)}</option>)}</select></div>
          <div><label>Version</label><input value={`v${t.version}`} readOnly /></div>
          <div className="col-span-full"><label>Subject</label><input name="subject_tmpl" defaultValue={t.subject_tmpl} /></div>
          <div className="col-span-full"><label>Body</label><textarea name="body_tmpl" rows={12} defaultValue={t.body_tmpl} /></div>
          <div className="col-span-full muted text-xs">Variables detected: {t.variables.join(", ")}</div>
          <div className="col-span-full"><label>Change note</label><input name="notes" /></div>
          <div className="col-span-full"><button className="btn btn-sm" type="submit">Save as v{t.version + 1}</button></div>
        </form>
      ))}
      <form action={saveTemplate} className="card grid-form">
        <h2 className="col-span-full font-semibold">New template</h2>
        <div><label>Code (snake_case)</label><input name="code" required pattern="[a-z0-9_]+" /></div>
        <div><label>Purpose</label><select name="purpose" defaultValue="speculative">{TEMPLATE_PURPOSES.map((p) => <option key={p} value={p}>{humanise(p)}</option>)}</select></div>
        <div className="col-span-full"><label>Subject</label><input name="subject_tmpl" required /></div>
        <div className="col-span-full"><label>Body</label><textarea name="body_tmpl" rows={8} required /></div>
        <div className="col-span-full"><button className="btn btn-primary" type="submit">Create</button></div>
      </form>
    </div>
  );
}
