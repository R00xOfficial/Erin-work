import { DOCUMENT_KINDS } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate, humanise } from "@/lib/utils";
import { approveSnippet, deleteDocument, deleteSnippet, saveSnippet, setCurrentDocument, uploadDocument } from "@/server/actions/documents";

export const dynamic = "force-dynamic";

export default async function DocumentsSettings() {
  const { supabase } = await requireUser();
  const { data: snippets } = await supabase.from("reusable_snippets").select("*").order("kind").order("label");
  const { data: docs } = await supabase.from("documents").select("*").is("deleted_at", null).order("kind").order("created_at", { ascending: false });
  return (
    <div className="space-y-4">
      <p className="muted text-sm">Upload each CV and portfolio version once. Every application and email records the exact file (by hash) that was sent, so you can always tell which version a company received. Keep portfolios under 8 MB for email; larger files are linked instead.</p>
      <form action={uploadDocument} className="card grid-form" encType="multipart/form-data">
        <div><label>Kind</label><select name="kind" defaultValue="cv">{DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{humanise(k)}</option>)}</select></div>
        <div><label>Version label</label><input name="version_label" required placeholder="2026-10 general / BIM-focused" /></div>
        <div><label>File</label><input name="file" type="file" required accept=".pdf,.doc,.docx" /></div>
        <div><label>Notes</label><input name="notes" /></div>
        <div className="col-span-full flex items-center gap-3"><label className="flex items-center gap-2 m-0"><input type="checkbox" name="is_current" defaultChecked /> Make this the current version for its kind</label><button className="btn btn-primary ml-auto" type="submit">Upload</button></div>
      </form>
      <div className="card p-0 overflow-x-auto">
        <table>
          <thead><tr><th>Kind</th><th>Version</th><th>File</th><th>Size</th><th>SHA-256</th><th>Uploaded</th><th>Current</th><th></th></tr></thead>
          <tbody>
            {(docs ?? []).map((d) => (
              <tr key={d.id}>
                <td>{humanise(d.kind)}</td>
                <td className="font-medium">{d.version_label}</td>
                <td><a className="underline" href={`/api/documents/${d.id}`}>{d.file_name}</a></td>
                <td className="muted">{d.size_bytes ? `${(Number(d.size_bytes) / 1_048_576).toFixed(1)} MB` : "—"}</td>
                <td className="muted text-xs font-mono">{d.sha256.slice(0, 12)}…</td>
                <td className="muted">{fmtDate(d.created_at)}</td>
                <td>{d.is_current ? <span className="badge badge-ok">current</span> : <form action={setCurrentDocument.bind(null, d.id, d.kind)}><button className="btn btn-sm">Make current</button></form>}</td>
                <td><form action={deleteDocument.bind(null, d.id)}><button className="btn btn-sm">Remove</button></form></td>
              </tr>
            ))}
            {(docs ?? []).length === 0 && <tr><td colSpan={8} className="muted text-center py-8">No documents uploaded yet. Upload your CV first; outreach drafts require it.</td></tr>}
          </tbody>
        </table>
      </div>
      <section className="card space-y-3">
        <h2 className="font-semibold">Reusable answers</h2>
        <p className="muted text-xs">Standard wording for availability, right to work, salary and common questions. Drafts may only use a snippet you have approved, and editing one withdraws its approval.</p>
        {(snippets ?? []).map((s) => (
          <form key={s.id} action={saveSnippet} className="grid-form rounded border border-border p-2">
            <input type="hidden" name="id" value={s.id} />
            <div><label>Label</label><input name="label" defaultValue={s.label} /></div>
            <div><label>Kind</label><select name="kind" defaultValue={s.kind}>{["answer", "bio", "availability", "right_to_work", "salary", "other"].map((k) => <option key={k} value={k}>{humanise(k)}</option>)}</select></div>
            <div className="col-span-full"><label>Text</label><textarea name="body" rows={2} defaultValue={s.body} /></div>
            <div className="col-span-full flex items-center gap-2"><button className="btn btn-sm">Save</button>{s.approved_at ? <span className="badge badge-ok">Approved {fmtDate(s.approved_at)}</span> : <button className="btn btn-sm btn-primary" formAction={approveSnippet.bind(null, s.id)}>Approve for drafting</button>}<button className="btn btn-sm" formAction={deleteSnippet.bind(null, s.id)}>Delete</button></div>
          </form>
        ))}
        <form action={saveSnippet} className="grid-form">
          <div><label>Label</label><input name="label" required placeholder="e.g. Notice period" /></div>
          <div><label>Kind</label><select name="kind" defaultValue="answer">{["answer", "bio", "availability", "right_to_work", "salary", "other"].map((k) => <option key={k} value={k}>{humanise(k)}</option>)}</select></div>
          <div className="col-span-full"><label>Text</label><textarea name="body" rows={2} required /></div>
          <div className="col-span-full"><button className="btn">Add snippet</button></div>
        </form>
      </section>
      <p className="muted text-xs">Backups: this page lists what is stored. Applications and the document manifest can be downloaded from Applications → Export. The files themselves live in private storage; on the Supabase free plan there are no automatic database backups, so keep an export (and your original files) somewhere safe.</p>
    </div>
  );
}
