# Blast WA Scoring — Trecking Filter Oil Store

Laporan otomatis ke grup WhatsApp tentang **persentase store yang sudah dan belum scoring** di app Trecking Filter Oil Store (`trecking-filter-oil-store.web.app`).

- **Jadwal:** 12.00, 18.00, dan 00.00 WIB. Workflow `.github/workflows/filter-oil-wa-blast.yml` dijalankan di menit :02 karena slot :00 di GitHub sering tertunda.
- **Jam 00.00 = Rekap Final hari sebelumnya.** Laporan yang dibuat sebelum 06.00 WIB selalu untuk tanggal kemarin, supaya grup tidak menerima "0% sudah scoring" untuk hari yang baru dimulai.
- **App Filter Oil tidak diubah.** Script hanya membaca Firestore lewat service account **read-only** (Cloud Datastore Viewer). Tidak ada kode, rules, atau hosting app yang disentuh.
- **Biaya:** Rp0. GitHub Actions untuk repo publik gratis, dan pembacaan Firestore jauh di bawah kuota Spark 50.000 read/hari (±3 run × jumlah data scoring per hari).

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

1. **Service account read-only.** Jalankan di Cloud Shell akun Owner project:

   ```bash
   P=trecking-filter-oil-store; SA=wa-blast-reader; EMAIL=$SA@$P.iam.gserviceaccount.com
   gcloud config set project $P
   gcloud services enable iam.googleapis.com
   gcloud iam service-accounts describe $EMAIL >/dev/null 2>&1 || gcloud iam service-accounts create $SA --display-name="WA blast scoring (read-only)"
   gcloud projects add-iam-policy-binding $P --member="serviceAccount:$EMAIL" --role="roles/datastore.viewer" --condition=None --quiet >/dev/null && echo "ROLE OK"
   gcloud iam service-accounts keys create ~/fo-wa-key.json --iam-account=$EMAIL && cat ~/fo-wa-key.json
   ```

2. **GitHub Secrets.** Buka repo → Settings → Secrets and variables → Actions → *New repository secret*:

   | Secret | Isi |
   |---|---|
   | `FO_FIREBASE_SA` | Seluruh isi `fo-wa-key.json`, dari `{` sampai `}`. Setelah tersimpan, hapus file di Cloud Shell: `rm ~/fo-wa-key.json` |
   | `FO_WA_TARGET` | **Nama grup WhatsApp persis** (mis. `Filter Oil BBA`) atau ID grup `1203…@g.us`. Beberapa grup dipisah koma. |
   | `FO_WA_TOKEN` | *Opsional.* Token device Fonnte khusus Filter Oil. Kosongkan untuk memakai nomor bot yang sudah dipakai blast lain (`WA_TOKEN`). |

   Nomor bot (device Fonnte) **harus sudah jadi anggota grup tujuan**.

3. **Uji.** Tab Actions → *WA Blast Scoring Filter Oil* → *Run workflow*:
   - `dry_run`: pesan disusun tanpa dikirim. Hasilnya bisa diunduh di artifact. Hapus artifact setelah dibaca, karena repo publik.
   - `send`: kirim sekali ke grup.

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
FO_SA_KEY="$(cat ~/fo-wa-key.json)" npm run discover
FO_SA_KEY="$(cat ~/fo-wa-key.json)" npm run wa:dry-run   # pesan tersimpan di wa-out/
```
