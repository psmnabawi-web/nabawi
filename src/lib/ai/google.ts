import 'server-only';
import { ApiError, GoogleGenAI, MediaResolution, ThinkingLevel, type GoogleGenAIOptions } from '@google/genai';
import { HttpError } from '../utils';
import { buildUserText, imageLabel, SYSTEM_PROMPT, type AnalyzeInput, type RawAiOutput } from './prompt';

/**
 * Provider Google:
 * - Gemini Developer API (AI Studio, ada free tier)  -> GEMINI_API_KEY
 * - Vertex AI (billing GCP, ADC / service account)   -> GOOGLE_GENAI_USE_VERTEXAI=true + GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION
 * Model default: gemini-3.6-flash (ganti via AI_MODEL). gemini-2.5-* sudah ditutup untuk user baru sejak 2026.
 */
export const GOOGLE_DEFAULT_MODEL = 'gemini-3.6-flash';

// JSON Schema ditulis manual (subset yang didukung Gemini: type, enum, minimum, maximum, items, required, propertyOrdering).
// score = 0 berarti foto tidak valid (Gemini structured output tidak menerima nullable secara konsisten).
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    photoValid: { type: 'boolean', description: 'true jika foto jelas dan memperlihatkan area yang diaudit; false jika buram, gelap, salah objek, atau tidak bisa dinilai.' },
    photoIssue: { type: 'string', description: 'Alasan foto tidak valid (Bahasa Indonesia, singkat). Kosongkan jika valid.' },
    score: { type: 'integer', minimum: 0, maximum: 5, description: 'Skor 1-5 sesuai rubrik. Isi 0 jika photoValid=false.' },
    findings: { type: 'string', description: 'Ringkasan temuan 1-3 kalimat, Bahasa Indonesia, gaya laporan lapangan.' },
    issues: { type: 'array', items: { type: 'string' }, description: 'Temuan spesifik yang TIDAK memenuhi standar (kosong jika tidak ada).' },
    metCriteria: { type: 'array', items: { type: 'string' }, description: 'Kriteria standar yang terlihat TERPENUHI di foto.' },
    recommendation: { type: 'string', description: 'Ringkasan tindakan perbaikan (1-2 kalimat). Jika skor 5 tulis "Pertahankan kondisi."' },
    coverage: { type: 'string', enum: ['full', 'partial', 'unclear'], description: 'full = seluruh area terlihat jelas & dekat; partial = ada bagian tidak terlihat/terlalu jauh/terlalu zoom/tertutup; unclear = tidak bisa dipastikan.' },
    hiddenZones: { type: 'array', items: { type: 'string' }, description: 'Bagian area yang tidak terlihat di foto dan wajib difoto (kosong jika coverage=full).' },
    actionPlan: {
      type: 'array',
      description: 'Langkah perbaikan berurutan dan rinci agar skor mencapai batas lolos. Kosong jika sudah lolos.',
      items: {
        type: 'object',
        properties: {
          step: { type: 'string', description: 'Judul langkah singkat, mis. "Kerok grease tebal".' },
          detail: { type: 'string', description: 'Cara mengerjakan secara spesifik: bagian mana, gerakan, arah, durasi, apa yang dilepas.' },
          tool: { type: 'string', description: 'Alat dan bahan yang dipakai.' },
          check: { type: 'string', description: 'Cara memastikan langkah ini selesai.' },
        },
        required: ['step', 'detail', 'tool', 'check'],
        propertyOrdering: ['step', 'detail', 'tool', 'check'],
      },
    },
    passChecklist: { type: 'array', items: { type: 'string' }, description: 'Ciri visual yang harus terlihat di foto ulang agar lolos, termasuk cara memotret. Kosong jika sudah lolos.' },
    estimatedMinutes: { type: 'integer', minimum: 0, maximum: 600, description: 'Perkiraan total menit pengerjaan. 0 jika sudah lolos.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Keyakinan penilaian berdasarkan kejelasan foto.' },
  },
  required: ['photoValid', 'photoIssue', 'score', 'findings', 'issues', 'metCriteria', 'recommendation', 'coverage', 'hiddenZones', 'actionPlan', 'passChecklist', 'estimatedMinutes', 'confidence'],
  propertyOrdering: ['photoValid', 'photoIssue', 'score', 'findings', 'issues', 'metCriteria', 'recommendation', 'coverage', 'hiddenZones', 'actionPlan', 'passChecklist', 'estimatedMinutes', 'confidence'],
} as const;

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (client) return client;
  const useVertex = (process.env.GOOGLE_GENAI_USE_VERTEXAI ?? '').toLowerCase() === 'true';
  if (useVertex) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const sa = raw ? (JSON.parse(raw) as ServiceAccount) : null;
    const project = process.env.GOOGLE_CLOUD_PROJECT || sa?.project_id || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
    if (!project) throw new HttpError(500, 'GOOGLE_CLOUD_PROJECT belum diisi untuk Vertex AI.');
    const opts: GoogleGenAIOptions = { vertexai: true, project, location };
    // Lokal: pakai service account yang sama dengan Firebase Admin. Di App Hosting/Cloud Run: ADC otomatis.
    if (sa) opts.googleAuthOptions = { credentials: { client_email: sa.client_email, private_key: sa.private_key.replace(/\\n/g, '\n') } };
    client = new GoogleGenAI(opts);
  } else {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new HttpError(500, 'GEMINI_API_KEY belum diisi (ambil di Google AI Studio) atau set GOOGLE_GENAI_USE_VERTEXAI=true.');
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

const RETRY_DELAYS_MS = [8_000, 16_000, 30_000]; // free tier Gemini dibatasi per menit (TPM/RPM); tunggu lalu coba lagi

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Gerbang konkurensi per instance: free tier dibatasi token per menit, jadi panggilan dari banyak store diantrekan, bukan ditolak. */
const MAX_CONCURRENT = Number(process.env.AI_MAX_CONCURRENT || 2);
const QUEUE_TIMEOUT_MS = 90_000;
let running = 0;
const waiters: Array<() => void> = [];
async function acquire(): Promise<() => void> {
  if (running < MAX_CONCURRENT) {
    running += 1;
  } else {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        const i = waiters.indexOf(resolve);
        if (i >= 0) waiters.splice(i, 1);
        reject(new HttpError(429, 'Antrean analisa AI penuh. Tunggu 1 menit lalu coba lagi.'));
      }, QUEUE_TIMEOUT_MS);
      waiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
    running += 1;
  }
  return () => {
    running -= 1;
    const next = waiters.shift();
    if (next) next();
  };
}

/** Ringkasan skema JSON yang hemat token untuk model tanpa structured output (Gemma). */
function schemaGuide(schema: Record<string, unknown>, indent = ''): string {
  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const lines: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    const type = v.type === 'array' ? `array<${((v.items as Record<string, unknown>)?.type as string) ?? 'string'}>` : String(v.type);
    const en = Array.isArray(v.enum) ? ` salah satu: ${(v.enum as string[]).join('|')}` : '';
    const desc = typeof v.description === 'string' ? ` — ${v.description}` : '';
    lines.push(`${indent}- ${k} (${type})${en}${desc}`);
    const items = v.items as Record<string, unknown> | undefined;
    if (items && items.type === 'object') lines.push(schemaGuide(items, indent + '  '));
  }
  return lines.join('\n');
}

export interface GeminiUsage {
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
}

/** Pengaturan hemat biaya lewat env (tanpa ubah kode): AI_THINKING_LEVEL, AI_MEDIA_RESOLUTION, AI_MAX_OUTPUT_TOKENS. */
export function thinkingLevelFromEnv(def: ThinkingLevel = ThinkingLevel.HIGH): ThinkingLevel {
  const v = (process.env.AI_THINKING_LEVEL ?? '').toLowerCase();
  return v === 'minimal' ? ThinkingLevel.MINIMAL : v === 'low' ? ThinkingLevel.LOW : v === 'medium' ? ThinkingLevel.MEDIUM : v === 'high' ? ThinkingLevel.HIGH : def;
}
export function mediaResolutionFromEnv(def: MediaResolution = MediaResolution.MEDIA_RESOLUTION_HIGH): MediaResolution {
  const v = (process.env.AI_MEDIA_RESOLUTION ?? '').toLowerCase();
  return v === 'low' ? MediaResolution.MEDIA_RESOLUTION_LOW : v === 'medium' ? MediaResolution.MEDIA_RESOLUTION_MEDIUM : v === 'high' ? MediaResolution.MEDIA_RESOLUTION_HIGH : def;
}
/** Model Gemma (gratis di Gemini API) tidak mendukung systemInstruction, thinking, mediaResolution, dan JSON schema: prompt digabung, JSON diminta lewat teks. */
export function isGemmaModel(model: string) {
  return /^gemma/i.test(model);
}

export interface GeminiJsonRequest {
  model: string;
  systemInstruction: string;
  /** Urutan parts: label + gambar, lalu teks. */
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
  thinkingLevel?: ThinkingLevel;
}

/**
 * Panggilan generik Gemini dengan structured output (JSON schema), retry rate-limit, dan pemetaan error.
 * Dipakai oleh analisa kebersihan dan audit kualitas produk.
 */
export async function generateJsonWithGoogle(req: GeminiJsonRequest): Promise<{ data: Record<string, unknown>; model: string; usage: GeminiUsage }> {
  const ai = getClient();
  const gemma = isGemmaModel(req.model);
  const maxOutputTokens = req.maxOutputTokens ?? Number(process.env.AI_MAX_OUTPUT_TOKENS || 16384); // termasuk token thinking pada Gemini 3.x
  const request = gemma
    ? {
        model: req.model,
        contents: [{ role: 'user', parts: [{ text: `${req.systemInstruction}\n\nFORMAT JAWABAN: hanya satu objek JSON valid (tanpa teks lain, tanpa code fence, tanpa komentar) dengan field berikut, semua wajib diisi:\n${schemaGuide(req.schema)}` }, ...req.parts] }],
        config: { temperature: 0, maxOutputTokens: Math.min(maxOutputTokens, 8192) },
      }
    : {
        model: req.model,
        contents: [{ role: 'user', parts: req.parts }],
        config: {
          systemInstruction: req.systemInstruction,
          responseMimeType: 'application/json',
          responseJsonSchema: req.schema,
          temperature: 0,
          // resolusi media & thinking bisa diturunkan lewat env untuk menghemat token (default HIGH/HIGH)
          mediaResolution: mediaResolutionFromEnv(),
          thinkingConfig: { thinkingLevel: req.thinkingLevel ?? thinkingLevelFromEnv() },
          maxOutputTokens,
        },
      };

  let lastErr: unknown = null;
  const release = await acquire();
  try {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await ai.models.generateContent(request);
      const block = response.promptFeedback?.blockReason;
      if (block) throw new HttpError(422, `AI menolak foto ini (${block}). Ambil ulang foto area yang relevan.`);
      const finish = response.candidates?.[0]?.finishReason;
      if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS') {
        throw new HttpError(422, `AI menghentikan analisa (${finish}). Coba foto ulang.`);
      }
      const text = response.text;
      if (!text) {
        console.error('[ai/google] respons kosong', JSON.stringify({ finish, usage: response.usageMetadata }));
        throw new HttpError(502, 'AI tidak mengembalikan hasil. Coba analisa ulang.');
      }
      const u = response.usageMetadata;
      const usage: GeminiUsage = { promptTokens: u?.promptTokenCount ?? 0, outputTokens: u?.candidatesTokenCount ?? 0, thoughtTokens: u?.thoughtsTokenCount ?? 0, totalTokens: u?.totalTokenCount ?? 0 };
      try {
        return { data: parseJson(text), model: response.modelVersion ?? req.model, usage };
      } catch (e) {
        console.error('[ai/google] output bukan JSON', JSON.stringify({ finish, usage: response.usageMetadata, head: text.slice(0, 400) }));
        if (finish === 'MAX_TOKENS') throw new HttpError(502, 'Output AI terpotong (batas token). Coba analisa ulang.');
        throw e;
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err instanceof ApiError) {
        const msg = err.message ?? '';
        // Free tier: 429 "exceeded your current quota ... billing details" adalah rate limit, bukan kredit habis. Kredit habis hanya jika menyebut prepay/credit.
        const billingIssue = /prepay|credits? (are|is) depleted|insufficient credit/i.test(msg);
        if (err.status === 429 && billingIssue) {
          throw new HttpError(402, `Kredit Gemini API habis. Isi ulang / cek di https://ai.studio/projects. Pesan Google: ${msg}`);
        }
        if (err.status === 403 && /denied access/i.test(msg)) throw new HttpError(500, 'Proyek API key Gemini diblokir Google. Buat API key baru di AI Studio (proyek baru tanpa billing).');
        if (err.status === 429 && attempt < RETRY_DELAYS_MS.length) {
          lastErr = err;
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        if (err.status === 429) throw new HttpError(429, 'AI sedang penuh (batas gratis per menit tercapai). Tunggu 1 menit lalu tekan Analisa lagi.');
        if (err.status === 401 || err.status === 403) throw new HttpError(500, 'Kredensial Google AI tidak valid atau API belum diaktifkan.');
        if (err.status === 404) throw new HttpError(500, `Model ${req.model} tidak ditemukan di provider Google. Cek AI_MODEL.`);
        throw new HttpError(502, `Layanan AI Google error (${err.status}): ${err.message}`);
      }
      throw err;
    }
  }
  console.warn('[ai/google] rate limit setelah retry', lastErr instanceof Error ? lastErr.message.slice(0, 200) : lastErr);
  throw new HttpError(429, 'AI sedang penuh (batas gratis per menit). Tunggu 1 menit lalu coba lagi.');
  } finally {
    release();
  }
}

export async function analyzeWithGoogle(input: AnalyzeInput, model: string): Promise<RawAiOutput> {
  const { data, model: used, usage } = await generateJsonWithGoogle({
    model,
    systemInstruction: SYSTEM_PROMPT,
    parts: [
      ...input.images.flatMap((img, i) => [{ text: imageLabel(i, input.images.length) }, { inlineData: { mimeType: img.mediaType, data: img.base64 } }]),
      { text: buildUserText(input) },
    ],
    schema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
  });
  return { ...normalize(data, used), usage };
}

function parseJson(raw: string): Record<string, unknown> {
  const text = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // buang code fence jika model membungkus JSON
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as Record<string, unknown>;
      } catch {
        /* fallthrough */
      }
    }
    throw new HttpError(502, 'Output AI bukan JSON valid. Coba analisa ulang.');
  }
}

function normalize(o: Record<string, unknown>, model: string): RawAiOutput {
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : []);
  const scoreRaw = typeof o.score === 'number' ? Math.round(o.score) : Number(o.score);
  const score = Number.isFinite(scoreRaw) && scoreRaw >= 1 && scoreRaw <= 5 ? scoreRaw : null;
  const photoValid = o.photoValid === true && score !== null;
  const conf = o.confidence === 'high' || o.confidence === 'medium' || o.confidence === 'low' ? o.confidence : 'medium';
  const plan = Array.isArray(o.actionPlan)
    ? o.actionPlan
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map((x) => ({
          step: typeof x.step === 'string' ? x.step.trim() : '',
          detail: typeof x.detail === 'string' ? x.detail.trim() : '',
          tool: typeof x.tool === 'string' ? x.tool.trim() : '',
          check: typeof x.check === 'string' ? x.check.trim() : '',
        }))
        .filter((x) => x.step || x.detail)
    : [];
  const minutes = typeof o.estimatedMinutes === 'number' && Number.isFinite(o.estimatedMinutes) ? Math.max(0, Math.round(o.estimatedMinutes)) : null;
  return {
    photoValid,
    photoIssue: photoValid ? null : (typeof o.photoIssue === 'string' && o.photoIssue.trim()) || 'Foto tidak dapat dinilai.',
    score: photoValid ? score : null,
    findings: typeof o.findings === 'string' ? o.findings.trim() : '',
    issues: strArr(o.issues),
    metCriteria: strArr(o.metCriteria),
    recommendation: typeof o.recommendation === 'string' ? o.recommendation.trim() : '',
    coverage: o.coverage === 'full' || o.coverage === 'partial' || o.coverage === 'unclear' ? o.coverage : 'unclear',
    hiddenZones: strArr(o.hiddenZones),
    actionPlan: plan,
    passChecklist: strArr(o.passChecklist),
    estimatedMinutes: minutes,
    confidence: conf,
    model,
  };
}
