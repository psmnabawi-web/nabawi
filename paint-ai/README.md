# AI Content Intelligence & Video Generator — Retail Paint

Platform AI marketing untuk toko cat, toko bahan bangunan, bisnis home improvement dan pasar desain interior.

```
SOCIAL MEDIA TREND INPUT → AI TREND ANALYSIS → AI CONTENT STRATEGY → AI SCRIPT GENERATOR
        → AI VIDEO GENERATION → CONTENT MANAGEMENT → PERFORMANCE ANALYTICS
```

> **Aplikasi terpisah.** Folder `paint-ai/` memiliki project Firebase, Hosting, Firestore, rules dan Cloud Functions sendiri.
> Aplikasi ini tidak menyentuh app *Store Cleanliness* di root repo. `scripts/deploy.sh` menolak deploy ke project app tersebut.

## Fitur

| Modul | Isi |
|---|---|
| **Auth & Role** | Firebase Auth: Email/Password (dengan verifikasi email, reset password) dan Google. Tiga role: **Super Admin**, **Marketing Manager**, **Store Manager**. Email di `SUPER_ADMIN_EMAILS` otomatis menjadi Super Admin, tetapi hanya jika email sudah terverifikasi. |
| **1. Trend Monitoring** | Input link TikTok/Instagram/YouTube, akun kompetitor atau hashtag, dengan kategori, lokasi dan scope store. Caption/transkrip bisa ditempel. Caption publik TikTok/YouTube diambil otomatis lewat oEmbed. Tombol **Analyze Trend**. |
| **2. AI Trend Analyzer** | `analyzeTrend()` menghasilkan nama tren, skor 0-100 dengan rubrik tertulis, growth, viral pattern, audience emotion, hook, visual strategy, marketing opportunity dan rekomendasi. Output berupa JSON terstruktur. |
| **3. AI Content Generator** | `generateContent()` membuat sampai 20 ide per brief (produk × audiens × objective × platform, opsional berbasis tren). Tiap ide berisi Title, Hook, Storyline, CTA dan Expected impact. Ide bisa difavoritkan, diedit dan dihapus. |
| **4. AI Script Generator** | `generateScript()` menyusun TITLE → HOOK 0-3 detik → SCENE 1..n (Visual/Voice/Text) → CTA, plus voice-over, caption dan hashtag. Script bisa diedit, di-copy dan diunduh sebagai .txt. |
| **5. AI Video Generator** | 5 template, durasi 15/30/60 detik, rasio 9:16, style Realistic/Cinematic, dan provider Runway / Kling / Pika / HeyGen. Alurnya: Generate Prompt → Send API Request → Save Result URL → Store in Firebase Storage. Klip 5-10 detik digabung otomatis dengan ffmpeg. Status: Draft → Processing → Completed → Published (atau Failed, bisa Retry). |
| **Dashboard** | Today's Trend dengan skor dan rekomendasi AI. Stat: Total Generated Video, Published Content, Average Engagement, Top Content. Chart: Content Growth (line) dan Platform Performance (bar). Setiap chart punya tampilan tabel. |
| **Campaign Calendar** | Kalender bulanan (desktop) atau agenda (mobile). Entri bisa ditautkan ke ide atau video, dengan status Planned/Scheduled/Published/Cancelled. |
| **Analytics** | KPI views, engagement, leads dan sales impact. Chart per platform dan tabel performa per video. **Export Excel** memakai formula (ER, sales per lead, SUMIF per platform), validasi data dan conditional formatting. **Import Excel** dari template dengan validasi per baris. |
| **Settings** | Profil; CRUD Store; User & Role (buat user, ubah role/store, nonaktifkan); AI & Integrations (provider default, bahasa konten, brand context, status API key); Demo data; Audit log. |

## Tech stack

- **Frontend:** React 19, Vite 8, TypeScript, Tailwind CSS 4, React Router 7, Recharts, Firebase Web SDK 12, zod, ExcelJS (lazy-load).
- **Backend:** Cloud Functions for Firebase v2 (Node.js 22, ESM), Firestore, Firebase Storage, Firebase Auth, Firebase Hosting, Secret Manager, Cloud Scheduler.
- **AI teks:** Google Gemini (API key atau Vertex AI), OpenAI (Responses API + Structured Outputs), Anthropic Claude (Messages API + structured outputs + refusal fallback). Tersedia juga provider `mock` untuk demo offline.
- **AI video:** Runway (text_to_video), Kling (text2video, JWT atau API key), Pika via fal.ai (queue API), HeyGen API **v3**, dan renderer `mock` offline.

## Struktur

```
paint-ai/
├─ src/
│  ├─ components/   ui/ (Button, Modal, Form…), layout/, charts/, trend/, content/, video/, analytics/, calendar/, settings/
│  ├─ pages/        Login, Dashboard, TrendIntelligence, ContentGenerator, VideoStudio, CampaignCalendar, Analytics, Settings
│  ├─ services/     firestore.ts (CRUD + query ber-scope), functions.ts (callable bertipe)
│  ├─ hooks/        useAuth, useStoreScope, useFirestore (realtime), useToast, useAsyncAction, useIntegrationStatus
│  ├─ utils/        constants, validation (zod), format, errors, engagement, excel, script
│  ├─ firebase/     config.ts (init + emulator)
│  └─ types/        tipe domain
├─ functions/
│  ├─ index.js      daftar semua Cloud Functions
│  └─ src/
│     ├─ ai/        trendAnalyzer.js, contentGenerator.js, scriptGenerator.js, videoGenerator.js,
│     │             prompts.js, schemas.js, socialContext.js, providers/{gemini,openai,claude,mock}.js
│     ├─ video/     pipeline.js (plan → jobs → poll → stitch → Storage), ffmpeg.js, adapters/{runway,kling,pika,heygen,mock}.js
│     ├─ performance/calculatePerformance.js
│     ├─ users/users.js, seed/demoData.js, lib/ (auth, validation, quota, audit, settings, errors)
│     ├─ scripts/seed-emulator.js
│     └─ test/unit.test.js
├─ tests/rules/rules.test.ts   test security rules (Firestore + Storage) di emulator
├─ firestore.rules, storage.rules, firestore.indexes.json, firebase.json
├─ docs/firestore-schema.md
└─ scripts/deploy.sh
```

## Role & akses

| Aksi | Super Admin | Marketing Manager | Store Manager |
|---|:-:|:-:|:-:|
| Lihat data semua store | ✅ | ✅ | ❌ (hanya store sendiri + konten brand-wide) |
| Tambah sumber, analisa tren, generate ide/script/video | ✅ | ✅ | ❌ |
| Publish video, input performa, kalender | ✅ | ✅ | ❌ (lihat saja) |
| Kelola store & user, provider AI, demo data, audit log | ✅ | ❌ (lihat status provider) | ❌ |

Akses ditegakkan di tiga lapis:

1. **Firestore Rules.** Setiap query Store Manager wajib memakai filter `storeId in [storeSendiri, 'ALL']`, dan validasi field dilakukan per koleksi.
2. **Storage Rules.** File video hanya bisa dibaca user yang berhak atas dokumen videonya (cross-service rules). Client tidak bisa upload.
3. **Cloud Functions.** Setiap callable memeriksa role, status aktif dan scope store.

Output AI (tren, ide, script, video) **hanya ditulis oleh server**.

## Cloud Functions

| Function | Jenis | Fungsi |
|---|---|---|
| `bootstrapProfile` | callable | Membuat atau menyegarkan profil `users/{uid}`. Promosi Super Admin untuk email terverifikasi. |
| `manageUser` | callable (admin) | Membuat user, mengubah role/store, mengaktifkan/menonaktifkan (+ revoke token). |
| `analyzeTrend` | callable | Modul 2 |
| `generateContent` | callable | Modul 3 (`generateContentIdeas`) |
| `generateScript` | callable | Modul 4 (`generateVideoScript`) |
| `generateVideo` | callable | Modul 5: membuat draft atau langsung memulai generate |
| `videoAction` | callable | start (draft), retry (failed), refresh (poll sekarang) |
| `pollVideoJobs` | scheduler 1 menit | Poll provider → download klip → stitch ffmpeg → upload `videos/{id}/final.mp4` + thumbnail |
| `calculatePerformance` | callable | Hitung ulang `stats/*` |
| `scheduledStats` | scheduler 60 menit | Hitung ulang `stats/*` |
| `onPerformanceWritten` | Firestore trigger | Menyelaraskan engagementRate dan judul |
| `onVideoDeleted` | Firestore trigger | Hapus file Storage dan performa video |
| `getIntegrationStatus` | callable | Status provider (tanpa membuka key), kuota, region |
| `seedDemoData` | callable (admin) | Load atau hapus data demo |

Guard rail yang aktif di backend:

- Kuota harian per user: `AI_DAILY_LIMIT`, `VIDEO_DAILY_LIMIT`. Kuota dikembalikan jika provider gagal.
- Audit log untuk setiap aksi AI, video dan admin.
- Input divalidasi zod (`.strict()`).
- Konten eksternal dibungkus tag `<data>` untuk mengurangi prompt injection.
- oEmbed hanya dipanggil ke endpoint resmi, sehingga tidak ada SSRF ke URL user.
- API key disimpan di Secret Manager.

## Provider AI

| Provider | Konfigurasi | Default model | Catatan |
|---|---|---|---|
| Gemini | secret `GEMINI_API_KEY` atau `GOOGLE_GENAI_USE_VERTEXAI=true` | `gemini-3.8-flash` | Vertex AI memakai service account Functions (beri role *Vertex AI User*). |
| OpenAI | secret `OPENAI_API_KEY` | `gpt-6-sol` | `gpt-6-luna` lebih murah. |
| Claude | secret `ANTHROPIC_API_KEY` | `claude-opus-5` | Server-side refusal fallback aktif untuk model Opus 5/Fable. |
| Runway | secret `RUNWAY_API_KEY` | `gen4.5` | Klip 2-10 detik (dipakai 10+5). `veo3.1*` memakai 4/6/8 detik. URL output kedaluwarsa, sehingga langsung disalin ke Storage. |
| Kling | secret `KLING_ACCESS_KEY` (+ `KLING_SECRET_KEY` untuk JWT) | `kling-v2-5-turbo`, mode `pro` | Durasi dikirim sebagai string "5"/"10". Base `https://api-singapore.klingai.com`. |
| Pika | secret `FAL_KEY` | `fal-ai/pika/v2.2/text-to-video` | Lewat fal.ai queue. Key hanya dikirim ke `queue.fal.run`. |
| HeyGen | secret `HEYGEN_API_KEY` + Avatar ID & Voice ID (Settings) | API v3 | Endpoint v1/v2 HeyGen dimatikan 31 Okt 2026, jadi adapter memakai v3. Wajib memilih script karena avatar membacakan voice-over. |

Provider default diatur di **Settings > AI & Integrations** (dokumen `settings/app`). Pengaturan ini menimpa `AI_PROVIDER` / `VIDEO_PROVIDER` di `functions/.env`. Nama model diubah lewat `functions/.env`.

## Jalan lokal (emulator, tanpa API key)

Prasyarat: Node.js 22+, Java 21 (untuk emulator).

```bash
cd paint-ai
npm install && npm --prefix functions install
cp .env.example .env.local                      # isi config demo di bawah
cp functions/.env.example functions/.env.local  # AI_PROVIDER=mock, VIDEO_PROVIDER=mock, SUPER_ADMIN_EMAILS=admin@demo.test
cp functions/.secret.local.example functions/.secret.local
npm run emulators                               # terminal 1
npm run emulators:seed                          # terminal 2: user demo + data demo
npm run dev                                     # terminal 3: http://localhost:5173
```

Isi `.env.local` untuk emulator:

```
VITE_FIREBASE_API_KEY=demo-api-key
VITE_FIREBASE_AUTH_DOMAIN=demo-paint-ai.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=demo-paint-ai
VITE_FIREBASE_STORAGE_BUCKET=demo-paint-ai.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=0
VITE_FIREBASE_APP_ID=1:0:web:0
VITE_FUNCTIONS_REGION=asia-southeast2
VITE_USE_EMULATORS=true
```

Login demo (password `Demo12345!`):

- `admin@demo.test` — Super Admin
- `marketing@demo.test` — Marketing Manager
- `store@demo.test` — Store Manager (Cat XYZ Jakarta)

Scheduler tidak berjalan di emulator. Di Video Studio, klik **Check status** untuk menjalankan polling atau stitching.

## Deploy ke Firebase (project baru)

### 1. Persiapan di Firebase Console (sekali saja)

1. Buat project **baru**, misalnya `paint-content-ai`, lalu upgrade ke plan **Blaze**. Functions v2, Scheduler, Secret Manager dan Storage mewajibkan Blaze.
2. **Authentication → Sign-in method**: aktifkan **Email/Password** dan **Google**.
3. **Build → Storage → Get started** untuk membuat bucket. Lokasi disarankan sama dengan Firestore.
4. **Project settings → Your apps → Web app**: salin config ke `paint-ai/.env.local`. Set `VITE_USE_EMULATORS=false`.
5. Isi `functions/.env`, salin dari `functions/.env.example`. Minimal isi `SUPER_ADMIN_EMAILS=email@anda.com`. `FUNCTIONS_REGION` harus sama dengan `VITE_FUNCTIONS_REGION`.

### 2. Deploy (satu blok)

```bash
cd paint-ai
bash scripts/deploy.sh <PROJECT_ID_BARU> asia-southeast2
```

Script ini menjalankan:

- Guard: menolak project app lain, mismatch project/region, dan mode emulator.
- `npm ci`.
- Lint, typecheck dan unit test.
- `firebase login`.
- Membuat Firestore di region pilihan (jika belum ada).
- Meminta nilai setiap secret. Isi `disabled` untuk provider yang tidak dipakai.
- `firebase deploy --only firestore:rules,firestore:indexes,storage,functions,hosting`.

Perintah manual yang setara:

```bash
cd paint-ai
npm ci && npm ci --prefix functions
npx firebase login
npx firebase use --add                       # pilih project BARU, alias default
npx firebase functions:secrets:set GEMINI_API_KEY   # ulangi untuk semua secret (isi "disabled" jika tidak dipakai)
npx firebase deploy
```

### 3. Setelah deploy

1. Buka `https://<PROJECT_ID>.web.app`, lalu login dengan email di `SUPER_ADMIN_EMAILS`. Pakai Google, atau Email/Password lalu klik link verifikasi.
2. **Settings → Stores**: tambah store.
3. **Settings → Users & roles**: atur role/store tim.
4. **Settings → AI & Integrations**: pilih provider default, isi brand context, lalu cek status API key.
5. (Opsional) **Settings → Demo data → Load** untuk melihat contoh. Hapus sebelum go-live.

## Testing

```bash
npm run lint && npm run typecheck && npm test   # frontend (oxlint, tsc, vitest)
npm --prefix functions run lint && npm --prefix functions test   # backend (eslint, node:test)
npm run test:rules                              # security rules di emulator Firestore + Storage
npm run build
```

Workflow `.github/workflows/paint-ai.yml` menjalankan semuanya ketika ada perubahan di `paint-ai/**`. Workflow ini tidak melakukan deploy otomatis.

## Batasan yang perlu diketahui

- **AI tidak menonton video.** Analisa tren memakai URL, keyword, caption publik (oEmbed TikTok/YouTube) dan catatan yang ditempel tim. Instagram tidak menyediakan oEmbed tanpa token Meta, jadi tempelkan caption secara manual. Tingkat keyakinan analisa ditampilkan di field `confidence` dan `rationale`.
- **Audio video.** Klip dari Runway/Kling/Pika digabung apa adanya. Audio dari provider dipertahankan, dan klip tanpa audio diisi silence. Voice-over otomatis (TTS) belum ada. Voice-over lengkap tersedia lewat HeyGen (avatar).
- **Durasi.** Durasi akhir mengikuti kombinasi klip yang didukung provider. Contoh: Veo 4/6/8 detik untuk target 15 detik menghasilkan 16 detik.
- **Biaya provider** (per token / per detik video) ditagihkan oleh masing-masing vendor. Kontrol biaya lewat kuota harian `AI_DAILY_LIMIT` / `VIDEO_DAILY_LIMIT` dan pilihan model.
- **Metrik performa** (views, likes, leads, sales impact) diinput manual atau lewat import Excel. Sinkron otomatis dari API TikTok/Meta/YouTube belum dibuat.

## Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| Deploy pertama gagal di Firestore trigger (Eventarc permission) | Izin service agent baru butuh waktu propagasi. Tunggu 2-5 menit, lalu jalankan `npx firebase deploy --only functions` lagi. |
| Deploy storage rules meminta grant IAM | Ini untuk cross-service rules (Storage membaca Firestore). Jawab **Yes**. |
| Callable error `not-found` / CORS | Region function berbeda dari `VITE_FUNCTIONS_REGION`. Samakan keduanya, lalu build ulang. |
| "X is not configured" | Secret provider belum diisi, atau masih `disabled`. Set dengan `firebase functions:secrets:set`, lalu deploy ulang functions. |
| Store Manager melihat layar "Waiting for access" | Belum di-assign store. Buka Settings → Users & roles. |
| Login email tidak menjadi Super Admin | Email belum diverifikasi. Klik link verifikasi, lalu klik **I have verified** di banner. |
