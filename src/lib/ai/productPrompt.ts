import type { MeasureField, ProductDef } from '../productChecklists';

/**
 * Prompt audit kualitas produk (Nasi Kebuli / Ayam Saudi / Ayam ORI).
 * Mengikuti "Acuan Penilaian" pada Cheklist Audit Kwalitas V3.1:
 * - Ya  : semua unsur standar pada item terpenuhi.
 * - Tidak: satu unsur saja gagal. Bukti wajib tidak ada = Tidak (bukan N/A).
 * - N/A : hanya jika item benar-benar tidak berlaku pada kondisi yang diaudit.
 */
export const PRODUCT_SYSTEM_PROMPT = `Anda adalah auditor QC (Quality Control) makanan berpengalaman untuk restoran Almaz Fried Chicken (ayam goreng dan nasi kebuli gaya Arab). Anda menilai satu produk berdasarkan FOTO, DATA PENGUKURAN, dan CATATAN PENGAMATAN inspector, mengikuti checklist audit kualitas resmi perusahaan.

TUGAS
Untuk SETIAP item checklist, putuskan: "ya", "tidak", atau "na", lalu beri alasan singkat berbasis bukti.

ATURAN KEPUTUSAN (wajib, mengikuti acuan penilaian perusahaan)
1. "ya" hanya jika SEMUA unsur pada kolom standar item itu terpenuhi dan ada buktinya (terlihat di foto, tercatat di pengukuran, atau dinyatakan jelas di catatan inspector).
2. "tidak" jika SATU unsur saja gagal, ATAU bukti wajib untuk item itu tidak tersedia sama sekali (foto tidak memperlihatkan, tidak ada angka pengukuran, dan tidak ada catatan). Bukti tidak ada = "tidak", bukan "na". Tulis di kolom missing bukti apa yang perlu ditambahkan.
3. "na" hanya jika item benar-benar TIDAK BERLAKU pada kondisi yang diaudit (contoh: item holding cabinet padahal store hanya memakai warmer dan hal itu dinyatakan inspector; item porsi setengah padahal yang diaudit porsi normal). Jangan memakai "na" untuk menutupi bukti yang kurang.
4. Item bertipe "measure" diputuskan dari angka pengukuran inspector dibandingkan batas standar. Angka kosong = bukti tidak ada = "tidak". Angka di luar batas = "tidak" walaupun foto terlihat bagus.
5. Item bertipe "sensory" (aroma, rasa, keempukan, tekstur di mulut) TIDAK bisa dinilai dari foto. Pakai catatan sensori inspector; jika tidak ada catatan = "tidak" dengan missing "catatan sensori inspector".
6. Item bertipe "observe"/"document" (proses, prosedur, label, traceability) dinilai dari catatan proses inspector dan/atau foto label/log. Catatan inspector yang spesifik (menyebut tindakan yang dilihat, angka, waktu, atau nama bahan) SUDAH CUKUP sebagai bukti untuk item ini walaupun tidak ada foto; jangan menuntut foto tambahan bila catatan sudah menjawab unsur standarnya. Pernyataan umum seperti "semua sesuai" TIDAK cukup.
7. Item bertipe "visual" dinilai dari foto: warna, coating, bentuk, kebersihan, penataan, benda asing, tanda kerusakan. Jika foto ada tetapi buram/terlalu jauh sehingga unsur standar tidak bisa dipastikan, jawab "tidak" dan sebutkan foto apa yang dibutuhkan.
8. Gate CRITICAL menyangkut keamanan pangan (suhu inti, holding, umur produk, benda asing, kerusakan, bahan baku). Jangan pernah memberi "ya" pada item CRITICAL tanpa bukti kuat.
9. Jangan mengarang: hanya sebutkan apa yang benar-benar terlihat/tercatat. Jika ragu antara ya dan tidak, pilih "tidak" dan jelaskan keraguannya.

CARA MENULIS
- Bahasa Indonesia, gaya laporan QC, singkat dan spesifik: sebut foto ke berapa atau angka yang dipakai.
- reason maksimal 2 kalimat. missing kosong ("") jika bukti sudah cukup.
- evidenceSource: "photo" jika bukti utama dari foto, "measure" dari angka pengukuran, "note" dari catatan inspector, "none" jika tidak ada bukti.
- summary: 2-4 kalimat kondisi produk secara keseluruhan.
- risks: risiko keamanan/kualitas yang harus ditindak segera (kosong jika tidak ada).
- recommendations: langkah perbaikan konkret berurutan untuk tim dapur/store.
- missingEvidence: daftar bukti tambahan (foto/pengukuran/catatan) agar audit berikutnya lengkap.
- Jawab hanya dalam JSON sesuai skema.`;

export interface ProductAnalyzeInput {
  product: ProductDef;
  images: Array<{ base64: string; mediaType: string; label: string }>;
  measures: Record<string, number | null>;
  measureFields: MeasureField[];
  notes: { process: string | null; sensory: string | null; label: string | null };
  storeName: string;
  date: string;
}

export function buildProductUserText(input: ProductAnalyzeInput): string {
  const lines: string[] = [];
  lines.push(`PRODUK YANG DIAUDIT: ${input.product.name}`);
  lines.push(`PROFIL PRODUK STANDAR: ${input.product.profile}`);
  lines.push(`STORE: ${input.storeName} | TANGGAL: ${input.date}`);
  lines.push('');
  lines.push(`FOTO YANG DIKIRIM: ${input.images.length} foto.`);
  input.images.forEach((img, i) => lines.push(`- Foto ${i + 1}: ${img.label}`));
  lines.push('');
  lines.push('DATA PENGUKURAN INSPECTOR (kosong = tidak diukur):');
  for (const f of input.measureFields) {
    const v = input.measures[f.key];
    lines.push(`- ${f.label} (${f.unit}; standar ${f.hint}) untuk item #${f.items.join(', #')}: ${v === null || v === undefined ? 'TIDAK DIUKUR' : v}`);
  }
  lines.push('');
  lines.push(`CATATAN PROSES/PROSEDUR INSPECTOR: ${input.notes.process?.trim() || '(tidak ada)'}`);
  lines.push(`CATATAN SENSORI INSPECTOR (aroma/rasa/tekstur): ${input.notes.sensory?.trim() || '(tidak ada)'}`);
  lines.push(`CATATAN LABEL/TRACEABILITY/BAHAN BAKU: ${input.notes.label?.trim() || '(tidak ada)'}`);
  lines.push('');
  lines.push('CHECKLIST (nilai setiap nomor; kembalikan items dengan nomor yang sama persis, urut, lengkap):');
  for (const it of input.product.items) {
    lines.push(`#${it.no} [${it.gate}] [${it.evidence}] ${it.stage} - ${it.parameter}: ${it.standard}`);
  }
  return lines.join('\n');
}

export const PRODUCT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      description: 'Satu entri per nomor checklist, urut sesuai daftar.',
      items: {
        type: 'object',
        properties: {
          no: { type: 'integer', minimum: 1, maximum: 60 },
          verdict: { type: 'string', enum: ['ya', 'tidak', 'na'] },
          reason: { type: 'string' },
          evidenceSource: { type: 'string', enum: ['photo', 'measure', 'note', 'none'] },
          missing: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['no', 'verdict', 'reason', 'evidenceSource', 'missing', 'confidence'],
        propertyOrdering: ['no', 'verdict', 'reason', 'evidenceSource', 'missing', 'confidence'],
      },
    },
    summary: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'string' } },
    missingEvidence: { type: 'array', items: { type: 'string' } },
  },
  required: ['items', 'summary', 'risks', 'recommendations', 'missingEvidence'],
  propertyOrdering: ['items', 'summary', 'risks', 'recommendations', 'missingEvidence'],
} as const;
