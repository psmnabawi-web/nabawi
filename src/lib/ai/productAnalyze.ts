import 'server-only';
import { MEASURE_FIELDS, type ProductDef, type Verdict } from '../productChecklists';
import type { ProductAuditAi, ProductItemAi } from '../types';
import { HttpError } from '../utils';
import { aiModel, aiProvider } from './analyze';
import { generateJsonWithGoogle } from './google';
import { buildProductUserText, PRODUCT_RESPONSE_SCHEMA, PRODUCT_SYSTEM_PROMPT, type ProductAnalyzeInput } from './productPrompt';

export interface ProductAnalyzeResult {
  items: Record<number, ProductItemAi>;
  ai: ProductAuditAi;
}

/** Batas standar untuk pengaman server: angka di luar batas => item measure dipaksa "tidak". */
type Limit = { key: string; item: number; ok: (v: number, m: Record<string, number | null>) => boolean; label: string };
const LIMITS: Record<string, Limit[]> = {
  kebuli: [
    { key: 'tempTop', item: 21, ok: (v) => v > 60, label: 'suhu atas harus > 60°C' },
    { key: 'tempMid', item: 22, ok: (v) => v > 60, label: 'suhu tengah harus > 60°C' },
    { key: 'tempBase', item: 23, ok: (v) => v > 60, label: 'suhu dasar harus > 60°C' },
    { key: 'ageHours', item: 24, ok: (v) => v <= 12, label: 'umur produk maks 12 jam' },
    { key: 'portionWeight', item: 25, ok: (v) => (v >= 175 && v <= 185) || (v >= 85 && v <= 95), label: 'porsi 175-185 g (setengah 85-95 g)' },
  ],
  saudi: [
    { key: 'coreTemp', item: 19, ok: (v, m) => v >= 74 && (m.coreHoldSec === null || m.coreHoldSec === undefined || m.coreHoldSec >= 10), label: 'suhu inti min 74°C selama 10 detik' },
    { key: 'dipWaterTemp', item: 8, ok: (v) => v >= 1 && v <= 4, label: 'air celup 1-4°C' },
  ],
  ori: [
    { key: 'coreTemp', item: 19, ok: (v, m) => v >= 74 && (m.coreHoldSec === null || m.coreHoldSec === undefined || m.coreHoldSec >= 10), label: 'suhu inti min 74°C selama 10 detik' },
    { key: 'dipWaterTemp', item: 8, ok: (v) => v >= 1 && v <= 4, label: 'air celup 1-4°C' },
  ],
};

export async function analyzeProduct(input: Omit<ProductAnalyzeInput, 'measureFields'> & { product: ProductDef }): Promise<ProductAnalyzeResult> {
  if (aiProvider() !== 'google') throw new HttpError(500, 'Audit produk saat ini hanya mendukung AI_PROVIDER=google.');
  const model = aiModel();
  const measureFields = MEASURE_FIELDS[input.product.id];
  const full: ProductAnalyzeInput = { ...input, measureFields };
  const { data, model: used } = await generateJsonWithGoogle({
    model,
    systemInstruction: PRODUCT_SYSTEM_PROMPT,
    parts: [
      ...input.images.flatMap((img, i) => [{ text: `Foto ${i + 1} dari ${input.images.length}: ${img.label}` }, { inlineData: { mimeType: img.mediaType, data: img.base64 } }]),
      { text: buildProductUserText(full) },
    ],
    schema: PRODUCT_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: 24576,
  });

  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : []);
  const items: Record<number, ProductItemAi> = {};
  const rawItems = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
  for (const r of rawItems) {
    if (!r || typeof r !== 'object') continue;
    const no = Number(r.no);
    if (!Number.isInteger(no)) continue;
    const verdict: Verdict = r.verdict === 'ya' || r.verdict === 'na' ? r.verdict : 'tidak';
    items[no] = {
      verdict,
      reason: typeof r.reason === 'string' ? r.reason.trim() : '',
      evidenceSource: r.evidenceSource === 'photo' || r.evidenceSource === 'measure' || r.evidenceSource === 'note' ? r.evidenceSource : 'none',
      missing: typeof r.missing === 'string' ? r.missing.trim() : '',
      confidence: r.confidence === 'high' || r.confidence === 'low' ? r.confidence : 'medium',
    };
  }
  const adjustments: string[] = [];
  // Item yang tidak dijawab AI => "tidak" (bukti tidak ada), sesuai acuan penilaian.
  for (const it of input.product.items) {
    if (!items[it.no]) {
      items[it.no] = { verdict: 'tidak', reason: 'AI tidak memberi penilaian untuk item ini; dianggap bukti tidak tersedia.', evidenceSource: 'none', missing: 'Analisa ulang atau isi manual oleh inspector.', confidence: 'low' };
      adjustments.push(`#${it.no}: tidak dijawab AI → tidak`);
    }
  }
  // Pengaman server untuk item measure: angka di luar batas tidak boleh "ya".
  for (const lim of LIMITS[input.product.id] ?? []) {
    const v = input.measures[lim.key];
    const cur = items[lim.item];
    if (!cur) continue;
    if (v === null || v === undefined) {
      if (cur.verdict === 'ya') {
        items[lim.item] = { ...cur, verdict: 'tidak', reason: `${cur.reason} Pengukuran tidak diisi.`.trim(), missing: cur.missing || 'Isi angka pengukuran.', evidenceSource: 'none' };
        adjustments.push(`#${lim.item}: tanpa angka pengukuran → tidak`);
      }
    } else if (!lim.ok(v, input.measures) && cur.verdict !== 'tidak') {
      items[lim.item] = { ...cur, verdict: 'tidak', reason: `Hasil ukur ${v} di luar batas (${lim.label}).`, evidenceSource: 'measure', confidence: 'high' };
      adjustments.push(`#${lim.item}: hasil ukur ${v} di luar batas → tidak`);
    }
  }
  return {
    items,
    ai: {
      model: used,
      analyzedAt: Date.now(),
      summary: typeof data.summary === 'string' ? data.summary.trim() : '',
      risks: strArr(data.risks),
      recommendations: strArr(data.recommendations),
      missingEvidence: strArr(data.missingEvidence),
      photoCount: input.images.length,
      adjustments,
    },
  };
}
