import type { PriorityStatus } from "./types.js";

export interface PlanItem {
  id: string;
  kind: "vacancy" | "employer";
  name: string;
  status: PriorityStatus;
  score: number | null;
  pinned: boolean;
  favourite: boolean;
  live: boolean;
  deadlineAt: Date | null;
  needsReview: boolean;
  holdReason: string | null;
  holdUntil: string | null;
  researchIncomplete: boolean;
  hasBlockers: boolean;
  /** An application already exists past the preparation-planning stage: Stage 4 manages it. */
  inProgress?: boolean;
  effortMinutes: number | null;
  effortBasis: string;
  employerId: string | null;
  vacancyId: string | null;
}
export interface PlannerPrefs { hoursPerDay: number; workingDays: number[]; maxApplicationsPerWeek: number; maxOutreachPerWeek: number; maxResearchPerWeek: number }
export interface PlanInput {
  /** Local date, YYYY-MM-DD. */
  today: string;
  items: PlanItem[];
  prefs: PlannerPrefs;
  /** Minutes already committed per day by actions Erin has accepted. */
  booked: Record<string, number>;
  /** Accepted actions already counted against the weekly caps. */
  bookedCounts: { applications: number; outreach: number; research: number };
  horizonDays?: number;
}
export interface PlannedAction {
  itemId: string; employerId: string | null; vacancyId: string | null;
  kind: "research" | "verify" | "resolve_blocker" | "prepare_application" | "prepare_outreach" | "reconsider" | "decide";
  title: string; reason: string; minutes: number; basis: string;
  plannedFor: string | null; dueAt: string | null; warning: string | null; dedupeKey: string;
}

const DAY = 86_400_000;
const parse = (d: string) => new Date(`${d}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const isoDow = (d: Date) => (d.getUTCDay() === 0 ? 7 : d.getUTCDay());

interface Candidate extends Omit<PlannedAction, "plannedFor" | "warning"> { tier: number; sort: number; capKind: "applications" | "outreach" | "research" | null; part?: [number, number] }

/**
 * Turns priorities into a realistic week: a few well-chosen actions that fit Erin's stated time, not everything that could be done.
 * It respects working days, daily minutes and the weekly caps, books deadline work before the deadline, and says so when something cannot fit.
 */
export function planWeek(input: PlanInput): { actions: PlannedAction[]; unscheduled: PlannedAction[] } {
  const horizon = input.horizonDays ?? 7;
  const today = parse(input.today);
  const days: string[] = [];
  for (let k = 0; k < horizon; k++) { const d = new Date(today.getTime() + k * DAY); if (input.prefs.workingDays.includes(isoDow(d))) days.push(fmt(d)); }
  const perDay = Math.round(input.prefs.hoursPerDay * 60);
  const free: Record<string, number> = Object.fromEntries(days.map((d) => [d, Math.max(0, perDay - (input.booked[d] ?? 0))]));
  const cands: Candidate[] = [];

  for (const it of input.items) {
    if (!it.live || it.status === "dismissed") continue;
    if (it.inProgress && !it.needsReview) continue;
    const mk = (kind: Candidate["kind"], title: string, reason: string, minutes: number, basis: string, tier: number, sort: number, capKind: Candidate["capKind"], dueAt: Date | null = null, part?: [number, number], suffix = ""): Candidate =>
      ({ itemId: it.id, employerId: it.employerId, vacancyId: it.vacancyId, kind, title: part && part[1] > 1 ? `${title} (part ${part[0]} of ${part[1]})` : title, reason, minutes, basis, tier, sort, capKind, dueAt: dueAt ? dueAt.toISOString() : null, dedupeKey: `${it.id}:${kind}${suffix}${part && part[1] > 1 ? `:${part[0]}` : ""}`, part });
    const soon = it.deadlineAt ? Math.floor((it.deadlineAt.getTime() - today.getTime()) / DAY) : null;
    const dl = it.deadlineAt ? it.deadlineAt.getTime() : Number.MAX_SAFE_INTEGER;
    const rank = -(it.score ?? 0) - (it.pinned ? 1000 : 0) - (it.favourite ? 5 : 0);

    if (it.needsReview) cands.push(mk("decide", `Review what changed: ${it.name}`, "The recommendation changed and needs your decision.", 10, "Estimate", 0, rank, null));
    if (it.status === "on_hold") {
      if (it.holdUntil && it.holdUntil <= input.today) cands.push(mk("reconsider", `Reconsider: ${it.name}`, `The hold ended on ${it.holdUntil}${it.holdReason ? ` (${it.holdReason})` : ""}.`, 10, "Estimate", 5, rank, null));
      else if (it.researchIncomplete) cands.push(mk("research", `Complete research: ${it.name}`, "No priority score is possible until the research is complete.", 30, "Estimate", it.pinned ? 2 : 5, rank, "research"));
      else if (it.hasBlockers && (it.pinned || it.favourite)) cands.push(mk("resolve_blocker", `Resolve the blocker: ${it.name}`, it.holdReason ?? "A blocker is holding this up.", 15, "Estimate", 5, rank, null));
      continue;
    }
    if (it.status === "backlog" && !it.pinned && !it.favourite) continue;
    if (it.kind === "vacancy") {
      if (!it.deadlineAt) cands.push(mk("verify", `Verify the closing date: ${it.name}`, "No closing date is recorded; do not assume the vacancy stays open.", 10, "Estimate", it.status === "high" ? 3 : 4, rank, null));
      const total = it.effortMinutes ?? 120;
      const chunks = Math.max(1, Math.ceil(total / Math.max(30, perDay)));
      for (let c = 1; c <= chunks; c++) {
        const mins = c < chunks ? Math.ceil(total / chunks) : total - Math.ceil(total / chunks) * (chunks - 1);
        const urgent = soon != null && soon <= 7;
        cands.push(mk("prepare_application", `Prepare application: ${it.name}`, it.deadlineAt ? `Closes ${fmt(it.deadlineAt)}. ${it.effortBasis}` : it.effortBasis, Math.max(10, mins), it.effortMinutes == null ? "Estimate (no breakdown available)" : "Estimate", urgent ? 1 : it.pinned ? 2 : it.status === "high" ? 3 : 4, urgent ? dl : rank, "applications", it.deadlineAt, [c, chunks]));
      }
    } else {
      const total = it.effortMinutes ?? 60;
      const chunks = Math.max(1, Math.ceil(total / Math.max(30, perDay)));
      for (let c = 1; c <= chunks; c++) {
        const mins = c < chunks ? Math.ceil(total / chunks) : total - Math.ceil(total / chunks) * (chunks - 1);
        cands.push(mk("prepare_outreach", `Prepare a speculative approach: ${it.name}`, `${it.effortBasis} Nothing is sent without your approval.`, Math.max(10, mins), "Estimate", it.pinned ? 2 : it.status === "high" ? 3 : 4, rank, "outreach", null, [c, chunks]));
      }
    }
  }
  cands.sort((a, b) => a.tier - b.tier || a.sort - b.sort);

  const caps = { applications: input.prefs.maxApplicationsPerWeek - input.bookedCounts.applications, outreach: input.prefs.maxOutreachPerWeek - input.bookedCounts.outreach, research: input.prefs.maxResearchPerWeek - input.bookedCounts.research };
  const used = { applications: new Set<string>(), outreach: new Set<string>(), research: new Set<string>() };
  const actions: PlannedAction[] = [], unscheduled: PlannedAction[] = [];
  const lastDayFor = new Map<string, string>();
  for (const c of cands) {
    const { tier: _t, sort: _s, capKind, part: _p, ...rest } = c;
    const out = (plannedFor: string | null, warning: string | null) => ({ ...rest, plannedFor, warning });
    if (capKind && !used[capKind].has(c.itemId) && used[capKind].size >= Math.max(0, caps[capKind])) { unscheduled.push(out(null, `Weekly limit of ${caps[capKind] + (capKind === "applications" ? input.bookedCounts.applications : capKind === "outreach" ? input.bookedCounts.outreach : input.bookedCounts.research)} reached; left for a later week.`)); continue; }
    const dueDay = c.dueAt ? c.dueAt.slice(0, 10) : null;
    const after = lastDayFor.get(c.itemId + c.kind) ?? null;
    const day = days.find((d) => free[d]! >= c.minutes && (!dueDay || d <= dueDay) && (!after || d >= after));
    if (!day) {
      unscheduled.push(out(null, dueDay ? `No room before the closing date (${dueDay}) within your available time: raise your hours, drop something else, or decide now.` : "No room in this week's available time."));
      continue;
    }
    free[day]! -= c.minutes;
    lastDayFor.set(c.itemId + c.kind, day);
    if (capKind) used[capKind].add(c.itemId);
    actions.push(out(day, null));
  }
  return { actions, unscheduled: unscheduled.slice(0, 12) };
}
