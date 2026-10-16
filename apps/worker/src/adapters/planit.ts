import { normaliseCompanyName } from "@ajis/shared";
import { fetchJson } from "../lib/http.js";
import { db } from "../lib/db.js";
import type { Adapter, RawSignal } from "./types.js";

interface PlanItRecord { uid: string; name?: string; description?: string; address?: string; postcode?: string; lat?: number; lng?: number; app_state?: string; app_type?: string; start_date?: string; decided_date?: string; agent_name?: string; applicant_name?: string; area_name?: string; link?: string; url?: string }
interface PlanItResponse { records?: PlanItRecord[]; total?: number }

/**
 * PlanIt (planit.org.uk) — public API, no key. Searches planning applications where an active employer
 * is named as the agent. Each new application is a hiring SIGNAL ("possible workload growth"), never a vacancy.
 */
export const planit: Adapter = {
  code: "planit",
  async *discover(ctx) {
    const cfg = ctx.config as { base_url?: string; pg_sz?: number; lookback_days?: number };
    const base = cfg.base_url ?? "https://www.planit.org.uk/api/applics/json";
    const since = new Date(Date.now() - (cfg.lookback_days ?? 120) * 86_400_000).toISOString().slice(0, 10);
    const { data: employers } = await db().from("employers").select("id, legal_name, display_name").is("deleted_at", null).eq("practice_type", "architecture_practice").not("outreach_stage", "in", "(closed_no_opportunity,suppressed)").order("latest_score", { ascending: false, nullsFirst: false }).limit(60);
    for (const e of employers ?? []) {
      if (!(await ctx.countRequest())) return;
      const name = e.display_name ?? e.legal_name;
      const url = new URL(base);
      url.searchParams.set("developer", name);
      url.searchParams.set("start_date", since);
      url.searchParams.set("pg_sz", String(cfg.pg_sz ?? 50));
      url.searchParams.set("sort", "-start_date");
      const { data, status } = await fetchJson<PlanItResponse>(url.toString(), { minIntervalMs: Math.max(ctx.minIntervalMs, 3000) });
      if (status === 429) throw new Error("PlanIt rate limit (429)");
      if (status === 403) throw new Error("PlanIt 403 — check User-Agent");
      const target = normaliseCompanyName(name);
      let matched = 0;
      for (const r of data?.records ?? []) {
        const agent = r.agent_name ? normaliseCompanyName(r.agent_name) : "";
        if (!agent || (!agent.includes(target) && !target.includes(agent))) continue;
        matched++;
        await db().from("planning_applications").upsert({ planit_uid: r.uid, authority: r.area_name ?? null, reference: r.name ?? null, description: r.description ?? null, address: r.address ?? null, postcode: r.postcode ?? null, lat: r.lat ?? null, lng: r.lng ?? null, app_state: r.app_state ?? null, app_type: r.app_type ?? null, start_date: r.start_date ?? null, decided_date: r.decided_date ?? null, agent_name: r.agent_name ?? null, normalised_agent: agent, applicant_name: r.applicant_name ?? null, employer_id: e.id, url: r.link ?? r.url ?? null, raw: r as never }, { onConflict: "planit_uid" });
      }
      if (matched > 0) {
        const s: RawSignal = { kind: "signal", employerId: e.id, signalType: "planning_agent_activity", strength: matched >= 5 ? "strong" : matched >= 2 ? "moderate" : "weak", summary: `${matched} planning application(s) since ${since} naming ${name} as agent`, url: null, observedOn: new Date().toISOString().slice(0, 10), raw: { matched } };
        yield s;
      }
    }
  },
};
