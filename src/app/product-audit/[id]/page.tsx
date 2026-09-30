'use client';

import { useParams, useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { IconCamera, IconSparkle } from '@/components/icons';
import { DecisionBadge, GateBadge, scorePctColor, VERDICT_COLOR, VERDICT_LABEL, VerdictBadge } from '@/components/ProductBits';
import { SuperAdminGuard } from '@/components/SuperAdminGuard';
import { Alert, Badge, Button, Card, CardHeader, Input, Label, Modal, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { apiFetch } from '@/lib/api-client';
import { exportProductAuditExcel } from '@/lib/export-product-excel';
import { useProductAudit } from '@/lib/hooks';
import { compressImage, type CompressedImage } from '@/lib/image';
import { MEASURE_FIELDS, PHOTO_SLOTS, type Verdict } from '@/lib/productChecklists';
import type { ProductAudit, ProductAuditItem } from '@/lib/types';
import { cn, fmtDate, fmtDateTime } from '@/lib/utils';

const MAX_PHOTOS = 6;
type Filter = 'all' | 'tidak' | 'critical' | 'inspector' | 'na';
type Staged = CompressedImage & { label: string };
type Notes = { process: string; sensory: string; label: string };

function initMeasures(a: ProductAudit): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of MEASURE_FIELDS[a.productId]) {
    const v = a.measures?.[f.key];
    out[f.key] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}
function initNotes(a: ProductAudit): Notes {
  return { process: a.notes?.process ?? '', sensory: a.notes?.sensory ?? '', label: a.notes?.label ?? '' };
}

export default function ProductAuditDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { audit, loading, error } = useProductAudit(id);

  // Input lokal (diinisialisasi dari dokumen saat pertama dimuat; pola "adjust state during render")
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [measures, setMeasures] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Notes>({ process: '', sensory: '', label: '' });
  if (audit && loadedFor !== audit.id) {
    setLoadedFor(audit.id);
    setMeasures(initMeasures(audit));
    setNotes(initNotes(audit));
  }

  const [keep, setKeep] = useState<Record<number, boolean>>({});
  const [staged, setStaged] = useState<Staged[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [openStd, setOpenStd] = useState<Record<number, boolean>>({});
  const [override, setOverride] = useState<{ item: ProductAuditItem; verdict: Verdict; note: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const editable = audit?.status === 'draft';
  const existingKept = useMemo(() => (audit ? audit.photoUrls.map((_, i) => keep[i] !== false) : []), [audit, keep]);
  const totalPhotos = existingKept.filter(Boolean).length + staged.length;

  const visible = useMemo(() => {
    if (!audit) return [];
    return audit.items.filter((it) => {
      if (filter === 'tidak') return it.final === 'tidak';
      if (filter === 'critical') return it.gate === 'CRITICAL';
      if (filter === 'inspector') return it.finalSource === 'inspector';
      if (filter === 'na') return it.final === 'na';
      return true;
    });
  }, [audit, filter]);

  const stages = useMemo(() => {
    const map = new Map<string, ProductAuditItem[]>();
    for (const it of visible) map.set(it.stage, [...(map.get(it.stage) ?? []), it]);
    return [...map.entries()];
  }, [visible]);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length || !audit) return;
    const room = MAX_PHOTOS - totalPhotos;
    if (room <= 0) {
      setMsg({ kind: 'error', text: `Maksimal ${MAX_PHOTOS} foto.` });
      return;
    }
    setBusy('compress');
    try {
      const slots = PHOTO_SLOTS[audit.productId];
      const next: Staged[] = [];
      for (const f of files.slice(0, room)) {
        const img = await compressImage(f);
        const idx = totalPhotos + next.length;
        next.push({ ...img, label: slots[idx] ?? `Foto ${idx + 1}` });
      }
      setStaged((s) => [...s, ...next]);
      setMsg(null);
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Gagal membaca foto.' });
    } finally {
      setBusy(null);
    }
  }

  function parsedMeasures(): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(measures)) {
      const n = v.trim() === '' ? null : Number(v.replace(',', '.'));
      out[k] = n === null || Number.isNaN(n) ? null : n;
    }
    return out;
  }
  function parsedNotes() {
    return { process: notes.process.trim() || null, sensory: notes.sensory.trim() || null, label: notes.label.trim() || null };
  }

  async function saveInputs() {
    if (!audit) return;
    setBusy('save');
    setMsg(null);
    try {
      await apiFetch(`/api/product-audits/${audit.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'inputs', measures: parsedMeasures(), notes: parsedNotes() }) });
      setMsg({ kind: 'success', text: 'Pengukuran & catatan tersimpan.' });
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Gagal menyimpan.' });
    } finally {
      setBusy(null);
    }
  }

  async function analyze() {
    if (!audit) return;
    if (totalPhotos === 0) {
      setMsg({ kind: 'error', text: 'Tambahkan minimal 1 foto produk.' });
      return;
    }
    setBusy('analyze');
    setMsg({ kind: 'info', text: `AI sedang menilai ${audit.items.length} item dari ${totalPhotos} foto, pengukuran, dan catatan. Biasanya 30-90 detik.` });
    try {
      await apiFetch(`/api/product-audits/${audit.id}/analyze`, {
        method: 'POST',
        body: JSON.stringify({
          images: staged.map((s) => ({ base64: s.base64, mediaType: s.mediaType, label: s.label })),
          keepPhotoIndexes: audit.photoUrls.map((_, i) => i).filter((i) => keep[i] !== false),
          measures: parsedMeasures(),
          notes: parsedNotes(),
        }),
      });
      setStaged([]);
      setKeep({});
      setMsg({ kind: 'success', text: 'Analisa AI selesai. Periksa hasil per item; koreksi bila perlu, lalu submit.' });
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Analisa gagal.' });
    } finally {
      setBusy(null);
    }
  }

  async function setVerdict(item: ProductAuditItem, verdict: Verdict | null, note?: string) {
    if (!audit) return;
    setBusy(`v${item.no}`);
    setMsg(null);
    try {
      await apiFetch(`/api/product-audits/${audit.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'verdict', no: item.no, verdict, note: note ?? null }) });
      setOverride(null);
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Gagal menyimpan keputusan.' });
    } finally {
      setBusy(null);
    }
  }

  function chooseVerdict(item: ProductAuditItem, verdict: Verdict) {
    if (item.ai && verdict === item.ai.verdict) {
      void setVerdict(item, null);
      return;
    }
    setOverride({ item, verdict, note: item.inspectorNote ?? '' });
  }

  async function act(action: 'submit' | 'reopen' | 'delete' | 'export') {
    if (!audit) return;
    setMsg(null);
    if (action === 'delete' && !confirm('Hapus audit produk ini beserta seluruh foto?')) return;
    if (action === 'submit' && !confirm(`Submit pemeriksaan ini? Keputusan: ${audit.summary.decision}.`)) return;
    setBusy(action);
    try {
      if (action === 'export') await exportProductAuditExcel(audit);
      else if (action === 'delete') {
        await apiFetch(`/api/product-audits/${audit.id}`, { method: 'DELETE' });
        router.replace('/product-audit');
        return;
      } else {
        await apiFetch(`/api/product-audits/${audit.id}`, { method: 'PATCH', body: JSON.stringify({ action }) });
        setMsg({ kind: 'success', text: action === 'submit' ? 'Pemeriksaan disubmit.' : 'Pemeriksaan dibuka kembali.' });
      }
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Gagal.' });
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <SuperAdminGuard>
        <div className="flex justify-center p-10 text-brand">
          <Spinner className="h-8 w-8" />
        </div>
      </SuperAdminGuard>
    );
  }
  if (error || !audit) {
    return (
      <SuperAdminGuard>
        <Alert>{error ?? 'Audit tidak ditemukan.'}</Alert>
      </SuperAdminGuard>
    );
  }
  const s = audit.summary;
  const fields = MEASURE_FIELDS[audit.productId];
  const slots = PHOTO_SLOTS[audit.productId];

  return (
    <SuperAdminGuard>
      <PageHeader
        title={`${audit.productName} · ${audit.storeName.replace(/^Almaz Fried Chicken\s*-\s*/i, '')}`}
        subtitle={`${fmtDate(audit.date)} · Pemeriksaan ke-${audit.checkNo} bulan ini · Inspector ${audit.inspectorName}`}
        actions={
          <>
            <Button variant="secondary" size="sm" loading={busy === 'export'} onClick={() => act('export')}>
              ⬇ Excel
            </Button>
            {editable ? (
              <Button size="sm" loading={busy === 'submit'} onClick={() => act('submit')} disabled={s.unanswered > 0}>
                Submit Pemeriksaan
              </Button>
            ) : (
              <Button variant="secondary" size="sm" loading={busy === 'reopen'} onClick={() => act('reopen')}>
                Buka Kembali
              </Button>
            )}
            <Button variant="danger" size="sm" loading={busy === 'delete'} onClick={() => act('delete')}>
              Hapus
            </Button>
          </>
        }
      />
      {msg && (
        <Alert kind={msg.kind} className="mb-4">
          {msg.text}
        </Alert>
      )}

      {/* ===== Ringkasan ===== */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-2xl text-white" style={{ backgroundColor: scorePctColor(s.score) }}>
            <span className="text-3xl font-black leading-none">{s.score === null ? '-' : `${s.score}%`}</span>
            <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide opacity-90">Nilai</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <DecisionBadge decision={s.decision} className="!px-3 !py-1 !text-sm" />
              <Badge color={audit.status === 'submitted' ? '#008300' : '#eda100'}>{audit.status === 'submitted' ? `Submitted ${fmtDateTime(audit.submittedAt)}` : 'Draft'}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {[
                ['Ya', s.ya, '#008300'],
                ['Tidak', s.tidak, '#e34948'],
                ['N/A', s.na, '#9a9994'],
                ['Critical NG', s.criticalNg, '#e34948'],
                ['Major NG', s.majorNg, '#eda100'],
                ['Control NG', s.controlNg, '#2a78d6'],
              ].map(([l, v, c]) => (
                <div key={l as string} className="rounded-xl bg-surface px-3 py-2">
                  <div className="text-lg font-black leading-none" style={{ color: c as string }}>
                    {v as number}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted">{l as string}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              Nilai = Ya ÷ (Ya + Tidak). CRITICAL Tidak → HOLD - TIDAK AMAN; MAJOR Tidak → JANGAN DISAJIKAN; CONTROL Tidak → BOLEH DISAJIKAN - CATAT DEVIASI.
              {s.unanswered > 0 && ` Masih ${s.unanswered} item belum dinilai.`}
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        {/* ===== Input: foto + pengukuran + catatan ===== */}
        <Card>
          <CardHeader title="Bukti Pemeriksaan" desc={editable ? 'Foto produk (maks 6), hasil ukur, dan catatan pengamatan. AI menilai semuanya sekaligus.' : 'Bukti yang dipakai pada pemeriksaan ini.'} />
          <div className="grid grid-cols-3 gap-2">
            {audit.photoUrls.map((url, i) => (
              <div key={url} className={cn('relative overflow-hidden rounded-xl border border-line', keep[i] === false && 'opacity-40')}>
                <a href={url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={audit.photoLabels[i] ?? `Foto ${i + 1}`} className="aspect-square w-full object-cover" />
                </a>
                <div className="truncate bg-white px-2 py-1 text-[11px] text-ink">{audit.photoLabels[i] || `Foto ${i + 1}`}</div>
                {editable && (
                  <button type="button" onClick={() => setKeep((k) => ({ ...k, [i]: k[i] === false }))} className="absolute right-1 top-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
                    {keep[i] === false ? 'Pakai lagi' : 'Buang'}
                  </button>
                )}
              </div>
            ))}
            {staged.map((img, i) => (
              <div key={i} className="relative overflow-hidden rounded-xl border-2 border-brand/60">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.previewUrl} alt={img.label} className="aspect-square w-full object-cover" />
                <select value={img.label} onChange={(e) => setStaged((s) => s.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} className="w-full border-t border-line bg-white px-1 py-1 text-[11px] text-ink">
                  {[...new Set([...slots, img.label])].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setStaged((s) => s.filter((_, k) => k !== i))} className="absolute right-1 top-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
                  Hapus
                </button>
              </div>
            ))}
            {editable && totalPhotos < MAX_PHOTOS && (
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy === 'compress'} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line text-muted hover:border-brand hover:text-brand">
                {busy === 'compress' ? <Spinner /> : <IconCamera size={26} />}
                <span className="text-xs font-semibold">Tambah foto</span>
                <span className="text-[10px]">{totalPhotos}/{MAX_PHOTOS}</span>
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onFiles} />
          </div>
          <p className="mt-2 text-xs text-muted">Saran foto: {slots.join(' · ')}.</p>

          <div className="mt-5">
            <div className="mb-2 text-sm font-bold text-ink">Hasil Pengukuran</div>
            <div className="grid grid-cols-2 gap-3">
              {fields.map((f) => (
                <div key={f.key}>
                  <Label htmlFor={`m-${f.key}`}>
                    {f.label} ({f.unit})
                  </Label>
                  <Input id={`m-${f.key}`} type="number" inputMode="decimal" step="any" placeholder={f.hint} value={measures[f.key] ?? ''} disabled={!editable} onChange={(e) => setMeasures((m) => ({ ...m, [f.key]: e.target.value }))} />
                  <div className="mt-0.5 text-[11px] text-muted">
                    Item #{f.items.join(', #')} · {f.hint}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <div className="text-sm font-bold text-ink">Catatan Pengamatan Inspector</div>
            <div>
              <Label htmlFor="n-process">Proses & prosedur (yang Anda saksikan)</Label>
              <Textarea id="n-process" disabled={!editable} value={notes.process} maxLength={2000} onChange={(e) => setNotes((n) => ({ ...n, process: e.target.value }))} placeholder="Contoh: fryer dipanaskan 150°C, shake 3x di menit ke-7, minyak difilter setelah 4 basket, zoning basah/kering terpisah, sarung tangan diganti setelah breading." />
            </div>
            <div>
              <Label htmlFor="n-sensory">Sensori (aroma, rasa, tekstur, keempukan)</Label>
              <Textarea id="n-sensory" disabled={!editable} value={notes.sensory} maxLength={2000} onChange={(e) => setNotes((n) => ({ ...n, sensory: e.target.value }))} placeholder="Contoh: aroma rempah dan asap seimbang, tidak ada bau tengik; daging juicy, mudah lepas dari tulang; rasa asin-gurih, tidak pedas." />
            </div>
            <div>
              <Label htmlFor="n-label">Label, traceability & bahan baku</Label>
              <Textarea id="n-label" disabled={!editable} value={notes.label} maxLength={2000} onChange={(e) => setNotes((n) => ({ ...n, label: e.target.value }))} placeholder="Contoh: label matang 10:15, expired 22:15; memakai beras basmati merk X; ayam Chicken Crispy dari supplier resmi, kemasan utuh." />
            </div>
          </div>

          {editable && (
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="secondary" loading={busy === 'save'} onClick={saveInputs}>
                Simpan Input
              </Button>
              <Button loading={busy === 'analyze'} onClick={analyze} disabled={totalPhotos === 0 || busy === 'compress'}>
                <IconSparkle size={18} /> {audit.ai ? 'Analisa Ulang AI' : 'Analisa AI'}
              </Button>
            </div>
          )}
        </Card>

        {/* ===== Hasil AI ===== */}
        <Card>
          <CardHeader title="Kesimpulan AI" desc={audit.ai ? `${audit.ai.model} · ${fmtDateTime(audit.ai.analyzedAt)} · ${audit.ai.photoCount} foto · analisa ke-${audit.attempts}` : 'Belum dianalisa.'} />
          {!audit.ai ? (
            <p className="text-sm text-muted">Lengkapi bukti di sebelah kiri lalu tekan <b>Analisa AI</b>. AI akan memutuskan Ya/Tidak/N/A untuk setiap item dan menghitung skor serta keputusan.</p>
          ) : (
            <div className="space-y-4 text-sm">
              <p className="text-ink">{audit.ai.summary}</p>
              {audit.ai.risks.length > 0 && (
                <div className="rounded-xl border border-danger/30 bg-red-50 p-3">
                  <div className="mb-1 text-xs font-bold uppercase tracking-wide text-danger">Risiko segera</div>
                  <ul className="list-disc space-y-1 pl-5 text-red-900">
                    {audit.ai.risks.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {audit.ai.recommendations.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Rekomendasi perbaikan</div>
                  <ol className="list-decimal space-y-1 pl-5 text-ink">
                    {audit.ai.recommendations.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ol>
                </div>
              )}
              {audit.ai.missingEvidence.length > 0 && (
                <div className="rounded-xl bg-amber-50 p-3">
                  <div className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-800">Bukti yang masih kurang</div>
                  <ul className="list-disc space-y-1 pl-5 text-amber-900">
                    {audit.ai.missingEvidence.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {audit.ai.adjustments.length > 0 && (
                <div className="text-xs text-muted">
                  Penyesuaian server: {audit.ai.adjustments.join('; ')}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* ===== Checklist ===== */}
      <Card className="mt-5 overflow-hidden p-0">
        <div className="p-5 pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-ink">Checklist Item</h2>
              <p className="mt-0.5 text-sm text-muted">{editable ? 'Keputusan AI bisa Anda koreksi. Koreksi yang berbeda dari AI wajib diberi alasan (tercatat di audit trail).' : 'Keputusan akhir per item.'}</p>
            </div>
            <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="sm:!w-auto">
              <option value="all">Semua ({audit.items.length})</option>
              <option value="tidak">Tidak ({audit.items.filter((i) => i.final === 'tidak').length})</option>
              <option value="critical">CRITICAL ({audit.items.filter((i) => i.gate === 'CRITICAL').length})</option>
              <option value="na">N/A ({audit.items.filter((i) => i.final === 'na').length})</option>
              <option value="inspector">Dikoreksi inspector ({audit.items.filter((i) => i.finalSource === 'inspector').length})</option>
            </Select>
          </div>
        </div>
        {stages.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">Tidak ada item untuk filter ini.</p>
        ) : (
          stages.map(([stage, items]) => (
            <div key={stage}>
              <div className="border-y border-line/70 bg-surface px-5 py-2 text-xs font-bold uppercase tracking-wide text-muted">{stage}</div>
              {items.map((it) => (
                <div key={it.no} className={cn('border-b border-line/50 px-5 py-3', it.final === 'tidak' && it.gate === 'CRITICAL' && 'bg-red-50/60', it.final === 'tidak' && it.gate === 'MAJOR' && 'bg-amber-50/60')}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-muted">#{it.no}</span>
                        <GateBadge gate={it.gate} />
                        <span className="font-semibold text-ink">{it.parameter}</span>
                        <button type="button" className="text-xs font-semibold text-brand hover:underline" onClick={() => setOpenStd((o) => ({ ...o, [it.no]: !o[it.no] }))}>
                          {openStd[it.no] ? 'Sembunyikan standar' : 'Lihat standar'}
                        </button>
                      </div>
                      {openStd[it.no] && <p className="mt-1 whitespace-pre-line rounded-lg bg-surface p-2 text-xs text-ink">{it.standard}</p>}
                      {it.ai ? (
                        <div className="mt-1.5 text-sm">
                          <span className="text-muted">AI: </span>
                          <VerdictBadge verdict={it.ai.verdict} /> <span className="text-ink">{it.ai.reason}</span>
                          {it.ai.missing && <div className="mt-0.5 text-xs text-amber-800">Bukti kurang: {it.ai.missing}</div>}
                          <div className="mt-0.5 text-[11px] text-muted">
                            Sumber: {it.ai.evidenceSource === 'photo' ? 'foto' : it.ai.evidenceSource === 'measure' ? 'pengukuran' : it.ai.evidenceSource === 'note' ? 'catatan inspector' : 'tidak ada'} · keyakinan {it.ai.confidence}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-muted">Belum dinilai AI.</div>
                      )}
                      {it.finalSource === 'inspector' && (
                        <div className="mt-1 text-xs text-[#7a4ac7]">
                          Koreksi inspector: <b>{it.final ? VERDICT_LABEL[it.final] : '-'}</b>
                          {it.inspectorNote && ` — ${it.inspectorNote}`} ({fmtDateTime(it.inspectorAt)})
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 sm:shrink-0">
                      {(['ya', 'tidak', 'na'] as Verdict[]).map((v) => (
                        <button
                          key={v}
                          type="button"
                          disabled={!editable || busy === `v${it.no}`}
                          onClick={() => chooseVerdict(it, v)}
                          className={cn('h-9 flex-1 rounded-lg border px-2 text-xs font-bold transition-colors disabled:cursor-not-allowed sm:min-w-[52px] sm:flex-none', it.final === v ? 'text-white' : 'border-line bg-white text-ink hover:bg-surface disabled:opacity-60')}
                          style={it.final === v ? { backgroundColor: VERDICT_COLOR[v], borderColor: VERDICT_COLOR[v] } : undefined}
                        >
                          {VERDICT_LABEL[v]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </Card>

      <Modal open={!!override} title={`Koreksi item #${override?.item.no}`} onClose={() => setOverride(null)}>
        {override && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void setVerdict(override.item, override.verdict, override.note);
            }}
          >
            <p className="text-sm text-ink">
              <b>{override.item.parameter}</b>
              <br />
              AI: <VerdictBadge verdict={override.item.ai?.verdict ?? null} /> → Anda: <VerdictBadge verdict={override.verdict} />
            </p>
            <div>
              <Label htmlFor="ov-note">Alasan koreksi (wajib)</Label>
              <Textarea id="ov-note" required minLength={5} maxLength={500} value={override.note} onChange={(e) => setOverride((o) => (o ? { ...o, note: e.target.value } : o))} placeholder="Contoh: sudah dicek langsung, suhu inti 78°C terbaca di termometer." />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOverride(null)}>
                Batal
              </Button>
              <Button type="submit" loading={busy === `v${override.item.no}`}>
                Simpan Koreksi
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </SuperAdminGuard>
  );
}
