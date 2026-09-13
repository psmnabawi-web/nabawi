import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { SCORE_RUBRIC } from '../scoring';
import type { AiResult } from '../types';
import { HttpError } from '../utils';

/**
 * Analisa foto kebersihan dengan Claude (vision + structured output).
 * Model default: claude-opus-5. Ganti lewat env AI_MODEL (mis. claude-sonnet-5 untuk biaya lebih rendah).
 */
const MODEL = process.env.AI_MODEL || 'claude-opus-5';

const ResultSchema = z.object({
  photoValid: z
    .boolean()
    .describe('true jika foto jelas dan benar-benar memperlihatkan area yang diaudit; false jika buram, gelap, salah objek, atau tidak bisa dinilai.'),
  photoIssue: z
    .string()
    .nullable()
    .describe('Alasan foto tidak valid (Bahasa Indonesia, singkat). null jika valid.'),
  score: z
    .number()
    .int()
    .min(1)
    .max(5)
    .nullable()
    .describe('Skor 1-5 sesuai rubrik. null jika photoValid=false.'),
  findings: z
    .string()
    .describe('Ringkasan temuan audit 1-3 kalimat, Bahasa Indonesia, gaya laporan lapangan. Sebutkan kondisi aktual yang terlihat.'),
  issues: z
    .array(z.string())
    .describe('Daftar temuan spesifik yang TIDAK memenuhi standar (kosong jika tidak ada). Setiap item singkat dan konkret.'),
  metCriteria: z
    .array(z.string())
    .describe('Daftar kriteria standar yang terlihat TERPENUHI di foto.'),
  recommendation: z
    .string()
    .describe('Tindakan perbaikan konkret untuk crew (1-2 kalimat). Jika skor 5, tulis "Pertahankan kondisi."'),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe('Keyakinan penilaian berdasarkan kejelasan foto dan seberapa banyak bagian area yang terlihat.'),
});

const SYSTEM_PROMPT = `Anda adalah auditor kebersihan (cleaning & sanitation) restoran cepat saji yang berpengalaman dan tegas.
Tugas Anda: menilai SATU foto area store terhadap standar bersih yang diberikan, lalu memberi skor 1-5.

Rubrik skor:
${SCORE_RUBRIC.map((r) => `${r.score} = ${r.label}: ${r.desc}`).join('\n')}

Prinsip penilaian:
- Nilai hanya dari apa yang terlihat di foto. Jangan berasumsi bagian yang tidak terlihat bersih.
- Kriteria yang tidak bisa diverifikasi dari foto (bau, bunyi, getaran, aliran air) jangan dijadikan temuan; sebutkan di findings bahwa perlu dicek manual jika relevan.
- Grease/lemak, kerak, jamur, sisa makanan, sampah, genangan, tanda hama, dan barang menyentuh lantai adalah temuan berat (skor maksimal 2).
- Debu tipis, sidik jari, bekas selotip, atau 1 noda kecil adalah temuan minor (skor 4).
- Beberapa temuan minor sekaligus, atau noda/kotoran yang jelas terlihat namun tidak menumpuk = skor 3.
- Jika foto buram, terlalu gelap, terlalu jauh, atau tidak memperlihatkan area yang diminta, set photoValid=false dan score=null.
- Bahasa: Indonesia, ringkas, konkret, tanpa basa-basi. Gunakan istilah lapangan (grease, kerak, noda, debu, sampah, genangan).`;

export interface AnalyzeInput {
  imageBase64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  area: string;
  category: string;
  standard: string;
  crewNote?: string | null;
}

let client: Anthropic | null = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new HttpError(500, 'ANTHROPIC_API_KEY belum diisi di environment server.');
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 });
  return client;
}

export async function analyzeCleanliness(input: AnalyzeInput): Promise<AiResult> {
  const anthropic = getClient();

  const userText = [
    `Kategori area: ${input.category}`,
    `Area yang diaudit: ${input.area}`,
    `Standar bersih / kondisi ideal: ${input.standard}`,
    input.crewNote ? `Catatan crew: ${input.crewNote}` : null,
    '',
    'Nilai foto ini terhadap standar di atas dan isi seluruh field output.',
  ]
    .filter((l) => l !== null)
    .join('\n');

  let response;
  try {
    response = await anthropic.beta.messages.parse({
      model: MODEL,
      max_tokens: 2048,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      output_config: { format: betaZodOutputFormat(ResultSchema), effort: 'medium' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.imageBase64 } },
            { type: 'text', text: userText },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new HttpError(429, 'Layanan AI sedang sibuk. Coba lagi beberapa detik.');
    }
    if (err instanceof Anthropic.AuthenticationError) {
      throw new HttpError(500, 'ANTHROPIC_API_KEY tidak valid.');
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new HttpError(503, 'Tidak dapat terhubung ke layanan AI. Periksa koneksi server.');
    }
    if (err instanceof Anthropic.APIError) {
      throw new HttpError(502, `Layanan AI error: ${err.message}`);
    }
    throw err;
  }

  if (response.stop_reason === 'refusal') {
    throw new HttpError(422, 'AI menolak menganalisa foto ini. Ambil ulang foto area yang relevan.');
  }
  const parsed = response.parsed_output;
  if (!parsed) {
    throw new HttpError(502, 'AI tidak mengembalikan hasil terstruktur. Coba analisa ulang.');
  }

  const valid = parsed.photoValid && parsed.score !== null;
  return {
    photoValid: valid,
    photoIssue: valid ? null : parsed.photoIssue ?? 'Foto tidak dapat dinilai.',
    score: valid ? parsed.score : null,
    findings: parsed.findings,
    issues: parsed.issues,
    metCriteria: parsed.metCriteria,
    recommendation: parsed.recommendation,
    confidence: parsed.confidence,
    model: response.model,
    analyzedAt: Date.now(),
  };
}
