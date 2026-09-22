import { CATEGORY_ORDER } from './indicators';
import type { AuditItem, AuditSummary, CategoryScore, Grade } from './types';

/**
 * Aturan scoring (mengikuti Form Audit Cleaning):
 * - Setiap indikator dinilai 1-5.
 * - Skor final = override manager (jika ada) atau skor AI.
 * - Persentase = rata-rata skor / 5 x 100.
 * - Item skor <= CRITICAL_THRESHOLD dianggap temuan kritikal (wajib tindak lanjut).
 */
export const MAX_SCORE = 5;
export const CRITICAL_THRESHOLD = 2;
/** Batas minimum agar area boleh di-submit crew: 75% dari skor maksimal -> skor 4 (80%) atau 5. */
export const MIN_SUBMIT_PCT = 75;
export const MIN_SUBMIT_SCORE = Math.ceil((MAX_SCORE * MIN_SUBMIT_PCT) / 100);

export function meetsSubmitThreshold(score: number | null): boolean {
  return score !== null && score >= MIN_SUBMIT_SCORE;
}

/** Item dianggap selesai (terkunci atau dilewati). */
export function isDone(item: Pick<AuditItem, 'locked' | 'status'>): boolean {
  return item.status === 'skipped' || item.locked === true;
}

/** Urutan kerja: area ke-i terbuka jika semua area sebelumnya selesai. Mengembalikan index area aktif (-1 jika semua selesai). */
export function activeIndex(items: Pick<AuditItem, 'locked' | 'status'>[]): number {
  return items.findIndex((it) => !isDone(it));
}

export const GRADE_RULES: { grade: Grade; minPct: number; label: string; color: string }[] = [
  { grade: 'A', minPct: 90, label: 'Excellent', color: '#008300' },
  { grade: 'B', minPct: 80, label: 'Good', color: '#2a78d6' },
  { grade: 'C', minPct: 70, label: 'Perlu Perbaikan', color: '#eda100' },
  { grade: 'D', minPct: 0, label: 'Kritikal', color: '#e34948' },
];

export function gradeFor(pct: number | null): Grade | null {
  if (pct === null || Number.isNaN(pct)) return null;
  return GRADE_RULES.find((g) => pct >= g.minPct)?.grade ?? 'D';
}

export function gradeMeta(grade: Grade | null) {
  return GRADE_RULES.find((g) => g.grade === grade) ?? null;
}

export function effectiveScore(item: Pick<AuditItem, 'overrideScore' | 'ai' | 'status'>): number | null {
  if (item.overrideScore !== null && item.overrideScore !== undefined) return item.overrideScore;
  if (item.ai && item.ai.photoValid && item.ai.score !== null) return item.ai.score;
  return null;
}

export function summarize(items: AuditItem[]): AuditSummary {
  const categories: CategoryScore[] = CATEGORY_ORDER.map((c) => ({
    code: c.code,
    label: c.label,
    total: 0,
    scored: 0,
    sum: 0,
    max: 0,
    avg: null,
    pct: null,
  }));
  const byCode = new Map(categories.map((c) => [c.code, c]));

  let scoredCount = 0;
  let invalidCount = 0;
  let pendingCount = 0;
  let criticalCount = 0;
  let lockedCount = 0;
  let skippedCount = 0;
  let retryCount = 0;
  let firstPassCount = 0;
  let firstSum = 0;
  let firstN = 0;
  let sum = 0;

  for (const item of items) {
    if (item.status === 'skipped') {
      skippedCount += 1;
      continue;
    }
    const cat = byCode.get(item.categoryCode);
    if (cat) cat.total += 1;
    if (item.locked) lockedCount += 1;
    const attempts = item.attempts ?? (item.ai ? 1 : 0);
    if (attempts > 1) retryCount += attempts - 1;
    const first = item.firstAiScore ?? (item.ai?.photoValid ? item.ai.score : null);
    if (first !== null && first !== undefined) {
      firstN += 1;
      firstSum += first;
      if (meetsSubmitThreshold(first)) firstPassCount += 1;
    }
    const score = effectiveScore(item);
    if (score !== null) {
      scoredCount += 1;
      sum += score;
      if (score <= CRITICAL_THRESHOLD) criticalCount += 1;
      if (cat) {
        cat.scored += 1;
        cat.sum += score;
        cat.max += MAX_SCORE;
      }
    } else if (item.status === 'invalid') {
      invalidCount += 1;
    } else {
      pendingCount += 1;
    }
  }

  for (const cat of categories) {
    if (cat.scored > 0) {
      cat.avg = round2(cat.sum / cat.scored);
      cat.pct = round1((cat.sum / cat.max) * 100);
    }
  }

  const max = scoredCount * MAX_SCORE;
  const avg = scoredCount > 0 ? round2(sum / scoredCount) : null;
  const pct = scoredCount > 0 ? round1((sum / max) * 100) : null;

  return {
    itemCount: items.length - skippedCount,
    scoredCount,
    invalidCount,
    pendingCount,
    criticalCount,
    lockedCount,
    skippedCount,
    retryCount,
    firstPassCount,
    firstPassPct: firstN > 0 ? round1((firstSum / (firstN * MAX_SCORE)) * 100) : null,
    sum,
    max,
    avg,
    pct,
    grade: gradeFor(pct),
    categories: categories.filter((c) => c.total > 0),
  };
}

export function emptySummary(): AuditSummary {
  return {
    itemCount: 0,
    scoredCount: 0,
    invalidCount: 0,
    pendingCount: 0,
    criticalCount: 0,
    lockedCount: 0,
    skippedCount: 0,
    retryCount: 0,
    firstPassCount: 0,
    firstPassPct: null,
    sum: 0,
    max: 0,
    avg: null,
    pct: null,
    grade: null,
    categories: [],
  };
}

export function round1(n: number) {
  return Math.round(n * 10) / 10;
}
export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export const SCORE_RUBRIC: { score: number; label: string; desc: string }[] = [
  { score: 5, label: 'Sangat Bersih', desc: 'Sepenuhnya sesuai standar, tidak ada temuan.' },
  { score: 4, label: 'Bersih', desc: 'Ada 1 temuan minor, tidak mempengaruhi higienitas.' },
  { score: 3, label: 'Cukup', desc: 'Beberapa temuan yang perlu dibersihkan segera.' },
  { score: 2, label: 'Kotor', desc: 'Temuan signifikan: grease/kerak/noda/bau jelas terlihat.' },
  { score: 1, label: 'Sangat Kotor', desc: 'Tidak sesuai standar, risiko higienitas atau keselamatan.' },
];
