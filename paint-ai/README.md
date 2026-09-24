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
| **5. AI Video Generator** | 5 template, durasi 15/30/60 detik, rasio 9:16, style Realistic/Cinematic, dan provider Google Veo (Vertex AI, tanpa API key) / Runway / Kling / Pika / HeyGen. Alurnya: Generate Prompt → Send API Request → Save Result URL → Store in Firebase Storage. Klip 4-10 detik digabung otomatis dengan transisi halus, lalu diberi **template brand Inti Warna**: logo, judul hook, label SEBELUM/PROSES/SESUDAH, caption per scene, dan end card berisi kontak. Versi tanpa template juga disimpan. Status: Draft → Processing → Completed → Published (atau Failed, bisa Retry). |
| **Dashboard** | Sapaan dan panduan aplikasi (*Learn the app*), kartu brand Inti Warna, Today's Trend dengan skor dan rekomendasi AI. Stat: Generated Videos, Published Content, Average Engagement, Top Content. Chart: AI Activity 30 hari (bar harian) dengan ringkasan hasil video (Succeeded/Failed/Processing), Content Growth (line), dan Platform Performance (bar). Setiap chart punya tampilan tabel. Sidebar bisa di-collapse, pemilih store ada di sidebar, dan notifikasi aktivitas video tersedia di topbar. |
| **Campaign Calendar** | Kalender bulanan (desktop) atau agenda (mobile). Entri bisa ditautkan ke ide atau video, dengan status Planned/Scheduled/Published/Cancelled. |
| **Analytics** | KPI views, engagement, leads dan sales impact. Chart per platform dan tabel performa per video. **Export Excel** memakai formula (ER, sales per lead, SUMIF per platform), validasi data dan conditional formatting. **Import Excel** dari template dengan validasi per baris. |
| **Settings** | Profil; CRUD Store; User & Role (buat user, ubah role/store, nonaktifkan); AI & Integrations (provider default, bahasa konten, brand context, status API key); Demo data; Audit log. |

## Tech stack

- **Frontend:** React 19, Vite 8, TypeScript, Tailwind CSS 4, React Router 7, Recharts, Firebase Web SDK 12, zod, ExcelJS (lazy-load).
- **Backend:** Cloud Functions for Firebase v2 (Node.js 22, ESM), Firestore, Firebase Storage, Firebase Auth, Firebase Hosting, Secret Manager, Cloud Scheduler.
- **AI teks:** Google Gemini (API key atau Vertex AI), OpenAI (Responses API + Structured Outputs), Anthropic Claude (Messages API + structured outputs + refusal fallback). Tersedia juga provider `mock` untuk demo offline.
- **AI video:** Google Veo 3.1 Lite via Vertex AI (tanpa API key), Runway (text_to_video), Kling (text2video, JWT atau API key), Pika via fal.ai (queue API), HeyGen API **v3**, dan renderer `mock` offline.

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
│     ├─ video/     pipeline.js (plan → jobs → poll → stitch → Storage), ffmpeg.js, adapters/{veo,runway,kling,pika,heygen,mock}.js
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
| **Google Veo** (default video) | **Tanpa API key.** Memakai service account Functions dan ditagih ke project Firebase; kredit free trial Google Cloud ikut terpakai. Wajib mengaktifkan Vertex AI API. | `veo-3.1-lite-generate-001`, 720p, tanpa audio, `us-central1` | Klip 4/6/8 detik (30 detik = 8+8+8+6). Harga referensi Veo 3.1 Lite: ±$0,03/detik (720p tanpa audio) sampai $0,05/detik (dengan audio). Diatur lewat `VEO_MODEL`, `VEO_LOCATION`, `VEO_RESOLUTION`, `VEO_GENERATE_AUDIO`, `VEO_ENABLED`. |
| Runway | secret `RUNWAY_API_KEY` | `gen4.5` | Klip 2-10 detik (dipakai 10+5). `veo3.1*` memakai 4/6/8 detik. URL output kedaluwarsa, sehingga langsung disalin ke Storage. |
| Kling | secret `KLING_ACCESS_KEY` (+ `KLING_SECRET_KEY` untuk JWT) | `kling-v2-5-turbo`, mode `pro` | Durasi dikirim sebagai string "5"/"10". Base `https://api-singapore.klingai.com`. |
| Pika | secret `FAL_KEY` | `fal-ai/pika/v2.2/text-to-video` | Lewat fal.ai queue. Key hanya dikirim ke `queue.fal.run`. |
| HeyGen | secret `HEYGEN_API_KEY` + Avatar ID & Voice ID (Settings) | API v3 | Endpoint v1/v2 HeyGen dimatikan 31 Okt 2026, jadi adapter memakai v3. Wajib memilih script karena avatar membacakan voice-over. |

Provider default diatur di **Settings > AI & Integrations** (dokumen `settings/app`). Pengaturan ini menimpa `AI_PROVIDER` / `VIDEO_PROVIDER` di `functions/.env`. Nama model diubah lewat `functions/.env`.

## Template video Inti Warna

Template dipasang otomatis saat video selesai dirakit (`functions/src/video/template/brandTemplate.js` + `composeVideo` di `ffmpeg.js`). Semua grafis dirender sebagai PNG transparan dengan satori + resvg (font Plus Jakarta Sans), lalu digabung ffmpeg dalam satu kali encode.

| Elemen | Waktu tampil | Sumber teks |
|---|---|---|
| Logo "Inti Warna" (kiri atas) | Sepanjang video | – |
| Judul hook + label template (SEBELUM & SESUDAH, TIPS CAT, dst.) | 0,15 - ±3,4 detik | `hookText` dari AI plan, atau hook di script, atau judul video |
| Label SEBELUM / PROSES / SESUDAH | Per klip (khusus template Before-After) | – |
| Caption per scene | Per klip | `onScreenText` per klip dari AI plan, atau dari script |
| Transisi | Antar klip 0,35 detik (fade; reveal Before-After memakai wipe) | – |
| End card | 3,2 detik terakhir | CTA script, atau CTA default di Settings. Kontak diambil dari Settings → Brand template, alamat dari Settings → Stores |

- Pengaturan ada di **Settings → Brand template**: aktif/nonaktif, caption, end card, Instagram, WhatsApp, website, jam buka, dan CTA default. Tab ini menampilkan preview.
- Template bisa dimatikan per video di **Video Studio** (toggle *Inti Warna template*).
- Video yang sudah jadi bisa diberi template tanpa generate ulang klip: tombol **Apply template** di library. Setelah Brand template diubah, gunakan ikon tongkat ajaib (**Re-apply template**). Keduanya merender ulang dari versi clean dan tidak memakai kuota video atau biaya AI.
- Font memakai file TTF yang dibundel (`functions/assets/fonts`, SIL OFL). Jangan ganti ke WOFF: satori mendekompresi WOFF lewat fflate, dan versi fflate yang tidak cocok membuat huruf tergambar kosong. Test `draws real glyphs` menjaga hal ini.
- Setiap video menyimpan `final.mp4` (dengan template) dan `clean.mp4` (tanpa template, untuk diedit lanjut), dengan tombol unduh terpisah di library.
- Layout mengikuti safe zone Reels/TikTok (atas ±8%, bawah ±22%, kanan ±11% dikosongkan untuk UI aplikasi).
- Audio: klip Veo dibuat tanpa suara. Musik sebaiknya ditambahkan dari library musik Instagram/TikTok saat posting, karena lisensinya aman dan membantu jangkauan.

## Caption otomatis & auto-posting Instagram

**Caption AI.** Saat video selesai, AI menulis caption untuk Instagram, TikTok, Facebook, dan YouTube Shorts (judul + deskripsi) dari script, teks hook/caption video, dan kontak di Brand template. AI tidak boleh mengarang harga, promo, atau klaim. Caption bisa diedit, ditulis ulang dengan AI, dan disalin dari **Video Studio → Post**.

**Auto-posting Instagram Reels** memakai API resmi *Instagram API with Instagram Login* (akun Business/Creator):

| Langkah | Detail |
|---|---|
| 1. Meta app | developers.facebook.com/apps → Create app → use case *Manage messaging & content on Instagram* |
| 2. Kredensial | Instagram → API setup with Instagram login: catat **Instagram app ID** dan **app secret** |
| 3. Redirect URI | Business login settings → tambahkan `https://<PROJECT_ID>.web.app/api/oauth/instagram` (ditampilkan juga di Settings → Social accounts) |
| 4. Akun tester | App roles → Instagram testers: tambahkan akun IG toko, lalu terima undangannya di aplikasi Instagram (Settings → Apps and websites → Tester invites). Untuk akun milik sendiri, mode development cukup; App Review tidak diperlukan |
| 5. Server | `functions/.env`: `INSTAGRAM_APP_ID=…`; secret: `npx firebase-tools functions:secrets:set INSTAGRAM_APP_SECRET`; lalu deploy |
| 6. Connect | Settings → **Social accounts** → *Connect Instagram account* (super admin), lalu pilih toko untuk tiap akun (atau "All stores" untuk akun brand) |

Alur posting: **Post** di kartu video → pilih akun → *Post now* atau *Schedule*. Server membuat media container (Instagram mengunduh `final.mp4`), worker `pollVideoJobs` (tiap menit) mengecek sampai `FINISHED`, lalu `media_publish` → permalink disimpan dan video otomatis berstatus **Published**.

- Token long-lived (±60 hari) diperpanjang otomatis kalau tinggal kurang dari 10 hari. Kalau dicabut, status akun menjadi *Reconnect needed*.
- Token disimpan terenkripsi di `social_tokens` (tidak bisa dibaca client) dan hanya dikirim ke `api.instagram.com` / `graph.instagram.com`.
- **Auto-post** (Settings → Social accounts) default **OFF**. Kalau ON, setiap video yang selesai langsung diposting dengan caption AI tanpa review. Tidak disarankan, karena video AI bisa berisi kesalahan.
- Batas Instagram: 30 hashtag, 2.200 karakter, Reels lewat API maksimal 90 detik, dan kuota posting per 24 jam per akun. Kalau kena rate limit, posting otomatis dicoba lagi 15 menit kemudian.
- Video tanpa suara diberi track audio AAC senyap (Instagram mensyaratkan stream audio).
- **TikTok & YouTube Shorts:** API mereka mengunci upload sebagai *private* sampai app lolos audit platform. Sementara itu, gunakan caption AI dan upload manual (tambahkan musik dari library aplikasi), lalu catat lewat *Record it as published*.

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

1. Buat project **baru** dan upgrade ke plan **Blaze**. Tambahkan juga sebuah **Web app** di Project settings → Your apps.
2. **Authentication → Get started → Sign-in method**: aktifkan **Email/Password** dan **Google**.
3. **Storage → Get started**: buat bucket default, pilih lokasi yang sama dengan Firestore (disarankan `asia-southeast2`).
4. Siapkan minimal satu API key AI teks. Gemini paling mudah: key gratis di https://aistudio.google.com/apikey.

### 2. Deploy (satu blok, dijalankan di laptop)

Prasyarat: Node.js 22+ dan Git.

```bash
bash scripts/deploy.sh <PROJECT_ID> asia-southeast2 email-admin@anda.com
```

Script mengerjakan semuanya secara otomatis:

- Guard: menolak project app lain dan config project yang tidak cocok.
- `npm ci`, lalu lint, typecheck dan unit test.
- `firebase login` (browser terbuka).
- Firestore: membuat database di region pilihan, atau memastikan region-nya cocok dengan database yang sudah ada.
- Mengambil config Web app otomatis ke `.env.production.local`.
- Membuat `functions/.env` dengan region dan email Super Admin.
- Meminta nilai setiap secret. Isi `disabled` untuk provider yang belum dipakai.
- `firebase deploy` (rules, indexes, storage, functions, hosting), dengan satu kali retry otomatis. Retry ini mengantisipasi service account Google yang belum siap pada deploy pertama.

Secret bisa ditambah atau diganti kapan saja:

```bash
npx firebase-tools functions:secrets:set RUNWAY_API_KEY --project <PROJECT_ID>
npx firebase-tools deploy --only functions --project <PROJECT_ID>
```

### 3. Setelah deploy

1. Buka `https://<PROJECT_ID>.web.app`, lalu login dengan email Super Admin. Pakai Google, atau Email/Password lalu klik link verifikasi.
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
| `Cloud Firestore API has not been used in project … or it is disabled` | Project Google Cloud baru belum mengaktifkan API. Script menampilkan satu link untuk mengaktifkan semua API sekaligus (`console.cloud.google.com/flows/enableapi?...`). Klik **Enable**, tunggu 1-2 menit, tekan Enter. |
| Deploy pertama gagal di Firestore trigger (Eventarc permission) | Izin service agent baru butuh waktu propagasi. Tunggu 2-5 menit, lalu jalankan `npx firebase deploy --only functions` lagi. |
| Deploy storage rules meminta grant IAM | Ini untuk cross-service rules (Storage membaca Firestore). Jawab **Yes**. |
| Tombol AI menampilkan `internal [0]` (status 0 / CORS) untuk function tertentu | Function itu gagal di **create** pertama, lalu di retry hanya di-**update**. Firebase CLI hanya memasang izin publik (`allUsers` invoker) untuk callable saat create. Hapus dan deploy ulang function tersebut: `npx firebase-tools functions:delete paint-ai:<nama> --region <region> --project <id> --force`, lalu `npx firebase-tools deploy --only functions:paint-ai:<nama> --project <id>`. |
| Callable error `not-found` / CORS | Region function berbeda dari `VITE_FUNCTIONS_REGION`. Samakan keduanya, lalu build ulang. |
| Veo: `Vertex AI API is not enabled` | Aktifkan API-nya lewat `https://console.cloud.google.com/flows/enableapi?apiid=aiplatform.googleapis.com&project=<id>`, tunggu 1-2 menit, lalu klik **Retry** di video. |
| Veo: `Permission denied on Vertex AI` | Buka IAM (`https://console.cloud.google.com/iam-admin/iam?project=<id>`). Beri role **Vertex AI User** ke `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com` (service account Cloud Functions), lalu Retry. |
| Veo: `model … is not available` / `quota reached` | Model belum tersedia di region tersebut: ubah `VEO_MODEL` atau `VEO_LOCATION` di `functions/.env`, lalu deploy functions. Untuk quota per menit: tunggu 1 menit lalu Retry, atau pakai durasi 15/30 detik (klipnya lebih sedikit). |
| Veo: `safety filter blocked this clip` | Prompt klip terkena filter keamanan Google (misalnya orang terkenal atau merek). Ubah brief/script, lalu Retry. |
| Predeploy gagal `ERR_MODULE_NOT_FOUND` (mis. `@resvg/resvg-js`) | Setelah `git pull` ada dependensi baru yang belum ter-install. Sekarang predeploy menjalankan `npm install` otomatis. Untuk versi lama, jalankan `npm --prefix functions install && npm install`, lalu deploy lagi. |
| Settings → Social accounts: "Instagram is not set up yet" | `INSTAGRAM_APP_ID` belum ada di `functions/.env` atau secret `INSTAGRAM_APP_SECRET` masih `disabled`. Isi keduanya, lalu deploy functions. |
| Connect Instagram: "Invalid redirect_uri" / "Invalid platform app" | Redirect URI di Meta app harus persis `https://<PROJECT_ID>.web.app/api/oauth/instagram`, dan yang dipakai adalah *Instagram* app ID (bukan Facebook app ID). |
| Post gagal: "personal account" / izin | Ubah akun IG menjadi Business/Creator, tambahkan sebagai Instagram tester di Meta app, lalu Connect ulang. |
| "X is not configured" | Secret provider belum diisi, atau masih `disabled`. Set dengan `firebase functions:secrets:set`, lalu deploy ulang functions. |
| Store Manager melihat layar "Waiting for access" | Belum di-assign store. Buka Settings → Users & roles. |
| Login email tidak menjadi Super Admin | Email belum diverifikasi. Klik link verifikasi, lalu klik **I have verified** di banner. |
