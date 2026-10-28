import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { humanise } from "@/lib/utils";
import { mergeEmployers } from "@/server/actions/employers";

export const dynamic = "force-dynamic";

const HREF: Record<string, (id: string) => string> = {
  employer: (id) => `/employers/${id}`,
  office: (id) => `/employers/${id}?tab=offices`,
  vacancy: (id) => `/vacancies/${id}`,
  contact: (id) => `/contacts/${id}`,
  source: () => `/sources`,
};

export default async function DataQualityPage() {
  const { supabase } = await requireUser();
  const { data: issues } = await supabase.from("v_data_quality_issues").select("*").limit(1000);
  const groups = new Map<string, NonNullable<typeof issues>>();
  for (const i of issues ?? []) {
    const key = i.issue ?? "unknown";
    const g = groups.get(key) ?? [];
    g.push(i);
    groups.set(key, g);
  }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Data quality <span className="muted text-sm font-normal">({issues?.length ?? 0} issues)</span></h1>
      <p className="muted text-xs">Duplicate employers, stale records, dead or non-careers careers URLs, un-geocoded offices, missing travel times, expired vacancies, bounced contacts, conflicting claims and failing sources. Resolve them here so the scores stay honest.</p>
      {groups.size === 0 && <p className="card muted">No issues detected.</p>}
      {[...groups.entries()].map(([issue, rows]) => (
        <section key={issue} className="card">
          <h2 className="font-semibold mb-2">{humanise(issue)} <span className="badge">{rows.length}</span></h2>
          <ul className="text-sm space-y-1">
            {rows.slice(0, 100).map((r, i) => {
              const target = issue === "office_not_geocoded" || issue === "office_missing_travel_time" ? (r.related_id ?? r.entity_id) : r.entity_id;
              const href = r.entity_type && target ? HREF[r.entity_type]?.(target) : null;
              return (
                <li key={`${r.entity_id}-${i}`} className="flex flex-wrap gap-2 items-center">
                  {href ? <Link className="underline" href={href}>{r.detail}</Link> : <span>{r.detail}</span>}
                  {issue === "possible_duplicate_employer" && r.entity_id && r.related_id && (
                    <span className="flex gap-1 ml-auto">
                      <form action={mergeEmployers.bind(null, r.entity_id, r.related_id)}><button className="btn btn-sm">Keep first, merge second</button></form>
                      <form action={mergeEmployers.bind(null, r.related_id, r.entity_id)}><button className="btn btn-sm">Keep second, merge first</button></form>
                    </span>
                  )}
                </li>
              );
            })}
            {rows.length > 100 && <li className="muted">… and {rows.length - 100} more</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}
