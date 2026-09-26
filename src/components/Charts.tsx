'use client';

import { useEffect, useRef, useState } from 'react';
import { cn, scoreColor } from '@/lib/utils';

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

/** Batang vertikal per tanggal: rata-rata skor audit submitted hari itu. Tanggal tanpa audit tampil sebagai titik tipis. */
export function DateBars({ data, target = 90, minHeight = 260 }: { data: DateBarDatum[]; target?: number; minHeight?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 720, h: minHeight });
  // ukuran mengikuti kontainer (mengisi kartu), teks tetap tajam karena viewBox = piksel
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0) setSize({ w: Math.round(r.width), h: Math.max(minHeight, Math.round(r.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [minHeight]);
  if (data.length === 0) return <p className="p-4 text-center text-sm text-muted">Belum ada data.</p>;
  const W = size.w;
  const H = size.h;
  const padL = 40;
  const padR = 12;
  const padT = 22;
  const padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = data.length;
  const slot = innerW / n;
  const barW = Math.max(4, Math.min(18, slot * 0.55));
  const x = (i: number) => padL + slot * i + (slot - barW) / 2;
  const y = (v: number) => padT + innerH - (Math.max(0, Math.min(100, v)) / 100) * innerH;
  const ticks = [0, 25, 50, 75, 100];
  const labelEvery = n <= 10 ? 1 : n <= 20 ? 2 : n <= 40 ? 5 : Math.ceil(n / 8);
  const showValues = n <= 14;
  const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const withData = data.filter((d) => d.pct !== null).length;
  const avg = withData ? data.reduce((s, d) => s + (d.pct ?? 0), 0) / withData : null;
  const hv = hover !== null ? data[hover] : null;
  return (
    <div className="relative flex h-full flex-col">
      <div ref={boxRef} className="relative min-h-0 flex-1" style={{ minHeight }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="absolute inset-0" role="img" aria-label="Skor kebersihan per tanggal">
        <defs>
          {['#008300', '#2a78d6', '#eda100', '#e34948'].map((c) => (
            <linearGradient key={c} id={`db-${c.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity={1} />
              <stop offset="100%" stopColor={c} stopOpacity={0.55} />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#ecebe7" strokeWidth={1} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize={10} fill="#8a8985">
              {t}%
            </text>
          </g>
        ))}
        {hover !== null && <rect x={padL + slot * hover} y={padT - 6} width={slot} height={innerH + 6} rx={6} fill="#F26522" opacity={0.06} />}
        <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke="#0b0b0b" strokeWidth={1} strokeDasharray="5 4" opacity={0.35} />
        {avg !== null && <line x1={padL} x2={W - padR} y1={y(avg)} y2={y(avg)} stroke="#F26522" strokeWidth={1} strokeDasharray="2 4" opacity={0.6} />}
        {data.map((d, i) => {
          const has = d.pct !== null;
          const top = has ? y(d.pct as number) : y(0);
          const color = has ? scoreColor(((d.pct as number) / 100) * 5) : '#dededa';
          const active = hover === i;
          const r = Math.min(barW / 2, 6);
          const bx = x(i);
          const path = `M${bx},${y(0)} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + barW - r} Q${bx + barW},${top} ${bx + barW},${top + r} V${y(0)} Z`;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onTouchStart={() => setHover(i)}>
              <rect x={padL + slot * i} y={padT - 6} width={slot} height={innerH + 12} fill="transparent" />
              {has ? (
                <path d={path} fill={`url(#db-${color.slice(1)})`} opacity={hover === null || active ? 1 : 0.55} style={{ transition: 'opacity 120ms' }} />
              ) : (
                <circle cx={bx + barW / 2} cy={y(0) - 3} r={2} fill="#d3d2cd" />
              )}
              {has && showValues && (
                <text x={bx + barW / 2} y={top - 6} textAnchor="middle" fontSize={10} fontWeight={700} fill="#0b0b0b">
                  {Math.round(d.pct as number)}
                </text>
              )}
              {(i % labelEvery === 0 || i === n - 1) && (
                <text x={bx + barW / 2} y={H - padB + 16} textAnchor="middle" fontSize={10} fill="#8a8985">
                  {fmt(d.date)}
                </text>
              )}
              <line x1={bx + barW / 2} x2={bx + barW / 2} y1={y(0)} y2={y(0) + 4} stroke="#d3d2cd" strokeWidth={1} />
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="#cfcec9" strokeWidth={1} />
      </svg>
      {hv && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-line bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: x(hover) + barW / 2, top: (hv.pct === null ? y(0) : y(hv.pct)) - 8 }}
        >
          <div className="font-bold text-ink">{fmt(hv.date)}</div>
          {hv.pct === null ? (
            <div className="text-muted">tidak ada audit selesai</div>
          ) : (
            <div className="whitespace-nowrap">
              <span className="font-bold" style={{ color: scoreColor((hv.pct / 100) * 5) }}>{hv.pct.toLocaleString('id-ID')}%</span> · {hv.audits} audit · {hv.critical} kritikal
            </div>
          )}
        </div>
      )}
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0 w-4 border-t border-dashed border-ink/60" /> target {target}%</span>
          {avg !== null && <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0 w-4 border-t border-dotted border-brand" /> rata-rata {avg.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%</span>}
        </span>
        <span>{withData} dari {n} hari ada audit selesai</span>
      </div>
    </div>
  );
}

export interface RankBarDatum {
  id: string;
  label: string;
  value: number; // 0-100
  grade: string | null;
  sub?: string;
  /** Audit masih draft: batang pudar & bergaris putus (skor sementara). */
  draft?: boolean;
}

/**
 * Peringkat horizontal (gaya "ranking outlet"): nomor peringkat (medali 3 besar), nama, track dengan isi bergradasi
 * oranye brand (makin gelap makin tinggi), chip grade, garis target, sumbu 0-100%. Draft: pola garis + border putus.
 */
export function RankBars({ data, target = 90, unit = '%' }: { data: RankBarDatum[]; target?: number; unit?: string }) {
  if (data.length === 0) return <p className="p-6 text-center text-sm text-muted">Belum ada store yang scoring di tanggal ini.</p>;
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const shade = (i: number) => {
    const t = sorted.length <= 1 ? 0 : i / (sorted.length - 1);
    const from = [201, 78, 20];
    const to = [249, 165, 122];
    return '#' + from.map((f, k) => Math.round(f + (to[k] - f) * t).toString(16).padStart(2, '0')).join('');
  };
  const medal = ['#E8B923', '#B4B7BF', '#C8853F'];
  const gradeColor = (g: string | null) => (g === 'A' ? '#008300' : g === 'B' ? '#2a78d6' : g === 'C' ? '#eda100' : g === 'D' ? '#e34948' : '#9a9994');
  const ticks = [0, 25, 50, 75, 100];
  return (
    <div>
      <div className="space-y-2">
        {sorted.map((d, i) => {
          const color = shade(i);
          const w = Math.max(0, Math.min(100, d.value));
          return (
            <div key={d.id} className="group flex items-center gap-3">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black"
                style={i < 3 ? { backgroundColor: medal[i], color: '#fff' } : { backgroundColor: '#eeece7', color: '#5f5e5a' }}
              >
                {i + 1}
              </span>
              <div className="w-[6.5rem] shrink-0 truncate text-right text-xs font-semibold text-ink sm:w-[9.5rem] sm:text-sm" title={d.label}>
                {d.label}
              </div>
              <div className="relative h-8 flex-1 rounded-full bg-surface-2" title={`${d.label}: ${d.value.toLocaleString('id-ID')}${unit}${d.grade ? ` · ${d.grade}` : ''}${d.sub ? ` · ${d.sub}` : ''}`}>
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
                  style={
                    d.draft
                      ? { width: `${w}%`, backgroundImage: `repeating-linear-gradient(135deg, ${color}55 0 6px, ${color}22 6px 12px)`, border: `1.5px dashed ${color}` }
                      : { width: `${w}%`, background: `linear-gradient(90deg, ${color}cc, ${color})`, boxShadow: `inset 0 -2px 0 rgba(0,0,0,0.08)` }
                  }
                />
                <div className="pointer-events-none absolute inset-y-[-3px] border-l-2 border-dashed border-ink/40" style={{ left: `${target}%` }} />
              </div>
              <div className="flex w-[5.5rem] shrink-0 items-center gap-1.5 sm:w-[6rem] xl:w-[10rem]">
                <span className={cn('text-sm font-black tabular-nums', d.draft ? 'text-muted' : 'text-ink')}>
                  {d.value.toLocaleString('id-ID', { maximumFractionDigits: 1 })}
                  {unit}
                </span>
                {d.grade && (
                  <span className="rounded-full px-1.5 py-0.5 text-[10px] font-black text-white" style={{ backgroundColor: gradeColor(d.grade) }}>
                    {d.grade}
                  </span>
                )}
                {d.sub && <span className="hidden truncate text-[11px] text-muted xl:inline">{d.sub}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <span className="w-7 shrink-0" />
        <span className="w-[6.5rem] shrink-0 sm:w-[9.5rem]" />
        <div className="relative h-4 flex-1">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2 text-[10px] text-muted" style={{ left: `${t}%` }}>
              {t}
              {unit}
            </span>
          ))}
        </div>
        <span className="w-[5.5rem] shrink-0 sm:w-[6rem] xl:w-[10rem]" />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0 w-4 border-t-2 border-dashed border-ink/40" /> target {target}%</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-full border border-dashed border-brand bg-[repeating-linear-gradient(135deg,#F2652255_0_4px,#F2652222_4px_8px)]" /> draft (skor sementara)</span>
      </div>
    </div>
  );
}
