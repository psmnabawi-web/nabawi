# Kepatuhan Filter Oil (halaman web + export Excel)

Halaman web untuk melihat **store mana yang tidak patuh** menjalankan filter minyak sesuai jadwal slot. Halaman ini juga bisa **export Excel** yang rapi dan berformula. Data dibaca langsung dari Firestore app Trecking Filter Oil (`trecking-filter-oil-store`). Halaman ini hanya membaca dan tidak pernah menulis ke database.

- **Alamat:** situs Firebase Hosting terpisah di project yang sama, mis. `https://kepatuhan-filter-oil.web.app`. Nama pastinya tertulis di ringkasan run workflow *Deploy Kepatuhan Filter Oil*. Situs utama app (`trecking-filter-oil-store.web.app`) tidak disentuh, dan script deploy menolak menerbitkan ke situs itu.
- **Isi halaman:**
  - KPI: skor kepatuhan, % slot terlaksana, % tepat waktu, jumlah slot tidak dikerjakan, jumlah store tidak patuh.
  - Peringkat store dari skor terendah.
  - Peta kepatuhan harian (store × tanggal).
  - Detail per slot, dengan pilihan hanya menampilkan yang bermasalah.
  - Filter periode, area, dan target skor.
- **Export Excel**, 4 sheet:
  - *Ringkasan Store*: rumus COUNTIFS/SUMIFS ke sheet Detail; status *Tidak patuh* mengikuti target di sheet Parameter.
  - *Harian*: skor per store per hari, dalam bentuk rumus, dengan skala warna.
  - *Detail Slot*: data per slot, dengan filter dan freeze pane.
  - *Parameter*: periode, target (sel input), toleransi, jam slot, sumber data.

## Aturan penilaian

Aturan mengikuti pengaturan app, dokumen `settings/app`:

| Kondisi | Status | Skor |
|---|---|---|
| Catatan filter dalam ±`toleranceMin` (30) menit dari jam slot | Tepat waktu | 1 |
| Lebih awal dari toleransi | Terlalu awal | 0,5 |
| Lebih lambat dari toleransi | Terlambat | 0,5 |
| Tidak ada catatan untuk slot itu | Tidak dikerjakan | 0 |

- **Slot wajib:** setiap slot (`slot1`..`slotN`, saat ini 09.00, 16.00, 23.30) per store aktif per hari, mulai `activeFrom` store.
- **Slot hari ini** baru dihitung setelah jam slot + toleransi lewat.
- **Skor kepatuhan** = total skor ÷ slot wajib. Store *Tidak patuh* bila skornya di bawah target (default 90%, bisa diubah di halaman).
- **Foto galeri** = bukti foto yang waktunya diambil dari berkas (`evidenceTimeSource` = File lastModified, trust LOW), bukan dari kamera app. Angka ini perlu diawasi.

## Setup & deploy

1. Sekali saja, di Cloud Shell akun Owner project:

   ```bash
   curl -sL https://raw.githubusercontent.com/psmnabawi-web/nabawi/claude/adoring-dijkstra-78ese7/apps/filter-oil-kepatuhan/setup-cloudshell.sh | bash
   ```

   Script ini membuat service account `kepatuhan-deployer` (Firebase Hosting Admin) dan mengizinkan GitHub Actions repo ini memakainya lewat Workload Identity. Tanpa key dan tanpa secret.

2. **Deploy otomatis** setiap ada perubahan di `apps/filter-oil-kepatuhan/**` pada branch default, atau manual lewat tab Actions → *Deploy Kepatuhan Filter Oil* → *Run workflow*. Situs dibuat otomatis saat deploy pertama.

## Catatan keamanan

Aturan Firestore app saat ini mengizinkan **siapa pun membaca data tanpa login**, termasuk lewat REST API publik. Karena itu halaman ini tidak memakai login. Kalau aturan Firestore nanti diperketat (sangat disarankan), halaman ini akan menampilkan pesan "akses data ditolak" dan perlu ditambah login dengan metode yang sama seperti app.

## Uji lokal

```bash
cd apps/filter-oil-kepatuhan
npm test                                   # logika kepatuhan + script deploy (API tiruan)
python3 -m http.server -d public 8080      # buka http://localhost:8080
```
