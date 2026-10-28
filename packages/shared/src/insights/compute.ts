import { inRange, makePeriod, makeRate, median, type Period, type Rate } from "./stats.js";
import type { ApplicationFact, InsightFacts, VacancyFact } from "./types.js";

const DAY = 86_400_000;
const CLOSED_VACANCY = ["closed", "filled", "withdrawn", "expired"];
const TERMINAL = ["offer_accepted", "offer_declined", "rejected", "withdrawn", "vacancy_closed", "closed_without_response"];

export interface RecordRef { kind: "vacancy" | "application"; id: string; label: string }
export interface FunnelStep { key: string; label: string; cohort: "vacancies" | "applications"; count: number; note?: string; records: RecordRef[] }
export interface OutcomeTally { key: string; label: string; count: number }
export interface GroupStat { key: string; n: number; responses: number; interviews: number; offers: number; interviewRate: Rate; responseRate: Rate }
export interface SourceStat {
  source: string; label: string; discovered: number; rawIncludingDuplicates: number; uniqueEmployers: number; relevant: number; pendingReview: number; relevantRate: Rate;
  appliedFrom: number; interviews: number; offers: number; stale: number; staleRate: Rate; duplicateRate: Rate;
  reliability: { runs: number; failed: number; successRate: Rate } | null;
}
export interface SeriesPoint { start: string; label: string; discovered: number; selected: number; submitted: number; responses: number; partial: boolean }

export interface Insights {
  period: Period;
  generatedAt: Date;
  overview: {
    employersDiscovered: number; vacanciesDiscovered: number; vacanciesReviewed: number; vacanciesAwaitingReview: number; sourcesWithMostRelevant: { source: string; relevant: number }[];
    duplicateRate: Rate; expiredRate: Rate;
    applicationsPrepared: number; applicationsSubmitted: number; awaitingResponse: number; interviewsOrAssessments: number; offers: number; rejected: number; withdrawn: number; noKnownOutcome: number; inProgress: number;
  };
  rates: { discoveryToResearch: Rate; researchToPriority: Rate; submission: Rate; interview: Rate; offer: Rate; response: Rate };
  outcomes: OutcomeTally[];
  funnel: FunnelStep[];
  sources: SourceStat[];
  breakdowns: Record<"roleFamily" | "practiceType" | "type" | "source" | "cv" | "zone" | "matched", GroupStat[]>;
  timing: { discoveryToSubmission: { n: number; medianDays: number | null }; submissionToResponse: { n: number; medianDays: number | null } };
  series: SeriesPoint[];
  previous: { vacanciesDiscovered: number; applicationsPrepared: number; applicationsSubmitted: number; responses: number };
  dataNotes: string[];
}

const eligibleVacancy = (v: VacancyFact) => !v.isTest && !v.duplicateOf;
const submittedAt = (a: ApplicationFact) => (a.confirmed ? a.submittedAt : null);
const responded = (a: ApplicationFact) => !!a.firstResponseAt || a.interviews + a.assessments > 0 || a.stage === "rejected" || a.stage === "offer_received" || a.stage === "offer_accepted" || a.stage === "offer_declined";
const hasOffer = (a: ApplicationFact) => ["offer_received", "offer_accepted", "offer_declined"].includes(a.stage);

/** A submission can be judged once something has happened, or once the maturity window has passed. Newer silent ones are "too early to tell". */
export function isMature(a: ApplicationFact, now: Date, maturityDays: number): boolean {
  const s = submittedAt(a);
  if (!s) return false;
  return responded(a) || TERMINAL.includes(a.stage) || now.getTime() - s.getTime() >= maturityDays * DAY;
}

const ref = (kind: RecordRef["kind"], id: string, label: string): RecordRef => ({ kind, id, label });

function group(apps: ApplicationFact[], keyOf: (a: ApplicationFact) => string | null | undefined): GroupStat[] {
  const m = new Map<string, ApplicationFact[]>();
  for (const a of apps) { const k = keyOf(a); const key = k && k.trim() ? k : "Unknown"; (m.get(key) ?? m.set(key, []).get(key)!).push(a); }
  return [...m.entries()].map(([key, xs]) => ({
    key, n: xs.length, responses: xs.filter(responded).length, interviews: xs.filter((a) => a.interviews + a.assessments > 0).length, offers: xs.filter(hasOffer).length,
    interviewRate: makeRate(xs.filter((a) => a.interviews + a.assessments > 0).length, xs.length), responseRate: makeRate(xs.filter(responded).length, xs.length),
  })).sort((a, b) => b.n - a.n);
}

export function computeInsights(facts: InsightFacts, range: { start: Date; end: Date }, opts: { now: Date; maturityDays: number; backlogDays: number }): Insights {
  const { now, maturityDays } = opts;
  const period = makePeriod(range.start, range.end, now);
  const inP = (d: Date | null | undefined) => inRange(d, period.start, period.endExclusive);
  const dataNotes: string[] = [];

  // ---- Discovery ---------------------------------------------------------------------------------------------------------
  const vacRaw = facts.vacancies.filter((v) => !v.isTest && inP(v.firstSeenAt));
  const vacs = vacRaw.filter(eligibleVacancy);
  const dupCount = vacRaw.filter((v) => v.duplicateOf).length;
  const eligible = vacs.filter((v) => v.eligibility !== "ineligible");
  const researched = eligible.filter((v) => v.researched);
  const dismissedUnresearched = (v: VacancyFact) => v.discoveryState === "dismissed" && !v.researched;
  const prioritised = researched.filter((v) => v.prioritised);
  const reviewed = vacs.filter((v) => v.discoveryState !== "new");
  const relevantOf = (v: VacancyFact) => v.eligibility !== "ineligible" && v.discoveryState !== "dismissed";

  const apps = facts.applications.filter((a) => !a.isTest);
  const selected = apps.filter((a) => inP(a.selectedAt));
  const prepared = selected;
  const submissionDen = selected.filter((a) => !(a.stage === "withdrawn" && !a.confirmed));
  const submittedInP = apps.filter((a) => inP(submittedAt(a)));
  const mature = submittedInP.filter((a) => isMature(a, now, maturityDays));
  const tooEarly = submittedInP.length - mature.length;
  const interviewed = (a: ApplicationFact) => a.interviews + a.assessments > 0;

  const unconfirmed = apps.filter((a) => a.submittedAt && !a.confirmed).length;
  const rates = {
    discoveryToResearch: makeRate(researched.length, eligible.length, {
      excluded: [{ reason: "test records", count: facts.vacancies.filter((v) => v.isTest && inP(v.firstSeenAt)).length }, { reason: "duplicates of another vacancy", count: dupCount }, { reason: "marked ineligible", count: vacs.length - eligible.length }],
      pending: eligible.filter((v) => !v.researched && !dismissedUnresearched(v)).length,
    }),
    researchToPriority: makeRate(prioritised.length, researched.length, { excluded: [{ reason: "duplicates and test records", count: dupCount }], pending: researched.filter((v) => !v.prioritised && v.priorityStatus == null).length }),
    submission: makeRate(submissionDen.filter((a) => a.confirmed).length, submissionDen.length, {
      excluded: [{ reason: "withdrawn before submission", count: selected.length - submissionDen.length }],
      pending: submissionDen.filter((a) => !a.confirmed && !TERMINAL.includes(a.stage)).length,
    }),
    interview: makeRate(mature.filter(interviewed).length, mature.length, { excluded: [{ reason: "submitted too recently to judge", count: tooEarly }, { reason: "submission not confirmed", count: unconfirmed }] }),
    offer: makeRate(mature.filter(hasOffer).length, mature.length, { excluded: [{ reason: "submitted too recently to judge", count: tooEarly }] }),
    response: makeRate(mature.filter(responded).length, mature.length, { excluded: [{ reason: "submitted too recently to judge", count: tooEarly }] }),
  };

  // ---- Outcomes. Unknown, pending and negative are kept apart. ----------------------------------------------------------------
  const sub = apps.filter((a) => a.confirmed);
  const cat = (a: ApplicationFact): string =>
    a.stage === "offer_accepted" ? "offer_accepted" : a.stage === "offer_declined" ? "offer_declined" : a.stage === "offer_received" ? "offer" : a.stage === "rejected" ? "rejected" : a.stage === "withdrawn" ? "withdrawn"
    : a.stage === "vacancy_closed" ? "vacancy_closed" : a.stage === "closed_without_response" ? "no_response" : interviewed(a) || ["interview_1", "further_interview", "assessment"].includes(a.stage) ? "in_process" : "awaiting";
  const labels: Record<string, string> = { offer_accepted: "Offer accepted", offer_declined: "Offer declined", offer: "Offer received, undecided", rejected: "Rejected by the employer", withdrawn: "Withdrawn by me", vacancy_closed: "Vacancy closed, outcome unknown", no_response: "No response after follow-ups", in_process: "In an interview or assessment process", awaiting: "Awaiting a response" };
  const submittedPeriodApps = sub.filter((a) => inP(a.submittedAt));
  const outcomes = Object.keys(labels).map((key) => ({ key, label: labels[key]!, count: submittedPeriodApps.filter((a) => cat(a) === key).length }));

  // ---- Funnel ------------------------------------------------------------------------------------------------------------
  const vref = (v: VacancyFact) => ref("vacancy", v.id, v.label);
  const aref = (a: ApplicationFact) => ref("application", a.id, a.label);
  const funnel: FunnelStep[] = [
    { key: "discovered", label: "Opportunities discovered", cohort: "vacancies", count: vacs.length, records: vacs.map(vref) },
    { key: "researched", label: "Researched", cohort: "vacancies", count: researched.length, records: researched.map(vref), note: "Of eligible vacancies" },
    { key: "prioritised", label: "Prioritised for action", cohort: "vacancies", count: prioritised.length, records: prioritised.map(vref) },
    { key: "prepared", label: "Applications prepared", cohort: "applications", count: prepared.length, records: prepared.map(aref), note: "Includes speculative applications" },
    { key: "submitted", label: "Submitted (confirmed)", cohort: "applications", count: prepared.filter((a) => a.confirmed).length, records: prepared.filter((a) => a.confirmed).map(aref) },
    { key: "interviews", label: "Interview or assessment received", cohort: "applications", count: prepared.filter((a) => a.confirmed && interviewed(a)).length, records: prepared.filter((a) => a.confirmed && interviewed(a)).map(aref), note: "Counted once per application, however many rounds" },
    { key: "offers", label: "Offer received", cohort: "applications", count: prepared.filter((a) => a.confirmed && hasOffer(a)).length, records: prepared.filter((a) => a.confirmed && hasOffer(a)).map(aref) },
    { key: "accepted", label: "Offer accepted", cohort: "applications", count: prepared.filter((a) => a.stage === "offer_accepted").length, records: prepared.filter((a) => a.stage === "offer_accepted").map(aref) },
  ];

  // ---- Sources -----------------------------------------------------------------------------------------------------------
  const labelOf = (code: string) => facts.sources.find((s) => s.code === code)?.label ?? (code === "unknown" ? "Unknown source" : code);
  const sourceCodes = [...new Set(vacRaw.map((v) => v.source))];
  const sources: SourceStat[] = sourceCodes.map((code) => {
    const raw = vacRaw.filter((v) => v.source === code), uniq = raw.filter(eligibleVacancy);
    const rel = uniq.filter(relevantOf);
    const stale = uniq.filter((v) => CLOSED_VACANCY.includes(v.status) || v.disappeared);
    const mine = new Set(uniq.map((v) => v.id));
    const fromHere = apps.filter((a) => a.vacancyId && mine.has(a.vacancyId));
    const runs = facts.sourceRuns.filter((r) => r.source === code && inP(r.startedAt));
    const failed = runs.filter((r) => r.status === "failed" || r.errors > 0).length;
    return {
      source: code, label: labelOf(code), discovered: uniq.length, rawIncludingDuplicates: raw.length, uniqueEmployers: new Set(uniq.map((v) => v.employerId).filter(Boolean)).size,
      relevant: rel.length, pendingReview: uniq.filter((v) => v.discoveryState === "new").length, relevantRate: makeRate(rel.length, uniq.length, { pending: uniq.filter((v) => v.discoveryState === "new").length }),
      appliedFrom: fromHere.length, interviews: fromHere.filter(interviewed).length, offers: fromHere.filter(hasOffer).length, stale: stale.length, staleRate: makeRate(stale.length, uniq.length),
      duplicateRate: makeRate(raw.length - uniq.length, raw.length),
      reliability: runs.length ? { runs: runs.length, failed, successRate: makeRate(runs.length - failed, runs.length) } : null,
    };
  }).sort((a, b) => b.relevant - a.relevant);

  // ---- Breakdowns (mature, confirmed submissions in the period) ---------------------------------------------------------------
  const breakdowns = {
    roleFamily: group(mature, (a) => a.roleFamily), practiceType: group(mature, (a) => a.practiceType), type: group(mature, (a) => (a.type === "speculative" ? "Speculative outreach" : "Advertised vacancy")),
    source: group(mature, (a) => a.source), cv: group(mature, (a) => a.cvVersion), zone: group(mature, (a) => a.zone),
    matched: group(mature, (a) => (a.matchedPreferences == null ? null : a.matchedPreferences ? "Matched stated preferences" : "Outside stated preferences")),
  };

  // ---- Timing ------------------------------------------------------------------------------------------------------------
  const d2s = submittedInP.filter((a) => a.discoveredAt && a.submittedAt).map((a) => (a.submittedAt!.getTime() - a.discoveredAt!.getTime()) / DAY).filter((x) => x >= 0);
  const s2r = submittedInP.filter((a) => a.firstResponseAt && a.submittedAt).map((a) => (a.firstResponseAt!.getTime() - a.submittedAt!.getTime()) / DAY).filter((x) => x >= 0);
  const timing = { discoveryToSubmission: { n: d2s.length, medianDays: median(d2s) }, submissionToResponse: { n: s2r.length, medianDays: median(s2r) } };

  // ---- Series ------------------------------------------------------------------------------------------------------------
  const step = period.days <= 31 ? 1 : 7, series: SeriesPoint[] = [];
  for (let t = period.start.getTime(); t < period.endExclusive.getTime(); t += step * DAY) {
    const s = new Date(t), e = new Date(Math.min(t + step * DAY, period.endExclusive.getTime()));
    const within = (d: Date | null | undefined) => inRange(d, s, e);
    series.push({
      start: s.toISOString().slice(0, 10), label: s.toISOString().slice(5, 10), discovered: vacs.filter((v) => within(v.firstSeenAt)).length, selected: apps.filter((a) => within(a.selectedAt)).length,
      submitted: apps.filter((a) => within(submittedAt(a))).length, responses: apps.filter((a) => within(a.firstResponseAt)).length, partial: e.getTime() > now.getTime(),
    });
  }

  const pv = period.previous, inPrev = (d: Date | null | undefined) => inRange(d, pv.start, pv.endExclusive);
  const previous = {
    vacanciesDiscovered: facts.vacancies.filter((v) => !v.isTest && !v.duplicateOf && inPrev(v.firstSeenAt)).length, applicationsPrepared: apps.filter((a) => inPrev(a.selectedAt)).length,
    applicationsSubmitted: apps.filter((a) => inPrev(submittedAt(a))).length, responses: apps.filter((a) => inPrev(a.firstResponseAt)).length,
  };

  // ---- Overview ----------------------------------------------------------------------------------------------------------
  const bySrc = new Map<string, number>(); for (const v of vacs.filter(relevantOf)) bySrc.set(v.source, (bySrc.get(v.source) ?? 0) + 1);
  const openSub = sub.filter((a) => !TERMINAL.includes(a.stage));
  const overview = {
    employersDiscovered: facts.employersDiscovered.filter((e) => !e.isTest && inP(e.discoveredAt)).length, vacanciesDiscovered: vacs.length, vacanciesReviewed: reviewed.length, vacanciesAwaitingReview: vacs.length - reviewed.length,
    sourcesWithMostRelevant: [...bySrc.entries()].map(([source, relevant]) => ({ source, relevant })).sort((a, b) => b.relevant - a.relevant).slice(0, 3),
    duplicateRate: makeRate(dupCount, vacRaw.length), expiredRate: makeRate(vacs.filter((v) => CLOSED_VACANCY.includes(v.status) || v.disappeared).length, vacs.length),
    applicationsPrepared: prepared.length, applicationsSubmitted: submittedInP.length, awaitingResponse: openSub.filter((a) => cat(a) === "awaiting").length,
    interviewsOrAssessments: apps.filter((a) => inP(a.submittedAt) && interviewed(a)).length, offers: apps.filter((a) => hasOffer(a) && inP(a.submittedAt)).length,
    rejected: submittedPeriodApps.filter((a) => a.stage === "rejected").length, withdrawn: submittedPeriodApps.filter((a) => a.stage === "withdrawn").length,
    noKnownOutcome: submittedPeriodApps.filter((a) => ["awaiting", "vacancy_closed", "no_response"].includes(cat(a))).length,
    inProgress: apps.filter((a) => !a.confirmed && !TERMINAL.includes(a.stage)).length,
  };

  if (facts.vacancies.length === 0) dataNotes.push("No vacancies have been discovered yet, so discovery measures have nothing to report.");
  if (facts.applications.length === 0) dataNotes.push("No applications have been recorded yet, so application measures have nothing to report.");
  if (unconfirmed > 0) dataNotes.push(`${unconfirmed} application(s) have a recorded date but no confirmed submission; they are left out of submission and response measures until confirmed.`);
  if (period.isPartial) dataNotes.push(`This period is not finished (${period.elapsedDays} of ${period.days} days). The comparison uses the ${period.previous.days} days before it so that like is compared with like.`);
  if (tooEarly > 0) dataNotes.push(`${tooEarly} submission(s) are newer than ${maturityDays} days with no reply. They are not counted as failures; they are too early to tell.`);

  return { period, generatedAt: now, overview, rates, outcomes, funnel, sources, breakdowns, timing, series, previous, dataNotes };
}

