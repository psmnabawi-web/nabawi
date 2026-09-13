'use client';

import { useRef, useState } from 'react';
import { ScoreDot } from './ScoreBadge';
import { Alert, Badge, Button, Modal, Select, Spinner, Textarea } from './ui';
import { apiFetch } from '@/lib/api-client';
import { compressImage } from '@/lib/image';
import { SCORE_RUBRIC, effectiveScore } from '@/lib/scoring';
import type { AuditItem, Role } from '@/lib/types';
import { cn, fmtDateTime } from '@/lib/utils';

interface Props {
  item: AuditItem;
  auditId: string;
  editable: boolean; // audit masih draft
  role: Role;
}

const STATUS_LABEL: Record<AuditItem['status'], { text: string; color: string }> = {
  pending: { text: 'Belum difoto', color: '#9a9994' },
  scored: { text: 'Dinilai AI', color: '#2a78d6' },
  invalid: { text: 'Foto tidak valid', color: '#e34948' },
  override: { text: 'Dikoreksi manager', color: '#7a4ac7' },
};

export function CaptureItem({ item, auditId, editable, role }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'analyze' | 'reset' | 'override' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [ovScore, setOvScore] = useState<number>(item.finalScore ?? 3);
  const [ovNote, setOvNote] = useState('');
  const [crewNote, setCrewNote] = useState(item.crewNote ?? '');
  const fileRef = useRef<HTMLInputElement>(null);

  const score = effectiveScore(item);
  const status = STATUS_LABEL[item.status];
  const canOverride = role !== 'crew';

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

  async function patch(body: Record<string, unknown>, kind: 'reset' | 'override') {
    setBusy(kind);
    setError(null);
    try {
      await apiFetch(`/api/audits/${auditId}/items/${item.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setOverrideOpen(false);
      setOvNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={cn('rounded-xl border bg-white shadow-sm', item.status === 'invalid' ? 'border-danger/40' : score !== null && score <= 2 ? 'border-danger/60' : 'border-line')}>
      <button type="button" className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ScoreDot score={score} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-muted">#{item.no}</span>
            <span className="truncate text-sm font-semibold text-ink">{item.area}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <Badge color={status.color}>{status.text}</Badge>
            {item.ai?.confidence && item.status !== 'pending' && (
              <span className="text-[11px] text-muted">keyakinan AI: {item.ai.confidence === 'high' ? 'tinggi' : item.ai.confidence === 'medium' ? 'sedang' : 'rendah'}</span>
            )}
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

          {error && <Alert>{error}</Alert>}

          {busy === 'analyze' && (
            <div className="flex items-center gap-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="h-14 w-14 rounded-lg object-cover" />
              )}
              <div className="flex items-center gap-2">
                <Spinner className="h-5 w-5" /> Mengunggah foto & analisa AI... (10-30 detik)
              </div>
            </div>
          )}

          {item.photoUrl && busy !== 'analyze' && (
            <a href={item.photoUrl} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.photoUrl} alt={`Foto ${item.area}`} className="max-h-72 w-full rounded-lg object-cover" />
            </a>
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
                Skor AI: <b>{item.ai.score ?? '-'}</b> · {item.capturedByName} · {fmtDateTime(item.capturedAt)}
              </div>
            </div>
          )}

          {item.overrideScore !== null && (
            <Alert kind="info">
              Skor dikoreksi manager menjadi <b>{item.overrideScore}</b> oleh {item.overrideByName} ({fmtDateTime(item.overrideAt)}): {item.overrideNote}
            </Alert>
          )}

          {editable && (
            <div>
              <Textarea placeholder="Catatan crew (opsional, dikirim ke AI sebagai konteks)" maxLength={500} value={crewNote} onChange={(e) => setCrewNote(e.target.value)} rows={2} />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {editable && (
              <>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
                <Button type="button" onClick={() => fileRef.current?.click()} loading={busy === 'analyze'} disabled={busy !== null}>
                  📷 {item.photoUrl ? 'Foto Ulang' : 'Ambil Foto'}
                </Button>
                {item.photoUrl && (
                  <Button type="button" variant="secondary" loading={busy === 'reset'} disabled={busy !== null} onClick={() => patch({ action: 'reset' }, 'reset')}>
                    Hapus Foto
                  </Button>
                )}
              </>
            )}
            {canOverride && item.ai && (
              <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => setOverrideOpen(true)}>
                Koreksi Skor
              </Button>
            )}
            {canOverride && item.overrideScore !== null && (
              <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => patch({ action: 'clear_override' }, 'override')}>
                Batalkan Koreksi
              </Button>
            )}
          </div>
        </div>
      )}

      <Modal open={overrideOpen} title={`Koreksi skor · ${item.area}`} onClose={() => setOverrideOpen(false)}>
        <div className="space-y-3">
          <p className="text-sm text-muted">Skor AI saat ini: <b>{item.ai?.score ?? '-'}</b>. Koreksi dicatat di audit trail.</p>
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
    </div>
  );
}
