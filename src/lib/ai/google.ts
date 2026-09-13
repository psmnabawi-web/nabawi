import 'server-only';
import { ApiError, GoogleGenAI, type GoogleGenAIOptions } from '@google/genai';
import { HttpError } from '../utils';
import { buildUserText, SYSTEM_PROMPT, type AnalyzeInput, type RawAiOutput } from './prompt';

/**
 * Provider Google:
 * - Gemini Developer API (AI Studio, ada free tier)  -> GEMINI_API_KEY
 * - Vertex AI (billing GCP, ADC / service account)   -> GOOGLE_GENAI_USE_VERTEXAI=true + GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION
 * Model default: gemini-2.5-flash (ganti via AI_MODEL).
 */
export const GOOGLE_DEFAULT_MODEL = 'gemini-2.5-flash';

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
    recommendation: { type: 'string', description: 'Tindakan perbaikan konkret untuk crew (1-2 kalimat). Jika skor 5 tulis "Pertahankan kondisi."' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Keyakinan penilaian berdasarkan kejelasan foto.' },
  },
  required: ['photoValid', 'photoIssue', 'score', 'findings', 'issues', 'metCriteria', 'recommendation', 'confidence'],
  propertyOrdering: ['photoValid', 'photoIssue', 'score', 'findings', 'issues', 'metCriteria', 'recommendation', 'confidence'],
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

const RETRY_DELAYS_MS = [12_000, 24_000]; // free tier Gemini dibatasi per menit; tunggu lalu coba lagi

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function analyzeWithGoogle(input: AnalyzeInput, model: string): Promise<RawAiOutput> {
  const ai = getClient();
  const request = {
    model,
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: input.mediaType, data: input.imageBase64 } }, { text: buildUserText(input) }],
      },
    ],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseJsonSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
      maxOutputTokens: 2048,
    },
  };

  let lastErr: unknown = null;
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
      if (!text) throw new HttpError(502, 'AI tidak mengembalikan hasil. Coba analisa ulang.');
      return normalize(parseJson(text), response.modelVersion ?? model);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err instanceof ApiError) {
        if (err.status === 429 && attempt < RETRY_DELAYS_MS.length) {
          lastErr = err;
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        if (err.status === 429) throw new HttpError(429, 'Kuota AI (free tier) sementara habis. Tunggu 1 menit lalu coba lagi, atau tingkatkan kuota di Google AI Studio.');
        if (err.status === 401 || err.status === 403) throw new HttpError(500, 'Kredensial Google AI tidak valid atau API belum diaktifkan.');
        if (err.status === 404) throw new HttpError(500, `Model ${model} tidak ditemukan di provider Google. Cek AI_MODEL.`);
        throw new HttpError(502, `Layanan AI Google error (${err.status}): ${err.message}`);
      }
      throw err;
    }
  }
  throw new HttpError(429, `Kuota AI habis: ${lastErr instanceof Error ? lastErr.message : 'rate limit'}`);
}

function parseJson(text: string): Record<string, unknown> {
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
  return {
    photoValid,
    photoIssue: photoValid ? null : (typeof o.photoIssue === 'string' && o.photoIssue.trim()) || 'Foto tidak dapat dinilai.',
    score: photoValid ? score : null,
    findings: typeof o.findings === 'string' ? o.findings.trim() : '',
    issues: strArr(o.issues),
    metCriteria: strArr(o.metCriteria),
    recommendation: typeof o.recommendation === 'string' ? o.recommendation.trim() : '',
    confidence: conf,
    model,
  };
}
