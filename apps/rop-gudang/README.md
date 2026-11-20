# ROP Gudang — rekomendasi pembelian dari stok Zahir

Web app statis + data bersama tim (Cloud Firestore). Alur kerja tim:

**Download stok dari Zahir → upload ke aplikasi → rekomendasi PR muncul di semua perangkat tim → export Excel / salin teks PR / cetak PO.**

File Zahir dibaca di browser; hasilnya disimpan sebagai **data terbaru tim** sehingga siapa pun yang membuka aplikasi (dengan link tim) melihat file yang di-upload terakhir. Parameter ROP (pemakaian/hari, buffer, lead time, MOQ, harga) dibaca langsung dari Google Sheet yang sudah dipakai tim (tab `PKU`), jadi tidak ada data ganda.

## SOP harian (untuk admin SCM / purchasing)

| Langkah | Yang dilakukan | Waktu |
|---|---|---|
| 1 | Zahir → laporan **Daftar Produk Per Gudang** → download untuk gudang **SCM PKU** dan **Head Quarter / Produksi PKU** (2 file, atau 1 file berisi keduanya). Jangan diedit. | 2 menit |
| 2 | Buka aplikasi → pilih **kedua file sekaligus** di kotak **Upload stok Zahir** (atau upload satu, lalu **+ Tambah file**). Stok dijumlah per kode. | 10 detik |
| 3 | Cek bar hijau **File Zahir terverifikasi** (semua subtotal cocok). Bila merah: download ulang. | — |
| 4 | Nolkan **Final PR** untuk barang yang sudah dipesan tetapi belum datang (aplikasi tidak menghitung PO outstanding). | 2–5 menit |
| 5 | Review tab **Rekomendasi PR** dari atas (OOS → Kritis → Order). Ubah **Final PR** bila perlu + isi catatan. | 10–15 menit |
| 6 | **Export Excel** (arsip & dasar PO) dan/atau **Salin teks PR** (kirim ke WhatsApp purchasing). | 1 menit |

Perubahan manual tersimpan per file (dikunci SHA-256 file) untuk seluruh tim, tercatat di sheet **Log Perubahan**, dan bisa dibatalkan dengan **Reset perubahan**.

## Data bersama tim

| Yang dibagikan | Perilaku |
|---|---|
| File Zahir terakhir | Upload siapa pun langsung jadi data terbaru di semua perangkat (tanpa reload). Upload lama tersimpan di **Riwayat** dan bisa dipakai lagi. |
| Final PR, catatan, tanggal stok, gudang dihitung | Tersinkron per file; dua orang yang mengedit item berbeda tidak saling menimpa. Saat seseorang sedang mengetik di sel, perubahan dari tim ditunda sampai sel ditinggalkan. |
| Nomor PO | Diambil dari nomor terakhir tim (transaksi), jadi dua perangkat tidak mencetak nomor yang sama. |
| Link Google Sheet parameter | Ikut tersimpan untuk tim; perangkat baru cukup punya kode tim. |

**Akses = kode tim.** Data ada di `ropGudang/{kodeTim}` (Firestore project `sssg-dashboard-2026`). Kode tim (43 karakter acak) hanya ada di **link tim** `https://<situs>.web.app/#team=<KODE>` (Pengaturan → **Salin link aplikasi untuk tim**, sudah membawa link sheet). Tiap perangkat cukup membuka link itu sekali. Tanpa kode, data tidak bisa dibaca/ditulis dan daftar kode tidak bisa dilihat (`firestore.rules`). Bila link bocor: Pengaturan → **Buat kode tim baru** → upload ulang → kirim link baru ke tim.

Tanpa koneksi atau bila Firestore gagal, aplikasi tetap jalan dengan data di perangkat itu (pesan kuning/merah di kartu Upload).

## MOQ (minimum order purchasing)

MOQ yang terlalu besar membuat PR melebihi kebutuhan dan DSI tidak bisa turun ke target. Aturannya:

- **Kebutuhan** = Pemakaian × (Buffer + Lead time) − SOH (sesuai parameter master). Ini angka yang seharusnya dibeli dan selalu ditampilkan di samping Final PR. MOQ diuji terhadap Kebutuhan yang sudah dibulatkan ke `Kelipatan Order` master.
- **Batas kelebihan MOQ** (Pengaturan, default **2 hari pemakaian**): MOQ diikuti hanya bila menambah ≤ batas. Lebih dari itu, Final PR = Kebutuhan dan item ditandai **MOQ ditahan** (purchasing negosiasi MOQ/kemasan, cari supplier lain, atau isi Final PR manual bila memang harus ikut MOQ).
- **0** = selalu sesuai kebutuhan (MOQ hanya info). **999** = selalu ikut MOQ (perilaku lama).
- Kolom **MOQ (hari pemakaian)** menunjukkan seberapa besar MOQ dibanding pemakaian; Data issue *MOQ melebihi kebutuhan* memberi usulan **MOQ wajar = 1 siklus order** (pemakaian × hari antar order, dibulatkan kemasan).
- **Lebih dari kebutuhan** (qty & Rp) = Final PR − Kebutuhan, termasuk karena edit manual. KPI dan Excel menampilkan nilai kebutuhan riil, kelebihan, dan jumlah MOQ ditahan.
- Hasil sama persis dengan kolom PR sheet lama: **Batas MOQ 999** (Kebutuhan sudah sama dengan sheet lama secara default).

## Stok dari beberapa gudang (SCM + Produksi)

Persediaan SCM = stok **gudang SCM PKU + gudang Produksi PKU**. Aplikasi menjumlah SOH per kode dari semua gudang yang dicentang.

- **Upload**: beberapa file sekaligus, atau **+ Tambah file** setelah file pertama. Satu file yang berisi beberapa laporan "Daftar Produk Per Gudang" bersambung (seperti tab "Stok Zahir") juga dibaca; baris Total dobel/basi di akhir laporan diabaikan dan dicatat di Data issue.
- **Gudang dihitung**: kotak centang di atas tabel. Default `DEFAULT_GUDANGS` di `config.js` (SCM PKU + Produksi PKU); gudang lain (mis. Sales) bisa dicentang manual. Pilihan tersimpan di browser.
- **Harga** gabungan = rata-rata tertimbang (total nilai ÷ total qty).
- **Pengaman**: gudang yang sama dari dua file tidak dijumlah dua kali (dipakai file terakhir); satuan yang beda antar gudang untuk kode yang sama ditandai *Satuan beda antar gudang*.
- **Jejak**: rincian SOH per gudang di layar (angka kecil di bawah SOH, dan rincian item) dan di Excel (kolom *Rincian SOH per gudang*). SOH di sheet Perhitungan berupa rumus `SUMIFS` ke sheet *Stok Zahir* untuk baris yang kolom *Dihitung* = Ya.

## Cara hitung

Default (**Dasar qty order = Buffer + Lead time**): pemicu dan qty order sama dengan sheet "Perhitungan Kebutuhan /ROP WH" (Total Safety = ROP), mengikuti Buffer dan Lead time yang disetel di master. PO outstanding tidak dihitung:

| Besaran | Rumus |
|---|---|
| Safety stock | Pemakaian/hari × Buffer (hari) |
| ROP = Stok maksimum | Pemakaian/hari × (Buffer + Lead time) |
| Kebutuhan | Pemakaian/hari × (Buffer + Lead time) − SOH Zahir (negatif dihitung 0), bila SOH ≤ ROP; selain itu 0 |
| Dibulatkan kemasan | CEILING(Kebutuhan, Kelipatan Order master) · bila kelipatan kosong = Kebutuhan |
| Final PR | MAX(MOQ, dibulatkan kemasan) bila tambahan karena MOQ ≤ Batas MOQ × Pemakaian/hari; selain itu = dibulatkan kemasan ("MOQ ditahan") |
| Lebih dari kebutuhan | Final PR − Kebutuhan (karena kemasan, MOQ, atau edit manual) |
| DSI | SOH ÷ Pemakaian/hari |
| DSI gudang | Nilai stok ÷ nilai pemakaian per hari (semua item berparameter; sama dengan kolom DSI sheet lama) |
| Batas stok fisik (target) | Pemakaian/hari × MAX(Buffer + 1, Target DSI) · SOH di atas ini = "Di atas target" |
| Kelebihan | SOH − Batas stok fisik (barang bergerak) · seluruh SOH (barang tidak bergerak) |
| DSI desain | Buffer + 0,5 hari, dibobot nilai pemakaian. ASUMSI: PR dibuat harian dan barang yang sudah di-PR tidak di-PR ulang sebelum datang |

- **Target DSI (default 3 hari)** dipakai untuk KPI dan status *Di atas target*; tidak menambah qty order. Bila Buffer + 0,5 > Target, item ditandai *Target DSI tidak tercapai* (buffer di master lebih besar dari target).
- **Pilihan "Target DSI"** (Pengaturan → Dasar qty order, atau sel `C21` di sheet Ringkasan Excel): Stok maksimum = Pemakaian × (MAX(Buffer + 1, 2 × Target − Buffer) + Lead time), sehingga rata-rata stok fisik = target. Qty order lebih besar dan order lebih jarang. Target per item bisa diisi lewat kolom `Target DSI (Hari)` di master.
- **Kelipatan**: kolom `Kelipatan Order` di master. Pembulatan otomatis Gram/Ml per 1.000 tidak aktif secara default (bisa dinyalakan di Pengaturan).
- Pengaturan yang tersimpan di browser sebelum versi ini otomatis pindah ke default baru (Buffer + Lead time, tanpa pembulatan Gram/Ml otomatis).
- **Harga**: kolom `Harga` di master (harga beli terakhir); bila kosong pakai harga satuan Zahir (HPP rata-rata).
- Kode yang ada di master tetapi tidak ada di file dihitung stok 0 (sama dengan VLOOKUP sheet lama) dan ditandai di Data issue. Aturan ini hanya berlaku bila master memang untuk gudang yang dipilih (≥ 50% kode master ada di gudang itu).

| Status | Arti | Tindakan |
|---|---|---|
| OOS | Stok 0, ada pemakaian | Order hari ini / transfer |
| Kritis | DSI ≤ lead time: habis sebelum barang datang | Order + percepat supplier |
| Order | SOH ≤ ROP | Order sesuai Final PR |
| Aman | Di atas ROP, tidak melebihi batas stok fisik (target) | — |
| Di atas target | SOH melebihi batas stok fisik (target) | Tahan order, habiskan dulu |
| Overstock | DSI > batas overstock (default 30 hari) | Tahan order, dorong pemakaian |
| Tidak bergerak | Ada stok, pemakaian 0 | Cek parameter / cuci gudang |
| Tanpa parameter | Kode tidak ada di master | Lengkapi master |

## Format file

**Stok Zahir**: laporan *Daftar Produk Per Gudang* apa adanya. Format teks bertab berekstensi .xls (format download Zahir saat ini), .xlsx, .csv, tabel HTML, dan .xls biner lama (butuh internet untuk memuat SheetJS) semuanya didukung. Struktur grup Zahir (induk gudang → gudang → kategori → produk → baris Total) dibaca bertingkat, lalu **setiap subtotal di file dicocokkan dengan jumlah baris produk**. File yang terpotong atau diedit akan ketahuan.

**Master parameter**: dibaca berdasarkan **nama header**, bukan posisi kolom.

| Header (contoh) | Wajib | Isi |
|---|---|---|
| Kode Barang | ya | sama dengan kode Zahir (spasi & huruf besar/kecil diabaikan) |
| Penjualan 1 Hari | ya | pemakaian/hari dalam **satuan Zahir** |
| Buffer Stock (Hari) | ya | safety stock dalam hari |
| Lead Time (Hari) | ya | hari dari PR sampai barang diterima |
| Minimum Order Versi Purchasing | | MOQ |
| Harga | | harga beli terakhir |
| Nama, Satuan, Kategori | | informasi & pengecekan satuan |
| Supplier | | memisah Cetak PO per supplier |
| Target DSI (Hari), Kelipatan Order, Aktif | | kolom tambahan opsional |

Tombol **Unduh template master** menghasilkan file Excel berisi semua kolom di atas (terisi parameter yang sedang dipakai). File itu bisa di-upload kembali bila Google Sheet tidak bisa diakses.

## Cetak PO

Tombol **Cetak PO** menyusun dokumen Purchase Order A4 dari item dengan Final PR > 0 (termasuk yang sudah diubah manual), lalu membuka dialog print browser. Pilih *Simpan sebagai PDF* untuk menyimpan file.

| Pengaturan | Isi |
|---|---|
| Satu PO per | **Supplier** (kolom `Supplier` di master; item tanpa supplier dikumpulkan di satu PO dengan kolom supplier kosong untuk diisi tangan) · Kategori Zahir · Kategori master · satu PO |
| Nomor PO | Awalan `PO/YYYYMMDD/` + nomor urut 3 digit. Nomor berikutnya diingat per tanggal di perangkat itu, jadi cetak ulang tidak memakai nomor yang sama. Dua perangkat berbeda bisa menghasilkan nomor sama: tetapkan satu perangkat/PIC penerbit PO. |
| Tanggal kirim | Kosong = tanggal PO + lead time terpanjang item di PO itu |
| Tampilan | Dengan/tanpa harga; Gram ditampilkan Kg dan Ml ditampilkan Liter (qty ÷ 1.000, harga × 1.000, jumlah tetap) |
| Tanda tangan | Dibuat oleh · Diperiksa · Disetujui |

Setiap cetak dicatat di **Log Perubahan** (nomor PO, kelompok, jumlah item, nilai, oleh siapa). Catatan per item tidak ikut dicetak (catatan internal).

## Export Excel

| Sheet | Isi |
|---|---|
| Ringkasan | Info file (nama, SHA-256), parameter global (sel kuning, dirujuk rumus), KPI berformula, nilai PR per kategori, **rekonsiliasi subtotal Zahir dengan SUMIFS** |
| PR | Daftar beli urut prioritas; angka diambil dari sheet Perhitungan via INDEX/MATCH (aman bila diurutkan) |
| Perhitungan | Semua item; input kuning, hasil berupa rumus. Final PR yang diubah manual berwarna oranye + catatan sel berisi rekomendasi sistem |
| Data Issue | Masalah data per prioritas + tindakan |
| Stok Zahir | Hasil baca file mentah, semua gudang |
| Log Perubahan | Siapa mengubah apa, kapan, dari berapa ke berapa |

Rumus Excel diuji: workbook ditulis tanpa nilai cache, dihitung ulang oleh LibreOffice, lalu hasilnya dibandingkan dengan hitungan aplikasi (`test/export.test.cjs`).

## Deploy otomatis (aktif)

Workflow `.github/workflows/deploy-rop-gudang.yml` menerbitkan `public/` ke situs Firebase Hosting **terpisah** di project `sssg-dashboard-2026` setiap ada perubahan di branch pengembangan / `main` (tes dulu, baru deploy). Situs SSSG tidak disentuh: config deploy memakai `site` eksplisit dan nama situs SSSG ditolak. Bisa juga dijalankan manual dari tab Actions.

Langkah **Data bersama** di workflow (aman diulang): aktifkan Cloud Firestore API, buat database `(default)` di `asia-southeast2` bila belum ada (`scripts/firestore-setup.mjs`), deploy `firestore.rules`, daftarkan web app "ROP Gudang", lalu tulis konfigurasi web app ke `config.local.json` saat deploy (tidak di-commit). Firestore sebelumnya tidak dipakai di project ini, jadi `firestore.rules` di sini adalah rules seluruh project: bila kelak ada aplikasi lain yang memakai Firestore di project yang sama, gabungkan rules-nya di file ini.

**Link untuk tim.** Link Google Sheet dan kode tim tidak ikut ter-deploy. Bagikan alamat aplikasi dengan keduanya di belakang `#`:

```
https://<situs>.web.app/#sheet=<ID_SPREADSHEET>&gid=0&tab=PKU&team=<KODE_TIM>
```

Bagian setelah `#` tidak pernah dikirim ke server. Cukup dibuka sekali per perangkat; setelah itu alamat biasa sudah memakai sheet dan data tim. Link ini juga bisa disalin dari menu Pengaturan → **Salin link aplikasi untuk tim**.

## Deploy manual ke project sendiri (opsional, ±5 menit)

1. **Google Sheet parameter** → Bagikan → Akses umum: **Siapa saja yang memiliki link → Pelihat**. Jangan *Editor*: link ini ikut ter-deploy di situs.
2. Di Google Cloud Shell (atau laptop dengan Node.js 20+), jalankan:

   ```bash
   git clone -b claude/zealous-carson-bns1ge https://github.com/psmnabawi-web/nabawi.git && cd nabawi/apps/rop-gudang && bash deploy.sh "LINK_GOOGLE_SHEET_PARAMETER"
   ```

   Script menulis `public/config.local.json` (link sheet, tidak di-commit), menjalankan tes, login Firebase, membuat project `rop-gudang-pku` bila belum ada, lalu deploy. Hasil: `https://rop-gudang-pku.web.app`. ID project lain: `PROJECT_ID=nama-lain bash deploy.sh "LINK"`.
3. Update versi: `git pull` lalu `bash deploy.sh` lagi (link lama dipakai ulang).

Tanpa deploy pun aplikasi bisa dicoba lokal: `npm run serve` lalu buka http://localhost:8080 dan isi link sheet di menu Pengaturan.

## Struktur

```
public/
  index.html, style.css, app.js   UI
  rop-core.js                     parser Zahir & master, rumus ROP, KPI, teks PR (dipakai browser & tes Node)
  excel-export.js                 workbook Excel berformula (ExcelJS)
  shared.js                       data bersama tim (Firestore): upload terakhir, edit, nomor PO, riwayat
  config.js                       konfigurasi umum (tanpa link sheet / kode tim)
  vendor/exceljs.min.js           ExcelJS 4.4.0 (MIT)
  vendor/firebase-*-compat.js     Firebase JS SDK 10.14.1 (Apache-2.0), dimuat hanya bila data bersama aktif
firestore.rules                   akses Firestore per kode tim + validasi bentuk data
scripts/serve.cjs                 server lokal dengan header = firebase.json (CSP)
scripts/firestore-setup.mjs       dipakai workflow: aktifkan Firestore & buat database (sekali)
test/                             tes unit, export (LibreOffice), e2e (Playwright), fixture SINTETIS
deploy.sh, firebase.json
```

## Tes

```bash
npm test            # logika + export Excel (+ hitung ulang LibreOffice bila terpasang)
npm run test:e2e    # Chromium: muat parameter, upload, edit, export, salin, reload, mobile, tanpa error CSP
npx -y firebase-tools@13 emulators:exec --only firestore --project demo-rop --config firebase.emulator.json "node test/shared.e2e.cjs"
                    # data bersama: 3 perangkat, realtime, nomor PO, riwayat, rules (butuh Java)
```

Fixture di `test/fixtures` adalah data sintetis. **Jangan commit file Zahir asli** (repo ini publik dan file berisi nilai persediaan).

## Keamanan & batasan

- Tidak ada login: akses data stok = memegang **kode tim** (link tim). Siapa pun yang punya link tim bisa melihat stok/harga dan meng-upload file; jadi kirim link hanya ke anggota tim. Riwayat upload tidak bisa dihapus/diubah dari aplikasi, jadi upload yang salah bisa dikembalikan lewat **Riwayat**.
- Google Sheet parameter sebaiknya *Pelihat* (bukan Editor): link sheet ikut di link tim.
- CSP ketat: skrip hanya dari situs sendiri (+ cdn.sheetjs.com untuk .xls biner lama), koneksi hanya ke Google Sheets dan Firestore.
- localStorage browser tetap dipakai sebagai cache (pengaturan, parameter, file terakhir, perubahan), sehingga aplikasi tetap bisa dibuka saat offline.
- Kuota Firestore paket gratis (Spark): 50.000 baca & 20.000 tulis per hari, jauh di atas pemakaian tim (ASUMSI ≤ 20 pengguna).
- PO outstanding sengaja tidak dihitung (keputusan pemilik). Barang yang sudah dipesan tetapi belum diterima akan direkomendasikan lagi sampai stoknya masuk Zahir: nolkan Final PR-nya secara manual.
- Belum ada alur approval PR (siapa menyetujui); log perubahan mencatat nama dari kolom "Disiapkan oleh".
