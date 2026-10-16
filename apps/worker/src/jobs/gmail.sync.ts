import type { gmail_v1 } from "googleapis";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { gmailClient, ensureLabels, LABELS, headerOf, parseAddress, bodyText, markCredential } from "../lib/gmail/client.js";
import type { Job } from "./index.js";

const OPT_OUT = /\b(unsubscribe|do not contact|don't contact|stop contacting|remove me|no further (emails|contact)|not interested in receiving)\b/i;
const BOUNCE_SENDERS = /mailer-daemon|postmaster|mail delivery (subsystem|system)/i;

/**
 * Every 10 minutes: partial sync via history.list from the stored historyId. New messages in known
 * threads become inbound activities (idempotent on message id); opt-outs → suppressions; DSNs → bounced;
 * alert-sender messages → email_alert_messages for the discovery.email_alerts job.
 */
export async function gmailSync(_job: Job<{ initial?: boolean; manual?: boolean }>) {
  const { gmail, cred, reason } = await gmailClient();
  if (!gmail || !cred) return { skipped: reason };
  const labels = await ensureLabels(gmail);
  const { data: defs } = await db().from("source_definitions").select("id, code, config").eq("adapter_type", "email_alert_ingest").eq("enabled", true);
  const alertPatterns = (defs ?? []).flatMap((d) => (((d.config as { sender_patterns?: string[] }).sender_patterns) ?? []).map((p) => ({ p: p.toLowerCase(), id: d.id })));
  const { data: threads } = await db().from("email_threads").select("provider_thread_id, employer_id, contact_id, application_id, status, message_count").in("status", ["awaiting_reply", "replied"]);
  const threadMap = new Map((threads ?? []).map((t) => [t.provider_thread_id, t]));

  let messageIds: string[] = [];
  let newHistoryId: string | null = null;
  if (cred.last_history_id) {
    try {
      let pageToken: string | undefined;
      do {
        const res = await gmail.users.history.list({ userId: "me", startHistoryId: cred.last_history_id, historyTypes: ["messageAdded"], pageToken, maxResults: 500 });
        for (const h of res.data.history ?? []) for (const m of h.messagesAdded ?? []) if (m.message?.id) messageIds.push(m.message.id);
        newHistoryId = res.data.historyId ?? newHistoryId;
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    } catch (e) {
      const status = (e as { code?: number }).code;
      if (status === 404) { logger.warn("historyId too old; falling back to bounded full sync"); cred.last_history_id = null; }
      else throw e;
    }
  }
  if (!cred.last_history_id) {
    // Bounded full sync: recent messages in known threads + alert senders.
    const queries = ["newer_than:30d (in:inbox OR in:sent)"];
    for (const q of queries) {
      const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 200 });
      messageIds.push(...(res.data.messages ?? []).map((m) => m.id!).filter(Boolean));
    }
    const prof = await gmail.users.getProfile({ userId: "me" });
    newHistoryId = prof.data.historyId ?? null;
  }
  messageIds = [...new Set(messageIds)];
  let inbound = 0, alerts = 0, bounces = 0, optOuts = 0, skipped = 0;
  for (const id of messageIds) {
    const { data: exists } = await db().from("activities").select("id").eq("provider_message_id", id).maybeSingle();
    if (exists) { skipped++; continue; }
    const { data: alreadyAlert } = await db().from("email_alert_messages").select("id").eq("provider_message_id", id).maybeSingle();
    if (alreadyAlert) { skipped++; continue; }
    let meta: gmail_v1.Schema$Message;
    try { meta = (await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "To", "Subject", "Message-ID", "In-Reply-To", "Date"] })).data; } catch { continue; }
    const from = parseAddress(headerOf(meta, "From"));
    const subject = headerOf(meta, "Subject");
    const threadId = meta.threadId ?? null;
    const isOurs = (meta.labelIds ?? []).includes("SENT");
    const alertDef = from ? alertPatterns.find((a) => from.endsWith(a.p) || from.includes(`@${a.p}`) || from.includes(a.p)) : undefined;
    if (alertDef && !isOurs) {
      await db().from("email_alert_messages").upsert({ provider_message_id: id, provider_thread_id: threadId, from_email: from, subject, received_at: meta.internalDate ? new Date(Number(meta.internalDate)).toISOString() : null, source_definition_id: alertDef.id, status: "pending" }, { onConflict: "provider_message_id", ignoreDuplicates: true });
      try { await gmail.users.messages.modify({ userId: "me", id, requestBody: { addLabelIds: [labels[LABELS.alert]!] } }); } catch { /* ignore */ }
      alerts++;
      continue;
    }
    const thread = threadId ? threadMap.get(threadId) : undefined;
    if (!thread || !threadId || isOurs) { skipped++; continue; }
    const employerId = thread.employer_id;
    if (!employerId) { skipped++; continue; }
    const full = (await gmail.users.messages.get({ userId: "me", id, format: "full" })).data;
    const text = bodyText(full);
    const isBounce = !!from && BOUNCE_SENDERS.test(from);
    const optOut = !isBounce && OPT_OUT.test(text.slice(0, 4000));
    const receivedAt = full.internalDate ? new Date(Number(full.internalDate)).toISOString() : new Date().toISOString();
    const { data: act } = await db().from("activities").insert({
      employer_id: employerId, contact_id: thread.contact_id, application_id: thread.application_id,
      activity_type: isBounce ? "bounce_received" : optOut ? "opt_out_received" : "email_received", direction: "inbound", channel: "email",
      subject, body_text: text.slice(0, 20_000), sender_email: from, recipient_email: parseAddress(headerOf(full, "To")), provider: "gmail", provider_message_id: id, provider_thread_id: threadId,
      rfc_message_id: headerOf(full, "Message-ID"), in_reply_to: headerOf(full, "In-Reply-To"), occurred_at: receivedAt, delivery_result: "delivered", opt_out_detected: optOut, idempotency_key: `gmail:${id}`,
    }).select("id").single();
    if (isBounce) {
      bounces++;
      const failed = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() ?? null;
      await db().from("email_threads").update({ status: "bounced", last_message_at: receivedAt, last_direction: "inbound", message_count: thread.message_count + 1 }).eq("provider_thread_id", threadId);
      await db().from("activities").update({ delivery_result: "bounced", bounced_at: receivedAt, bounce_reason: text.slice(0, 500), follow_up_done: true }).eq("provider_thread_id", threadId).eq("direction", "outbound");
      if (thread.contact_id) await db().from("contacts").update({ email_verification: "bounced" }).eq("id", thread.contact_id);
      if (failed) await db().from("suppressions").upsert({ scope: "email", value: failed, reason: "hard_bounce", employer_id: employerId, contact_id: thread.contact_id, source_activity_id: act?.id ?? null, source_description: "Delivery status notification" }, { onConflict: "scope,value", ignoreDuplicates: true });
      await db().from("tasks").insert({ title: `Email bounced${failed ? ` for ${failed}` : ""} — find another route`, task_type: "data_quality", entity_type: "employer", entity_id: employerId, employer_id: employerId, auto_generated: true, dedupe_key: `bounce:${threadId}`, priority: "normal" });
      continue;
    }
    inbound++;
    await db().from("email_threads").update({ status: "replied", last_message_at: receivedAt, last_direction: "inbound", message_count: thread.message_count + 1 }).eq("provider_thread_id", threadId);
    await db().from("activities").update({ reply_received: true, follow_up_done: true }).eq("provider_thread_id", threadId).eq("direction", "outbound");
    await db().from("tasks").update({ status: "cancelled" }).like("dedupe_key", `follow_up:%`).eq("employer_id", employerId).in("status", ["open", "snoozed"]);
    if (thread.contact_id) await db().from("contacts").update({ last_reply_at: receivedAt, relationship_status: "replied", email_verification: "confirmed_by_reply" }).eq("id", thread.contact_id);
    try { await gmail.users.messages.modify({ userId: "me", id, requestBody: { addLabelIds: [labels[LABELS.root]!, labels[LABELS.reply]!] } }); } catch { /* ignore */ }
    if (optOut) {
      optOuts++;
      if (from) await db().from("suppressions").upsert({ scope: "email", value: from, reason: "opt_out", employer_id: employerId, contact_id: thread.contact_id, source_activity_id: act?.id ?? null, source_description: "Opt-out phrase detected in reply", lawful_basis_note: "Objection received; processing for outreach stopped." }, { onConflict: "scope,value", ignoreDuplicates: true });
      await db().from("tasks").insert({ title: "Reply looks like an opt-out — confirm and suppress the employer if appropriate", task_type: "data_quality", entity_type: "employer", entity_id: employerId, employer_id: employerId, auto_generated: true, dedupe_key: `optout:${threadId}`, priority: "high" });
    } else {
      await db().from("employers").update({ outreach_stage: "replied" }).eq("id", employerId).in("outreach_stage", ["email_sent", "follow_up_due", "contact_approved"]);
      await db().from("tasks").insert({ title: `Reply received: ${subject ?? "(no subject)"} — read and respond`, task_type: "follow_up", entity_type: "employer", entity_id: employerId, employer_id: employerId, auto_generated: true, dedupe_key: `reply:${id}`, priority: "high", due_at: new Date().toISOString() });
    }
  }
  if (newHistoryId) await markCredential(cred.id, { last_history_id: newHistoryId, last_sync_at: new Date(), last_error: null });
  if (alerts > 0) await db().from("job_requests").insert({ job_name: "discovery.email_alerts", payload: {}, singleton_key: "email_alerts" });
  return { scanned: messageIds.length, inbound, alerts, bounces, optOuts, skipped, historyId: newHistoryId };
}
