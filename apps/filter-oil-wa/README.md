# Blast WA Scoring — Trecking Filter Oil Store

Laporan otomatis ke grup WhatsApp tentang **persentase store yang sudah dan belum scoring** di app Trecking Filter Oil Store (`trecking-filter-oil-store.web.app`).

- **Jadwal:** 12.00, 18.00, dan 00.00 WIB. Workflow `.github/workflows/filter-oil-wa-blast.yml` dijalankan di menit :02 karena slot :00 di GitHub sering tertunda.
- **Jam 00.00 = Rekap Final hari sebelumnya.** Laporan yang dibuat sebelum 06.00 WIB selalu untuk tanggal kemarin, supaya grup tidak menerima "0% sudah scoring" untuk hari yang baru dimulai.
- **App Filter Oil tidak diubah.** Script hanya membaca Firestore lewat service account **read-only** (Cloud Datastore Viewer). Tidak ada kode, rules, atau hosting app yang disentuh.
- **Biaya:** Rp0. GitHub Actions untuk repo publik gratis, dan pembacaan Firestore jauh di bawah kuota Spark 50.000 read/hari (±3 run × jumlah data scoring per hari).
- **Pengaturan tanpa coding:** status AKTIF/UJI/MATI, token Fonnte, grup tujuan, dan riwayat kiriman ada di Google Sheet *Pengaturan Blast WA - Scoring Filter Oil*.

## Contoh pesan

```
*Laporan Scoring Filter Oil*
Senin, 05/10/2026 · posisi 12.02 WIB

✅ *Sudah scoring: 8 dari 12 store (67%)*
1. Store A
...

❌ *Belum scoring: 4 dari 12 store (33%)*
1. Store X
...

Mohon store yang belum segera melakukan scoring hari ini.
_Pesan otomatis_
```

## Setup (sekali saja)

Tidak ada key atau secret GitHub. Login ke Firebase memakai **Workload Identity Federation**: hanya GitHub Actions dari repo ini yang boleh memakai service account read-only. Token Fonnte dan grup tujuan disimpan di Google Sheet pengaturan milik psmnabawi@gmail.com.

1. **Cloud Shell (akun Owner project), satu baris:**

   ```bash
   curl -sL https://raw.githubusercontent.com/psmnabawi-web/nabawi/claude/ecstatic-franklin-hhjvmk/apps/filter-oil-wa/setup-cloudshell.sh | bash
   ```

   Script [`setup-cloudshell.sh`](setup-cloudshell.sh) membuat service account `wa-blast-reader` (role Cloud Datastore Viewer), Workload Identity Pool `github-actions`, dan provider `nabawi-repo` yang dikunci ke repo `psmnabawi-web/nabawi`. Aman dijalankan ulang. Semuanya gratis, dan project tetap di paket Spark.

2. **Bagikan Sheet pengaturan** *Pengaturan Blast WA - Scoring Filter Oil* ke `wa-blast-reader@trecking-filter-oil-store.iam.gserviceaccount.com` sebagai **Editor**. Script menulis ke tab Riwayat.

3. **Isi tab Pengaturan:**

   | Kunci | Isi |
   |---|---|
   | `status` | `UJI` (pesan hanya dicatat di tab Riwayat), `AKTIF` (kirim ke grup), `MATI` (tidak berjalan) |
   | `fonnte_token` | Token device Fonnte (md.fonnte.com, menu Device) |
   | `grup_tujuan` | Nama grup WhatsApp persis, atau ID `1203…@g.us`. Beberapa grup dipisah koma. Nomor Fonnte harus anggota grup. |
   | `judul` | Judul pesan (default `Scoring Filter Oil`) |

   Setiap run menambah satu baris di tab **Riwayat**: waktu, jenis laporan, status kirim, angka, dan isi pesan lengkap. Error juga dicatat di sana.

4. **Jadwal hanya berjalan dari branch default repo.** Workflow ini harus ada di branch default.

Alternatif tanpa Sheet: isi secret `FO_WA_TOKEN` dan `FO_WA_TARGET`. Alternatif tanpa Workload Identity: isi secret `FO_FIREBASE_SA` dengan key service account. Secret yang terisi selalu mengalahkan isi Sheet.

## Struktur data (deteksi otomatis)

Script mendeteksi sendiri koleksi dan field yang dipakai app. Log setiap run mencatat apa yang terdeteksi: hanya nama field dan tipe, tanpa isi data. Kalau tebakannya salah, isi lewat Settings → Variables:

| Variable | Arti | Default |
|---|---|---|
| `FO_SCORE_COLLECTION` | Koleksi data scoring. Untuk sub-koleksi per store: `stores/{store}/scorings` | ditebak dari nama koleksi (hanya untuk dry-run) |
| `FO_SCORE_STORE_FIELD` | Field penunjuk store di data scoring | `storeId`, `store`, `namaStore`, … |
| `FO_SCORE_DATE_FIELD` | Field tanggal/waktu scoring | `date`, `tanggal`, `createdAt`, `timestamp`, … |
| `FO_SCORE_DATE_FORMAT` | Hanya untuk tanggal teks `5/10/2026`: `dmy` atau `mdy` | `dmy` |
| `FO_STORE_COLLECTION` | Koleksi master store | `stores` |
| `FO_STORE_NAME_FIELD` / `FO_STORE_ACTIVE_FIELD` | Field nama dan aktif/nonaktif store | `name`/`nama`/… dan `active`/`aktif`/`status` |
| `FO_STORE_LIST` | Alternatif master store: daftar nama dipisah koma | – |
| `FO_TITLE` | Judul pesan | `Scoring Filter Oil` |

Format tanggal yang didukung: Firestore Timestamp, epoch ms atau detik, teks `YYYY-MM-DD…`, ISO UTC `…Z`, dan `d/m/yyyy` atau `dd-mm-yyyy` (dengan atau tanpa nol di depan).

Data scoring dicocokkan ke store lewat ID dokumen, nama, atau kode store. Pencocokan tidak peka huruf besar/kecil maupun spasi berlebih. Data yang tidak cocok dengan store mana pun dicatat jumlahnya di log dan tidak dihitung.

## Jalan lokal

```bash
cd apps/filter-oil-wa
npm test                                   # uji end-to-end dengan server tiruan
# di Cloud Shell (login gcloud sebagai Owner/Viewer project):
FO_ACCESS_TOKEN="$(gcloud auth print-access-token)" FO_PROJECT_ID=trecking-filter-oil-store npm run discover
FO_ACCESS_TOKEN="$(gcloud auth print-access-token)" FO_PROJECT_ID=trecking-filter-oil-store npm run wa:dry-run   # pesan di wa-out/
```
