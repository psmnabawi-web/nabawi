import { MIN_SUBMIT_PCT, MIN_SUBMIT_SCORE, SCORE_RUBRIC } from '../scoring';

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
- Bahasa: Indonesia, ringkas, konkret, tanpa basa-basi. Gunakan istilah lapangan (grease, kerak, noda, debu, sampah, genangan).

Batas lolos: area hanya boleh di-submit crew jika skor >= ${MIN_SUBMIT_SCORE} (${MIN_SUBMIT_PCT}%).
Jika skor < ${MIN_SUBMIT_SCORE} ATAU foto tidak valid, WAJIB isi actionPlan dan passChecklist secara rinci agar crew bisa mencapai skor >= ${MIN_SUBMIT_SCORE} pada foto berikutnya:
- actionPlan: 3-7 langkah BERURUTAN, spesifik untuk temuan di foto ini (bukan tips umum). Tiap langkah: step (judul singkat), detail (cara mengerjakan: gerakan, arah, berapa lama, apa yang dibongkar/dilepas), tool (alat & bahan yang lazim di restoran cepat saji: degreaser, sabun cuci piring, sikat kawat/nilon, scraper plastik, lap microfiber, spons, air panas, chemical sanitizer, sarung tangan), check (cara memastikan langkah itu selesai: raba tidak lengket, tidak ada bekas kuning, dst).
- Sertakan langkah keselamatan jika relevan (matikan kompor/gas, cabut listrik, tunggu dingin, pakai sarung tangan).
- passChecklist: 3-6 ciri visual yang HARUS terlihat di foto ulang (mis. "permukaan hood terlihat matte tanpa kilap minyak", "sudut sambungan tidak ada garis coklat", "lantai kering tanpa genangan"). Tulis juga cara mengambil foto agar terlihat jelas (jarak, sudut, pencahayaan).
- estimatedMinutes: perkiraan menit total yang realistis.
Jika foto tidak valid: actionPlan berisi cara mengambil ulang foto (posisi, jarak 1-2 meter, nyalakan lampu, hindari backlight, pastikan seluruh area masuk frame).
Jika skor >= ${MIN_SUBMIT_SCORE}: actionPlan kosong, passChecklist kosong, estimatedMinutes 0.`;

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
  actionPlan: { step: string; detail: string; tool: string; check: string }[];
  passChecklist: string[];
  estimatedMinutes: number | null;
  confidence: 'high' | 'medium' | 'low';
  model: string;
}
