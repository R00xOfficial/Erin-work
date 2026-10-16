import { employerBriefingSchema, canonicaliseUrl, urlHash, hostOf, type EmployerBriefing } from "@ajis/shared";
import { db } from "../lib/db.js";
import { politeFetch } from "../lib/http.js";
import { extractMainText, extractLinks, extractEmails } from "../lib/extract.js";
import { logger } from "../lib/logger.js";
import { runStructured } from "../ai/client.js";
import type { Job } from "./index.js";

interface Payload { employerId: string; force?: boolean }
const PROMPT_VERSION = "briefing-v1";
const MAX_PAGES = 6, MAX_CHARS_PER_PAGE = 6000;

const SYSTEM = `You are a research analyst preparing an employer intelligence briefing for an entry-level architecture job seeker (University of Portsmouth architecture graduate, London-based, Part 1-equivalent, open to assistant, technician, BIM/CAD, design-coordination and planning routes).

Rules you must follow:
1. Use ONLY the page extracts provided. Every factual field must cite the source ids (S1, S2, ...) it came from in source_ids.
2. Set evidence_status honestly: "verified_fact" only for something stated plainly on an official page; "source_supported_summary" for a fair paraphrase; "inference" for anything you deduce; "unverified" when the pages do not say; "conflicting_sources" when pages disagree.
3. Never invent projects, people, emails or vacancies. If there are no vacancies on the pages, hiring_signals must not claim one. A new office or project is an inference about possible demand, not a job.
4. Contacts: only people named on official pages with a professional role. No personal details.
5. Keep text concise and specific. The personalised_opener must reference a real, cited project or statement.
6. Output must match the JSON schema described by the user message exactly.`;

async function fetchPages(employer: { website: string | null; careers_url: string | null; website_domain: string | null }) {
  const pages: { id: string; url: string; title: string | null; text: string }[] = [];
  const seen = new Set<string>();
  const queue: string[] = [];
  if (employer.website) queue.push(employer.website);
  if (employer.careers_url) queue.push(employer.careers_url);
  while (queue.length && pages.length < MAX_PAGES) {
    const url = queue.shift()!;
    const canon = canonicaliseUrl(url);
    if (!canon || seen.has(canon)) continue;
    seen.add(canon);
    const res = await politeFetch(url, { minIntervalMs: 2500 });
    if (!res.ok || !res.text) continue;
    const { title, text } = extractMainText(res.text, res.url);
    if (text.length < 200) continue;
    pages.push({ id: `S${pages.length + 1}`, url: res.url, title, text: text.slice(0, MAX_CHARS_PER_PAGE) });
    if (pages.length === 1) {
      // From the homepage, pick the most informative internal links: about / people / projects / careers.
      const links = extractLinks(res.text, res.url).filter((l) => hostOf(l) && employer.website_domain && hostOf(l)!.endsWith(employer.website_domain!));
      const prefer = (re: RegExp) => links.find((l) => re.test(l) && !seen.has(canonicaliseUrl(l) ?? l));
      for (const re of [/career|join|vacanc|job|work-with|recruit|opportunit/i, /about|studio|practice|who-we-are/i, /people|team|staff/i, /project|work|portfolio/i, /news|journal/i]) {
        const l = prefer(re);
        if (l) queue.push(l);
      }
    }
  }
  return pages;
}

export async function aiEmployerBriefing(job: Job<Payload>) {
  const { employerId } = job.data;
  const { data: e } = await db().from("employers").select("*").eq("id", employerId).is("deleted_at", null).maybeSingle();
  if (!e) return { skipped: "employer missing" };
  if (!e.website) return { skipped: "no website on record" };
  const pages = await fetchPages(e);
  if (pages.length === 0) {
    await db().from("tasks").insert({ title: `Could not fetch ${e.legal_name}'s website for the briefing — check the URL or research manually`, task_type: "research", entity_type: "employer", entity_id: employerId, employer_id: employerId, auto_generated: true, dedupe_key: `briefing_fetch_failed:${employerId}` });
    return { skipped: "no fetchable pages" };
  }
  // Record each fetched page as a source so claims can point at it.
  const sourceIds = new Map<string, string>();
  for (const p of pages) {
    const canon = canonicaliseUrl(p.url)!;
    const { data: s } = await db().from("sources").upsert({ url: p.url, url_hash: urlHash(canon), canonical_url: canon, host: hostOf(canon), publisher: e.display_name ?? e.legal_name, title: p.title, evidence_type: "primary_official", confidence: 80, entity_type: "employer", entity_id: employerId, last_fetched_at: new Date().toISOString(), fetch_status: "ok", recheck_interval: "14 days", next_check_at: new Date(Date.now() + 14 * 86_400_000).toISOString() }, { onConflict: "url_hash" }).select("id").single();
    if (s) sourceIds.set(p.id, s.id);
  }
  const emails = extractEmails(pages.map((p) => p.text).join("\n")).filter((m) => e.website_domain && m.endsWith(`@${e.website_domain}`));
  const user = `EMPLOYER: ${e.legal_name}${e.display_name ? ` (${e.display_name})` : ""}\nWEBSITE DOMAIN: ${e.website_domain}\nKNOWN FACTS: practice_type=${e.practice_type}; sectors=${e.sectors.join(", ") || "unknown"}; companies_house=${e.companies_house_number ?? "unknown"}\nGENERIC EMAILS FOUND ON PAGES: ${emails.join(", ") || "none"}\n\nPAGE EXTRACTS:\n${pages.map((p) => `--- ${p.id}: ${p.url}${p.title ? ` — ${p.title}` : ""}\n${p.text}`).join("\n\n")}\n\nReturn JSON with exactly these keys: business_overview, design_identity_and_vision, practice_type, size_band, sectors, software, projects (max 5), hiring_signals, hires_part1, accepts_speculative, graduate_programme, applications_email, contacts (max 5), potential_role_fit, outreach_recommendation {worth_approaching, best_route, personalised_opener, proposed_ask (vacancy_enquiry|speculative_cv|portfolio_review|informal_conversation|do_not_approach_yet), rationale}, fit_notes {why_fit, most_relevant_project, matching_skills[], gaps[]}, unresolved_questions[].\nEach claimed field is an object {value, evidence_status, source_ids[]}. practice_type value must be one of: architecture_practice, architectural_technologists, multidisciplinary_consultancy, interior_workplace_design, urban_design_masterplanning, heritage_conservation, planning_consultancy, residential_developer, commercial_developer, housing_association, local_authority, construction_design_build, building_surveying, bim_visualisation_studio, university_research, specialist_consultancy, recruitment_agency, other, or null. size_band one of 1_5, 6_20, 21_50, 51_200, 201_1000, 1000_plus, unknown, or null. hires_part1 / accepts_speculative / graduate_programme values: yes|no|unknown. hiring_signals items: {summary, signal_type, strength (weak|moderate|strong), evidence_status, source_ids}. projects items: {name, project_type, location, client, stage, relevance, evidence_status, source_ids}. contacts items: {full_name, role_title, why_relevant, official_profile_url, evidence_status, source_ids}.`;

  const result = await runStructured<EmployerBriefing>({ purpose: "employer_briefing", entityType: "employer", entityId: employerId, promptVersion: PROMPT_VERSION, system: SYSTEM, user, schema: employerBriefingSchema, maxTokens: 6000 });
  if (!result.ok) {
    logger.warn({ employerId, reason: result.reason }, "briefing failed");
    return { skipped: result.reason };
  }
  const b = result.data;
  const sid = (ids: string[]) => ids.map((i) => sourceIds.get(i)).find(Boolean) ?? null;
  const claim = async (field: string, value: unknown, status: string, ids: string[], quote?: string | null) => {
    await db().from("claims").upsert({ entity_type: "employer", entity_id: employerId, field_name: field, value: value as never, evidence_status: status as never, source_id: sid(ids), extracted_by: "ai", model: process.env.ANTHROPIC_MODEL ?? null, prompt_version: PROMPT_VERSION, quote: quote ?? null }, { onConflict: "entity_type,entity_id,field_name,source_id" });
  };
  await claim("business_overview", b.business_overview.value, b.business_overview.evidence_status, b.business_overview.source_ids);
  await claim("design_identity_and_vision", b.design_identity_and_vision.value, b.design_identity_and_vision.evidence_status, b.design_identity_and_vision.source_ids);
  await claim("practice_type", b.practice_type.value, b.practice_type.evidence_status, b.practice_type.source_ids);
  await claim("size_band", b.size_band.value, b.size_band.evidence_status, b.size_band.source_ids);
  await claim("sectors", b.sectors.value, b.sectors.evidence_status, b.sectors.source_ids);
  await claim("software", b.software.value, b.software.evidence_status, b.software.source_ids);
  await claim("hires_part1", b.hires_part1.value, b.hires_part1.evidence_status, b.hires_part1.source_ids);
  await claim("accepts_speculative", b.accepts_speculative.value, b.accepts_speculative.evidence_status, b.accepts_speculative.source_ids);
  await claim("graduate_programme", b.graduate_programme.value, b.graduate_programme.evidence_status, b.graduate_programme.source_ids);
  await claim("applications_email", b.applications_email.value, b.applications_email.evidence_status, b.applications_email.source_ids);
  await claim("potential_role_fit", b.potential_role_fit.value, b.potential_role_fit.evidence_status, b.potential_role_fit.source_ids);
  await claim("outreach_recommendation", b.outreach_recommendation, "inference", []);
  b.projects.forEach((p, i) => void claim(`project.${i + 1}`, `${p.name}${p.project_type ? ` — ${p.project_type}` : ""}${p.location ? `, ${p.location}` : ""}${p.stage ? ` (${p.stage})` : ""}: ${p.relevance}`, p.evidence_status, p.source_ids));
  b.contacts.forEach((c, i) => void claim(`contact.${i + 1}`, `${c.full_name}${c.role_title ? `, ${c.role_title}` : ""} — ${c.why_relevant}${c.official_profile_url ? ` (${c.official_profile_url})` : ""}`, c.evidence_status, c.source_ids));
  b.unresolved_questions.forEach((q, i) => void claim(`unresolved_question.${i + 1}`, q, "unverified", []));
  for (const [i, s] of b.hiring_signals.entries()) {
    await claim(`hiring_signal.${i + 1}`, `${s.signal_type}: ${s.summary}`, s.evidence_status, s.source_ids);
    if (s.evidence_status === "verified_fact" || s.evidence_status === "source_supported_summary") {
      const type = /vacanc|hiring|recruit|job/i.test(s.signal_type + s.summary) ? "social_hiring_post" : /office|studio|relocat/i.test(s.signal_type) ? "new_office" : /project|win|award/i.test(s.signal_type) ? "project_announcement" : "press";
      await db().from("hiring_signals").upsert({ employer_id: employerId, signal_type: type, strength: s.strength, summary: s.summary, source_id: sid(s.source_ids), evidence_status: s.evidence_status }, { onConflict: "employer_id,signal_type,source_id,observed_on", ignoreDuplicates: true });
    }
  }
  // Cache onto the employer record (text + evidence status), never touching stage or vacancies.
  const only = (st: string) => (st === "verified_fact" || st === "source_supported_summary");
  await db().from("employers").update({
    business_signals: b.business_overview.value, business_signals_evidence: b.business_overview.evidence_status,
    vision_culture: b.design_identity_and_vision.value, vision_culture_evidence: b.design_identity_and_vision.evidence_status,
    project_intelligence: b.projects.map((p) => `• ${p.name}${p.project_type ? ` (${p.project_type}` : ""}${p.location ? `${p.project_type ? ", " : " ("}${p.location}` : ""}${p.project_type || p.location ? ")" : ""} — ${p.relevance}`).join("\n") || null,
    project_intelligence_evidence: b.projects.length ? (b.projects.every((p) => only(p.evidence_status)) ? "source_supported_summary" : "inference") : "unverified",
    recruitment_intelligence: [b.potential_role_fit.value, b.hiring_signals.map((s) => `• ${s.summary}`).join("\n")].filter(Boolean).join("\n\n") || null,
    recruitment_intelligence_evidence: b.potential_role_fit.evidence_status,
    hires_part1: only(b.hires_part1.evidence_status) ? b.hires_part1.value : e.hires_part1,
    hires_part1_evidence: b.hires_part1.evidence_status,
    has_graduate_programme: only(b.graduate_programme.evidence_status) ? b.graduate_programme.value : e.has_graduate_programme,
    accepts_speculative: only(b.accepts_speculative.evidence_status) ? b.accepts_speculative.value : e.accepts_speculative,
    software: b.software.value.length ? b.software.value : e.software,
    sectors: e.sectors.length ? e.sectors : b.sectors.value,
    size_band: e.size_band === "unknown" && b.size_band.value && only(b.size_band.evidence_status) ? b.size_band.value : e.size_band,
    applications_email: e.applications_email ?? (only(b.applications_email.evidence_status) && b.applications_email.value && e.website_domain && b.applications_email.value.endsWith(`@${e.website_domain}`) ? b.applications_email.value : null),
    last_checked_at: new Date().toISOString(),
    confidence_score: Math.max(Number(e.confidence_score), 55),
    data_quality: e.data_quality === "poor" ? "fair" : e.data_quality,
  }).eq("id", employerId);
  // Research notes (interpretation) — marked for review.
  const { data: existingNote } = await db().from("research_notes").select("id").eq("employer_id", employerId).is("vacancy_id", null).eq("is_current", true).maybeSingle();
  const note = { employer_id: employerId, why_fit: b.fit_notes.why_fit, relevant_project: b.fit_notes.most_relevant_project, matching_skills: b.fit_notes.matching_skills, gaps: b.fit_notes.gaps, hiring_signal_summary: b.hiring_signals.map((s) => s.summary).join("; ") || null, personalised_opener: b.outreach_recommendation.personalised_opener, proposed_ask: b.outreach_recommendation.proposed_ask, best_contact_reason: b.outreach_recommendation.best_route, evidence_status: "inference" as const, ai_run_id: result.runId, is_current: true, reviewed_at: null };
  if (existingNote) await db().from("research_notes").update(note).eq("id", existingNote.id); else await db().from("research_notes").insert(note);
  await db().from("tasks").insert({ title: `Review AI briefing for ${e.legal_name} and confirm the fit notes before any outreach`, task_type: "research", entity_type: "employer", entity_id: employerId, employer_id: employerId, auto_generated: true, dedupe_key: `briefing_review:${employerId}`, priority: "normal" });
  await db().from("job_requests").insert({ job_name: "scoring.recompute", payload: { employerId }, singleton_key: `score:${employerId}` });
  if (e.outreach_stage === "awaiting_research" || e.outreach_stage === "discovered") await db().from("employers").update({ outreach_stage: "research_in_progress" }).eq("id", employerId);
  return { employerId, pages: pages.length, cached: result.cached, projects: b.projects.length, contacts: b.contacts.length, signals: b.hiring_signals.length };
}
