import Link from "next/link";
import { ELIGIBILITY_STATUSES, EMPLOYMENT_TYPES, PRACTICE_TYPES, ROLE_FAMILIES, SENIORITIES } from "@ajis/shared";
import { requireUser } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, fmtMoney, humanise } from "@/lib/utils";
import { BandBadge, EligibilityBadge, StatusBadge } from "@/components/badges";
import { dismissEmployer, dismissVacancy, markEmployerReviewed, restoreEmployer, restoreVacancy, saveEmployer, saveVacancy } from "@/server/actions/discovery";
import { markVacancyReviewed } from "@/server/actions/vacancies";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const LIVE = ["open", "closing_soon", "unverified"] as const;
const ENDED = ["closed", "filled", "withdrawn"] as const;
const ZONES = ["A", "B", "C", "EXT", "OUT"];

type SP = Record<string, string | undefined>;
type EnumOf<T extends readonly string[]> = T[number];

const daysAgo = (n: string | undefined) => (n && Number(n) > 0 ? new Date(Date.now() - Number(n) * 86_400_000).toISOString() : null);
const href = (sp: SP, patch: SP) => {
  const merged: SP = { ...sp, ...patch };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
  return `/discovery?${qs.toString()}`;
};

export default async function DiscoveryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const view = sp.view === "employers" ? "employers" : "vacancies";
  const page = Math.max(1, Number(sp.page) || 1);
  const { supabase } = await requireUser();

  const [{ data: counts }, { data: lastRun }] = await Promise.all([
    supabase.from("v_discovery_counts").select("*").maybeSingle(),
    supabase.from("source_runs").select("finished_at, status").not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold mr-auto">Discovery</h1>
        <Link href="/vacancies/import" className="btn">Paste a vacancy</Link>
        <Link href="/employers/new" className="btn">Add employer</Link>
        <Link href="/sources" className="btn">Sources</Link>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-8">
        <Tile label="New vacancies (7d)" value={counts?.new_vacancies_7d} href={href({}, { view: "vacancies", state: "new", found: "7" })} />
        <Tile label="Vacancies to review" value={counts?.vacancies_to_review} href={href({}, { view: "vacancies", review: "unreviewed" })} />
        <Tile label="Vacancies saved" value={counts?.vacancies_saved} href={href({}, { view: "vacancies", state: "saved" })} />
        <Tile label="Possibly outdated" value={counts?.vacancies_stale} href={href({}, { view: "vacancies", stale: "1" })} />
        <Tile label="New employers (7d)" value={counts?.new_employers_7d} href={href({}, { view: "employers", state: "new", found: "7" })} />
        <Tile label="Employers to review" value={counts?.employers_to_review} href={href({}, { view: "employers", review: "unreviewed" })} />
        <Tile label="Employers saved" value={counts?.employers_saved} href={href({}, { view: "employers", state: "saved" })} />
        <Tile label="Dismissed" value={counts?.dismissed_total} href={href({}, { view: "vacancies", state: "dismissed" })} />
      </div>

      <p className="muted text-xs">
        Sources are checked on the schedules shown under Sources, not continuously. {lastRun?.finished_at ? <>Last discovery run finished {fmtDateTime(lastRun.finished_at)} ({humanise(lastRun.status)}).</> : <>No discovery run has completed yet, so no vacancies have been found automatically.</>}
      </p>

      <div className="flex gap-2 border-b border-border">
        {(["vacancies", "employers"] as const).map((t) => (
          <Link key={t} href={href({}, { view: t })} className={`px-3 py-2 text-sm -mb-px border-b-2 ${view === t ? "border-accent font-semibold" : "border-transparent muted"}`}>
            {t === "vacancies" ? "Vacancies" : "Employers"}
          </Link>
        ))}
      </div>

      {view === "vacancies" ? <VacanciesView sp={sp} page={page} /> : <EmployersView sp={sp} page={page} />}
    </div>
  );
}

function Tile({ label, value, href: to }: { label: string; value: number | null | undefined; href: string }) {
  return (
    <Link href={to} className="card block hover:bg-surface-2">
      <div className="text-2xl font-semibold">{value ?? "—"}</div>
      <div className="muted text-xs">{label}</div>
    </Link>
  );
}

function Pager({ sp, page, total }: { sp: SP; page: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="muted">{total === 0 ? "No results" : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}</span>
      {page > 1 && <Link className="btn btn-sm" href={href(sp, { page: String(page - 1) })}>Previous</Link>}
      {page < pages && <Link className="btn btn-sm" href={href(sp, { page: String(page + 1) })}>Next</Link>}
    </div>
  );
}

const STATE_OPTIONS = (
  <>
    <option value="">New + saved</option>
    <option value="new">New only</option>
    <option value="saved">Saved</option>
    <option value="dismissed">Dismissed</option>
    <option value="all">Everything</option>
  </>
);

async function VacanciesView({ sp, page }: { sp: SP; page: number }) {
  const { supabase } = await requireUser();
  let q = supabase.from("v_discovery_vacancies").select("*", { count: "exact" }).order("first_seen_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (sp.q) q = q.textSearch("search_vector", sp.q, { type: "websearch", config: "english" });
  if (sp.state === "new" || sp.state === "saved" || sp.state === "dismissed") q = q.eq("discovery_state", sp.state);
  else if (sp.state !== "all") q = q.in("discovery_state", ["new", "saved"]);
  if (sp.review === "unreviewed") q = q.is("reviewed_at", null);
  if (sp.review === "reviewed") q = q.not("reviewed_at", "is", null);
  if (sp.status === "ended") q = q.in("status", [...ENDED]);
  else if (sp.status !== "all") q = q.in("status", [...LIVE]);
  if (sp.kind === "core") q = q.eq("is_adjacent", false);
  if (sp.kind === "adjacent") q = q.eq("is_adjacent", true);
  if (sp.family) q = q.eq("role_family", sp.family as EnumOf<typeof ROLE_FAMILIES>);
  if (sp.eligibility) q = q.eq("eligibility_status", sp.eligibility as EnumOf<typeof ELIGIBILITY_STATUSES>);
  if (sp.type) q = q.eq("employment_type", sp.type as EnumOf<typeof EMPLOYMENT_TYPES>);
  if (sp.level) q = q.eq("seniority", sp.level as EnumOf<typeof SENIORITIES>);
  if (sp.zone) q = q.eq("zone_code", sp.zone);
  if (Number(sp.salary) > 0) q = q.gte("salary_year_min", Number(sp.salary));
  if (Number(sp.travel) > 0) q = q.lte("pt_minutes", Number(sp.travel));
  const found = daysAgo(sp.found);
  if (found) q = q.gte("first_seen_at", found);
  if (sp.stale === "1") q = q.eq("is_stale", true);
  const { data: rows, count, error } = await q;
  if (error) throw new Error(error.message);

  return (
    <>
      <form className="card grid gap-2 grid-cols-2 md:grid-cols-6" method="get">
        <input type="hidden" name="view" value="vacancies" />
        <input name="q" placeholder="Search title, employer, description" defaultValue={sp.q ?? ""} className="col-span-2" />
        <select name="state" defaultValue={sp.state ?? ""}>{STATE_OPTIONS}</select>
        <select name="review" defaultValue={sp.review ?? ""}><option value="">Reviewed or not</option><option value="unreviewed">Unreviewed</option><option value="reviewed">Reviewed</option></select>
        <select name="status" defaultValue={sp.status ?? ""}><option value="">Open / unverified</option><option value="ended">Closed / filled / withdrawn</option><option value="all">Any status</option></select>
        <select name="kind" defaultValue={sp.kind ?? ""}><option value="">Core + adjacent</option><option value="core">Core architecture</option><option value="adjacent">Adjacent routes</option></select>
        <select name="family" defaultValue={sp.family ?? ""}><option value="">Any role</option>{ROLE_FAMILIES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select>
        <select name="eligibility" defaultValue={sp.eligibility ?? ""}><option value="">Any eligibility</option>{ELIGIBILITY_STATUSES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select>
        <select name="level" defaultValue={sp.level ?? ""}><option value="">Any level</option>{SENIORITIES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select>
        <select name="type" defaultValue={sp.type ?? ""}><option value="">Any contract</option>{EMPLOYMENT_TYPES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</select>
        <select name="zone" defaultValue={sp.zone ?? ""}><option value="">Any zone</option>{ZONES.map((z) => <option key={z} value={z}>Zone {z}</option>)}</select>
        <input name="salary" type="number" min={0} step={1000} placeholder="Min salary £/yr (known only)" defaultValue={sp.salary ?? ""} />
        <input name="travel" type="number" min={0} step={5} placeholder="Max travel mins (known only)" defaultValue={sp.travel ?? ""} />
        <select name="found" defaultValue={sp.found ?? ""}><option value="">Found any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="stale" value="1" defaultChecked={sp.stale === "1"} /> Possibly outdated</label>
        <div className="flex gap-2"><button className="btn btn-primary" type="submit">Filter</button><Link className="btn" href="/discovery?view=vacancies">Reset</Link></div>
      </form>
      <p className="muted text-xs">Salary and travel filters only match records where those values are known; unknown values are never guessed.</p>
      <Pager sp={sp} page={page} total={count ?? 0} />
      <div className="card p-0 overflow-x-auto">
        <table>
          <thead><tr><th>Title</th><th>Employer</th><th>Kind</th><th>Status</th><th>Eligibility</th><th>Location</th><th>Salary</th><th>Closing</th><th>Found / verified</th><th>Source</th><th></th></tr></thead>
          <tbody>
            {(rows ?? []).map((v) => {
              const link = v.canonical_url ?? v.original_url ?? null;
              return (
                <tr key={v.id} className={v.discovery_state === "dismissed" ? "opacity-60" : v.reviewed_at ? "" : "font-medium"}>
                  <td>
                    <Link className="underline" href={`/vacancies/${v.id}`}>{v.title}</Link>
                    {v.discovery_state === "saved" && <span className="badge badge-ok ml-1">saved</span>}
                    {v.discovery_state === "dismissed" && <span className="badge ml-1">dismissed</span>}
                    {!v.reviewed_at && v.discovery_state !== "dismissed" && <span className="badge badge-accent ml-1">new</span>}
                  </td>
                  <td>{v.employer_id ? <Link className="underline" href={`/employers/${v.employer_id}`}>{v.employer_name}</Link> : <span className="muted">{v.employer_name_raw ?? "unmatched"}{v.employer_match_status === "agency_anonymised" && " (agency)"}</span>}</td>
                  <td>{v.is_adjacent ? <span className="badge badge-warn">adjacent</span> : <span className="muted">{humanise(v.role_family)}</span>}</td>
                  <td><StatusBadge value={v.status} />{v.disappeared_at && <div className="muted text-xs">gone {fmtDate(v.disappeared_at)}</div>}</td>
                  <td><EligibilityBadge status={v.eligibility_status ?? "needs_review"} flags={v.hard_flags} /></td>
                  <td className="muted">{v.location_text ?? "unknown"} {v.zone_code && <span className="badge">{v.zone_code}</span>}</td>
                  <td>{v.salary_min != null || v.salary_max != null ? fmtMoney(v.salary_min == null ? null : Number(v.salary_min), v.salary_max == null ? null : Number(v.salary_max), v.salary_period) : (v.salary_text ?? <span className="muted">unknown</span>)}</td>
                  <td className="muted whitespace-nowrap">{v.closing_at ? fmtDate(v.closing_at) : "unknown"}</td>
                  <td className="muted whitespace-nowrap">
                    {fmtDate(v.first_seen_at)}
                    <div className="text-xs">{v.last_verified_at ? `verified ${fmtDate(v.last_verified_at)}` : "not verified"}{v.is_stale && <span className="badge badge-warn ml-1">outdated</span>}</div>
                  </td>
                  <td className="whitespace-nowrap">
                    {link ? <a className="underline" href={link} target="_blank" rel="noopener noreferrer">Open original</a> : <span className="muted">no link</span>}
                    <div className="muted text-xs">{v.discovery_source ?? "manual"}{(v.source_count ?? 1) > 1 && ` · ${v.source_count} listings`}</div>
                  </td>
                  <td className="whitespace-nowrap">
                    <div className="flex gap-1">
                      {v.discovery_state === "dismissed" ? (
                        <form action={restoreVacancy.bind(null, v.id!)}><button className="btn btn-sm">Restore</button></form>
                      ) : (
                        <>
                          {v.discovery_state !== "saved" && <form action={saveVacancy.bind(null, v.id!)}><button className="btn btn-sm btn-primary">Save</button></form>}
                          {!v.reviewed_at && <form action={markVacancyReviewed.bind(null, v.id!)}><button className="btn btn-sm">Reviewed</button></form>}
                          <form action={dismissVacancy.bind(null, v.id!)}><button className="btn btn-sm">Dismiss</button></form>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {(rows ?? []).length === 0 && <tr><td colSpan={11} className="muted text-center py-8">No vacancies match. None have been found yet unless a source has run or you have pasted one in.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function EmployersView({ sp, page }: { sp: SP; page: number }) {
  const { supabase } = await requireUser();
  let q = supabase.from("v_discovery_employers").select("*", { count: "exact" }).order("latest_score", { ascending: false, nullsFirst: false }).order("name").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (sp.q) q = q.textSearch("search_vector", sp.q, { type: "websearch", config: "english" });
  if (sp.state === "new" || sp.state === "saved" || sp.state === "dismissed") q = q.eq("discovery_state", sp.state);
  else if (sp.state !== "all") q = q.in("discovery_state", ["new", "saved"]);
  if (sp.review === "unreviewed") q = q.is("reviewed_at", null);
  if (sp.review === "reviewed") q = q.not("reviewed_at", "is", null);
  if (sp.type) q = q.eq("practice_type", sp.type as EnumOf<typeof PRACTICE_TYPES>);
  if (sp.specialism) q = q.contains("specialisms", [sp.specialism]);
  if (sp.zone) q = q.eq("zone_code", sp.zone);
  if (sp.advert === "advertising") q = q.gt("open_vacancy_count", 0);
  if (sp.advert === "speculative") q = q.eq("open_vacancy_count", 0);
  if (Number(sp.travel) > 0) q = q.lte("pt_minutes", Number(sp.travel));
  const found = daysAgo(sp.found);
  if (found) q = q.gte("first_discovered_at", found);
  if (sp.checked === "never") q = q.is("last_checked_at", null);
  if (sp.checked === "stale") q = q.lt("last_checked_at", daysAgo("30")!);
  const [{ data: rows, count, error }, { data: specRows }] = await Promise.all([
    q,
    supabase.from("v_discovery_employers").select("specialisms").limit(2000),
  ]);
  if (error) throw new Error(error.message);
  const specialisms = [...new Set((specRows ?? []).flatMap((r) => r.specialisms ?? []))].sort((a, b) => a.localeCompare(b));

  return (
    <>
      <form className="card grid gap-2 grid-cols-2 md:grid-cols-6" method="get">
        <input type="hidden" name="view" value="employers" />
        <input name="q" placeholder="Search name, sector, notes" defaultValue={sp.q ?? ""} className="col-span-2" />
        <select name="state" defaultValue={sp.state ?? ""}>{STATE_OPTIONS}</select>
        <select name="review" defaultValue={sp.review ?? ""}><option value="">Reviewed or not</option><option value="unreviewed">Unreviewed</option><option value="reviewed">Reviewed</option></select>
        <select name="advert" defaultValue={sp.advert ?? ""}><option value="">Advertising or not</option><option value="advertising">Has an open vacancy</option><option value="speculative">No vacancy (speculative target)</option></select>
        <select name="type" defaultValue={sp.type ?? ""}><option value="">Any category</option>{PRACTICE_TYPES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}</select>
        <select name="specialism" defaultValue={sp.specialism ?? ""}><option value="">Any specialism</option>{specialisms.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <select name="zone" defaultValue={sp.zone ?? ""}><option value="">Any zone</option>{ZONES.map((z) => <option key={z} value={z}>Zone {z}</option>)}</select>
        <input name="travel" type="number" min={0} step={5} placeholder="Max travel mins (known only)" defaultValue={sp.travel ?? ""} />
        <select name="found" defaultValue={sp.found ?? ""}><option value="">Added any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
        <select name="checked" defaultValue={sp.checked ?? ""}><option value="">Checked any time</option><option value="never">Never checked</option><option value="stale">Not checked in 30 days</option></select>
        <div className="flex gap-2"><button className="btn btn-primary" type="submit">Filter</button><Link className="btn" href="/discovery?view=employers">Reset</Link></div>
      </form>
      <p className="muted text-xs">Travel times appear once your home postcode is set (Settings) and the worker has geocoded offices; until then that filter matches nothing.</p>
      <Pager sp={sp} page={page} total={count ?? 0} />
      <div className="card p-0 overflow-x-auto">
        <table>
          <thead><tr><th>Employer</th><th>Category</th><th>Town / zone</th><th>Vacancies</th><th>Band</th><th>Careers page</th><th>Added / checked</th><th></th></tr></thead>
          <tbody>
            {(rows ?? []).map((e) => (
              <tr key={e.id} className={e.discovery_state === "dismissed" ? "opacity-60" : ""}>
                <td>
                  <Link className="font-medium underline" href={`/employers/${e.id}`}>{e.name}</Link>
                  {e.discovery_state === "saved" && <span className="badge badge-ok ml-1">saved</span>}
                  {e.discovery_state === "dismissed" && <span className="badge ml-1">dismissed</span>}
                  {!e.reviewed_at && e.discovery_state !== "dismissed" && <span className="badge badge-accent ml-1">new</span>}
                  {e.website && <div className="text-xs"><a className="muted underline" href={e.website} target="_blank" rel="noopener noreferrer">{e.website_domain ?? e.website}</a></div>}
                </td>
                <td className="muted">{humanise(e.practice_type)}{(e.specialisms ?? []).length > 0 && <div className="text-xs">{(e.specialisms ?? []).slice(0, 3).join(", ")}</div>}</td>
                <td>{e.town ?? <span className="muted">unknown</span>} {e.zone_code && <span className="badge">{e.zone_code}</span>}</td>
                <td>{Number(e.open_vacancy_count) > 0 ? <span className="badge badge-ok">{e.open_vacancy_count} open</span> : <span className="badge">speculative</span>}</td>
                <td><BandBadge band={e.latest_band} /></td>
                <td>{e.careers_url ? <a className="underline" href={e.careers_url} target="_blank" rel="noopener noreferrer">Open</a> : <span className="muted">not recorded</span>}</td>
                <td className="muted whitespace-nowrap">{fmtDate(e.first_discovered_at)}<div className="text-xs">{e.last_checked_at ? `checked ${fmtDate(e.last_checked_at)}` : "never checked"}</div></td>
                <td className="whitespace-nowrap">
                  <div className="flex gap-1">
                    {e.discovery_state === "dismissed" ? (
                      <form action={restoreEmployer.bind(null, e.id!)}><button className="btn btn-sm">Restore</button></form>
                    ) : (
                      <>
                        {e.discovery_state !== "saved" && <form action={saveEmployer.bind(null, e.id!)}><button className="btn btn-sm btn-primary">Save</button></form>}
                        {!e.reviewed_at && <form action={markEmployerReviewed.bind(null, e.id!)}><button className="btn btn-sm">Reviewed</button></form>}
                        <form action={dismissEmployer.bind(null, e.id!)}><button className="btn btn-sm">Dismiss</button></form>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {(rows ?? []).length === 0 && <tr><td colSpan={8} className="muted text-center py-8">No employers match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
