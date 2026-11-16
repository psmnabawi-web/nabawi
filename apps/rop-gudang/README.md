# ROP Gudang — rekomendasi pembelian dari stok Zahir

Web app statis (tanpa server, tanpa database). Alur kerja tim:

**Download stok dari Zahir → upload ke aplikasi → rekomendasi PR muncul → export Excel / salin teks PR ke purchasing.**

File Zahir diproses di browser pengguna dan **tidak dikirim ke server mana pun**. Parameter ROP (pemakaian/hari, buffer, lead time, MOQ, harga) dibaca langsung dari Google Sheet yang sudah dipakai tim (tab `PKU`), jadi tidak ada data ganda.

## SOP harian (untuk admin SCM / purchasing)

| Langkah | Yang dilakukan | Waktu |
|---|---|---|
| 1 | Zahir → laporan **Daftar Produk Per Gudang** → download (Excel/.xls). Jangan diedit. | 1 menit |
| 2 | Buka aplikasi → tarik file ke kotak **Upload stok Zahir**. | 10 detik |
| 3 | Cek bar hijau **File Zahir terverifikasi** (semua subtotal cocok). Bila merah: download ulang. | — |
| 4 | Nolkan **Final PR** untuk barang yang sudah dipesan tetapi belum datang (aplikasi tidak menghitung PO outstanding). | 2–5 menit |
| 5 | Review tab **Rekomendasi PR** dari atas (OOS → Kritis → Order). Ubah **Final PR** bila perlu + isi catatan. | 10–15 menit |
| 6 | **Export Excel** (arsip & dasar PO) dan/atau **Salin teks PR** (kirim ke WhatsApp purchasing). | 1 menit |

Perubahan manual tersimpan di browser per file (dikunci SHA-256 file), tercatat di sheet **Log Perubahan**, dan bisa dibatalkan dengan **Reset perubahan**.

## Cara hitung

Pemicu order sama dengan sheet "Perhitungan Kebutuhan /ROP WH" (Total Safety = ROP). Qty order disetel supaya **rata-rata stok fisik = target DSI** (default **3 hari**), ditambah pembulatan MOQ/kelipatan. PO outstanding tidak dihitung:

| Besaran | Rumus |
|---|---|
| Safety stock | Pemakaian/hari × Buffer (hari) |
| ROP | Pemakaian/hari × (Buffer + Lead time) |
| Stok fisik maksimum | Pemakaian/hari × MAX(Buffer + 1, 2 × Target DSI − Buffer) · stok sesaat setelah barang datang |
| Stok maksimum (dasar PR) | Stok fisik maksimum + Pemakaian/hari × Lead time |
| Saran PR | Stok maksimum − SOH Zahir (negatif dihitung 0), bila SOH ≤ ROP; selain itu 0 |
| Final PR | MAX(MOQ, CEILING(Saran PR, Kelipatan)) |
| DSI | SOH ÷ Pemakaian/hari |
| DSI gudang | Nilai stok ÷ nilai pemakaian per hari (semua item berparameter; sama dengan kolom DSI sheet lama) |
| Kelebihan | SOH − Stok fisik maksimum (barang bergerak) · seluruh SOH (barang tidak bergerak) |
| DSI desain | Rata-rata stok fisik bila semua item diorder sesuai rumus = (Buffer + hari stok fisik maks) ÷ 2, dibobot nilai pemakaian |

- **Target DSI 3 (default) = rata-rata stok FISIK 3 hari**, sama dengan cara hitung KPI DSI gudang (nilai stok ÷ nilai pemakaian per hari). Stok fisik bergerak antara Buffer (sesaat sebelum barang datang) dan stok fisik maksimum (sesaat setelah datang); rata-ratanya = target. Contoh buffer 2 hari, target 3: stok bergerak 2–4 hari, qty order ≈ 2 hari pemakaian (order tiap ±2 hari). ASUMSI: stok direview harian.
- Bila Buffer + 0,5 > Target (buffer sudah di atas target), target tidak bisa dicapai; item ditandai *Target DSI tidak tercapai*.
- Target bisa diubah di Pengaturan (berlaku semua item) atau per item lewat kolom `Target DSI (Hari)` di master. **Target 0** = hasil Saran PR sama persis dengan kolom PR di sheet lama (order hanya sampai ROP).
- **Kelipatan**: kolom `Kelipatan Order` di master. Bila kosong, satuan Gram/Ml dibulatkan ke atas per 1.000 (bisa dimatikan di Pengaturan).
- **Harga**: kolom `Harga` di master (harga beli terakhir); bila kosong pakai harga satuan Zahir (HPP rata-rata).
- Kode yang ada di master tetapi tidak ada di file dihitung stok 0 (sama dengan VLOOKUP sheet lama) dan ditandai di Data issue. Aturan ini hanya berlaku bila master memang untuk gudang yang dipilih (≥ 50% kode master ada di gudang itu).

| Status | Arti | Tindakan |
|---|---|---|
| OOS | Stok 0, ada pemakaian | Order hari ini / transfer |
| Kritis | DSI ≤ lead time: habis sebelum barang datang | Order + percepat supplier |
| Order | SOH ≤ ROP | Order sesuai Final PR |
| Aman | Di atas ROP, tidak melebihi stok fisik maksimum | — |
| Di atas target | Stok fisik melebihi stok fisik maksimum | Tahan order, habiskan dulu |
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

**Link untuk tim.** Link Google Sheet tidak ikut ter-deploy. Bagikan alamat aplikasi dengan sumber parameter di belakang `#`:

```
https://<situs>.web.app/#sheet=<ID_SPREADSHEET>&gid=0&tab=PKU
```

Bagian setelah `#` tidak pernah dikirim ke server. Cukup dibuka sekali per perangkat; setelah itu alamat biasa sudah memakai sheet tersebut. Link ini juga bisa disalin dari menu Pengaturan → **Salin link aplikasi untuk tim**.

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
  config.js                       konfigurasi umum (tanpa link sheet)
  vendor/exceljs.min.js           ExcelJS 4.4.0 (MIT)
scripts/serve.cjs                 server lokal dengan header = firebase.json (CSP)
test/                             tes unit, export (LibreOffice), e2e (Playwright), fixture SINTETIS
deploy.sh, firebase.json
```

## Tes

```bash
npm test            # logika + export Excel (+ hitung ulang LibreOffice bila terpasang)
npm run test:e2e    # Chromium: muat parameter, upload, edit, export, salin, reload, mobile, tanpa error CSP
```

Fixture di `test/fixtures` adalah data sintetis. **Jangan commit file Zahir asli** (repo ini publik dan file berisi nilai persediaan).

## Keamanan & batasan

- Tidak ada login: siapa pun yang tahu alamat situs bisa membuka aplikasi, tetapi aplikasi tidak menyimpan data di server. Yang terlihat hanya parameter dari sheet (karena itu sheet harus *Pelihat*).
- CSP ketat: skrip hanya dari situs sendiri (+ cdn.sheetjs.com untuk .xls biner lama), koneksi hanya ke Google Sheets.
- Data tersimpan di localStorage browser: pengaturan, cache parameter, file terakhir, dan perubahan manual. Ganti perangkat = mulai dari upload lagi.
- PO outstanding sengaja tidak dihitung (keputusan pemilik). Barang yang sudah dipesan tetapi belum diterima akan direkomendasikan lagi sampai stoknya masuk Zahir: nolkan Final PR-nya secara manual.
- Belum ada alur approval PR multi-user; butuh backend (pengembangan tahap berikutnya).
