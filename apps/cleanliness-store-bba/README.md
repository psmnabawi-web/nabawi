# Bangor Cleanliness Control (cleanliness-store-bba)

Source app **Store Cleanliness Control** untuk Bangor yang live di https://cleanliness-store-bba.web.app
(project Firebase `cleanliness-store-bba`). App statis: HTML + JS modul + CSS di `public/`, langsung memakai
Firebase JS SDK (Firestore, Storage, Functions `scoreEvidence` & `finalizeSession` region asia-southeast1).

`public/` diambil dari versi live `0deb67c34a2cbd3f` (rilis 25 Agu 2026) lewat Hosting REST API, lihat `snapshot.json`.
Yang **tidak** ada di repo: source Cloud Functions (`scoreEvidence`, `finalizeSession`), data Firestore, foto di Storage.

## Master data

Semua master ada di `public/master-data.js`, bukan di Firestore:

| Konstanta | Isi | Catatan |
|---|---|---|
| `STORE_MASTER` | daftar store (`id`, `code`, `name`) | `id` dipakai sebagai id dokumen Firestore `stores/` dan awalan id sesi audit. App menyinkronkan daftar ini ke Firestore saat dibuka. |
| `CREW_MASTER` | crew per store (`id`, `name`, `storeId`, `storeName`) | Menu **Evidence Kebersihan** hanya bisa dipakai bila store punya crew di sini. |
| `CONTROL_POINTS` | 26 titik kontrol + bobot | Total bobot 1500, dicek tes. |

Tambah store: tambah baris di `STORE_MASTER` (nama huruf besar, `id` slug `store-...`, `code` kosong bila belum ada).
Tambah crew: tambah baris di `CREW_MASTER` dengan `storeId`/`storeName` yang persis sama dengan master store.
Jalankan `npm test` sebelum deploy.

## Cloud Functions (AI scoring)

Source backend ada di `functions/` (Node 22, Firebase Functions v2, region asia-southeast1): `scoreEvidence` menilai foto
dengan AI lalu menstempel dan menyimpan evidence, `finalizeSession` menutup sesi dan menghitung on time / late.
Mesin AI dipilih lewat env (`functions/ai.js`):

| Env | Default | Keterangan |
|---|---|---|
| `CLEANLINESS_AI_PROVIDER` | `gemini` | `openai` = endpoint OpenAI-compatible (chat/completions, mis. relay Qwen; butuh secret `OPENAI_API_KEY`), `gemini` = Gemini API free tier (butuh secret `GEMINI_API_KEY`), `vertex` = Vertex AI |
| `OPENAI_BASE_URL` | `https://bandelbanget.xyz/v1` | base URL endpoint OpenAI-compatible, tanpa `/chat/completions` |
| `CLEANLINESS_AI_TIMEOUT_MS` | `75000` | batas waktu satu panggilan ke endpoint OpenAI-compatible |
| `CLEANLINESS_AI_MODEL` | `gemma-4-31b-it` | model utama; alternatif `gemma-4-26b-a4b-it` (lebih cepat) |
| `CLEANLINESS_AI_FALLBACK` | `vertex` | cadangan otomatis saat rate limit / gangguan / key kosong / output rusak; `none` untuk mematikan |
| `CLEANLINESS_AI_FALLBACK_MODEL` | `gemini-2.5-flash` | model cadangan |
| `CLEANLINESS_AI_LOCATION` | `global` | lokasi Vertex |

Deploy dari Cloud Shell (membuat secret, memberi akses, deploy dua fungsi, cek hidup):

```bash
curl -sL https://raw.githubusercontent.com/psmnabawi-web/nabawi/claude/upbeat-babbage-wb9ksk/apps/cleanliness-store-bba/tools/deploy-functions-cloudshell.sh | bash
```

Script di atas juga memberi role ke service account `hosting-deployer` (langkah 6), sehingga deploy backend berikutnya
cukup lewat GitHub Actions: workflow *Deploy Cleanliness Store BBA* → *Run workflow* → target `functions` (pilih provider,
model, base URL, cadangan). Secret API key tetap hanya dibuat atau diganti dari Cloud Shell.

Hasil tiap scoring menyimpan `aiProvider`, `model`, `structuredOutput`, dan `fallbackReason` di dokumen audit, dan log
`scoreEvidence ok` menyebut mesin yang dipakai. Tes modul AI: `cd functions && npm test` (tanpa dependensi).

## Deploy

1. **Pertama kali / dari Cloud Shell** (akun Owner project), sekaligus menyiapkan deploy otomatis GitHub Actions:
   ```bash
   curl -sL https://raw.githubusercontent.com/psmnabawi-web/nabawi/claude/upbeat-babbage-wb9ksk/apps/cleanliness-store-bba/setup-cloudshell.sh | bash
   ```
   `SKIP_SETUP=1` di depan perintah bila hanya ingin deploy ulang dari Cloud Shell.
2. **GitHub Actions**: workflow *Deploy Cleanliness Store BBA* → *Run workflow* (login lewat Workload Identity, tanpa key).
3. **firebase CLI** (laptop pemilik app): `firebase deploy --only hosting` dari folder ini (`firebase.json` + `.firebaserc` sudah ada).

Script `scripts/deploy-hosting.mjs` menolak deploy bila versi live bukan versi snapshot atau hasil deploy script ini
sendiri, supaya deploy dari tempat lain tidak tertimpa tanpa sengaja. `FORCE_DEPLOY=1` (atau input *force* di workflow)
memaksa. Rollback: Firebase Console → Hosting → riwayat rilis → *Rollback* ke versi sebelumnya.

## Desain visual (Okt 2026)

Palet diturunkan dari logo Bangor: lime (`--brand`) sebagai aksen progres/aktif, navy gelap untuk sidebar, latar abu lembut
dengan kartu putih, font Inter. Token warna, radius, dan bayangan ada di `:root` pada `public/styles.css`.
Di layar ≤ 900px sidebar diganti **bottom navigation** (Dashboard, Evidence, Master), logo pindah ke topbar, dan toast
muncul di atas bottom nav. Semua nama class dipertahankan sehingga `app.js` tidak bergantung pada tampilan.
Pratinjau layar boot dan modal skor final: `EXTRA=1 NODE_PATH=$(npm root -g) node tools/preview.mjs public /tmp/preview-out`.

## Pembaruan UX (Okt 2026)

- **Evidence (crew, HP):** bar progres sticky dengan tombol *Berikutnya* ke titik yang belum difoto, chip navigasi per area
  dengan progres (mis. Kitchen Equipment 2/6), kartu berpenanda warna status, tombol *Ambil Foto / Foto Ulang* yang besar
  (tanpa teks bawaan browser), dan tombol foto terkunci sampai store + crew dipilih.
- **Dashboard:** rekap 3 shift diurutkan dari store bermasalah (belum submit, terlambat, belum mulai, progress) ke yang
  beres; ringkasan per shift di atas tabel; store tanpa crew ditandai dan ditaruh paling bawah; kolom store sticky saat
  tabel digeser di HP; KPI 2 kolom di HP.
- **Master Store:** pencarian store/kode/nama crew, daftar crew per store (klik baris), badge *BELUM ADA CREW*.
- Perbaikan bug lama: halaman melebar keluar layar di HP (Dashboard & Evidence), teks jumlah crew menempel pada nama store.

Cek visual sebelum deploy (butuh Playwright + Chromium):

```bash
NODE_PATH=$(npm root -g) node tools/preview.mjs public /tmp/preview-out        # screenshot desktop + HP, deteksi overflow
INTERACT=1 NODE_PATH=$(npm root -g) node tools/preview.mjs public /tmp/preview-out   # uji alur UX (PASS/FAIL)
```

## Tes

```bash
npm test   # tanpa dependensi; node >= 20
```
