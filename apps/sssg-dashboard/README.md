# Dashboard SSSG per Toko — Inti Warna (Firebase Hosting)

Dashboard statis (tanpa database) yang membaca langsung Google Sheet
"(2026) TOTAL OMSET PERHARI ALL OUTLET" dan menghitung SSSG % per bulan per toko.

## Deploy (satu kali, ±3 menit)
Prasyarat: Node.js 18+ dan akun Google yang punya akses Firebase.

```bash
cd sssg-dashboard
bash deploy.sh
```
Hasil: https://sssg-dashboard-2026.web.app (project Firebase `sssg-dashboard-2026`, akun nabawim@gmail.com; ganti lewat `PROJECT_ID=... bash deploy.sh`).

## Syarat data
1. Spreadsheet dibagikan **Siapa saja yang memiliki link → Viewer** (Bagikan → Akses umum).
   Bila tidak boleh publik, pakai `apps-script/Code.gs` (petunjuk di dalam file) dan isi `APPS_SCRIPT_URL` di `public/config.js`.
2. Untuk SSSG YoY per toko, buat sheet baru bernama **BASELINE 2025** di spreadsheet yang sama.
   Kolom: `TOKO | JANUARI | … | DESEMBER`, satu baris per toko, isi omset 2025 (angka penuh, tanpa titik).
   Template: `BASELINE_2025_template.csv`. Nama toko boleh memakai singkatan yang ada di `config.js` (mis. TJ, AF, BW, IWP, IWU, IW PYK, IW HR).
   Tanpa sheet ini, dashboard tetap jalan: SSSG YoY hanya di level perusahaan (dari sheet REKAP) dan mode **Growth MoM** tersedia per toko.

## Pencapaian target per outlet (halaman Ringkasan)
Kartu **Pencapaian target per outlet** tampil di halaman Ringkasan tanpa perlu memilih outlet: semua outlet
diurutkan dari yang paling tertinggal (merah < 80%, kuning 80–99%, hijau ≥ 100%, abu-abu = target belum diisi).
- Pencapaian = omset ÷ target **sampai hari berdata** (like-for-like) untuk bulan berjalan; target periode penuh untuk bulan lalu, YTD, dan rentang tanggal.
- Baris yang belum tercapai menampilkan kekurangan Rp dan, untuk bulan berjalan, kebutuhan Rp/hari pada sisa hari agar target bulan penuh terkejar.
- Tombol **Hanya yang belum tercapai** menyaring daftar; klik kartu outlet untuk membuka rinciannya di Ringkasan.
- Ambang warna mengikuti `ALERTS.achWarn` di `config.js`.

## Cara hitung
- SSSG YoY = Omset toko bulan ini 2026 ÷ Omset toko bulan sama 2025 − 1 (hanya toko yang ada di kedua tahun).
- Growth MoM = Omset bulan ini ÷ Omset bulan lalu − 1.
- Toko dianggap aktif bila mulai berjualan paling lambat tanggal 15 (ubah di `MIN_ACTIVE_DAYS`).
- Bulan berjalan dibandingkan like-for-like: tanggal 1–N vs 1–N pembanding; baseline 2025 diprorata N ÷ jumlah hari.
- Gudang dikeluarkan dari SSSG (`excludeFromSSSG: true`).
- Kolom dibaca dari header baris "TGL | HARI | TOTAL | …"; bila ada toko baru, tambahkan di `STORES` pada `config.js`.

## Struktur
```
firebase.json, .firebaserc         konfigurasi hosting
public/index.html, style.css       tampilan
public/app.js                      pembacaan sheet + perhitungan + grafik
public/config.js                   ID sheet, nama sheet, mapping toko, ambang warna
apps-script/Code.gs                opsi bila spreadsheet privat
BASELINE_2025_template.csv         template baseline 2025 per toko
deploy.sh                          skrip deploy
```
Setelah mengubah `config.js`, jalankan lagi `firebase deploy --only hosting`.

## Narasi AI bersama tim (proxy Apps Script)
Token API disimpan di server Apps Script, bukan di browser/kode situs.
1. Buka https://script.google.com → proyek baru → tempel isi `apps-script/AiProxy.gs`.
2. Project Settings → Script Properties: `SYLOR_TOKEN` (wajib), `SYLOR_BASE`, `SYLOR_MODEL`, `RATE_PER_MIN`, `RATE_PER_DAY` (opsional).
3. Deploy → New deployment → Web app → Execute as **Me**, Who has access **Anyone** → salin URL `/exec`.
4. Isi `AI_PROXY_URL` di `public/config.js`, lalu `bash deploy.sh`.
Catatan: siapa pun yang tahu URL proxy bisa memakainya (URL ada di kode situs); pembatas laju membatasi penyalahgunaan. Ganti token & deploy ulang bila perlu mencabut akses.

## Chat AI (brainstorm)

**Chat AI** adalah widget melayang (tombol di pojok kanan bawah, tersedia di semua halaman; menu "Chat AI" di navigasi membuka panel yang sama, tautan `#chat` membukanya saat halaman dimuat): obrolan bebas dengan model bahasa lewat proxy/token yang sama dengan Narasi AI.
Angka ringkasan periode & outlet yang sedang dipilih (omset, target, per outlet, kunjungan, peringatan) dikirim sebagai konteks
bila kotak "Sertakan data periode" dicentang. Riwayat obrolan disimpan hanya di browser (localStorage `sssg.chat`, maks 40 pesan),
12 pesan terakhir dikirim ke model sebagai konteks percakapan. Model dipilih otomatis (yang cepat dulu: deepseek-v4-flash, gemini flash, sonnet).
