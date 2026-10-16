import { canonicaliseUrl, classifyTitle } from "@ajis/shared";
import { db } from "../lib/db.js";
import { gmailClient, bodyText } from "../lib/gmail/client.js";
import { extractLinks } from "../lib/extract.js";
import { politeFetch } from "../lib/http.js";
import { extractMainText } from "../lib/extract.js";
import { ingestVacancy } from "../pipeline/ingest_vacancy.js";
import type { Job } from "./index.js";

/**
 * Parses job-alert emails (Dezeen Jobs, Indeed, LinkedIn, AJ Jobs…) that gmail.sync filed.
 * Links to hosts we may fetch (robots allowing) are fetched and ingested; links to no-fetch hosts
 * (Indeed, LinkedIn, Dezeen) become verify_vacancy tasks with the URL for you to open and paste.
 */
const NO_FETCH_HOSTS = ["indeed.com", "indeed.co.uk", "linkedin.com", "dezeenjobs.com", "dezeen.com", "glassdoor"];

export async function discoveryEmailAlerts(_job: Job) {
  const { gmail, reason } = await gmailClient();
  if (!gmail) return { skipped: reason };
  const { data: pending } = await db().from("email_alert_messages").select("*, source_definitions(code, config)").eq("status", "pending").order("received_at").limit(30);
  let fetched = 0, tasks = 0, processed = 0;
  for (const m of pending ?? []) {
    try {
      const full = (await gmail.users.messages.get({ userId: "me", id: m.provider_message_id, format: "full" })).data;
      const parts: string[] = [];
      const walk = (p?: { mimeType?: string | null; body?: { data?: string | null }; parts?: unknown[] }) => { if (!p) return; if (p.mimeType === "text/html" && p.body?.data) parts.push(Buffer.from(p.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); (p.parts as typeof p[] | undefined)?.forEach(walk); };
      walk(full.payload as never);
      const html = parts.join("\n") || `<p>${bodyText(full)}</p>`;
      const def = m.source_definitions as { code: string; config: { link_host_patterns?: string[] } } | null;
      const hostPatterns = def?.config?.link_host_patterns ?? [];
      const links = [...new Set(extractLinks(html, "https://mail.google.com/").map((l) => canonicaliseUrl(l)).filter((l): l is string => !!l))]
        .filter((l) => !/unsubscribe|preferences|privacy|login|signin|account|settings|help|mailto:/i.test(l))
        .filter((l) => hostPatterns.length === 0 || hostPatterns.some((h) => new URL(l).hostname.endsWith(h)))
        .slice(0, 25);
      const extracted: { url: string; action: string }[] = [];
      for (const url of links) {
        const host = new URL(url).hostname;
        if (NO_FETCH_HOSTS.some((h) => host.endsWith(h)) || !/job|vacanc|career|position|viewjob|jobs\//i.test(url)) {
          if (!/job|vacanc|career|position|viewjob/i.test(url)) continue;
          const { error } = await db().from("tasks").insert({ title: `Job alert link (${host}) — open and paste the vacancy if relevant`, task_type: "verify_vacancy", notes: url, auto_generated: true, dedupe_key: `alert_link:${url}`, priority: "low" });
          if (!error) tasks++;
          extracted.push({ url, action: "task" });
          continue;
        }
        const page = await politeFetch(url, { minIntervalMs: 3000 });
        if (page.skipped || !page.ok) { extracted.push({ url, action: page.skipped ?? `http ${page.status}` }); continue; }
        const { title, text } = extractMainText(page.text, page.url);
        if (!title) continue;
        const cls = classifyTitle(title);
        if (cls.family === "unknown" && !/architect|design|bim|cad|planning/i.test(title)) continue;
        await ingestVacancy({ kind: "vacancy", title, url: page.url, employerName: null, description: text.slice(0, 20_000), descriptionIsTruncated: false, locationText: null, postcode: null, lat: null, lng: null, postedAt: m.received_at, closingAt: null, salaryMin: null, salaryMax: null, salaryText: null, employmentType: "unknown", externalRef: null, applicationUrl: page.url, applicationEmail: null, postedByAgency: false, raw: { from_alert: m.provider_message_id } }, { sourceDefinitionId: m.source_definition_id!, sourceCode: def?.code ?? "email_alert", sourceRunId: null });
        fetched++;
        extracted.push({ url, action: "ingested" });
      }
      await db().from("email_alert_messages").update({ status: "processed", processed_at: new Date().toISOString(), extracted_links: extracted as never }).eq("id", m.id);
      processed++;
    } catch (e) {
      await db().from("email_alert_messages").update({ status: "failed", error: (e as Error).message }).eq("id", m.id);
    }
  }
  return { processed, fetched, tasks };
}
