# Dashboard SSSG per Toko — Inti Warna (Firebase Hosting)

Dashboard statis (tanpa database) yang membaca langsung Google Sheet
"(2026) TOTAL OMSET PERHARI ALL OUTLET" dan menghitung SSSG % per bulan per toko.

## Deploy (satu kali, ±3 menit)
Prasyarat: Node.js 18+ dan akun Google yang punya akses Firebase.

```bash
cd sssg-dashboard
bash deploy.sh
```
Hasil: https://dashboard-inti-warna.web.app (alamat utama) dan https://sssg-dashboard-2026.web.app (alamat lama, tetap aktif). Keduanya site Hosting di project Firebase `sssg-dashboard-2026`, akun nabawim@gmail.com..

## Syarat data
1. Spreadsheet dibagikan **Siapa saja yang memiliki link → Viewer** (Bagikan → Akses umum).
   Bila tidak boleh publik, pakai `apps-script/Code.gs` (petunjuk di dalam file) dan isi `APPS_SCRIPT_URL` di `public/config.js`.
2. Untuk SSSG YoY per toko, buat sheet baru bernama **BASELINE 2025** di spreadsheet yang sama.
   Kolom: `TOKO | JANUARI | … | DESEMBER`, satu baris per toko, isi omset 2025 (angka penuh, tanpa titik).
   Template: `BASELINE_2025_template.csv`. Nama toko boleh memakai singkatan yang ada di `config.js` (mis. TJ, AF, BW, IWP, IWU, IW PYK, IW HR).
   Tanpa sheet ini, dashboard tetap jalan: SSSG YoY hanya di level perusahaan (dari sheet REKAP) dan mode **Growth MoM** tersedia per toko.

## Pencapaian target per outlet (halaman Ringkasan)
Kartu **Pencapaian target per outlet** tampil di halaman Ringkasan tanpa perlu memilih outlet.
- KPI ringkas: jumlah outlet belum tercapai, tercapai, total kekurangan Rp, dan outlet tanpa target.
- Sorotan **Prioritas**: outlet dengan kekurangan Rp terbesar (bukan % terbesar) beserta kebutuhan Rp/hari pada sisa hari.
- Daftar peringkat dengan bar sejajar dan garis tanda 100%: merah < 80%, kuning 80–99%, hijau ≥ 100%, abu-abu = target belum diisi.
- Filter **Semua / Belum tercapai / Tercapai** dan urutan **% pencapaian** atau **Rp kekurangan** (pilihan diingat di browser).
- Pencapaian = omset ÷ target **sampai hari berdata** (like-for-like) untuk bulan berjalan; target periode penuh untuk bulan lalu, YTD, dan rentang tanggal.
- Klik outlet untuk membuka rinciannya. Ambang warna mengikuti `ALERTS.achWarn` di `config.js`.

## Pencapaian sales (halaman Sales)
Membaca spreadsheet terpisah "Pencapaian sales" (`SALES.SHEET_ID` di `config.js`, tab pertama bila `SHEET_NAME` kosong).
Format: satu baris per sales, kolom `Nama | Target <bulan> | target per hari | Total Price | Month to Date | omset per tanggal`.
Pencapaian = omset ÷ target sampai hari berdata (target bulan ÷ jumlah hari × hari berdata), ditampilkan juga % terhadap target bulan.
Halaman menampilkan KPI tim, sales terbaik, kekurangan terbesar, daftar peringkat (filter dan urutan), dan tombol Kirim WA.
Bagian sales otomatis ikut dalam ketiga versi pesan WhatsApp bila bulan sheet sama dengan periode yang dipilih.

## Kirim ke grup WhatsApp
Tombol **Kirim WA** di kartu "Pencapaian target per outlet" menyusun pesan WhatsApp dari periode yang sedang dipilih:
total perusahaan, sisa hari dan kebutuhan per hari, daftar outlet belum/sudah mencapai target dengan emoji status,
prioritas outlet dengan kekurangan Rp terbesar, dan tautan dashboard. Pesan bisa diedit, lalu **Salin pesan** (tempel di grup)
atau **Buka WhatsApp** (pilih grup tujuan). Tidak memakai bot atau gateway, jadi tidak ada biaya dan tidak ada risiko blokir.

## Blast otomatis ke grup WhatsApp (09.00 & 14.00 WIB)
Workflow GitHub Actions `.github/workflows/wa-blast.yml` menjalankan `scripts/wa-blast.mjs` setiap hari pukul 09.03 dan 14.03 WIB
(cron UTC `3 2,7 * * *`; menit :03 dipilih karena menit :00 adalah slot paling tertunda di GitHub). Script membuka dashboard secara
headless (Playwright), menunggu data Google Sheet termuat, mengambil pesan yang **persis sama** dengan tombol Kirim WA
(`window.SSSG.wa(mode)`), lalu mengirimkannya lewat gateway WhatsApp: grup **BOD** menerima versi rinci (dengan rupiah),
grup **Grup Leader** menerima versi persentase (tanpa rupiah; mode lain ditolak kecuali variabel `WA_LEADER_ALLOW_RUPIAH=1`).

WhatsApp resmi (Cloud API) tidak mengizinkan pengiriman ke grup, sehingga dibutuhkan gateway pihak ketiga yang memakai
nomor WhatsApp sendiri. Gunakan **nomor khusus** (bukan nomor pribadi) karena ada risiko pembatasan oleh WhatsApp.

### Dua syarat dari GitHub
1. **Jadwal hanya berjalan dari branch default.** File workflow harus ada di branch default repo (Settings → General → Default branch).
   Sebelum itu cron tidak pernah dipicu dan tombol **Run workflow** di tab Actions juga belum muncul (pemicu manual hanya bisa lewat API).
   Setelah branch default berisi workflow ini, jadwal langsung aktif: pastikan uji `dry_run` sudah dilakukan sebelum secret `send` diisi.
2. **Repo publik: jadwal dinonaktifkan otomatis setelah 60 hari tanpa commit.** GitHub mengirim email sebelumnya; aktifkan lagi di tab
   Actions → WA Blast Pencapaian → Enable workflow, atau lakukan commit apa pun.

### Setup sekali (sekitar 15 menit)
1. **Gateway.** Daftar di Fonnte (fonnte.com) atau Wablas, tambahkan device, scan QR dengan nomor WA khusus, salin token.
   Wablas memakai dua kunci: isi `WA_TOKEN` dengan `token.secret_key` (digabung dengan titik).
2. **Masukkan nomor gateway ke grup** BOD dan grup Grup Leader.
3. **Isi di GitHub** (Settings → Secrets and variables → Actions):

   | Nama | Jenis | Isi |
   |---|---|---|
   | `WA_GATEWAY` | Variable | `fonnte`, `wablas`, atau `webhook` |
   | `WA_TOKEN` | Secret | token device (Wablas: `token.secret_key`) |
   | `WA_API_URL` | Variable/Secret | Wablas: domain server, mis. `https://jogja.wablas.com` · webhook: URL tujuan (wajib https) |
   | `WA_TARGET_BOD` | Secret | ID grup BOD, format `1203…@g.us` |
   | `WA_TARGET_LEADER` | Secret | ID grup Grup Leader |
   | `WA_MODE_BOD` / `WA_MODE_LEADER` | Variable (opsional) | `detail` (default BOD) / `pct` (default Leader) / `compact` |

4. **Cari ID grup.** Fonnte: tab Actions → *WA Blast Pencapaian* → Run workflow → action `list_groups` → unduh artifact `pesan-wa-<nomor>`
   (berisi `daftar-grup.txt`), salin ID, lalu **hapus artifact** tersebut. Wablas: menu Group di panel Wablas.
5. **Uji tanpa mengirim.** Run workflow dengan action `dry_run`, baca pesannya di artifact, lalu hapus artifact.
6. **Uji kirim.** Run workflow dengan action `send`. Setelah itu jadwal berjalan sendiri.

Perilaku penting:
- Pengiriman terjadwal **tidak** menyimpan artifact (repo publik: artifact dapat diunduh siapa pun yang login GitHub). Artifact hanya
  dibuat pada mode uji (`dry_run`, `list_groups`, dan push perubahan kode) dengan masa simpan 3 hari.
- Log tidak pernah memuat token, ID grup, isi pesan, atau balasan gateway.
- Konfigurasi tidak lengkap (token kosong padahal gateway diisi, target kosong, URL bukan https, mode salah) membuat job **gagal merah**,
  bukan diam-diam dilewati. Hanya bila gateway sama sekali belum dikonfigurasi, job berjalan sebagai dry-run dengan peringatan.
- Gateway yang tidak merespons 45 detik dianggap tidak pasti dan **tidak diulang** (menghindari kiriman ganda); koneksi yang gagal
  sebelum terkirim diulang sekali.
- Setiap perubahan pada script/workflow memicu dry-run otomatis di Actions sebagai uji.

Mengubah jam: edit baris `cron` (UTC = WIB − 7). Menonaktifkan: Actions → WA Blast Pencapaian → Disable workflow.
Pesan memakai periode bulan berjalan dan data sampai tanggal terakhir yang terisi; bila sheet belum diperbarui, isinya sama dengan blast sebelumnya.

Uji lokal: `cd apps/sssg-dashboard && npm install && npx playwright install chromium && npm run wa:dry-run`.

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
