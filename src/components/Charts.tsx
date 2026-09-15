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
        <path d={path} fill="none" stroke="#F26522" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
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

export interface StoreBarDatum {
  id: string;
  label: string;
  pct: number | null; // rata-rata skor (%), null jika belum ada audit
  audits: number;
  critical: number;
}

/**
 * Batang horizontal per store (mobile-friendly): panjang = rata-rata skor %, garis target, label nilai di ujung batang.
 * Warna batang mengikuti grade skor (hijau/biru/kuning/merah) agar konsisten dengan seluruh app.
 */
export function StoreBars({ data, target = 90, onSelect }: { data: StoreBarDatum[]; target?: number; onSelect?: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  if (data.length === 0) return <p className="p-4 text-center text-sm text-muted">Belum ada store.</p>;
  return (
    <div>
      <div className="relative">
        <div className="pointer-events-none absolute bottom-0 top-0 border-l-2 border-dashed border-ink/50" style={{ left: `calc(9.5rem + (100% - 9.5rem - 3.25rem) * ${target / 100})` }} aria-hidden />
        <div className="space-y-1.5">
          {data.map((d) => {
            const color = d.pct === null ? '#c9c8c2' : scoreColor((d.pct / 100) * 5);
            const active = hover === d.id;
            return (
              <div
                key={d.id}
                className="flex items-center gap-2"
                onMouseEnter={() => setHover(d.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect?.(d.id)}
                role={onSelect ? 'button' : undefined}
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
                title={d.pct === null ? `${d.label}: belum ada audit submitted` : `${d.label}: ${d.pct.toLocaleString('id-ID')}% · ${d.audits} audit · ${d.critical} kritikal`}
              >
                <div className="w-[9.5rem] shrink-0 truncate text-xs font-semibold text-ink" title={d.label}>
                  {d.label}
                </div>
                <div className="relative h-5 flex-1 overflow-visible rounded bg-surface-2">
                  <div className="h-full rounded transition-all" style={{ width: `${Math.max(d.pct === null ? 0 : Math.min(100, d.pct), 0)}%`, backgroundColor: color, opacity: active ? 1 : 0.9 }} />
                </div>
                <div className="w-[3.25rem] shrink-0 text-right text-xs font-bold tabular-nums" style={{ color: d.pct === null ? '#9a9994' : color }}>
                  {d.pct === null ? '–' : `${d.pct.toLocaleString('id-ID', { maximumFractionDigits: 0 })}%`}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span>Garis putus-putus = target {target}%</span>
        <span>Warna: hijau ≥90 · biru ≥80 · kuning ≥60 · merah &lt;60 · abu-abu belum ada audit</span>
      </div>
      {hover && (() => {
        const d = data.find((x) => x.id === hover);
        if (!d) return null;
        return (
          <div className="mt-2 rounded-lg border border-line bg-white px-3 py-1.5 text-xs shadow-sm">
            <b>{d.label}</b>: {d.pct === null ? 'belum ada audit submitted di periode ini' : `${d.pct.toLocaleString('id-ID')}% · ${d.audits} audit · ${d.critical} temuan kritikal`}
          </div>
        );
      })()}
    </div>
  );
}

export interface DateBarDatum {
  date: string; // YYYY-MM-DD
  pct: number | null;
  audits: number;
  critical: number;
}

/** Batang vertikal per tanggal: rata-rata skor audit submitted hari itu. Tanggal tanpa audit tampil kosong. */
export function DateBars({ data, target = 90 }: { data: DateBarDatum[]; target?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return <p className="p-4 text-center text-sm text-muted">Belum ada data.</p>;
  const W = 640;
  const H = 220;
  const padL = 36;
  const padR = 8;
  const padT = 16;
  const padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = data.length;
  const slot = innerW / n;
  const barW = Math.max(3, Math.min(28, slot * 0.7));
  const x = (i: number) => padL + slot * i + (slot - barW) / 2;
  const y = (v: number) => padT + innerH - (Math.max(0, Math.min(100, v)) / 100) * innerH;
  const ticks = [0, 25, 50, 75, 100];
  const labelEvery = n <= 10 ? 1 : n <= 20 ? 2 : n <= 40 ? 5 : Math.ceil(n / 8);
  const showValues = n <= 14;
  const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const withData = data.filter((d) => d.pct !== null).length;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Skor kebersihan per tanggal">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#dededa" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="#5f5e5a">
              {t}%
            </text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke="#0b0b0b" strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
        {data.map((d, i) => {
          const has = d.pct !== null;
          const top = has ? y(d.pct as number) : y(0);
          const color = has ? scoreColor(((d.pct as number) / 100) * 5) : '#dededa';
          const active = hover === i;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onTouchStart={() => setHover(i)}>
              <rect x={padL + slot * i} y={padT} width={slot} height={innerH} fill="transparent" />
              {has ? (
                <rect x={x(i)} y={top} width={barW} height={Math.max(2, y(0) - top)} rx={3} fill={color} opacity={hover === null || active ? 1 : 0.6} />
              ) : (
                <rect x={x(i)} y={y(0) - 2} width={barW} height={2} fill="#dededa" />
              )}
              {has && showValues && (
                <text x={x(i) + barW / 2} y={top - 4} textAnchor="middle" fontSize={10} fontWeight={700} fill="#0b0b0b">
                  {Math.round(d.pct as number)}
                </text>
              )}
              {(i % labelEvery === 0 || i === n - 1) && (
                <text x={x(i) + barW / 2} y={H - padB + 14} textAnchor="middle" fontSize={10} fill="#5f5e5a">
                  {fmt(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap justify-between gap-2 text-[11px] text-muted">
        <span>Garis putus-putus = target {target}%</span>
        <span>{withData} dari {n} hari ada audit submitted</span>
      </div>
      {hover !== null && (
        <div className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 rounded-lg border border-line bg-white px-3 py-1.5 text-xs shadow">
          <b>{fmt(data[hover].date)}</b>:{' '}
          {data[hover].pct === null ? 'tidak ada audit submitted' : `${(data[hover].pct as number).toLocaleString('id-ID')}% · ${data[hover].audits} audit · ${data[hover].critical} kritikal`}
        </div>
      )}
    </div>
  );
}
