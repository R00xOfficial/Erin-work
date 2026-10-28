import { isMature, type Insights } from "./compute.js";
import { compareRates, confidenceFor, makeRate, pct, type RecommendationConfidence } from "./stats.js";
import type { ApplicationFact, FeedbackFact, InsightFacts } from "./types.js";

// Findings are hypotheses worth investigating, never diagnoses. Each carries the observation, the numbers and sample size behind it, why it
// might matter, a proposed action and an honest confidence. Fingerprints are stable so a refreshed finding updates the same recommendation
// instead of creating a duplicate, and a dismissed one is not nagged back every day.

export type FindingArea = "discovery" | "sources" | "research" | "prioritisation" | "applications" | "interviews" | "follow_up" | "outreach" | "profile" | "scoring";
export interface Finding {
  code: string; fingerprint: string; area: FindingArea; title: string; observation: string; evidence: Record<string, unknown>; sampleSize: number;
  why: string; action: string; confidence: RecommendationConfidence; funnel: boolean;
}
const DAY = 86_400_000;
const interviewed = (a: ApplicationFact) => a.interviews + a.assessments > 0;
const hasOffer = (a: ApplicationFact) => ["offer_received", "offer_accepted", "offer_declined"].includes(a.stage);
const LOCATION_FLAG = /locat|commut|travel|distance|zone|relocat/i;

export function detectFindings(facts: InsightFacts, ins: Insights, opts: { now: Date; maturityDays: number; backlogDays: number }): Finding[] {
  const out: Finding[] = [];
  const { period } = ins, now = opts.now;
  const add = (f: Omit<Finding, "fingerprint" | "confidence"> & { key?: string; confidence?: RecommendationConfidence }) => out.push({ ...f, fingerprint: f.key ? `${f.code}:${f.key}` : f.code, confidence: f.confidence ?? confidenceFor(f.sampleSize) });
  const inP = (d: Date) => d.getTime() >= period.start.getTime() && d.getTime() < period.endExclusive.getTime();
  const vacs = facts.vacancies.filter((v) => !v.isTest && !v.duplicateOf && inP(v.firstSeenAt));
  const apps = facts.applications.filter((a) => !a.isTest);

  // Many discoveries are dismissed as not relevant.
  const reviewed = vacs.filter((v) => v.discoveryState !== "new"), dismissed = reviewed.filter((v) => v.discoveryState === "dismissed");
  if (reviewed.length >= 20 && dismissed.length / reviewed.length >= 0.6) {
    const reasons = new Map<string, number>(); for (const v of dismissed) if (v.dismissedReason) reasons.set(v.dismissedReason, (reasons.get(v.dismissedReason) ?? 0) + 1);
    add({ code: "discovery.too_broad", area: "discovery", funnel: false, title: "Most reviewed vacancies are being dismissed", sampleSize: reviewed.length,
      observation: `${dismissed.length} of ${reviewed.length} reviewed vacancies (${pct(dismissed.length / reviewed.length)}) were dismissed as not relevant.`,
      evidence: { reviewed: reviewed.length, dismissed: dismissed.length, topReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3) },
      why: "If most of what discovery brings in is unsuitable, review time is going on noise rather than opportunities.",
      action: "Look at the most common dismissal reasons and consider narrowing role families, keywords or sources in discovery. Nothing has been changed for you." });
  }

  // Location is the main reason vacancies are unsuitable, or few relevant vacancies are found at all.
  const locFlag = vacs.filter((v) => v.hardFlags.some((f) => LOCATION_FLAG.test(f)));
  if (vacs.length >= 20 && locFlag.length / vacs.length >= 0.3) {
    add({ code: "discovery.location", area: "discovery", funnel: false, title: "Location is ruling out many vacancies", sampleSize: vacs.length,
      observation: `${locFlag.length} of ${vacs.length} vacancies (${pct(locFlag.length / vacs.length)}) carry a location or travel flag.`, evidence: { vacancies: vacs.length, locationFlagged: locFlag.length },
      why: "Your travel limits may be excluding opportunities, or discovery may be searching areas you cannot reach.",
      action: "Check your location and travel limits in the candidate profile, and decide whether to keep them, widen them, or stop searching those areas." });
  }
  const relevant = vacs.filter((v) => v.eligibility !== "ineligible" && v.discoveryState !== "dismissed");
  if (vacs.length >= 30 && relevant.length < 5) {
    add({ code: "discovery.too_few_relevant", area: "discovery", funnel: false, title: "Very few relevant vacancies are being found", sampleSize: vacs.length,
      observation: `Only ${relevant.length} of ${vacs.length} vacancies discovered in this period are eligible and not dismissed.`, evidence: { vacancies: vacs.length, relevant: relevant.length },
      why: "The current search area or sources may not cover where suitable roles are advertised.",
      action: "Consider adding sources, widening the area or role families, or relying more on speculative outreach to practices likely to hire." });
  }

  // Source quality: compare each source with all the others, only where the difference is larger than chance.
  const allRel = ins.sources.reduce((a, s) => a + s.relevant, 0), allDisc = ins.sources.reduce((a, s) => a + s.discovered, 0);
  for (const s of ins.sources) {
    if (s.discovered < 10 || allDisc - s.discovered < 10) continue;
    const rest = makeRate(allRel - s.relevant, allDisc - s.discovered), cmp = compareRates(s.relevantRate, rest);
    if (!cmp.comparable || !cmp.reliableDifference) continue;
    const better = s.relevantRate.rate! > rest.rate!;
    add({ code: better ? "sources.better" : "sources.worse", key: s.source, area: "sources", funnel: false, sampleSize: s.discovered,
      title: better ? `${s.label} is producing better-matched vacancies` : `${s.label} is producing mostly unsuitable vacancies`,
      observation: `${s.relevant} of ${s.discovered} vacancies from ${s.label} (${pct(s.relevantRate.rate)}) are relevant, against ${pct(rest.rate)} from the other sources.`,
      evidence: { source: s.source, relevant: s.relevant, discovered: s.discovered, others: { relevant: rest.numerator, discovered: rest.denominator } },
      why: better ? "A source that yields more suitable roles per vacancy deserves more of your review time." : "Review time spent here yields fewer suitable roles than elsewhere.",
      action: better ? `Check ${s.label} first when reviewing, and consider running it more often.` : `Consider checking ${s.label} less often or tightening its filters.` });
  }
  for (const s of ins.sources) {
    if (s.reliability && s.reliability.runs >= 5 && s.reliability.failed / s.reliability.runs >= 0.4) {
      add({ code: "sources.unreliable", key: s.source, area: "sources", funnel: false, title: `${s.label} refreshes are often failing`, sampleSize: s.reliability.runs,
        observation: `${s.reliability.failed} of ${s.reliability.runs} refreshes of ${s.label} in this period failed or reported errors.`, evidence: { source: s.source, ...s.reliability },
        why: "Unreliable refreshes mean you may be missing vacancies from this source, or seeing stale ones.", action: "Check the source's status and error notes on the Sources page before relying on its numbers." });
    }
  }

  // Funnel: researched less than discovered.
  const el = ins.rates.discoveryToResearch;
  if (el.denominator >= 20 && el.rate! < 0.25 && el.pending / el.denominator >= 0.5) {
    add({ code: "funnel.research_gap", area: "research", funnel: true, title: "Many discoveries are waiting and few have been researched", sampleSize: el.denominator,
      observation: `${el.numerator} of ${el.denominator} eligible vacancies (${pct(el.rate)}) have been researched; ${el.pending} are still waiting for a decision.`, evidence: { researched: el.numerator, eligible: el.denominator, pending: el.pending },
      why: "This may be a review backlog rather than a problem with discovery. It could also mean discovery is bringing in more than you can use.",
      action: "Decide whether to set aside time to triage the waiting vacancies, or tighten discovery so less arrives." });
  }
  // Funnel: research time wasted on things that end up dismissed.
  const researchedV = vacs.filter((v) => v.researched), wasted = researchedV.filter((v) => v.priorityStatus === "dismissed" || v.discoveryState === "dismissed");
  if (researchedV.length >= 10 && wasted.length / researchedV.length >= 0.5) {
    add({ code: "funnel.research_wasted", area: "research", funnel: true, title: "Much researched work ends in dismissal", sampleSize: researchedV.length,
      observation: `${wasted.length} of ${researchedV.length} researched vacancies (${pct(wasted.length / researchedV.length)}) were later dismissed.`, evidence: { researched: researchedV.length, dismissed: wasted.length },
      why: "Research is the costly step. If it often ends in dismissal, an earlier check might save time.",
      action: "See which dismissal reasons recur, and consider whether an eligibility check or a quick-look filter could catch them before full research." });
  }
  // Funnel: prepared but never submitted.
  const stale = apps.filter((a) => !a.confirmed && !["withdrawn", "rejected", "vacancy_closed", "closed_without_response", "offer_declined", "offer_accepted"].includes(a.stage) && now.getTime() - a.selectedAt.getTime() >= opts.backlogDays * DAY);
  if (stale.length >= 3) {
    add({ code: "funnel.unsubmitted_backlog", area: "applications", funnel: true, title: "Applications are being started but not submitted", sampleSize: stale.length,
      observation: `${stale.length} applications have been in preparation for ${opts.backlogDays}+ days without a confirmed submission.`, evidence: { count: stale.length, examples: stale.slice(0, 5).map((a) => a.label) },
      why: "Applications that never go out use preparation time without any chance of a result. It may be that some should be withdrawn, or that something specific is blocking them.",
      action: "Open each one and either finish it, close it with a reason, or note what is blocking it." });
  }

  // Applications with few responses. A wide interval is not evidence, so this needs the upper bound to be clearly low.
  const mature = apps.filter((a) => a.confirmed && a.submittedAt && inP(a.submittedAt) && isMature(a, now, opts.maturityDays));
  const resp = ins.rates.response;
  if (resp.denominator >= 8 && resp.high! < 0.35) {
    const suitable = mature.filter((a) => (a.suitability ?? 0) >= 60).length;
    add({ code: "applications.no_response", area: "applications", funnel: true, title: "Few applications are getting any reply", sampleSize: resp.denominator,
      observation: `${resp.numerator} of ${resp.denominator} judged applications (${pct(resp.rate)}) have had a reply; ${suitable} of them scored 60+ for suitability.`, evidence: { responses: resp.numerator, judged: resp.denominator, suitable, range: [resp.low, resp.high] },
      why: "If suitable applications get no reply, the cause could be the CV, the portfolio, the covering message, the choice of practice, or simply timing. The data cannot say which.",
      action: "Ask someone you trust to review the CV and portfolio, compare what you sent with the vacancy wording, and consider recording any employer feedback you do get." });
  }
  // Interviews that rarely progress.
  const iv = mature.filter(interviewed), resolved = iv.filter((a) => hasOffer(a) || ["rejected", "withdrawn", "closed_without_response", "vacancy_closed"].includes(a.stage));
  if (resolved.length >= 5 && resolved.filter(hasOffer).length === 0) {
    add({ code: "interviews.no_offers", area: "interviews", funnel: true, title: "Interviews are happening but not leading to offers", sampleSize: resolved.length,
      observation: `${resolved.length} applications that reached an interview or assessment have concluded without an offer.`, evidence: { concluded: resolved.length, offers: 0 },
      why: "This may point to interview or assessment preparation, but offers also depend on the number of candidates and the employer's own timing.",
      action: "Record feedback and difficult questions for each one, then look for patterns before changing how you prepare." });
  }
  // Speculative outreach.
  const spec = mature.filter((a) => a.type === "speculative"), specResp = makeRate(spec.filter((a) => !!a.firstResponseAt || interviewed(a) || a.stage === "rejected" || hasOffer(a)).length, spec.length);
  if (spec.length >= 8 && specResp.high! < 0.25) {
    add({ code: "outreach.low_engagement", area: "outreach", funnel: false, title: "Speculative outreach is drawing little engagement", sampleSize: spec.length,
      observation: `${specResp.numerator} of ${spec.length} judged speculative approaches (${pct(specResp.rate)}) have had a reply.`, evidence: { replies: specResp.numerator, judged: spec.length },
      why: "Targeting, timing or the message may be off, or this kind of practice may rarely respond to unsolicited approaches.",
      action: "Review which practices were approached and which messages were used. Consider targeting only those with recruitment signals, and vary one thing at a time." });
  }
  // Follow-ups regularly missed.
  const due = facts.followups.filter((f) => inP(f.dueAt) && f.dueAt.getTime() < now.getTime()), missed = due.filter((f) => f.status === "open" || f.status === "snoozed");
  if (due.length >= 5 && missed.length / due.length >= 0.4) {
    add({ code: "followups.missed", area: "follow_up", funnel: false, title: "Follow-up tasks are often left undone", sampleSize: due.length,
      observation: `${missed.length} of ${due.length} follow-ups that fell due in this period are still open.`, evidence: { due: due.length, stillOpen: missed.length },
      why: "Either the reminders are not reaching you at a useful time, there are too many, or the intervals do not match how you work.",
      action: "Consider changing the follow-up interval or maximum count in Settings → Planner, or dismissing follow-ups you do not intend to make." });
  }
  // Priority recommendations repeatedly rejected.
  const pf = facts.priorityFeedback;
  if (pf.rejected >= 10 && pf.rejected / Math.max(1, pf.accepted + pf.rejected) >= 0.5) {
    add({ code: "scoring.rejected_often", area: "scoring", funnel: false, title: "Priority recommendations are often rejected", sampleSize: pf.accepted + pf.rejected,
      observation: `${pf.rejected} of ${pf.accepted + pf.rejected} responses to priority recommendations were rejections.`, evidence: pf,
      why: "If you often disagree with the ranking, the weights may not reflect what you value.", action: "Review the priority model weights in Settings → Planner, using the reasons you gave when rejecting. Weights are never changed automatically." });
  }
  return out;
}

// ---- Feedback themes ---------------------------------------------------------------------------------------------------
export interface Theme { tag: string; applications: number }
const normTag = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
/** Employer-provided and personal themes are counted separately and never merged. Each application counts once per tag. */
export function feedbackThemes(feedback: FeedbackFact[]): { employer: Theme[]; own: Theme[] } {
  const count = (src: "employer" | "own") => {
    const m = new Map<string, Set<string>>();
    for (const f of feedback.filter((x) => x.source === src)) for (const t of f.tags.map(normTag).filter(Boolean)) (m.get(t) ?? m.set(t, new Set()).get(t)!).add(f.applicationId);
    return [...m.entries()].map(([tag, s]) => ({ tag, applications: s.size })).sort((a, b) => b.applications - a.applications);
  };
  return { employer: count("employer"), own: count("own") };
}

export interface SuggestionDraft { kind: "skill_or_experience" | "qualification_requirement" | "job_categories" | "scoring_model"; fingerprint: string; title: string; detail: string; evidence: Record<string, unknown> }
export function profileSuggestions(facts: InsightFacts, ins: Insights): SuggestionDraft[] {
  const out: SuggestionDraft[] = [];
  // Requirements repeatedly missing from vacancies that otherwise suit. This is a prompt to check, never a claim that Erin holds the skill.
  const gaps = new Map<string, Set<string>>();
  for (const g of facts.gaps.filter((x) => (x.suitability ?? 0) >= 60)) for (const m of g.missing.map(normTag).filter((x) => x.length > 2)) (gaps.get(m) ?? gaps.set(m, new Set()).get(m)!).add(g.vacancyId);
  for (const [req, vs] of gaps) if (vs.size >= 3) out.push({
    kind: "qualification_requirement", fingerprint: `gap:${req}`, title: `“${req}” keeps appearing as a gap`,
    detail: `“${req}” is listed as missing from ${vs.size} vacancies that otherwise scored 60+ for suitability. Consider whether you hold it and have not recorded it, or whether it is a genuine barrier you want to address. It appearing often in job descriptions does not mean you have it, and nothing has been added to your profile.`,
    evidence: { requirement: req, vacancies: vs.size },
  });
  const themes = feedbackThemes(facts.feedback.filter((f) => f.kind === "missing_skill" || f.kind === "rejection_reason" || f.kind === "interview_feedback"));
  for (const t of themes.employer.filter((x) => x.applications >= 2)) out.push({
    kind: "skill_or_experience", fingerprint: `employer_theme:${t.tag}`, title: `Employers have raised “${t.tag}” more than once`,
    detail: `Employers themselves gave feedback mentioning “${t.tag}” on ${t.applications} different applications. Consider whether your profile and portfolio evidence it, or whether it is an area to develop. Your profile has not been changed.`,
    evidence: { tag: t.tag, applications: t.applications, source: "employer feedback" },
  });
  const fams = ins.breakdowns.roleFamily.filter((g) => g.key !== "Unknown" && g.n >= 8);
  for (const g of fams) {
    const rest = makeRate(ins.rates.interview.numerator - g.interviewRate.numerator, ins.rates.interview.denominator - g.n), cmp = compareRates(g.interviewRate, rest);
    if (cmp.comparable && cmp.reliableDifference && g.interviewRate.rate! > rest.rate!) out.push({
      kind: "job_categories", fingerprint: `family:${g.key}`, title: `Applications for “${g.key}” are getting more interviews`,
      detail: `${g.interviewRate.numerator} of ${g.n} “${g.key}” applications led to an interview, against ${pct(rest.rate)} for the others. This is an association in your own results and not proof of cause. You may want to weigh this when choosing preferred job categories.`,
      evidence: { family: g.key, interviews: g.interviewRate.numerator, applications: g.n, others: { interviews: rest.numerator, applications: rest.denominator } },
    });
  }
  const pf = facts.priorityFeedback;
  if (pf.rejected >= 10 && pf.rejected / Math.max(1, pf.accepted + pf.rejected) >= 0.5) out.push({
    kind: "scoring_model", fingerprint: "scoring:rejected", title: "Review the priority model", detail: `${pf.rejected} of ${pf.accepted + pf.rejected} recommendations were rejected. Historical priority items stay as they were; a new model version only affects future calculations.`, evidence: pf,
  });
  return out;
}
