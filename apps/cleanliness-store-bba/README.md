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

## Tes

```bash
npm test   # tanpa dependensi; node >= 20
```
