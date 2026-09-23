'use client';

import { useEffect, useRef, useState } from 'react';
import { ScoreDot } from './ScoreBadge';
import { Alert, Badge, Button, Modal, Select, Spinner, Textarea } from './ui';
import { apiFetch } from '@/lib/api-client';
import { compressImage } from '@/lib/image';
import { MIN_SUBMIT_PCT, MIN_SUBMIT_SCORE, SCORE_RUBRIC, effectiveScore, meetsSubmitThreshold } from '@/lib/scoring';
import type { AuditItem, Role } from '@/lib/types';
import { cn, fmtDateTime } from '@/lib/utils';

interface Props {
  item: AuditItem;
  auditId: string;
  editable: boolean; // audit masih draft
  role: Role;
  /** Area ini yang sedang dikerjakan (sudah difoto, belum di-submit). */
  isActive: boolean;
  /** Area lain masih dikerjakan; area ini belum boleh difoto. */
  isBlocked: boolean;
  blockedBy?: AuditItem | null;
  onLocked?: (autoSubmitted: boolean) => void;
}

const STATUS_LABEL: Record<AuditItem['status'], { text: string; color: string }> = {
  pending: { text: 'Belum difoto', color: '#9a9994' },
  scored: { text: 'Dinilai AI', color: '#2a78d6' },
  invalid: { text: 'Foto tidak valid', color: '#e34948' },
  override: { text: 'Dikoreksi manager', color: '#7a4ac7' },
  skipped: { text: 'Dilewati', color: '#9a9994' },
};

export function CaptureItem({ item, auditId, editable, role, isActive, isBlocked, blockedBy, onLocked }: Props) {
  // terbuka otomatis saat menjadi area aktif; user tetap bisa buka/tutup manual
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const [prevActive, setPrevActive] = useState(isActive);
  if (prevActive !== isActive) {
    setPrevActive(isActive);
    setOpenOverride(null);
  }
  const open = openOverride ?? isActive;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => setOpenOverride(typeof v === 'function' ? v(open) : v);
  const [busy, setBusy] = useState<'analyze' | 'reset' | 'override' | 'lock' | 'skip' | 'unlock' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [ovScore, setOvScore] = useState<number>(item.finalScore ?? 3);
  const [ovNote, setOvNote] = useState('');
  const [skipNote, setSkipNote] = useState('');
  const [crewNote, setCrewNote] = useState(item.crewNote ?? '');
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // area aktif otomatis terbuka dan di-scroll ke layar
  useEffect(() => {
    if (isActive) rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [isActive]);

  const score = effectiveScore(item);
  const locked = item.locked === true;
  const skipped = item.status === 'skipped';
  const status = locked ? { text: 'Area di-submit', color: '#008300' } : STATUS_LABEL[item.status];
  const canOverride = role !== 'crew';
  const passes = meetsSubmitThreshold(score);
  const attempts = item.attempts ?? (item.ai ? 1 : 0);
  const canCapture = editable && !locked && !skipped && !isBlocked;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setBusy('analyze');
    try {
      const img = await compressImage(file);
      setPreview(img.previewUrl);
      await apiFetch('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({ auditId, itemId: item.id, imageBase64: img.base64, mediaType: img.mediaType, crewNote: crewNote || null }),
      });
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analisa gagal.');
    } finally {
      setBusy(null);
      setPreview(null);
    }
  }

  async function patch(body: Record<string, unknown>, kind: NonNullable<typeof busy>) {
    setBusy(kind);
    setError(null);
    try {
      const r = await apiFetch<{ autoSubmitted?: boolean }>(`/api/audits/${auditId}/items/${item.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setOverrideOpen(false);
      setSkipOpen(false);
      setOvNote('');
      setSkipNote('');
      if (kind === 'lock' || kind === 'skip') {
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
        'rounded-xl border bg-white shadow-sm transition-opacity',
        isBlocked && !locked && !skipped && 'opacity-60',
        locked ? 'border-good/50' : skipped ? 'border-line border-dashed' : isActive ? 'border-brand ring-2 ring-brand/20' : item.status === 'invalid' ? 'border-danger/40' : 'border-line',
      )}
    >
      <button type="button" className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {locked ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-good text-sm font-bold text-white" aria-label="Area di-submit">
            ✓
          </span>
        ) : isBlocked && !skipped ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-base" aria-label="Terkunci">
            🔒
          </span>
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
            {attempts > 1 && <Badge color="#eda100">foto ulang {attempts - 1}x</Badge>}
            {isActive && !locked && <Badge color="#F26522">Sedang dikerjakan</Badge>}
            {isBlocked && !locked && !skipped && blockedBy && <span className="text-[11px] text-muted">selesaikan #{blockedBy.no} dulu</span>}
          </div>
        </div>
        {item.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photoUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" loading="lazy" />
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

          {busy === 'analyze' && (
            <div className="flex items-center gap-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="h-14 w-14 rounded-lg object-cover" />
              )}
              <div className="flex items-center gap-2">
                <Spinner className="h-5 w-5" /> Mengunggah foto & analisa AI... (5-20 detik)
              </div>
            </div>
          )}

          {item.photoUrl && busy !== 'analyze' && (
            <a href={item.photoUrl} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.photoUrl} alt={`Foto ${item.area}`} className="max-h-72 w-full rounded-lg object-cover" />
            </a>
          )}

          {item.ai && !locked && !skipped && (
            passes ? (
              <Alert kind="success">
                <b>Lolos.</b> Skor {score! * 20}% memenuhi batas {MIN_SUBMIT_PCT}%. Tekan <b>Submit Area</b> untuk mengunci dan lanjut ke area berikutnya.
              </Alert>
            ) : item.ai.photoValid ? (
              <Alert kind="error">
                <b>Belum lolos.</b> Skor {score === null ? '-' : `${score * 20}%`} di bawah batas {MIN_SUBMIT_PCT}% (minimal skor {MIN_SUBMIT_SCORE}). Bersihkan area sesuai rekomendasi di bawah, lalu <b>Foto Ulang</b>.
              </Alert>
            ) : null
          )}

          {item.ai && (
            <div className="space-y-2 rounded-lg bg-surface p-3 text-sm">
              {!item.ai.photoValid && (
                <Alert kind="warning">
                  Foto tidak dapat dinilai: {item.ai.photoIssue ?? 'tidak jelas'}. Ambil ulang foto dengan pencahayaan cukup dan area terlihat jelas.
                </Alert>
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
              <div className="text-[11px] text-muted">
                Skor AI: <b>{item.ai.score ?? '-'}</b> · percobaan ke-{attempts}
                {item.firstAiScore !== null && item.firstAiScore !== undefined && attempts > 1 && <> · skor awal <b>{item.firstAiScore}</b></>} · {item.capturedByName} ·{' '}
                {fmtDateTime(item.capturedAt)}
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
                    {h.photoUrl && (
                      <>
                        {' '}
                        ·{' '}
                        <a className="underline" href={h.photoUrl} target="_blank" rel="noreferrer">
                          foto
                        </a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {item.overrideScore !== null && (
            <Alert kind="info">
              Skor dikoreksi manager menjadi <b>{item.overrideScore}</b> oleh {item.overrideByName} ({fmtDateTime(item.overrideAt)}): {item.overrideNote}
            </Alert>
          )}
          {locked && (
            <Alert kind="success">
              Area di-submit oleh {item.lockedByName} · {fmtDateTime(item.lockedAt)}.
            </Alert>
          )}

          {canCapture && (
            <Textarea placeholder="Catatan crew (opsional, dikirim ke AI sebagai konteks)" maxLength={500} value={crewNote} onChange={(e) => setCrewNote(e.target.value)} rows={2} />
          )}

          <div className="flex flex-wrap gap-2">
            {canCapture && (
              <>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
                {item.ai && passes ? (
                  <Button type="button" size="lg" loading={busy === 'lock'} disabled={busy !== null} onClick={() => patch({ action: 'lock' }, 'lock')}>
                    ✓ Submit Area & Lanjut
                  </Button>
                ) : null}
                <Button type="button" variant={item.ai && passes ? 'secondary' : 'primary'} onClick={() => fileRef.current?.click()} loading={busy === 'analyze'} disabled={busy !== null}>
                  📷 {item.photoUrl ? 'Foto Ulang' : 'Ambil Foto'}
                </Button>
                {item.photoUrl && (
                  <Button type="button" variant="ghost" loading={busy === 'reset'} disabled={busy !== null} onClick={() => patch({ action: 'reset' }, 'reset')}>
                    Hapus Foto
                  </Button>
                )}
              </>
            )}
            {canOverride && item.ai && !skipped && (
              <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => setOverrideOpen(true)}>
                Koreksi Skor
              </Button>
            )}
            {canOverride && item.overrideScore !== null && (
              <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => patch({ action: 'clear_override' }, 'override')}>
                Batalkan Koreksi
              </Button>
            )}
            {canOverride && locked && (
              <Button type="button" variant="secondary" loading={busy === 'unlock'} disabled={busy !== null} onClick={() => patch({ action: 'unlock' }, 'unlock')}>
                Buka Kunci
              </Button>
            )}
            {canOverride && !locked && !skipped && (
              <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => setSkipOpen(true)}>
                Lewati Area
              </Button>
            )}
            {canOverride && skipped && (
              <Button type="button" variant="secondary" loading={busy === 'skip'} disabled={busy !== null} onClick={() => patch({ action: 'unskip' }, 'skip')}>
                Batalkan Lewati
              </Button>
            )}
            {canOverride && (locked || skipped) && item.photoUrl && (
              <Button type="button" variant="ghost" loading={busy === 'reset'} disabled={busy !== null} onClick={() => patch({ action: 'reset' }, 'reset')}>
                Reset Area
              </Button>
            )}
          </div>
        </div>
      )}

      <Modal open={overrideOpen} title={`Koreksi skor · ${item.area}`} onClose={() => setOverrideOpen(false)}>
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Skor AI saat ini: <b>{item.ai?.score ?? '-'}</b>. Koreksi dicatat di audit trail.
          </p>
          <Select value={ovScore} onChange={(e) => setOvScore(Number(e.target.value))}>
            {SCORE_RUBRIC.map((r) => (
              <option key={r.score} value={r.score}>
                {r.score} · {r.label} — {r.desc}
              </option>
            ))}
          </Select>
          <Textarea placeholder="Alasan koreksi (wajib, min. 5 karakter)" value={ovNote} onChange={(e) => setOvNote(e.target.value)} maxLength={500} />
          {error && <Alert>{error}</Alert>}
          <Button className="w-full" loading={busy === 'override'} disabled={ovNote.trim().length < 5} onClick={() => patch({ action: 'override', score: ovScore, note: ovNote.trim() }, 'override')}>
            Simpan Koreksi
          </Button>
        </div>
      </Modal>

      <Modal open={skipOpen} title={`Lewati area · ${item.area}`} onClose={() => setSkipOpen(false)}>
        <div className="space-y-3">
          <p className="text-sm text-muted">Area yang dilewati tidak dihitung dalam skor audit. Gunakan hanya jika area memang tidak bisa diaudit (renovasi, tidak ada, tutup).</p>
          <Textarea placeholder="Alasan (wajib, min. 5 karakter)" value={skipNote} onChange={(e) => setSkipNote(e.target.value)} maxLength={500} />
          {error && <Alert>{error}</Alert>}
          <Button className="w-full" loading={busy === 'skip'} disabled={skipNote.trim().length < 5} onClick={() => patch({ action: 'skip', note: skipNote.trim() }, 'skip')}>
            Lewati Area Ini
          </Button>
        </div>
      </Modal>
    </div>
  );
}
