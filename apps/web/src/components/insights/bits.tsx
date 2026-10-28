import { SAMPLE_LABELS, describeRate, pct, type GroupStat, type Rate, type SeriesPoint } from "@ajis/shared";

const LEVEL_CLASS = { none: "", insufficient: "badge-warn", preliminary: "badge-warn", moderate: "badge-accent", reasonable: "badge-ok" } as const;

export function SampleBadge({ level }: { level: Rate["level"] }) {
  return <span className={`badge ${LEVEL_CLASS[level]}`}>{SAMPLE_LABELS[level]}</span>;
}

/** A percentage is never shown alone: the counts, a plausible range for small samples, what was left out and what is still pending come with it. */
export function RateCard({ title, rate, definition }: { title: string; rate: Rate; definition: string }) {
  return (
    <div className="card space-y-1">
      <div className="flex items-center gap-2"><div className="text-xs muted mr-auto">{title}</div><SampleBadge level={rate.level} /></div>
      <div className="text-2xl font-semibold">{rate.rate == null ? "No data" : pct(rate.rate)}</div>
      <div className="text-sm">{describeRate(rate)}</div>
      {rate.level === "insufficient" && <div className="text-xs text-warn">Too few records to say anything reliable.</div>}
      {rate.pending > 0 && <div className="text-xs muted">{rate.pending} still in progress or awaiting a decision (not counted as failures).</div>}
      {rate.excluded.map((e) => <div key={e.reason} className="text-xs muted">{e.count} left out: {e.reason}.</div>)}
      <details className="text-xs"><summary className="cursor-pointer muted">Definition</summary><p className="mt-1">{definition}</p></details>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return <div className="card"><div className="text-2xl font-semibold">{value}</div><div className="muted text-xs">{label}</div>{sub && <div className="muted text-xs">{sub}</div>}</div>;
}

export function Delta({ now, before, partial }: { now: number; before: number; partial: boolean }) {
  const d = now - before;
  return <span className="muted text-xs">{before === 0 && now === 0 ? "none in either period" : `${d === 0 ? "same as" : d > 0 ? `+${d} on` : `${d} on`} the earlier ${partial ? "equal-length " : ""}period (${before})`}</span>;
}

export function Bars({ series, keys }: { series: SeriesPoint[]; keys: { key: "discovered" | "selected" | "submitted" | "responses"; label: string; color: string }[] }) {
  const max = Math.max(1, ...series.flatMap((p) => keys.map((k) => p[k.key])));
  const w = 720, h = 140, bw = w / Math.max(1, series.length);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h + 18}`} className="w-full" role="img" aria-label="Activity over time">
        {series.map((p, i) => keys.map((k, j) => {
          const bh = (p[k.key] / max) * h, gw = bw * 0.8 / keys.length;
          return <rect key={`${i}-${k.key}`} x={i * bw + bw * 0.1 + j * gw} y={h - bh} width={Math.max(1, gw - 1)} height={bh} fill={k.color} opacity={p.partial ? 0.45 : 1}><title>{`${p.start}: ${k.label} ${p[k.key]}${p.partial ? " (period not finished)" : ""}`}</title></rect>;
        }))}
        {series.filter((_, i) => i % Math.ceil(series.length / 8) === 0).map((p) => <text key={p.start} x={series.indexOf(p) * bw} y={h + 13} fontSize="9" fill="currentColor" opacity="0.6">{p.label}</text>)}
      </svg>
      <div className="flex flex-wrap gap-3 text-xs muted">{keys.map((k) => <span key={k.key}><span style={{ background: k.color }} className="inline-block w-2 h-2 mr-1 rounded-sm" />{k.label}</span>)}{series.some((p) => p.partial) && <span>Paler bars: not a finished period.</span>}</div>
    </div>
  );
}

export function GroupTable({ title, rows }: { title: string; rows: GroupStat[] }) {
  if (rows.length === 0) return <div className="card"><h3 className="font-semibold text-sm">{title}</h3><p className="muted text-sm mt-1">No judged applications to break down yet.</p></div>;
  return (
    <div className="card p-0 overflow-x-auto">
      <h3 className="font-semibold text-sm p-3 pb-0">{title}</h3>
      <table><thead><tr><th>Group</th><th>Applications</th><th>Replies</th><th>Interviews</th><th>Offers</th><th>Reading</th></tr></thead>
        <tbody>{rows.map((g) => (
          <tr key={g.key}><td className="font-medium">{g.key}</td><td>{g.n}</td><td>{g.responses}</td><td>{g.interviews}</td><td>{g.offers}</td>
            <td><SampleBadge level={g.interviewRate.level} />{g.n < 5 && <span className="muted text-xs ml-1">not enough to compare</span>}</td></tr>))}</tbody></table>
    </div>
  );
}
