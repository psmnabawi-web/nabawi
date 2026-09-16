# Kontrol Energi Store v1.1.4

> Aplikasi statis terpisah (HTML/CSS/JS biasa + Firebase Hosting). Tidak
> berhubungan dengan aplikasi Next.js di root repository ini dan tidak ikut
> proses build-nya. Deploy ke project Firebase `electric-control-bba`.

Aplikasi web mobile-first untuk mencatat listrik prabayar dan pascabayar dengan rumus yang sesuai model setiap store.

## Yang Diperbaiki di v1.1.4

| # | Masalah pada v1.1.3 | Dampak | Perbaikan |
|---|---|---|---|
| 1 | Firestore rules melampaui batas 1.000 ekspresi per evaluasi | **Seluruh** penyimpanan pembacaan meter dan pembelian token ditolak server dengan `permission-denied`. Aplikasi hanya bisa dibaca, tidak bisa dipakai mencatat | Rules dirombak: hasil `get()` master diikat sekali dengan `let`, `hasAll`+`hasOnly` diganti `hasOnly`+`size()`, dan validasi transisi saldo dipindah ke rule `tokenStates` yang memiliki anggaran ekspresi sendiri |
| 2 | Rules memakai pembagian bilangan bulat pada `usageKwh / intervalHours` | Pembacaan dengan pemakaian dan interval sama-sama bilangan bulat, misalnya 12 kWh dalam tepat 24 jam, ditolak server | Dikalikan `24.0` lebih dulu agar aritmetika berjalan desimal |
| 3 | `firebasehosting.googleapis.com` tidak pernah diaktifkan saat deploy | Deploy Hosting dapat gagal pada project yang baru dibuat | API Hosting, Service Usage, dan Cloud Resource Manager ikut diaktifkan |
| 4 | Anonymous Authentication harus diaktifkan manual di Firebase Console | Deploy berhenti menunggu operator | Diaktifkan otomatis lewat Identity Toolkit Admin API, dengan verifikasi nyata sebelum lanjut |
| 5 | Tidak ada manifest, ikon, atau service worker | Aplikasi tidak bisa dipasang di layar HP crew; `/favicon.ico` mengembalikan HTML | Ditambahkan `manifest.webmanifest`, ikon 192/512/maskable/apple-touch, favicon, dan service worker network-first |
| 6 | Tidak ada header keamanan pada Hosting | Tidak ada CSP, anti-clickjacking, atau pembatasan izin perangkat | Ditambahkan Content-Security-Policy, X-Frame-Options, Permissions-Policy, Referrer-Policy, dan X-Content-Type-Options |
| 7 | `masterRegistry` tidak memiliki aturan akses, koleksi lain tidak ditolak eksplisit | Registry tidak dapat dibaca aplikasi; koleksi baru berisiko terbuka tanpa aturan | Registry menjadi read-only untuk user login, dan ditambahkan penolakan menyeluruh `match /{document=**}` |
| 8 | Tidak ada pengujian rules | Cacat nomor 1 dan 2 lolos ke produksi tanpa terdeteksi | Ditambahkan 35 uji otomatis terhadap Firestore emulator di `tests/rules.test.mjs` |

Tambahan opsional: Firebase App Check (reCAPTCHA v3 atau Enterprise) sudah
terpasang di aplikasi dan aktif hanya bila site key diisi saat deploy. Tanpa
App Check, siapa pun yang memiliki API key publik dapat login anonim dan
membaca seluruh data pembacaan serta pembelian token.

## Menjalankan Uji Rules

Perlu Java 11 atau lebih baru. Sekali saja untuk mengunduh emulator.

```bash
npm install @firebase/rules-unit-testing firebase
npx firebase emulators:exec --only firestore --project demo-kes "node tests/rules.test.mjs"
```

Uji ini wajib hijau sebelum `firestore.rules` di-deploy. Uji nomor satu yang
paling penting adalah `pembacaan harian prabayar menyerap token pending`,
karena kasus itulah yang gagal total pada v1.1.3.

## Prinsip Input

- Input angka meter dilakukan manual; kamera, foto, dan OCR tidak digunakan.
- Format layar aplikasi dibakukan menjadi koma desimal, contoh `2306,60`.
- Satu titik desimal dari keyboard otomatis diubah menjadi koma.
- Pemisah ribuan, huruf, tanda plus/minus, notasi ilmiah, lebih dari satu pemisah, dan lebih dari dua desimal ditolak.
- Crew wajib mengetik angka dua kali; penyimpanan hanya aktif jika kedua nilai sama.
- Data disimpan sebagai angka sehingga perhitungan kWh dan biaya konsisten.
- Prabayar: `pemakaian = sisa kWh sebelumnya + token kWh masuk − sisa kWh sekarang`.
- Pascabayar: `pemakaian = meter kumulatif sekarang − meter kumulatif sebelumnya`.
- Pembelian token prabayar dicatat saat token sudah berhasil dimasukkan ke meter: total dibayar, kWh pada struk, referensi transaksi wajib dan unik, waktu, serta crew.
- Form harian tidak meminta token secara manual. Sistem menjumlahkan otomatis seluruh pembelian sejak pembacaan valid terakhir.
- Saldo token pending dan baseline prabayar disimpan sebagai state server per meter. Pembelian token dan perubahan state terjadi dalam satu transaksi atomik sehingga tidak hilang atau terhitung ganda saat dua HP dipakai bersamaan.
- Jangan menghitung kWh dari nominal rupiah. kWh wajib disalin dari struk karena biaya admin, PPJ, dan komponen transaksi dapat berbeda.
- `Estimasi nilai energi` tetap dihitung dari `pemakaian × tarif master`; angka ini terpisah dari cash-out pembelian token.

## Fitur

- Master resmi 11 store dan 11 meter dari `Master Electric.xlsx`, termasuk 9 prabayar dan 2 pascabayar, terkunci dan read-only bagi user.
- Input meter manual terstandar maksimal 12 digit bulat dan 2 angka desimal.
- Menu Token hanya menampilkan 9 store prabayar dan menyimpan ledger pembelian yang tidak dapat diedit atau dihapus user.
- Mendukung beberapa pembelian token dalam satu interval; kWh dan nominal dijumlah otomatis pada pembacaan berikutnya.
- Pembelian setelah input meter hari ini otomatis masuk interval pembacaan berikutnya dan tidak mengubah data yang sudah ditutup.
- Nomor referensi transaksi yang sama pada meter yang sama diblokir untuk mencegah duplikasi.
- kWh token dan nominal rupiah wajib diketik dua kali. Referensi berupa kode token PLN 20 digit ditolak agar kode rahasia tidak tersimpan.
- Pembacaan pertama menjadi baseline; pembacaan berikutnya menghitung pemakaian, interval, kWh setara 24 jam, dan estimasi biaya.
- Pembelian pada hari baseline tetap tercatat untuk audit, tetapi tidak menjadi pemakaian dan tidak dihitung ulang pada hari berikutnya.
- Pascabayar memblokir angka turun. Prabayar memblokir sisa yang naik tanpa token kWh yang cukup.
- Nilai nol wajib disertai alasan dan masuk status perlu verifikasi.
- Pengecekan baseline terbaru langsung ke server sebelum simpan. Baseline pascabayar dicari sampai pembacaan valid terakhir; baseline prabayar berasal dari state server resmi.
- Transaksi anti-duplikasi jika dua HP mencoba menyimpan meter yang sama.
- Ringkasan jaringan, tracking 11 store hari ini, dan dashboard detail per store.
- Dashboard per store menampilkan status input, angka meter terakhir, pemakaian interval, kWh setara 24 jam, biaya, kepatuhan 7 hari, tren, anomali, crew, serta grafik 7 pembacaan terakhir.
- Grafik riwayat memakai batang berbeda untuk data valid, perlu cek, baseline, dan data lama. Detail angka meter dan crew tetap tersedia melalui panel audit.
- Nilai perlu verifikasi atau melampaui kapasitas teoritis meter tetap tersimpan di audit trail dan dapat terlihat sebagai batang oranye untuk pemeriksaan, tetapi dikeluarkan dari KPI, rata-rata, biaya, dan tren valid.
- Rata-rata 7 hari hanya dibagi jumlah hari yang memiliki data valid; hari kosong tidak dianggap nol.
- Sinkronisasi realtime antarperangkat dengan indikator Live, Menghubungkan, Offline, atau Error.
- Riwayat 14 hari terbaru secara live, pemuatan riwayat lama per 100 data, serta export CSV data tampil.
- Query dibatasi agar tetap hemat kuota Firebase Spark.
- Data lama tetap dapat dibaca. Data prabayar lama tidak dipakai sebagai baseline karena basis pembacaannya dahulu belum dibedakan; input pertama v1.1.1 menjadi baseline baru.

## Cara Deploy

Project sudah dikunci ke `electric-control-bba`. Tersedia dua jalur.

### Jalur A - Google Cloud Shell (paling cepat untuk sekali jalan)

1. Buka <https://console.cloud.google.com/> lalu klik ikon Cloud Shell.
2. Upload `Kontrol_Energi_Store_Firebase_v1.1.4.zip`.
3. Minta seluruh crew berhenti input sampai deploy selesai.
4. Jalankan satu baris:

   ```bash
   unzip -p Kontrol_Energi_Store_Firebase_v1.1.4.zip DEPLOY_CLOUD_SHELL.txt | bash
   ```

Blok ini tidak menanyakan apa pun. Script memasang rules lebih dulu,
menyinkronkan master dan state token, menunggu indeks siap, baru menerbitkan
Hosting, lalu memverifikasi aset benar-benar tayang.

### Jalur B - GitHub Actions (tanpa terminal, untuk deploy berikutnya)

Persiapan sekali saja, lalu setiap deploy cukup satu klik dari tab Actions.

1. Buat service account dan kunci JSON. Jalankan sekali di Cloud Shell:

   ```bash
   PROJECT_ID=electric-control-bba
   SA=kes-deployer
   gcloud config set project "$PROJECT_ID"
   gcloud iam service-accounts create "$SA" --display-name="Kontrol Energi deployer" || true
   for ROLE in roles/firebase.admin roles/datastore.owner                roles/serviceusage.serviceUsageAdmin roles/iam.serviceAccountUser; do
     gcloud projects add-iam-policy-binding "$PROJECT_ID"        --member="serviceAccount:$SA@$PROJECT_ID.iam.gserviceaccount.com"        --role="$ROLE" --condition=None >/dev/null
   done
   gcloud iam service-accounts keys create kes-deployer.json      --iam-account="$SA@$PROJECT_ID.iam.gserviceaccount.com"
   echo "Unduh kes-deployer.json lewat menu titik tiga Cloud Shell Editor."
   ```

2. Di GitHub, buka Settings, Secrets and variables, Actions, lalu tambahkan
   secret `KES_FIREBASE_SERVICE_ACCOUNT` berisi seluruh isi `kes-deployer.json`.
   Opsional: `KES_PROJECT_ID` dan `KES_APPCHECK_SITE_KEY`.
3. Hapus `kes-deployer.json` dari Cloud Shell setelah disalin.
4. Buka tab Actions, pilih **Deploy Kontrol Energi Store**, klik **Run
   workflow**, ketik `DEPLOY` pada kolom konfirmasi.

Workflow menjalankan 35 uji Firestore rules lebih dulu. Bila ada uji yang
gagal, deploy dibatalkan dan produksi tidak tersentuh.

### Opsi tambahan

- App Check: `export APPCHECK_SITE_KEY="site-key-anda"` sebelum Jalur A, atau
  isi secret `KES_APPCHECK_SITE_KEY` untuk Jalur B.
- Project lain: `export KES_PROJECT_ID="project-id-lain"`.

Setelah deploy, minta crew menutup dan membuka kembali aplikasi. Service
worker akan memuat ulang satu kali agar rumus dan master versi baru langsung
dipakai.

## Master Terkunci

- Sumber audit: `source/Master_Electric.xlsx`.
- Master aplikasi: `public/master-electric.json`.
- Jumlah: 11 store dan 11 meter; kode store, nama store, dan nomor seri unik.
- Data yang dikunci: kode, nama, area, model listrik, koordinat, nomor seri, daya meteran, dan tarif per kWh.
- Excel tidak menyediakan target kWh, jam input, jumlah digit display, digit desimal, atau batas normal harian. Karena itu aplikasi menggunakan kebijakan global maksimal dua desimal dan kapasitas teoritis `daya meter ÷ 1000 × 24 jam` sebagai kontrol outlier, tanpa mengubah master.
- Multiplier pembacaan menggunakan default sistem `1`.
- Perubahan master hanya dilakukan melalui rilis resmi, bukan oleh crew.
- Seeder mencocokkan kode dan nomor seri dengan data existing agar baseline dan riwayat tidak terputus.

## Catatan Operasional

- Input sebaiknya dilakukan pada jam yang relatif sama setiap hari.
- Tanggal operasional aplikasi selalu memakai zona `Asia/Jakarta`. Pastikan tanggal dan jam HP benar sebelum membaca meter karena waktu perangkat dipakai untuk menghitung panjang interval.
- Pembelian token dicatat segera setelah token berhasil dimasukkan ke meter; jangan simpan kode token PLN 20 digit di kolom referensi.
- Sebelum menyimpan pembacaan prabayar, crew wajib mengonfirmasi seluruh pembelian sejak pembacaan valid terakhir sudah tercatat.
- Status Live berarti data terbaru sudah diterima dari server.
- Penyimpanan diblokir saat offline agar baseline dan duplikasi tetap konsisten.
- Setelah deploy, tutup-buka aplikasi pada seluruh HP agar v1.1.3 menggantikan tab lama.
- Dokumen lama v1.1.2 tetap dapat dibaca, tetapi tab v1.1.2 yang masih terbuka sengaja ditolak saat mencoba menyimpan data baru. Tutup-buka seluruh HP setelah deploy merupakan langkah wajib.
- Pembacaan berstatus perlu verifikasi tidak digunakan sebagai baseline berikutnya; sistem kembali ke pembacaan valid terakhir agar salah input tidak memblokir meter selamanya.
- Tanpa foto, aplikasi tidak dapat membuktikan angka fisik setelah kejadian. Kontrol penggantinya adalah input dua kali, format terkunci, timestamp server, validasi angka turun/nol, audit trail, dan audit fisik berkala.
- Approval dinonaktifkan selama aplikasi masih memakai login anonim.
- URL masih perlu diperlakukan sebagai tautan internal sampai login ber-role/store assignment diterapkan.
- Paket tidak memakai Firebase Storage dan disiapkan untuk paket Spark.
- Reset seluruh data input harus dilakukan oleh admin dengan backup dan masa henti input. Urutannya: hentikan input; backup; hapus tepat collection `readings`, `tokenPurchases`, dan seluruh 9 dokumen `tokenStates`; lalu jalankan kembali deploy/seeder dari paket yang sama agar 9 state kosong dibuat ulang. Menghapus hanya satu atau dua collection dapat meninggalkan saldo/baseline yatim dan akan diblokir oleh validasi deploy.
- Jangan pernah menghapus `stores`, `meters`, atau `masterRegistry`. Setelah reset, input pertama setiap meter menjadi baseline baru; untuk prabayar, token yang sudah tercatat sebelum baseline ditutup sebagai audit dan tidak dianggap pemakaian.

## Struktur Data

- `stores`: kode, nama, area, model listrik, koordinat, tarif, versi master, dan status lock.
- `meters`: relasi store, nomor seri, daya meteran, multiplier, versi master, dan status lock.
- `tokenPurchases`: store/meter prabayar, tanggal/waktu, total dibayar, kWh pada struk, referensi, crew, timestamp server, dan status immutable.
- `tokenStates`: accumulator server per meter prabayar berisi revision, saldo transaksi pending, serta pointer baseline valid terakhir. User tidak dapat membuat atau menghapus dokumen state secara langsung.
- `readings`: model listrik, basis pembacaan, angka sekarang/sebelumnya, rentang revision serta snapshot jumlah/kWh/nominal pembelian token terkait, pemakaian, interval, biaya/nilai energi, user, status, dan exception.

Tidak ada field foto, thumbnail, base64, blob, URL gambar, atau data OCR pada pembacaan baru.
