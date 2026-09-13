# Store Cleanliness Control

Tools kontrol kebersihan store berbasis web (mobile-first):

1. **Crew capture foto** setiap area langsung dari HP (kamera browser).
2. **AI (Claude vision) menilai** foto terhadap standar bersih tiap indikator → skor 1-5, temuan, rekomendasi.
3. **Skor tersimpan di Firebase** (Firestore + Storage) secara realtime → dashboard, ranking store, tren, export Excel.

Indikator mengikuti **Form Audit Cleaning** (57 area, 6 kategori): Kitchen, Service/Cashier, Lobby/Dining, Dry/Cold Storage, Back Area/Utility/Outdoor, Akses Masuk & Parking Yard.

## Fitur

| Modul | Detail |
|---|---|
| Auth & Role | Firebase Auth (email/password). Role `crew`, `manager`, `admin`. Email di `ADMIN_EMAILS` otomatis admin. |
| Audit | Buat audit per store/tanggal/shift → 57 item. Capture foto per item, AI scoring otomatis, submit. Cegah duplikasi audit. |
| AI Scoring | Claude vision + structured output (Zod). Foto buram/salah objek ditolak (`photoValid=false`). Rubrik 1-5 seragam. |
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
  ai/analyze.ts      prompt + schema output Claude
  auth-server.ts     verifikasi token, role, audit log
  export-excel.ts    ExcelJS
firestore.rules, storage.rules, firestore.indexes.json, apphosting.yaml
```

## Setup (sekali)

1. Buat project Firebase → aktifkan **Authentication (Email/Password)**, **Firestore**, **Storage**.
2. Project Settings → Your apps → Web app → salin config ke `.env.local` (lihat `.env.example`).
3. Project Settings → Service accounts → Generate new private key → isi `FIREBASE_SERVICE_ACCOUNT_JSON` (satu baris) di `.env.local`.
4. Isi `ANTHROPIC_API_KEY` dan `ADMIN_EMAILS`.
5. Jalankan:

```bash
npm install
npx firebase-tools login
npx firebase-tools use <PROJECT_ID>
npx firebase-tools deploy --only firestore:rules,firestore:indexes,storage
npm run seed          # 57 indikator + 1 store contoh
npm run dev           # http://localhost:3000
```

6. Login dengan email yang ada di `ADMIN_EMAILS` (daftar dulu lewat /register) → menu Admin → tambah store & user.

## Deploy ke Firebase App Hosting

```bash
npx firebase-tools apphosting:backends:create --project <PROJECT_ID>
npx firebase-tools apphosting:secrets:set ANTHROPIC_API_KEY
npx firebase-tools apphosting:secrets:set ADMIN_EMAILS
# edit apphosting.yaml: isi NEXT_PUBLIC_FIREBASE_* sesuai project
git push origin main   # App Hosting build otomatis dari GitHub
```

Di App Hosting, Admin SDK memakai default credential (tidak perlu `FIREBASE_SERVICE_ACCOUNT_JSON`). Pastikan service account backend punya role **Cloud Datastore User**, **Storage Object Admin**, **Firebase Authentication Admin**.

Alternatif: Vercel (`vercel --prod`) dengan env yang sama seperti `.env.local`.

## Biaya AI (estimasi)

Per foto ±1.500 token input gambar + ±900 token prompt (cached) + ±300 token output.
Dengan `claude-opus-5`: ±USD 0,02/foto → ±USD 1,2 per audit 57 area. Ganti `AI_MODEL=claude-sonnet-5` untuk ±60% lebih murah.

## Scripts

| Perintah | Fungsi |
|---|---|
| `npm run dev` | development |
| `npm run build && npm start` | produksi |
| `npm run typecheck` / `npm run lint` | cek tipe & lint |
| `npm run seed` | seed indikator & store contoh |
| `npm run deploy:rules` | deploy Firestore/Storage rules & index |
