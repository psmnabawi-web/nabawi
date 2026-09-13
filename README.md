# Store Cleanliness Control

Tools kontrol kebersihan store berbasis web (mobile-first):

1. **Crew capture foto** setiap area langsung dari HP (kamera browser).
2. **AI vision menilai** foto terhadap standar bersih tiap indikator → skor 1-5, temuan, rekomendasi. Default **Google Gemini** (Gemini API free tier atau Vertex AI); Claude tersedia sebagai opsi.
3. **Skor tersimpan di Firebase** (Firestore + Storage) secara realtime → dashboard, ranking store, tren, export Excel.

Indikator mengikuti **Form Audit Cleaning** (57 area, 6 kategori): Kitchen, Service/Cashier, Lobby/Dining, Dry/Cold Storage, Back Area/Utility/Outdoor, Akses Masuk & Parking Yard.

## Fitur

| Modul | Detail |
|---|---|
| Auth & Role | Firebase Auth (email/password). Role `crew`, `manager`, `admin`. Email di `ADMIN_EMAILS` otomatis admin. |
| Audit | Buat audit per store/tanggal/shift → 57 item. Capture foto per item, AI scoring otomatis, submit. Cegah duplikasi audit. |
| AI Scoring | Google Gemini (default) atau Claude, structured JSON output, rubrik 1-5 seragam. Foto buram/salah objek ditolak (`photoValid=false`). Retry otomatis saat kena rate limit free tier. |
| Koreksi manager | Manager/admin dapat override skor AI dengan alasan wajib → tercatat di audit trail. |
| Scoring | % = rata-rata skor / 5. Grade A ≥90, B ≥80, C ≥70, D <70. Skor ≤2 = temuan kritikal. |
| Dashboard | KPI (skor rata-rata, audit, kritikal, di bawah target), tren per audit, skor per kategori vs target, ranking store. |
| Export Excel | Per audit (Form Audit + Summary berformula + Action Plan) dan rekap multi-audit. |
| Admin | CRUD store, user & role (buat akun, reset password, nonaktifkan), indikator (edit/tambah/nonaktifkan/reset default), audit trail. |
| Keamanan | Semua tulis data lewat API server (Admin SDK) dengan verifikasi ID token; Firestore rules read-only per store/role; Storage tertutup (akses via URL bertoken). |

## Struktur

```
src/app/
  login, register, profile, dashboard
  audits/            daftar audit
  audits/new         buat audit
  audits/[id]        capture per indikator + hasil AI + submit/export
  admin/{stores,users,indicators,logs}
  api/me             profil (auto-create)
  api/audits         POST buat audit
  api/audits/[id]    PATCH submit/reopen/note, DELETE
  api/audits/[id]/items/[itemId]  PATCH override/reset/note
  api/analyze        POST foto → Storage → Claude → Firestore
  api/admin/{users,stores,indicators}
src/lib/
  indicators.ts      57 indikator default (dari Excel)
  scoring.ts         rubrik, grade, summary
  ai/analyze.ts      pemilih provider (AI_PROVIDER) + model
  ai/prompt.ts       rubrik & prompt bersama
  ai/google.ts       Gemini API / Vertex AI (@google/genai)
  ai/anthropic.ts    Claude (opsional)
  auth-server.ts     verifikasi token, role, audit log
  export-excel.ts    ExcelJS
scripts/deploy.sh    deploy sekali jalan ke Firebase (App Hosting)
firestore.rules, storage.rules, firestore.indexes.json, apphosting.yaml
.github/workflows/ci.yml  lint+typecheck+build tiap push, deploy rules ke Firebase saat push main
```

## Pilihan AI & biaya

| Mode | Env | Biaya | Batas | Cocok untuk |
|---|---|---|---|---|
| **Gemini API (AI Studio)** | `AI_PROVIDER=google`, `GEMINI_API_KEY` | Gratis (free tier) | Dibatasi per menit & per hari oleh Google, angka berubah-ubah (cek di AI Studio > Rate limits). Data request dipakai Google untuk peningkatan produk. | Uji coba, 1-3 store |
| **Vertex AI** | `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` | Berbayar per token (bisa pakai kredit trial GCP USD 300 / 90 hari) | Kuota produksi, tanpa data-sharing | Produksi multi store |
| **Claude** | `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` | Berbayar | - | Jika butuh akurasi/penjelasan lebih kuat |

Vertex AI **bukan** layanan gratis; yang gratis adalah Gemini API lewat Google AI Studio. Kode ini mendukung keduanya, cukup ganti env.

## Deploy ke Firebase (satu perintah)

Prasyarat di laptop: Node.js 20+, Git, [Google Cloud SDK](https://cloud.google.com/sdk/docs/install), akun Google, dan kartu untuk upgrade project ke plan **Blaze** (App Hosting & Storage mewajibkan Blaze; pemakaian kecil tetap dalam kuota gratis).

```bash
git clone https://github.com/psmnabawi-web/nabawi.git && cd nabawi
bash scripts/deploy.sh <PROJECT_ID> asia-southeast1 psmnabawi-web/nabawi main
```

Script akan: login Google → buat/pilih project → cek Blaze → aktifkan API → buat Firestore + deploy rules/index → ambil config web app ke `.env.local` dan `apphosting.yaml` → minta Gemini API key (gratis, dari https://aistudio.google.com/apikey) dan simpan sebagai secret → buat service account untuk seed → seed 57 indikator → buat backend App Hosting yang auto-deploy dari GitHub → beri IAM role → trigger rollout pertama.

Dua langkah yang tetap manual di Firebase Console (sekali saja, script memberi link-nya):
1. Authentication → Sign-in method → aktifkan **Email/Password**.
2. Build → Storage → **Get started** (inisialisasi bucket), lalu jalankan `npx firebase-tools deploy --only storage`.

Setelah rollout selesai, cek `https://<domain>/api/health` lalu daftar di `/register` dengan email yang ada di `ADMIN_EMAILS` → menu Admin → tambah store & user. Setiap push ke `main` otomatis deploy ulang.

Pindah ke Vertex AI nanti: di `apphosting.yaml` ubah `GOOGLE_GENAI_USE_VERTEXAI` ke `"true"`, hapus entri `GEMINI_API_KEY`, tambah `GOOGLE_CLOUD_PROJECT` dan `GOOGLE_CLOUD_LOCATION`, push.

## Jalan lokal

```bash
cp .env.example .env.local   # isi sesuai komentar (atau biarkan scripts/deploy.sh yang mengisi)
npm install
npm run seed
npm run dev                  # http://localhost:3000
```

## Scripts

| Perintah | Fungsi |
|---|---|
| `npm run dev` | development |
| `npm run build && npm start` | produksi |
| `npm run typecheck` / `npm run lint` | cek tipe & lint |
| `npm run seed` | seed indikator & store contoh |
| `npm run deploy:rules` | deploy Firestore/Storage rules & index |
