import 'server-only';
import { ApiError, GoogleGenAI, MediaResolution, ThinkingLevel, type GoogleGenAIOptions } from '@google/genai';
import type { AiSettings } from '../types';
import { HttpError } from '../utils';
import { acquire, jsonFormatInstruction, parseJson, sleep, type AiUsage, type JsonRequest, type JsonResult } from './shared';

/**
 * Provider Google:
 * - Gemini Developer API (AI Studio, ada free tier)  -> GEMINI_API_KEY
 * - Vertex AI (billing GCP, ADC / service account)   -> GOOGLE_GENAI_USE_VERTEXAI=true + GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION
 * Model default: gemini-3.6-flash (ganti via AI_MODEL). gemini-2.5-* sudah ditutup untuk user baru sejak 2026.
 */
export const GOOGLE_DEFAULT_MODEL = 'gemini-3.6-flash';

// JSON Schema ditulis manual (subset yang didukung Gemini: type, enum, minimum, maximum, items, required, propertyOrdering).
// score = 0 berarti foto tidak valid (Gemini structured output tidak menerima nullable secara konsisten).
export const RESPONSE_SCHEMA = {
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

let client: { sig: string; ai: GoogleGenAI } | null = null;

function getClient(s: AiSettings): GoogleGenAI {
  const sig = `${s.useVertex ? 'vertex' : 'key'}:${s.apiKey}`;
  if (client && client.sig === sig) return client.ai;
  let ai: GoogleGenAI;
  if (s.useVertex) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const sa = raw ? (JSON.parse(raw) as ServiceAccount) : null;
    const project = process.env.GOOGLE_CLOUD_PROJECT || sa?.project_id || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';
    if (!project) throw new HttpError(500, 'GOOGLE_CLOUD_PROJECT belum diisi untuk Vertex AI.');
    const opts: GoogleGenAIOptions = { vertexai: true, project, location };
    if (sa) opts.googleAuthOptions = { credentials: { client_email: sa.client_email, private_key: sa.private_key.replace(/\\n/g, '\n') } };
    ai = new GoogleGenAI(opts);
  } else {
    if (!s.apiKey) throw new HttpError(500, 'API key Gemini belum diisi. Isi di menu Pengaturan AI.');
    ai = new GoogleGenAI({ apiKey: s.apiKey });
  }
  client = { sig, ai };
  return ai;
}

const RETRY_DELAYS_MS = [8_000, 16_000, 30_000]; // free tier dibatasi per menit (TPM/RPM); tunggu lalu coba lagi

export type { AiUsage as GeminiUsage } from './shared';

function thinkingLevel(v: string, def: ThinkingLevel = ThinkingLevel.HIGH): ThinkingLevel {
  return v === 'minimal' ? ThinkingLevel.MINIMAL : v === 'low' ? ThinkingLevel.LOW : v === 'medium' ? ThinkingLevel.MEDIUM : v === 'high' ? ThinkingLevel.HIGH : def;
}
function mediaResolution(v: string, def: MediaResolution = MediaResolution.MEDIA_RESOLUTION_HIGH): MediaResolution {
  return v === 'low' ? MediaResolution.MEDIA_RESOLUTION_LOW : v === 'medium' ? MediaResolution.MEDIA_RESOLUTION_MEDIUM : v === 'high' ? MediaResolution.MEDIA_RESOLUTION_HIGH : def;
}
/** Model Gemma (gratis di Gemini API) tidak mendukung systemInstruction, thinking, mediaResolution, dan JSON schema: prompt digabung, JSON diminta lewat teks. */
export function isGemmaModel(model: string) {
  return /^gemma/i.test(model);
}

/**
 * Panggilan Gemini/Gemma dengan structured output (JSON schema), retry rate-limit, dan pemetaan error.
 * Dipakai oleh analisa kebersihan dan audit kualitas produk lewat dispatcher generateJson().
 */
export async function generateJsonWithGoogle(req: JsonRequest, s: AiSettings): Promise<JsonResult> {
  const ai = getClient(s);
  const model = s.model || GOOGLE_DEFAULT_MODEL;
  const gemma = isGemmaModel(model);
  const maxOutputTokens = req.maxOutputTokens ?? Number(process.env.AI_MAX_OUTPUT_TOKENS || 16384); // termasuk token thinking pada Gemini 3.x
  const imageParts = req.images.flatMap((img) => [{ text: img.label }, { inlineData: { mimeType: img.mediaType, data: img.base64 } }]);
  const request = gemma
    ? {
        model,
        contents: [{ role: 'user', parts: [{ text: `${req.systemInstruction}\n\n${jsonFormatInstruction(req.schema)}` }, ...imageParts, { text: req.text }] }],
        config: { temperature: 0, maxOutputTokens: Math.min(maxOutputTokens, 8192) },
      }
    : {
        model,
        contents: [{ role: 'user', parts: [...imageParts, { text: req.text }] }],
        config: {
          systemInstruction: req.systemInstruction,
          responseMimeType: 'application/json',
          responseJsonSchema: req.schema,
          temperature: 0,
          mediaResolution: mediaResolution(s.mediaResolution),
          thinkingConfig: { thinkingLevel: thinkingLevel(s.thinkingLevel) },
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
        const usage: AiUsage = { promptTokens: u?.promptTokenCount ?? 0, outputTokens: u?.candidatesTokenCount ?? 0, thoughtTokens: u?.thoughtsTokenCount ?? 0, totalTokens: u?.totalTokenCount ?? 0 };
        try {
          return { data: parseJson(text), model: response.modelVersion ?? model, usage };
        } catch (e) {
          console.error('[ai/google] output bukan JSON', JSON.stringify({ finish, usage: response.usageMetadata, head: text.slice(0, 400) }));
          if (finish === 'MAX_TOKENS') throw new HttpError(502, 'Output AI terpotong (batas token). Coba analisa ulang.');
          throw e;
        }
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (err instanceof ApiError) {
          const msg = err.message ?? '';
          const billingIssue = /prepay|credits? (are|is) depleted|insufficient credit/i.test(msg);
          if (err.status === 429 && billingIssue) throw new HttpError(402, `Kredit Gemini API habis. Isi ulang / cek di https://ai.studio/projects. Pesan Google: ${msg}`);
          if (err.status === 403 && /denied access/i.test(msg)) throw new HttpError(500, 'Proyek API key Gemini diblokir Google. Buat API key baru di AI Studio (proyek baru tanpa billing).');
          if (err.status === 429 && attempt < RETRY_DELAYS_MS.length) {
            lastErr = err;
            await sleep(RETRY_DELAYS_MS[attempt]);
            continue;
          }
          if (err.status === 429) throw new HttpError(429, 'AI sedang penuh (batas per menit tercapai). Tunggu 1 menit lalu tekan Analisa lagi.');
          if (err.status === 401 || err.status === 403) throw new HttpError(500, 'Kredensial Google AI tidak valid atau API belum diaktifkan.');
          if (err.status === 404) throw new HttpError(500, `Model ${model} tidak ditemukan di provider Google. Cek pengaturan model.`);
          throw new HttpError(502, `Layanan AI Google error (${err.status}): ${err.message}`);
        }
        throw err;
      }
    }
    console.warn('[ai/google] rate limit setelah retry', lastErr instanceof Error ? lastErr.message.slice(0, 200) : lastErr);
    throw new HttpError(429, 'AI sedang penuh (batas per menit). Tunggu 1 menit lalu coba lagi.');
  } finally {
    release();
  }
}
