# Kepatuhan Filter Oil (halaman web + export Excel)

Halaman web untuk melihat **store mana yang tidak patuh** menjalankan filter minyak sesuai jadwal slot. Halaman ini juga bisa **export Excel** yang rapi dan berformula. Data dibaca langsung dari Firestore app Trecking Filter Oil (`trecking-filter-oil-store`). Halaman ini hanya membaca dan tidak pernah menulis ke database.

> **Sekarang dipakai di dalam app utama.** Halaman ini tampil sebagai menu **"Export Kepatuhan"** dan tombol **Export Excel** di Dashboard app `trecking-filter-oil-store.web.app` (lihat `apps/filter-oil-app`). `public/core.js` dan `public/kepatuhan.js` dipakai bersama oleh app utama. Situs terpisah `kepatuhan-filter-oil.web.app` sudah **dimatikan**.

- **Alamat lama:** https://kepatuhan-filter-oil.web.app (dimatikan), situs Firebase Hosting terpisah di project yang sama. Script deploy menolak menerbitkan ke atau mematikan situs utama app.
- **Isi halaman:**
  - KPI: skor kepatuhan, % slot terlaksana, % tepat waktu, jumlah slot tidak dikerjakan, jumlah store tidak patuh.
  - Peringkat store dari skor terendah.
  - Peta kepatuhan harian (store × tanggal).
  - Detail per slot, dengan pilihan hanya menampilkan yang bermasalah.
  - Filter periode, area, dan target skor.
- **Export Excel**, 4 sheet:
  - *Ringkasan Store*: rumus COUNTIFS/SUMIFS ke sheet Detail; status *Tidak patuh* = compliance di bawah target di sheet Parameter.
  - *Harian*: compliance per store per hari, dalam bentuk rumus, dengan skala warna.
  - *Detail Slot*: data per slot, dengan filter dan freeze pane.
  - *Parameter*: periode, target (sel input), toleransi, jam slot, sumber data.

## Aturan penilaian

Aturan mengikuti pengaturan app (dokumen `settings/app`) dan definisi di dashboard app:

| Kondisi | Status | Dihitung dikerjakan? | Skor tertimbang |
|---|---|---|---|
| Catatan filter dalam ±`toleranceMin` (30) menit dari jam slot | Tepat waktu | ya | 1 |
| Lebih awal dari toleransi | Terlalu awal | ya | 0,5 |
| Lebih lambat dari toleransi | Terlambat | ya | 0,5 |
| Tidak ada catatan untuk slot itu | Tidak dikerjakan | tidak | 0 |

- **Slot wajib:** setiap slot (`slot1`..`slotN`, saat ini 09.00, 16.00, 23.30) per store aktif per hari, mulai `activeFrom` store.
- **Compliance** = slot dikerjakan ÷ slot wajib, sama dengan dashboard app. Store *Tidak patuh* bila compliance di bawah target. Default target 95%, sama dengan target di dashboard app, dan bisa diubah di halaman maupun di sheet Parameter.
- **Skor tertimbang** = total skor ÷ slot wajib. Angka ini pelengkap untuk melihat ketepatan waktu.
- **Slot hari ini** baru dihitung setelah jam slot + toleransi lewat. Dashboard app sudah menghitung slot yang belum jatuh tempo sebagai wajib, jadi angka hari berjalan bisa sedikit berbeda. Untuk hari yang sudah lewat, angkanya sama.
- **Foto galeri** = bukti foto yang waktunya diambil dari berkas (`evidenceTimeSource` = File lastModified, trust LOW), bukan dari kamera app. Angka ini perlu diawasi.

## Setup & deploy

1. Sekali saja, di Cloud Shell akun Owner project:

   ```bash
   curl -sL https://raw.githubusercontent.com/psmnabawi-web/nabawi/claude/adoring-dijkstra-78ese7/apps/filter-oil-kepatuhan/setup-cloudshell.sh | bash
   ```

   Script ini membuat service account `kepatuhan-deployer` (Firebase Hosting Admin) dan mengizinkan GitHub Actions repo ini memakainya lewat Workload Identity. Tanpa key dan tanpa secret.

2. **Workflow** *Deploy Kepatuhan Filter Oil*: push hanya menjalankan tes (tidak pernah deploy). Manual lewat tab Actions → *Run workflow*: `disable` mematikan situs terpisah, `deploy` menghidupkannya lagi (hanya bila memang diminta).

## Catatan keamanan

Aturan Firestore app saat ini mengizinkan **siapa pun membaca data tanpa login**, termasuk lewat REST API publik. Karena itu halaman ini tidak memakai login. Kalau aturan Firestore nanti diperketat (sangat disarankan), halaman ini akan menampilkan pesan "akses data ditolak" dan perlu ditambah login dengan metode yang sama seperti app.

## Uji lokal

```bash
cd apps/filter-oil-kepatuhan
npm test                                   # logika kepatuhan + script deploy (API tiruan)
python3 -m http.server -d public 8080      # buka http://localhost:8080
```
