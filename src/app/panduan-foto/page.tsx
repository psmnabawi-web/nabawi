'use client';

import { useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Card, CardHeader, Input, PageHeader, Select } from '@/components/ui';
import { useIndicators } from '@/lib/hooks';
import { CATEGORY_ORDER } from '@/lib/indicators';
import { photoGuideFor } from '@/lib/photoGuides';
import { MIN_SUBMIT_PCT } from '@/lib/scoring';

function Diagram({ kind }: { kind: 'distance' | 'angle' | 'light' | 'coverage' }) {
  const stroke = '#F26522';
  const grey = '#c9c8c2';
  const ink = '#0b0b0b';
  return (
    <svg viewBox="0 0 240 130" className="h-auto w-full" role="img" aria-hidden>
      <rect x="0" y="0" width="240" height="130" rx="12" fill="#faf7f3" />
      {kind === 'distance' && (
        <>
          <rect x="150" y="30" width="70" height="70" rx="6" fill="#fff" stroke={ink} strokeWidth="1.5" />
          <text x="185" y="70" textAnchor="middle" fontSize="10" fill={ink}>area</text>
          <g transform="translate(40,55)">
            <rect x="0" y="0" width="26" height="18" rx="3" fill={ink} />
            <circle cx="13" cy="9" r="5" fill="#fff" />
          </g>
          <line x1="70" y1="64" x2="146" y2="64" stroke={stroke} strokeWidth="2" strokeDasharray="4 3" />
          <text x="108" y="58" textAnchor="middle" fontSize="11" fontWeight="700" fill={stroke}>1 - 2 m</text>
          <text x="108" y="110" textAnchor="middle" fontSize="10" fill="#5f5e5a">Foto 1: seluruh area masuk frame</text>
        </>
      )}
      {kind === 'angle' && (
        <>
          <rect x="30" y="85" width="180" height="20" rx="3" fill="#fff" stroke={ink} strokeWidth="1.5" />
          <text x="120" y="99" textAnchor="middle" fontSize="10" fill={ink}>lantai / permukaan</text>
          <g transform="translate(60,25) rotate(40)">
            <rect x="0" y="0" width="26" height="18" rx="3" fill={ink} />
            <circle cx="13" cy="9" r="5" fill="#fff" />
          </g>
          <path d="M78 45 L140 85" stroke={stroke} strokeWidth="2" />
          <path d="M60 85 A40 40 0 0 1 78 45" fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray="3 3" />
          <text x="92" y="80" fontSize="11" fontWeight="700" fill={stroke}>45°</text>
          <text x="120" y="122" textAnchor="middle" fontSize="10" fill="#5f5e5a">Miring 45°, bukan lurus dari atas</text>
        </>
      )}
      {kind === 'light' && (
        <>
          <circle cx="45" cy="30" r="12" fill="#F9A57A" />
          {[0, 45, 90, 135].map((a) => (
            <line key={a} x1={45 + 16 * Math.cos((a * Math.PI) / 180)} y1={30 + 16 * Math.sin((a * Math.PI) / 180)} x2={45 + 24 * Math.cos((a * Math.PI) / 180)} y2={30 + 24 * Math.sin((a * Math.PI) / 180)} stroke="#F9A57A" strokeWidth="2" />
          ))}
          <rect x="120" y="35" width="90" height="60" rx="6" fill="#fff" stroke={ink} strokeWidth="1.5" />
          <g transform="translate(60,75)">
            <rect x="0" y="0" width="26" height="18" rx="3" fill={ink} />
            <circle cx="13" cy="9" r="5" fill="#fff" />
          </g>
          <text x="165" y="70" textAnchor="middle" fontSize="10" fill={ink}>area terang</text>
          <text x="120" y="120" textAnchor="middle" fontSize="10" fill="#5f5e5a">Cahaya dari belakang kamera</text>
        </>
      )}
      {kind === 'coverage' && (
        <>
          <rect x="20" y="25" width="90" height="70" rx="6" fill="#fff" stroke={ink} strokeWidth="1.5" />
          <rect x="30" y="35" width="70" height="50" rx="3" fill="none" stroke={stroke} strokeWidth="2" />
          <text x="65" y="108" textAnchor="middle" fontSize="10" fontWeight="700" fill="#008300">✓ seluruh area</text>
          <rect x="130" y="25" width="90" height="70" rx="6" fill="#fff" stroke={ink} strokeWidth="1.5" />
          <rect x="165" y="55" width="30" height="25" rx="3" fill="none" stroke={grey} strokeWidth="2" strokeDasharray="3 2" />
          <line x1="140" y1="35" x2="210" y2="85" stroke="#e34948" strokeWidth="2" />
          <text x="175" y="108" textAnchor="middle" fontSize="10" fontWeight="700" fill="#e34948">✗ zoom sebagian</text>
          <text x="120" y="123" textAnchor="middle" fontSize="10" fill="#5f5e5a">Zoom ke bagian bersih = skor maks 3</text>
        </>
      )}
    </svg>
  );
}

export default function PhotoGuidePage() {
  const { indicators } = useIndicators();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('ALL');
  const list = useMemo(() => indicators.filter((i) => i.active && (cat === 'ALL' || i.categoryCode === cat) && (!q || i.area.toLowerCase().includes(q.toLowerCase()))), [indicators, cat, q]);

  return (
    <AppShell>
      <PageHeader title="Panduan foto audit" subtitle={`Supaya AI bisa menilai dengan benar dan area lolos ≥ ${MIN_SUBMIT_PCT}% tanpa berulang kali foto.`} />

      <Card className="mb-5">
        <CardHeader title="4 aturan dasar" desc="Berlaku untuk semua area." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['distance', 'Jarak 1-2 meter', 'Foto pertama harus memuat seluruh area dari ujung ke ujung. Kalau tidak muat, mundur atau ambil dari sudut ruangan.'],
              ['angle', 'Sudut 45°', 'Untuk lantai, meja, dan permukaan datar, miringkan kamera 45° agar kilap minyak dan noda terlihat. Untuk dinding/alat, tegak lurus.'],
              ['light', 'Cahaya cukup', 'Nyalakan semua lampu. Jangan memotret melawan jendela atau lampu (backlight). Pakai flash untuk bagian dalam alat, kolong, dan saluran.'],
              ['coverage', 'Jangan zoom sebagian', 'AI menilai cakupan. Foto yang hanya memperlihatkan bagian bersih dinilai "sebagian area" dan skor dibatasi maksimal 3.'],
            ] as const
          ).map(([k, t, d]) => (
            <div key={k} className="rounded-2xl border border-line/70 p-3">
              <Diagram kind={k} />
              <div className="mt-2 font-bold text-ink">{t}</div>
              <p className="mt-0.5 text-sm text-muted">{d}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-5">
        <CardHeader title="Urutan kerja yang benar" desc="Bersihkan dulu, baru foto. AI menilai foto, bukan usaha." />
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['Baca panduan area', 'Buka area di aplikasi, baca "Panduan foto area ini": persiapan, posisi, bagian wajib terlihat.'],
            ['Bersihkan sampai tuntas', 'Termasuk sudut, sambungan, kolong, gasket, dan bagian belakang. Lap kering terakhir agar tidak ada kilap air/minyak.'],
            ['Foto 1: keseluruhan', 'Jarak 1-2 m, seluruh area masuk frame, lampu menyala.'],
            ['Foto 2-3: detail', 'Bagian yang disebut "wajib terlihat": sudut, bagian dalam (pintu/tutup dibuka), kolong, gasket. Dekat 30-50 cm.'],
            ['Analisa & submit', 'Tekan Analisa. Jika belum lolos, ikuti "Panduan agar lolos" dan foto ulang hanya bagian yang diminta. Setelah 2x gagal, boleh minta verifikasi manager.'],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-2xl bg-surface p-3">
              <div className="mb-1 flex h-7 w-7 items-center justify-center rounded-full bg-brand text-xs font-black text-white">{i + 1}</div>
              <div className="font-bold text-ink">{t}</div>
              <p className="mt-0.5 text-sm text-muted">{d}</p>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <CardHeader title="Panduan per area" desc={`${list.length} area`} />
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <Input placeholder="Cari area, mis. grease trap" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="ALL">Semua kategori</option>
            {CATEGORY_ORDER.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          {list.map((i) => {
            const g = photoGuideFor(i.id);
            return (
              <details key={i.id} className="rounded-xl border border-line/70 bg-white">
                <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-semibold text-ink">
                  <span className="mr-2 text-xs text-muted">#{i.no}</span>
                  {i.area} <span className="ml-1 text-xs font-normal text-muted">· {i.category}</span>
                </summary>
                <div className="space-y-2 border-t border-line/70 px-3 py-3 text-sm text-ink">
                  <div>
                    <b>Standar:</b> <span className="text-muted">{i.standard}</span>
                  </div>
                  <div>
                    <b>Persiapan:</b> {g.prep}
                  </div>
                  <div>
                    <b>Posisi kamera:</b> {g.position}
                  </div>
                  <div>
                    <b>Wajib terlihat:</b>
                    <ul className="ml-4 list-disc">
                      {g.must.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="text-danger">
                    <b>Hindari:</b> {g.avoid.join(' · ')}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </Card>
    </AppShell>
  );
}
