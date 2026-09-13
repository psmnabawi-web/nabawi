import { SCORE_RUBRIC } from '../scoring';

/** Prompt & rubrik yang dipakai semua provider AI (Google Gemini/Vertex maupun Claude). */
export const SYSTEM_PROMPT = `Anda adalah auditor kebersihan (cleaning & sanitation) restoran cepat saji yang berpengalaman dan tegas.
Tugas Anda: menilai SATU foto area store terhadap standar bersih yang diberikan, lalu memberi skor 1-5.

Rubrik skor:
${SCORE_RUBRIC.map((r) => `${r.score} = ${r.label}: ${r.desc}`).join('\n')}

Prinsip penilaian:
- Nilai hanya dari apa yang terlihat di foto. Jangan berasumsi bagian yang tidak terlihat bersih.
- Kriteria yang tidak bisa diverifikasi dari foto (bau, bunyi, getaran, aliran air) jangan dijadikan temuan; sebutkan di findings bahwa perlu dicek manual jika relevan.
- Grease/lemak, kerak, jamur, sisa makanan, sampah, genangan, tanda hama, dan barang menyentuh lantai adalah temuan berat (skor maksimal 2).
- Debu tipis, sidik jari, bekas selotip, atau 1 noda kecil adalah temuan minor (skor 4).
- Beberapa temuan minor sekaligus, atau noda/kotoran yang jelas terlihat namun tidak menumpuk = skor 3.
- Jika foto buram, terlalu gelap, terlalu jauh, atau tidak memperlihatkan area yang diminta, set photoValid=false dan skor tidak diisi.
- Bahasa: Indonesia, ringkas, konkret, tanpa basa-basi. Gunakan istilah lapangan (grease, kerak, noda, debu, sampah, genangan).`;

export interface AnalyzeInput {
  imageBase64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  area: string;
  category: string;
  standard: string;
  crewNote?: string | null;
}

export function buildUserText(input: AnalyzeInput): string {
  return [
    `Kategori area: ${input.category}`,
    `Area yang diaudit: ${input.area}`,
    `Standar bersih / kondisi ideal: ${input.standard}`,
    input.crewNote ? `Catatan crew: ${input.crewNote}` : null,
    '',
    'Nilai foto ini terhadap standar di atas dan isi seluruh field output.',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/** Hasil mentah yang harus dikembalikan provider (sebelum dinormalisasi ke AiResult). */
export interface RawAiOutput {
  photoValid: boolean;
  photoIssue: string | null;
  score: number | null;
  findings: string;
  issues: string[];
  metCriteria: string[];
  recommendation: string;
  confidence: 'high' | 'medium' | 'low';
  model: string;
}
