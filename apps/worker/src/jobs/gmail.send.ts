import { db, getSetting, sql } from "../lib/db.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { gmailClient, ensureLabels, LABELS } from "../lib/gmail/client.js";
import type { Job } from "./index.js";

interface Payload { activityId: string }

/**
 * The only place an email leaves the system. retryLimit is 0: a failure is investigated, never retried blindly.
 * 1. Lock the activity row.  2. Run fn_can_send (authoritative checklist) inside the same transaction.
 * 3. Dry run → mark simulated.  4. drafts.send → record ids, label, thread, follow-up, employer stage.
 */
export async function gmailSend(job: Job<Payload>) {
  const { activityId } = job.data;
  const dryRun = env().dryRun || (await getSetting<boolean>("dry_run", true));
  const followUpDays = await getSetting<number>("follow_up_days", 7);
  const pg = sql();
  // Phase 1: lock + checklist in one transaction; mark 'sending' so a concurrent run cannot double-send.
  const gate = await pg.begin(async (tx) => {
    const rows = await tx<{ id: string; delivery_result: string; provider_draft_id: string | null; provider_thread_id: string | null; employer_id: string; contact_id: string | null; application_id: string | null; recipient_email: string; template_code: string | null }[]>`
      select id, delivery_result, provider_draft_id, provider_thread_id, employer_id, contact_id, application_id, recipient_email, template_code
      from public.activities where id = ${activityId} for update`;
    const a = rows[0];
    if (!a) return { ok: false as const, reason: "activity missing" };
    if (a.delivery_result !== "approved") return { ok: false as const, reason: `delivery_result is ${a.delivery_result}, expected approved` };
    const gateRows = await tx<{ fn_can_send: string[] }[]>`select public.fn_can_send(${activityId}) as fn_can_send`;
    const reasons = gateRows[0]?.fn_can_send ?? ["checklist_unavailable"];
    if (reasons.length > 0) {
      await tx`update public.activities set delivery_result = 'blocked', blocked_reasons = ${reasons}, approval_status = 'pending_approval' where id = ${activityId}`;
      return { ok: false as const, reason: `blocked: ${reasons.join(", ")}`, blocked: reasons };
    }
    if (!dryRun && !a.provider_draft_id) {
      await tx`update public.activities set delivery_result = 'blocked', blocked_reasons = ${["gmail_draft_missing"]} where id = ${activityId}`;
      return { ok: false as const, reason: "no Gmail draft id; re-render the draft" };
    }
    await tx`update public.activities set delivery_result = 'sending' where id = ${activityId}`;
    return { ok: true as const, a };
  });
  if (!gate.ok) { logger.warn({ activityId, reason: gate.reason }, "send refused"); return { activityId, sent: false, reason: gate.reason }; }
  const a = gate.a;
  const now = new Date();
  const followUpDue = new Date(now.getTime() + followUpDays * 86_400_000).toISOString();

  if (dryRun) {
    await db().from("activities").update({ delivery_result: "simulated", sent_at: now.toISOString(), activity_type: "email_sent", follow_up_due_at: followUpDue, notes: "Dry run: nothing was sent." }).eq("id", activityId);
    await db().from("employers").update({ outreach_stage: "email_sent" }).eq("id", a.employer_id).eq("outreach_stage", "contact_approved");
    return { activityId, sent: false, simulated: true };
  }
  const { gmail, reason } = await gmailClient();
  if (!gmail) {
    await db().from("activities").update({ delivery_result: "blocked", blocked_reasons: ["credential_not_active"], notes: reason }).eq("id", activityId);
    return { activityId, sent: false, reason };
  }
  try {
    const res = await gmail.users.drafts.send({ userId: "me", requestBody: { id: a.provider_draft_id! } });
    const messageId = res.data.id!, threadId = res.data.threadId!;
    const labels = await ensureLabels(gmail);
    try { await gmail.users.messages.modify({ userId: "me", id: messageId, requestBody: { addLabelIds: [labels[LABELS.root]!, labels[LABELS.sent]!] } }); } catch (e) { logger.warn({ err: (e as Error).message }, "label failed"); }
    await db().from("activities").update({ delivery_result: "sent", activity_type: "email_sent", sent_at: now.toISOString(), provider_message_id: messageId, provider_thread_id: threadId, follow_up_due_at: a.template_code?.startsWith("follow_up") ? null : followUpDue }).eq("id", activityId);
    await db().from("email_threads").upsert({ provider_thread_id: threadId, employer_id: a.employer_id, contact_id: a.contact_id, application_id: a.application_id, subject: null, first_sent_at: now.toISOString(), last_message_at: now.toISOString(), last_direction: "outbound", message_count: 1, status: "awaiting_reply", label_applied: true }, { onConflict: "provider_thread_id", ignoreDuplicates: false });
    await db().from("employers").update({ outreach_stage: "email_sent" }).eq("id", a.employer_id).in("outreach_stage", ["contact_approved", "follow_up_due"]);
    if (a.contact_id) await db().from("contacts").update({ last_contacted_at: now.toISOString(), relationship_status: "contacted" }).eq("id", a.contact_id).eq("relationship_status", "none");
    if (a.contact_id) await db().from("contacts").update({ last_contacted_at: now.toISOString() }).eq("id", a.contact_id);
    return { activityId, sent: true, messageId, threadId };
  } catch (e) {
    const msg = (e as Error).message;
    await db().from("activities").update({ delivery_result: "failed", notes: msg }).eq("id", activityId);
    await db().from("tasks").insert({ title: `Email send failed: ${msg.slice(0, 120)}`, task_type: "data_quality", entity_type: "activity", entity_id: activityId, employer_id: a.employer_id, priority: "high", auto_generated: true, dedupe_key: `send_failed:${activityId}` });
    throw e;
  }
}
