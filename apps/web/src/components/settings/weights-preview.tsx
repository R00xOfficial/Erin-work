"use client";
import { useState } from "react";
import { bandFor } from "@ajis/shared";

export function WeightsPreview({ initial, labels, factors }: { initial: Record<string, number>; labels: Record<string, string>; factors: string[] }) {
  const [w, setW] = useState<Record<string, number>>(initial);
  const [sample, setSample] = useState<Record<string, number>>(Object.fromEntries(factors.map((f) => [f, 60])));
  const total = factors.reduce((a, f) => a + (w[f] ?? 0), 0);
  const score = Math.round(factors.reduce((a, f) => a + ((sample[f] ?? 0) * (w[f] ?? 0)) / 100, 0) * 10) / 10;
  const band = bandFor(score, 80, 0);
  return (
    <div className="space-y-3">
      <table className="text-sm">
        <thead><tr><th>Factor</th><th>Weight %</th><th>Sample factor score (preview only)</th></tr></thead>
        <tbody>
          {factors.map((f) => (
            <tr key={f}>
              <td>{labels[f]}</td>
              <td className="w-28"><input name={f} type="number" min={0} max={100} value={w[f] ?? 0} onChange={(e) => setW({ ...w, [f]: Number(e.target.value) })} /></td>
              <td><input type="range" min={0} max={100} value={sample[f] ?? 0} onChange={(e) => setSample({ ...sample, [f]: Number(e.target.value) })} className="w-full" /> <span className="muted text-xs">{sample[f]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-4 items-center text-sm">
        <span className={total === 100 ? "text-ok" : "text-danger"}>Weights total: {total}{total !== 100 && " (must be 100)"}</span>
        <span>Preview score: <strong>{score}</strong>/100 → <span className="badge">{band}</span></span>
      </div>
    </div>
  );
}
