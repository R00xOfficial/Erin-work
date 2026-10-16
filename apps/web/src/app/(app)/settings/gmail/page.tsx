import { requireUser } from "@/lib/supabase/server";
import { fmtDateTime, humanise } from "@/lib/utils";
import { setDryRun, setStopSwitch } from "@/server/actions/settings";
import { disconnectGmail, startGmailConnect, requestGmailSync } from "@/server/actions/gmail";

export const dynamic = "force-dynamic";

export default async function GmailSettings() {
  const { supabase } = await requireUser();
  const [{ data: cred }, { data: settings }, { data: labels }] = await Promise.all([
    supabase.from("oauth_credential_status").select("*").eq("provider", "gmail").maybeSingle(),
    supabase.from("settings").select("key, value").in("key", ["stop_switch", "dry_run"]),
    supabase.from("settings").select("value").eq("key", "gmail_labels").maybeSingle(),
  ]);
  const stop = (settings?.find((s) => s.key === "stop_switch")?.value as boolean | undefined) ?? true;
  const dry = (settings?.find((s) => s.key === "dry_run")?.value as boolean | undefined) ?? true;
  const configured = !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
  const envDry = process.env.OUTREACH_DRY_RUN === "true";
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card space-y-3">
        <h2 className="font-semibold">Stop controls</h2>
        <div className="flex items-center justify-between gap-3">
          <div><div className="font-medium">Stop switch {stop ? <span className="badge badge-danger">ON</span> : <span className="badge badge-ok">off</span>}</div><p className="muted text-xs">While on, no draft is created and no email is sent, whatever else is approved. Turn it on immediately if anything looks wrong.</p></div>
          <form action={setStopSwitch.bind(null, !stop)}><button className={`btn ${stop ? "btn-primary" : "btn-danger"}`} type="submit">{stop ? "Turn off (allow sending)" : "STOP all sending"}</button></form>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div><div className="font-medium">Dry run {dry || envDry ? <span className="badge badge-warn">ON</span> : <span className="badge badge-ok">off</span>}</div><p className="muted text-xs">Approved sends are simulated and recorded as “simulated”. {envDry && "Forced on by OUTREACH_DRY_RUN=true in the worker environment."}</p></div>
          <form action={setDryRun.bind(null, !dry)}><button className="btn" type="submit" disabled={envDry}>{dry ? "Disable dry run" : "Enable dry run"}</button></form>
        </div>
      </section>
      <section className="card space-y-3">
        <h2 className="font-semibold">Gmail connection</h2>
        {!configured && <p className="text-warn text-sm">GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in the web environment. Create an OAuth web client in Google Cloud, enable the Gmail API, add the redirect URI from .env.example, then restart.</p>}
        {cred ? (
          <div className="text-sm space-y-1">
            <div><span className="muted">Account:</span> {cred.account_email} <span className={`badge ${cred.status === "active" ? "badge-ok" : "badge-danger"}`}>{humanise(cred.status ?? "")}</span></div>
            <div><span className="muted">Scopes:</span> {(cred.scopes ?? []).join(", ")}</div>
            <div><span className="muted">Connected:</span> {fmtDateTime(cred.connected_at)} · <span className="muted">last sync:</span> {fmtDateTime(cred.last_sync_at)}</div>
            {cred.last_error && <div className="text-danger">Last error: {cred.last_error}</div>}
            <div><span className="muted">Labels:</span> {Object.keys((labels?.value as Record<string, string>) ?? {}).join(", ") || "created on first sync"}</div>
            <div className="flex gap-2 mt-2">
              <form action={requestGmailSync}><button className="btn btn-sm" type="submit">Sync now</button></form>
              <form action={startGmailConnect}><button className="btn btn-sm" type="submit" disabled={!configured}>Re-authorise</button></form>
              <form action={disconnectGmail}><button className="btn btn-sm btn-danger" type="submit">Disconnect</button></form>
            </div>
            {cred.status === "needs_reauth" && <p className="text-warn text-xs">Google revoked or expired the grant (apps in “Testing” expire after 7 days). Re-authorise to resume; sending is halted until then.</p>}
          </div>
        ) : (
          <form action={startGmailConnect}><button className="btn btn-primary" type="submit" disabled={!configured}>Connect Gmail</button></form>
        )}
        <p className="muted text-xs">Scope requested: gmail.modify (read, draft, send, label) plus your email address to confirm the right mailbox. Tokens are encrypted with TOKEN_ENC_KEY and stored outside the public schema. Replies, bounces and opt-outs are matched by thread id every 10 minutes.</p>
      </section>
    </div>
  );
}
