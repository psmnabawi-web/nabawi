import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { HttpError } from '../utils';
import { buildUserText, SYSTEM_PROMPT, type AnalyzeInput, type RawAiOutput } from './prompt';

/** Provider Anthropic (Claude vision). Aktif jika AI_PROVIDER=anthropic. */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5';

const ResultSchema = z.object({
  photoValid: z.boolean().describe('true jika foto jelas dan benar-benar memperlihatkan area yang diaudit; false jika buram, gelap, salah objek, atau tidak bisa dinilai.'),
  photoIssue: z.string().nullable().describe('Alasan foto tidak valid (Bahasa Indonesia, singkat). null jika valid.'),
  score: z.number().int().min(1).max(5).nullable().describe('Skor 1-5 sesuai rubrik. null jika photoValid=false.'),
  findings: z.string().describe('Ringkasan temuan audit 1-3 kalimat, Bahasa Indonesia, gaya laporan lapangan.'),
  issues: z.array(z.string()).describe('Daftar temuan spesifik yang TIDAK memenuhi standar (kosong jika tidak ada).'),
  metCriteria: z.array(z.string()).describe('Daftar kriteria standar yang terlihat TERPENUHI di foto.'),
  recommendation: z.string().describe('Tindakan perbaikan konkret untuk crew (1-2 kalimat). Jika skor 5, tulis "Pertahankan kondisi."'),
  confidence: z.enum(['high', 'medium', 'low']).describe('Keyakinan penilaian berdasarkan kejelasan foto.'),
});

let client: Anthropic | null = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(500, 'ANTHROPIC_API_KEY belum diisi di environment server.');
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 });
  return client;
}

export async function analyzeWithAnthropic(input: AnalyzeInput, model: string): Promise<RawAiOutput> {
  const anthropic = getClient();
  let response;
  try {
    response = await anthropic.beta.messages.parse({
      model,
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
            { type: 'text', text: buildUserText(input) },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Layanan AI sedang sibuk. Coba lagi beberapa detik.');
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(500, 'ANTHROPIC_API_KEY tidak valid.');
    if (err instanceof Anthropic.APIConnectionError) throw new HttpError(503, 'Tidak dapat terhubung ke layanan AI. Periksa koneksi server.');
    if (err instanceof Anthropic.APIError) throw new HttpError(502, `Layanan AI error: ${err.message}`);
    throw err;
  }

  if (response.stop_reason === 'refusal') throw new HttpError(422, 'AI menolak menganalisa foto ini. Ambil ulang foto area yang relevan.');
  const parsed = response.parsed_output;
  if (!parsed) throw new HttpError(502, 'AI tidak mengembalikan hasil terstruktur. Coba analisa ulang.');

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
  };
}
