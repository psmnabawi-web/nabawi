'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ScoreDot } from './ScoreBadge';
import { Alert, Badge, Button, Modal, Select, Spinner, Textarea } from './ui';
import { apiFetch } from '@/lib/api-client';
import { compressImage, type CompressedImage } from '@/lib/image';
import { photoGuideFor } from '@/lib/photoGuides';
import { MIN_SUBMIT_PCT, MIN_SUBMIT_SCORE, SCORE_RUBRIC, effectiveScore, meetsSubmitThreshold } from '@/lib/scoring';
import type { AuditItem, Role } from '@/lib/types';
import { cn, fmtDateTime } from '@/lib/utils';

interface Props {
  item: AuditItem;
  auditId: string;
  editable: boolean;
  role: Role;
  isActive: boolean;
  isBlocked: boolean;
  blockedBy?: AuditItem | null;
  onLocked?: (autoSubmitted: boolean) => void;
}

const MAX_PHOTOS = 3;
const REVIEW_AFTER = 2; // percobaan minimal sebelum bisa minta verifikasi manager

const STATUS_LABEL: Record<AuditItem['status'], { text: string; color: string }> = {
  pending: { text: 'Belum difoto', color: '#9a9994' },
  scored: { text: 'Dinilai AI', color: '#2a78d6' },
  invalid: { text: 'Foto tidak valid', color: '#e34948' },
  override: { text: 'Dikoreksi manager', color: '#7a4ac7' },
  skipped: { text: 'Dilewati', color: '#9a9994' },
};

type Busy = 'analyze' | 'reset' | 'override' | 'lock' | 'skip' | 'unlock' | 'review' | 'verify' | 'compress' | null;

export function CaptureItem({ item, auditId, editable, role, isActive, isBlocked, blockedBy, onLocked }: Props) {
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const [prevActive, setPrevActive] = useState(isActive);
  if (prevActive !== isActive) {
    setPrevActive(isActive);
    setOpenOverride(null);
  }
  const open = openOverride ?? isActive;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => setOpenOverride(typeof v === 'function' ? v(open) : v);

  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<CompressedImage[]>([]);
  const [modal, setModal] = useState<'override' | 'skip' | 'review' | 'verify' | null>(null);
  const [mScore, setMScore] = useState<number>(item.finalScore ?? 4);
  const [mNote, setMNote] = useState('');
  const [crewNote, setCrewNote] = useState(item.crewNote ?? '');
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive) rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [isActive]);

  const score = effectiveScore(item);
  const locked = item.locked === true;
  const skipped = item.status === 'skipped';
  const status = locked ? { text: 'Area di-submit', color: '#008300' } : STATUS_LABEL[item.status];
  const isManager = role !== 'crew';
  const passes = meetsSubmitThreshold(score);
  const attempts = item.attempts ?? (item.ai ? 1 : 0);
  const canCapture = editable && !locked && !skipped && !isBlocked;
  const guide = photoGuideFor(item.indicatorId ?? item.id);
  const photos = item.photoUrls?.length ? item.photoUrls : item.photoUrl ? [item.photoUrl] : [];
  const canRequestReview = canCapture && item.ai && !passes && attempts >= REVIEW_AFTER && !item.reviewRequested;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setBusy('compress');
    try {
      const img = await compressImage(file);
      setStaged((s) => (s.length >= MAX_PHOTOS ? s : [...s, img]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membaca foto.');
    } finally {
      setBusy(null);
    }
  }

  async function analyze() {
    if (staged.length === 0) return;
    setError(null);
    setBusy('analyze');
    try {
      await apiFetch('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({ auditId, itemId: item.id, images: staged.map((s) => ({ base64: s.base64, mediaType: s.mediaType })), crewNote: crewNote || null }),
      });
      setStaged([]);
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analisa gagal.');
    } finally {
      setBusy(null);
    }
  }

  async function patch(body: Record<string, unknown>, kind: NonNullable<Busy>) {
    setBusy(kind);
    setError(null);
    try {
      const r = await apiFetch<{ autoSubmitted?: boolean; item: AuditItem }>(`/api/audits/${auditId}/items/${item.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setModal(null);
      setMNote('');
      if (kind === 'lock' || kind === 'skip' || (kind === 'verify' && r.item?.locked)) {
        setOpen(false);
        onLocked?.(!!r.autoSubmitted);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        'rounded-2xl border bg-white shadow-sm transition-opacity',
        isBlocked && !locked && !skipped && 'opacity-60',
        locked ? 'border-good/50' : skipped ? 'border-dashed border-line' : item.reviewRequested ? 'border-[#7a4ac7]/50' : isActive ? 'border-brand ring-2 ring-brand/20' : item.status === 'invalid' ? 'border-danger/40' : 'border-line',
      )}
    >
      <button type="button" className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {locked ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-good text-sm font-bold text-white">✓</span>
        ) : isBlocked && !skipped ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-base">🔒</span>
        ) : (
          <ScoreDot score={skipped ? null : score} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-muted">#{item.no}</span>
            <span className={cn('truncate text-sm font-semibold', skipped ? 'text-muted line-through' : 'text-ink')}>{item.area}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <Badge color={status.color}>{status.text}</Badge>
            {locked && score !== null && <Badge color="#008300">{score * 20}%</Badge>}
            {item.reviewRequested && !locked && <Badge color="#7a4ac7">Menunggu verifikasi manager</Badge>}
            {attempts > 1 && <Badge color="#eda100">foto ulang {attempts - 1}x</Badge>}
            {photos.length > 1 && <Badge color="#5f5e5a">{photos.length} foto</Badge>}
            {isActive && !locked && <Badge color="#F26522">Sedang dikerjakan</Badge>}
            {isBlocked && !locked && !skipped && blockedBy && <span className="text-[11px] text-muted">selesaikan #{blockedBy.no} dulu</span>}
          </div>
        </div>
        {photos[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photos[0]} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" loading="lazy" />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-xl text-muted">📷</span>
        )}
      </button>

      {open && (
        <div className="space-y-3 border-t border-line p-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Standar bersih</div>
            <p className="mt-0.5 text-sm text-ink">{item.standard}</p>
          </div>

          {/* Panduan foto per area */}
          {canCapture && (
            <details className="rounded-xl border border-brand/30 bg-orange-50/60" open={!item.ai}>
              <summary className="cursor-pointer select-none px-3 py-2 text-sm font-bold text-brand">📸 Panduan foto area ini (baca sebelum memotret)</summary>
              <div className="space-y-2 px-3 pb-3 text-sm text-ink">
                <div>
                  <b>1. Persiapan:</b> {guide.prep}
                </div>
                <div>
                  <b>2. Posisi kamera:</b> {guide.position}
                </div>
                <div>
                  <b>3. Wajib terlihat:</b>
                  <ul className="ml-4 list-disc">
                    {guide.must.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
                <div className="text-danger">
                  <b>Hindari:</b> {guide.avoid.join(' · ')}
                </div>
                <div className="text-xs text-muted">
                  Ambil sampai {MAX_PHOTOS} foto: foto 1 keseluruhan, foto 2-3 detail bagian yang wajib terlihat. AI menilai semua foto sekaligus.{' '}
                  <Link href="/panduan-foto" className="font-semibold text-brand underline">
                    Panduan lengkap
                  </Link>
                </div>
              </div>
            </details>
          )}

          {skipped && (
            <Alert kind="info">
              Area dilewati oleh {item.skippedByName}: {item.skipNote}
            </Alert>
          )}
          {isBlocked && !locked && !skipped && blockedBy && (
            <Alert kind="warning">
              Area <b>#{blockedBy.no} {blockedBy.area}</b> masih dikerjakan. Selesaikan (Submit Area) atau hapus fotonya dulu sebelum memulai area ini.
            </Alert>
          )}
          {error && <Alert>{error}</Alert>}

          {/* Foto yang disiapkan (belum dianalisa) */}
          {staged.length > 0 && (
            <div className="rounded-xl border border-brand/40 bg-white p-3">
              <div className="mb-2 flex items-center justify-between text-sm">
                <b className="text-ink">
                  {staged.length} dari {MAX_PHOTOS} foto siap dianalisa
                </b>
                <button type="button" className="text-xs font-semibold text-muted underline" onClick={() => setStaged([])} disabled={busy !== null}>
                  Batal semua
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {staged.map((s, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.previewUrl} alt="" className="h-20 w-20 rounded-lg object-cover" />
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-bold text-white">{i === 0 ? 'Keseluruhan' : `Detail ${i}`}</span>
                    <button type="button" className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-danger text-[11px] font-bold text-white" onClick={() => setStaged((arr) => arr.filter((_, j) => j !== i))} aria-label="Hapus foto ini" disabled={busy !== null}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {busy === 'analyze' && (
            <div className="flex items-center gap-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-900">
              <Spinner className="h-5 w-5" /> Mengunggah {staged.length} foto & analisa AI... (10-30 detik)
            </div>
          )}

          {photos.length > 0 && busy !== 'analyze' && staged.length === 0 && (
            <div className={cn('grid gap-2', photos.length > 1 ? 'grid-cols-3' : 'grid-cols-1')}>
              {photos.map((u, i) => (
                <a key={u} href={u} target="_blank" rel="noreferrer" className="relative block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt={`Foto ${i + 1} ${item.area}`} className={cn('w-full rounded-xl object-cover', photos.length > 1 ? 'h-28' : 'max-h-72')} />
                  {photos.length > 1 && <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 text-[10px] font-bold text-white">{i === 0 ? 'Keseluruhan' : `Detail ${i}`}</span>}
                </a>
              ))}
            </div>
          )}

          {item.ai && !locked && !skipped && (
            passes ? (
              <Alert kind="success">
                <b>Lolos.</b> Skor {score! * 20}% memenuhi batas {MIN_SUBMIT_PCT}%. Tekan <b>Submit Area</b> untuk mengunci dan lanjut.
              </Alert>
            ) : item.ai.photoValid ? (
              <Alert kind="error">
                <b>Belum lolos.</b> Skor {score === null ? '-' : `${score * 20}%`} di bawah batas {MIN_SUBMIT_PCT}% (minimal skor {MIN_SUBMIT_SCORE}). Ikuti panduan di bawah, lalu <b>Foto Ulang</b>.
                {attempts >= REVIEW_AFTER && !item.reviewRequested && <> Sudah {attempts}x mencoba? Anda bisa <b>minta verifikasi manager</b>.</>}
              </Alert>
            ) : null
          )}

          {item.reviewRequested && !locked && (
            <Alert kind="info">
              <b>Menunggu verifikasi manager.</b> Catatan crew ({item.reviewRequestedByName}, {fmtDateTime(item.reviewRequestedAt ?? null)}): {item.reviewNote}
            </Alert>
          )}

          {item.ai && (
            <div className="space-y-2 rounded-xl bg-surface p-3 text-sm">
              {!item.ai.photoValid && (
                <Alert kind="warning">
                  Foto tidak dapat dinilai: {item.ai.photoIssue ?? 'tidak jelas'}. Ambil ulang sesuai panduan foto di atas.
                </Alert>
              )}
              {item.ai.coverage && item.ai.coverage !== 'full' && item.ai.photoValid && (
                <Alert kind="warning">
                  <b>Foto belum memperlihatkan seluruh area</b> (skor dibatasi maksimal 3).
                  {item.ai.hiddenZones && item.ai.hiddenZones.length > 0 && (
                    <>
                      {' '}
                      Saat foto ulang, <b>tambahkan foto detail</b> untuk: {item.ai.hiddenZones.join(', ')}.
                    </>
                  )}
                </Alert>
              )}
              {item.ai.adjustments && item.ai.adjustments.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <b>Penyesuaian ketat:</b> {item.ai.adjustments.join(' · ')}
                </div>
              )}
              <div>
                <span className="font-semibold text-ink">Temuan AI: </span>
                {item.ai.findings}
              </div>
              {item.ai.issues.length > 0 && (
                <div>
                  <div className="font-semibold text-danger">Tidak sesuai standar:</div>
                  <ul className="ml-4 list-disc">
                    {item.ai.issues.map((i, idx) => (
                      <li key={idx}>{i}</li>
                    ))}
                  </ul>
                </div>
              )}
              {item.ai.metCriteria.length > 0 && (
                <div>
                  <div className="font-semibold text-good">Terpenuhi:</div>
                  <ul className="ml-4 list-disc text-muted">
                    {item.ai.metCriteria.map((i, idx) => (
                      <li key={idx}>{i}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <span className="font-semibold text-ink">Rekomendasi: </span>
                {item.ai.recommendation}
              </div>
              {!locked && (!passes || item.ai.coverage === 'partial') && (item.ai.actionPlan?.length || item.ai.passChecklist?.length) ? (
                <div className="mt-2 overflow-hidden rounded-xl border border-brand/30 bg-white">
                  <div className="flex items-center justify-between gap-2 bg-brand/10 px-3 py-2">
                    <div className="text-sm font-bold text-brand">Panduan agar lolos ≥ {MIN_SUBMIT_PCT}%</div>
                    {item.ai.estimatedMinutes ? <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-brand">± {item.ai.estimatedMinutes} menit</span> : null}
                  </div>
                  {item.ai.actionPlan && item.ai.actionPlan.length > 0 && (
                    <ol className="divide-y divide-line/70">
                      {item.ai.actionPlan.map((st, idx) => (
                        <li key={idx} className="flex gap-3 px-3 py-2.5">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-black text-white">{idx + 1}</span>
                          <div className="min-w-0 text-sm">
                            <div className="font-semibold text-ink">{st.step}</div>
                            {st.detail && <div className="mt-0.5 text-ink/90">{st.detail}</div>}
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                              {st.tool && (
                                <span>
                                  <b className="text-ink">Alat/bahan:</b> {st.tool}
                                </span>
                              )}
                              {st.check && (
                                <span>
                                  <b className="text-ink">Cek:</b> {st.check}
                                </span>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                  {item.ai.passChecklist && item.ai.passChecklist.length > 0 && (
                    <div className="border-t border-line/70 bg-green-50/60 px-3 py-2.5">
                      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-good">Yang harus terlihat di foto ulang</div>
                      <ul className="space-y-1 text-sm text-ink">
                        {item.ai.passChecklist.map((c, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="mt-0.5 text-good">✓</span>
                            <span>{c}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : null}
              <div className="text-[11px] text-muted">
                Skor AI: <b>{item.ai.score ?? '-'}</b> · percobaan ke-{attempts}
                {item.firstAiScore !== null && item.firstAiScore !== undefined && attempts > 1 && <> · skor awal <b>{item.firstAiScore}</b></>} · {item.capturedByName} · {fmtDateTime(item.capturedAt)}
              </div>
            </div>
          )}

          {item.history && item.history.length > 1 && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer font-semibold">Riwayat {item.history.length} percobaan</summary>
              <ul className="mt-1 space-y-0.5">
                {item.history.map((h, i) => (
                  <li key={i}>
                    #{i + 1} {fmtDateTime(h.at)} · skor <b>{h.photoValid ? h.score : 'foto tidak valid'}</b> · {h.byName}
                    {h.photoUrls && h.photoUrls.length > 1 ? ` · ${h.photoUrls.length} foto` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {item.overrideScore !== null && (
            <Alert kind="info">
              Skor ditetapkan manager menjadi <b>{item.overrideScore}</b> oleh {item.overrideByName} ({fmtDateTime(item.overrideAt)}): {item.overrideNote}
            </Alert>
          )}
          {locked && (
            <Alert kind="success">
              Area di-submit oleh {item.lockedByName} · {fmtDateTime(item.lockedAt ?? null)}.
            </Alert>
          )}

          {canCapture && <Textarea placeholder="Catatan crew (opsional, konteks untuk AI dan manager)" maxLength={500} value={crewNote} onChange={(e) => setCrewNote(e.target.value)} rows={2} />}

          <div className="flex flex-wrap gap-2">
            {canCapture && (
              <>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
                {staged.length > 0 ? (
                  <>
                    <Button type="button" size="lg" loading={busy === 'analyze'} disabled={busy !== null} onClick={analyze}>
                      🔍 Analisa {staged.length} foto
                    </Button>
                    {staged.length < MAX_PHOTOS && (
                      <Button type="button" variant="secondary" loading={busy === 'compress'} disabled={busy !== null} onClick={() => fileRef.current?.click()}>
                        📷 Tambah foto detail ({staged.length}/{MAX_PHOTOS})
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    {item.ai && passes ? (
                      <Button type="button" size="lg" loading={busy === 'lock'} disabled={busy !== null} onClick={() => patch({ action: 'lock' }, 'lock')}>
                        ✓ Submit Area & Lanjut
                      </Button>
                    ) : null}
                    <Button type="button" variant={item.ai && passes ? 'secondary' : 'primary'} loading={busy === 'compress'} disabled={busy !== null} onClick={() => fileRef.current?.click()}>
                      📷 {photos.length ? 'Foto Ulang' : 'Ambil Foto'}
                    </Button>
                    {canRequestReview && (
                      <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => setModal('review')}>
                        🙋 Minta verifikasi manager
                      </Button>
                    )}
                    {item.reviewRequested && (
                      <Button type="button" variant="ghost" loading={busy === 'review'} disabled={busy !== null} onClick={() => patch({ action: 'cancel_review' }, 'review')}>
                        Batalkan permintaan
                      </Button>
                    )}
                    {photos.length > 0 && (
                      <Button type="button" variant="ghost" loading={busy === 'reset'} disabled={busy !== null} onClick={() => patch({ action: 'reset' }, 'reset')}>
                        Hapus Foto
                      </Button>
                    )}
                  </>
                )}
              </>
            )}
            {isManager && item.ai && !skipped && !locked && (
              <Button type="button" variant={item.reviewRequested ? 'primary' : 'secondary'} disabled={busy !== null} onClick={() => { setMScore(item.finalScore ?? 4); setModal('verify'); }}>
                ✔ Verifikasi & Submit
              </Button>
            )}
            {isManager && item.ai && !skipped && (
              <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => { setMScore(item.finalScore ?? 3); setModal('override'); }}>
                Koreksi Skor
              </Button>
            )}
            {isManager && item.overrideScore !== null && !locked && (
              <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => patch({ action: 'clear_override' }, 'override')}>
                Batalkan Koreksi
              </Button>
            )}
            {isManager && locked && (
              <Button type="button" variant="secondary" loading={busy === 'unlock'} disabled={busy !== null} onClick={() => patch({ action: 'unlock' }, 'unlock')}>
                Buka Kunci
              </Button>
            )}
            {isManager && !locked && !skipped && (
              <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => setModal('skip')}>
                Lewati Area
              </Button>
            )}
            {isManager && skipped && (
              <Button type="button" variant="secondary" loading={busy === 'skip'} disabled={busy !== null} onClick={() => patch({ action: 'unskip' }, 'skip')}>
                Batalkan Lewati
              </Button>
            )}
            {isManager && (locked || skipped) && photos.length > 0 && (
              <Button type="button" variant="ghost" loading={busy === 'reset'} disabled={busy !== null} onClick={() => patch({ action: 'reset' }, 'reset')}>
                Reset Area
              </Button>
            )}
          </div>
        </div>
      )}

      <Modal open={modal === 'override'} title={`Koreksi skor · ${item.area}`} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <p className="text-sm text-muted">Skor AI saat ini: <b>{item.ai?.score ?? '-'}</b>. Koreksi dicatat di audit trail (tidak mengunci area).</p>
          <Select value={mScore} onChange={(e) => setMScore(Number(e.target.value))}>
            {SCORE_RUBRIC.map((r) => (
              <option key={r.score} value={r.score}>
                {r.score} · {r.label} — {r.desc}
              </option>
            ))}
          </Select>
          <Textarea placeholder="Alasan koreksi (wajib, min. 5 karakter)" value={mNote} onChange={(e) => setMNote(e.target.value)} maxLength={500} />
          {error && <Alert>{error}</Alert>}
          <Button className="w-full" loading={busy === 'override'} disabled={mNote.trim().length < 5} onClick={() => patch({ action: 'override', score: mScore, note: mNote.trim() }, 'override')}>
            Simpan Koreksi
          </Button>
        </div>
      </Modal>

      <Modal open={modal === 'verify'} title={`Verifikasi manager · ${item.area}`} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Periksa area secara langsung atau lewat foto. Skor AI: <b>{item.ai?.score ?? '-'}</b>, percobaan: {attempts}x.
            {item.reviewNote && <> Catatan crew: <i>{item.reviewNote}</i></>}
          </p>
          <p className="text-xs text-muted">Skor ≥ {MIN_SUBMIT_SCORE} akan langsung mengunci area (submit). Skor di bawahnya tercatat sebagai koreksi tanpa mengunci; crew harus membersihkan lagi.</p>
          <Select value={mScore} onChange={(e) => setMScore(Number(e.target.value))}>
            {SCORE_RUBRIC.map((r) => (
              <option key={r.score} value={r.score}>
                {r.score} · {r.label} — {r.desc}
              </option>
            ))}
          </Select>
          <Textarea placeholder="Hasil verifikasi (wajib, min. 5 karakter), mis. 'dicek langsung, hood sudah bersih, sisa kilap adalah bekas pemakaian lama'" value={mNote} onChange={(e) => setMNote(e.target.value)} maxLength={500} />
          {error && <Alert>{error}</Alert>}
          <Button className="w-full" loading={busy === 'verify'} disabled={mNote.trim().length < 5} onClick={() => patch({ action: 'verify_lock', score: mScore, note: mNote.trim() }, 'verify')}>
            {meetsSubmitThreshold(mScore) ? 'Verifikasi & Submit Area' : 'Simpan Skor (belum lolos)'}
          </Button>
        </div>
      </Modal>

      <Modal open={modal === 'review'} title={`Minta verifikasi manager · ${item.area}`} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Sudah {attempts}x foto dan belum lolos. Manager akan memeriksa area ini dan memutuskan. Tulis apa yang sudah dibersihkan dan kenapa menurut Anda area ini sudah sesuai standar.
          </p>
          <Textarea placeholder="Contoh: sudah degreaser + sikat 2x, sisa warna kuning adalah bekas permanen di stainless lama" value={mNote} onChange={(e) => setMNote(e.target.value)} maxLength={500} />
          {error && <Alert>{error}</Alert>}
          <Button className="w-full" loading={busy === 'review'} disabled={mNote.trim().length < 5} onClick={() => patch({ action: 'request_review', note: mNote.trim() }, 'review')}>
            Kirim ke Manager
          </Button>
        </div>
      </Modal>

      <Modal open={modal === 'skip'} title={`Lewati area · ${item.area}`} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <p className="text-sm text-muted">Area yang dilewati tidak dihitung dalam skor audit. Gunakan hanya jika area memang tidak bisa diaudit (renovasi, tidak ada, tutup).</p>
          <Textarea placeholder="Alasan (wajib, min. 5 karakter)" value={mNote} onChange={(e) => setMNote(e.target.value)} maxLength={500} />
          {error && <Alert>{error}</Alert>}
          <Button className="w-full" loading={busy === 'skip'} disabled={mNote.trim().length < 5} onClick={() => patch({ action: 'skip', note: mNote.trim() }, 'skip')}>
            Lewati Area Ini
          </Button>
        </div>
      </Modal>
    </div>
  );
}
