'use client';

import { useState } from 'react';
import { scoreColor } from '@/lib/utils';

/** Bar horizontal per kategori: target vs aktual. */
export function CategoryBars({ data, target = 90 }: { data: { label: string; pct: number | null; scored: number }[]; target?: number }) {
  return (
    <div className="space-y-2.5">
      {data.map((d) => (
        <div key={d.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-semibold text-ink">{d.label}</span>
            <span className="text-muted">
              <b style={{ color: scoreColor(d.pct === null ? null : (d.pct / 100) * 5) }}>{d.pct === null ? '-' : `${d.pct.toLocaleString('id-ID')}%`}</b> · {d.scored} item
            </span>
          </div>
          <div className="relative h-2.5 w-full rounded-full bg-surface-2">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, d.pct ?? 0)}%`, backgroundColor: scoreColor(d.pct === null ? null : (d.pct / 100) * 5) }} />
            <div className="absolute top-[-3px] h-4 w-0.5 bg-ink/60" style={{ left: `${target}%` }} title={`Target ${target}%`} />
          </div>
        </div>
      ))}
      <div className="text-[11px] text-muted">Garis hitam = target {target}%</div>
    </div>
  );
}

/** Tren skor (%) per audit, SVG sederhana dengan hover. */
export function TrendLine({ points, target = 90 }: { points: { label: string; value: number; sub?: string }[]; target?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return <p className="p-4 text-center text-sm text-muted">Belum ada data.</p>;
  const W = 640;
  const H = 200;
  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const x = (i: number) => padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (Math.max(0, Math.min(100, v)) / 100) * innerH;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const ticks = [0, 25, 50, 75, 100];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Tren skor kebersihan">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#dededa" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="#5f5e5a">
              {t}%
            </text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke="#0b0b0b" strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
        <path d={path} fill="none" stroke="#1f3a68" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onTouchStart={() => setHover(i)}>
            <circle cx={x(i)} cy={y(p.value)} r={14} fill="transparent" />
            <circle cx={x(i)} cy={y(p.value)} r={hover === i ? 6 : 4} fill={scoreColor((p.value / 100) * 5)} stroke="#fff" strokeWidth={2} />
            {(points.length <= 8 || i === points.length - 1 || i === 0) && (
              <text x={x(i)} y={H - padB + 14} textAnchor="middle" fontSize={10} fill="#5f5e5a">
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-lg border border-line bg-white px-3 py-1.5 text-xs shadow">
          <b>{points[hover].value.toLocaleString('id-ID')}%</b> · {points[hover].label}
          {points[hover].sub && <span className="text-muted"> · {points[hover].sub}</span>}
        </div>
      )}
    </div>
  );
}
