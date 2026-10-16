import { requireUser } from "@/lib/supabase/server";
import { fmtDateTime, humanise } from "@/lib/utils";
import { StatusBadge } from "@/components/badges";
import { runSourceNow, toggleSource } from "@/server/actions/sources";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const { supabase } = await requireUser();
  const [{ data: defs }, { data: runs }, { data: pending }] = await Promise.all([
    supabase.from("source_definitions").select("*").order("adapter_type").order("label"),
    supabase.from("source_runs").select("*, source_definitions(code)").order("started_at", { ascending: false }).limit(40),
    supabase.from("job_requests").select("job_name, status, requested_at, error").order("requested_at", { ascending: false }).limit(20),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Sources</h1>
      <p className="muted text-xs">Each source has an adapter type that reflects what its terms allow. Sources that need an API key stay disabled until the key is present in the worker environment. Robots.txt and rate limits are enforced per host by the worker; Dezeen, Indeed, LinkedIn and the RIBA directory are email/manual only by design.</p>
      <div className="card p-0 overflow-x-auto">
        <table>
          <thead><tr><th>Source</th><th>Adapter</th><th>Enabled</th><th>Schedule</th><th>Needs</th><th>Last run</th><th>Last success</th><th>Failures</th><th></th></tr></thead>
          <tbody>
            {(defs ?? []).map((d) => (
              <tr key={d.id} className={d.enabled ? "" : "opacity-70"}>
                <td><div className="font-medium">{d.label}</div><div className="muted text-xs max-w-md">{d.notes}</div>{d.disabled_reason && <div className="text-danger text-xs">{d.disabled_reason}</div>}</td>
                <td className="muted">{humanise(d.adapter_type)}</td>
                <td>{d.enabled ? <span className="badge badge-ok">on</span> : <span className="badge">off</span>}</td>
                <td className="muted text-xs">{d.schedule_cron ?? "on demand"}</td>
                <td className="muted text-xs">{d.requires_env.join(", ") || "—"}</td>
                <td className="muted whitespace-nowrap">{fmtDateTime(d.last_run_at)}</td>
                <td className="muted whitespace-nowrap">{fmtDateTime(d.last_success_at)}</td>
                <td>{d.consecutive_failures > 0 ? <span className="badge badge-danger">{d.consecutive_failures}</span> : "0"}</td>
                <td className="whitespace-nowrap">
                  {d.adapter_type !== "manual_import" && d.adapter_type !== "email_alert_ingest" && <form action={runSourceNow.bind(null, d.code)} className="inline"><button className="btn btn-sm" disabled={!d.enabled}>Run now</button></form>}
                  <form action={toggleSource.bind(null, d.id, !d.enabled)} className="inline ml-1"><button className="btn btn-sm">{d.enabled ? "Disable" : "Enable"}</button></form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card p-0 overflow-x-auto">
          <h2 className="font-semibold p-4 pb-2">Recent runs</h2>
          <table>
            <thead><tr><th>Source</th><th>Started</th><th>Status</th><th>Seen / new / changed / deduped</th><th>Requests</th></tr></thead>
            <tbody>
              {(runs ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{(r.source_definitions as { code: string } | null)?.code ?? r.job_name}</td>
                  <td className="muted whitespace-nowrap">{fmtDateTime(r.started_at)}</td>
                  <td><StatusBadge value={r.status} />{Array.isArray(r.errors) && r.errors.length > 0 && <div className="text-danger text-xs max-w-xs truncate">{JSON.stringify(r.errors[0])}</div>}</td>
                  <td>{r.items_seen} / {r.items_new} / {r.items_changed} / {r.items_deduped}</td>
                  <td>{r.requests_made}</td>
                </tr>
              ))}
              {(runs ?? []).length === 0 && <tr><td colSpan={5} className="muted text-center py-6">No runs yet. Deploy the worker to start scheduled discovery.</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="card p-0 overflow-x-auto">
          <h2 className="font-semibold p-4 pb-2">Job requests from this dashboard</h2>
          <table>
            <thead><tr><th>Job</th><th>Requested</th><th>Status</th></tr></thead>
            <tbody>
              {(pending ?? []).map((p, i) => <tr key={i}><td>{p.job_name}</td><td className="muted whitespace-nowrap">{fmtDateTime(p.requested_at)}</td><td><StatusBadge value={p.status} />{p.error && <div className="text-danger text-xs">{p.error}</div>}</td></tr>)}
              {(pending ?? []).length === 0 && <tr><td colSpan={3} className="muted text-center py-6">None.</td></tr>}
            </tbody>
          </table>
          <p className="muted text-xs p-4 pt-2">Requests stay “pending” until the worker is running and drains them.</p>
        </section>
      </div>
    </div>
  );
}
