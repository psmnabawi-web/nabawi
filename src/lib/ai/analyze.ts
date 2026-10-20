import 'server-only';
import { loadAiSettings } from '../server/aiSettings';
import type { AiResult, AiSettings } from '../types';
import { analyzeWithAnthropic } from './anthropic';
import { RESPONSE_SCHEMA } from './google';
import { buildUserText, imageLabel, SYSTEM_PROMPT, type AnalyzeInput, type RawAiOutput } from './prompt';
import { generateJson } from './provider';
import { normalizeCleanliness } from './shared';
import { HttpError } from '../utils';

export type { AnalyzeInput } from './prompt';

/** Jawaban model yang menandakan gambar tidak sampai ke model (gateway memotong/menyaring, kuota habis, model teks). */
const NO_IMAGE_PATTERNS = [/konten gambar tidak tersedia/i, /gambar tidak tersedia/i, /terfilter/i, /tidak ada gambar/i, /tidak menerima gambar/i, /tidak dapat melihat gambar/i, /no image/i, /image (was )?not provided/i, /cannot see (the )?image/i, /unable to view/i, /tidak dapat mengakses gambar/i];

/** Temuan berat yang tidak boleh lolos apa pun skor modelnya: hama, dan kotoran yang secara eksplisit menumpuk/tebal/meluas. */
const HEAVY_PATTERNS = [/tikus/i, /kecoa/i, /hama/i, /belatung/i, /lalat banyak/i, /(grease|lemak|kerak|jamur|sisa makanan|sampah|genangan|debu)[^.|]*(menumpuk|tebal|meluas|banyak|menggenang|tercecer)/i, /(menumpuk|tebal|meluas)[^.|]*(grease|lemak|kerak|jamur|sisa makanan|sampah|debu)/i];

/**
 * Pengaman di sisi server (versi longgar, setelah kalibrasi lapangan):
 * - coverage "unclear" (mayoritas area tidak terlihat / zoom sempit) -> maks 3
 * - temuan berat eksplisit (hama, kotoran menumpuk) -> maks 2
 * - skor 5 dengan temuan non-minor -> 4
 * Temuan kosmetik "(minor)" tidak menurunkan skor. Setiap penyesuaian dicatat di `adjustments`.
 */
export function applyStrictness(raw: RawAiOutput): RawAiOutput & { adjustments: string[] } {
  const adjustments: string[] = [];
  if (!raw.photoValid || raw.score === null) return { ...raw, adjustments };
  let score = raw.score;
  const nonMinor = raw.issues.filter((i) => !/^\s*\(?minor\)?/i.test(i) && !/kondisi aus/i.test(i) && !/perlu dicek manual/i.test(i));
  const issuesText = nonMinor.join(' | ');
  const cap = (max: number, reason: string) => {
    if (score > max) {
      adjustments.push(`${reason}: skor ${score} → ${max}`);
      score = max;
    }
  };
  if (raw.coverage === 'unclear') cap(3, 'Mayoritas area tidak terlihat di foto');
  if (nonMinor.length > 0) {
    if (HEAVY_PATTERNS.some((re) => re.test(issuesText))) cap(2, 'Ada temuan berat (hama / kotoran menumpuk)');
    else cap(4, 'Masih ada temuan yang perlu dibersihkan');
  }
  return { ...raw, score, adjustments };
}

function isProviderFault(e: unknown): boolean {
  if (!(e instanceof HttpError)) return true; // error jaringan/parsing tak terduga
  return e.status === 502 || e.status === 503 || e.status === 504 || e.status === 429 || (e.status === 400 && /provider ai menolak/i.test(e.message));
}

async function runOnce(input: AnalyzeInput, s: AiSettings): Promise<RawAiOutput> {
  if (s.provider === 'anthropic') return analyzeWithAnthropic(input, s.model || 'claude-opus-5');
  const { data, model, usage } = await generateJson(
    {
      systemInstruction: SYSTEM_PROMPT,
      images: input.images.map((img, i) => ({ base64: img.base64, mediaType: img.mediaType, label: imageLabel(i, input.images.length) })),
      text: buildUserText(input),
      schema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    },
    s,
  );
  const raw: RawAiOutput = { ...normalizeCleanliness(data, model), usage };
  // Gateway/provider yang tidak meneruskan gambar ke model: jangan dicatat sebagai "foto tidak valid" (itu kesalahan provider, bukan crew).
  if (!raw.photoValid && NO_IMAGE_PATTERNS.some((re) => re.test(raw.photoIssue ?? ''))) {
    console.error('[ai] provider tidak menerima gambar', JSON.stringify({ provider: s.provider, model: s.model, served: raw.model, issue: raw.photoIssue, usage }));
    throw new HttpError(502, `Layanan AI tidak menerima foto (model menjawab: "${(raw.photoIssue ?? '').slice(0, 120)}"). Ini masalah provider/kuota, bukan fotonya. Hubungi admin.`);
  }
  return raw;
}

/** Analisa kebersihan satu area dengan provider aktif (settings/ai, fallback env). `override` dipakai oleh uji mandiri. Bila model utama gagal/menolak foto dan ada konfigurasi cadangan, otomatis dicoba dengan cadangan. */
export async function analyzeCleanliness(input: AnalyzeInput, override?: AiSettings): Promise<AiResult> {
  const s = override ?? (await loadAiSettings());
  let raw: RawAiOutput;
  let fallbackUsed = false;
  try {
    raw = await runOnce(input, s);
  } catch (e) {
    const fb = s.fallback;
    if (!fb || !fb.model || !isProviderFault(e)) throw e;
    console.warn('[ai] model utama gagal, coba cadangan', JSON.stringify({ primary: s.model, fallback: fb.model, reason: e instanceof Error ? e.message.slice(0, 160) : String(e) }));
    const fs: AiSettings = { ...s, provider: fb.provider ?? s.provider, model: fb.model, baseUrl: fb.baseUrl || s.baseUrl, apiKey: fb.apiKey || s.apiKey, extraBody: fb.extraBody ?? {}, fallback: null };
    raw = await runOnce(input, fs);
    fallbackUsed = true;
  }
  const strict = applyStrictness(raw);
  return { ...strict, photoCount: input.images.length, analyzedAt: Date.now(), fallbackUsed };
}
