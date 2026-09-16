#!/usr/bin/env bash
#
# Reset data Firestore Kontrol Energi Store.
#
# Koleksi yang dikosongkan:
#   readings        riwayat pembacaan meter harian
#   tokenPurchases  ledger pembelian token prabayar
#   tokenStates     saldo dan baseline per meter
#   stores          master store
#   meters          master meter
#   masterRegistry  registry master
#
# Master (stores, meters, masterRegistry) dibangun ulang otomatis oleh
# scripts/seed-master.sh sesudah reset. Yang benar-benar hilang permanen adalah
# data transaksi: pembacaan meter dan pembelian token.
#
# PENGAMAN
#   1. Seluruh isi keenam koleksi diunduh lebih dulu ke satu berkas cadangan
#      NDJSON. Selama berkas itu disimpan, data masih dapat dipulihkan.
#   2. Penghapusan hanya berjalan bila KES_RESET_CONFIRM berisi persis RESET.
#   3. Penghapusan memakai perintah resmi `firebase firestore:delete` per
#      koleksi bernama, bukan loop hapus buatan sendiri, sehingga tidak ada
#      koleksi lain di project yang ikut tersentuh.
#
# Variabel lingkungan:
#   KES_PROJECT_ID      Project tujuan. Default electric-control-bba.
#   KES_RESET_CONFIRM   Wajib berisi persis RESET.
#   KES_BACKUP_DIR      Folder cadangan. Default folder kerja saat ini.
#
set -Eeuo pipefail

PROJECT_ID="${KES_PROJECT_ID:-electric-control-bba}"
BACKUP_DIR="${KES_BACKUP_DIR:-$PWD}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib-gcloud-auth.sh
. "$SCRIPT_DIR/lib-gcloud-auth.sh"

COLLECTIONS=(readings tokenPurchases tokenStates stores meters masterRegistry)

echo "================================================="
echo " RESET DATA KONTROL ENERGI STORE"
echo " Project: $PROJECT_ID"
echo "================================================="

if [ "${KES_RESET_CONFIRM:-}" != "RESET" ]; then
  echo
  echo "Reset dilewati: konfirmasi tidak diberikan."
  echo "Untuk benar-benar mengosongkan data, jalankan dengan KES_RESET_CONFIRM=RESET."
  exit 60
fi

if ! command -v firebase >/dev/null 2>&1; then
  echo "Firebase CLI tidak tersedia. Reset dibatalkan."
  exit 65
fi

ACCESS_TOKEN="$(kes_access_token)"
if [ -z "$ACCESS_TOKEN" ]; then
  echo "Access token Google Cloud tidak tersedia."
  kes_auth_help "$PROJECT_ID"
  exit 61
fi

API_BASE="https://firestore.googleapis.com/v1/projects/$PROJECT_ID/databases/(default)/documents"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/kontrol-energi-backup-$STAMP.ndjson"
WORK_DIR="$(mktemp -d)"
cleanup() {
  if [ -n "${WORK_DIR:-}" ] && [ -d "$WORK_DIR" ]; then
    rm -rf -- "$WORK_DIR"
  fi
}
trap cleanup EXIT

# Membaca seluruh dokumen satu koleksi ke berkas, dengan pagination.
# Fungsi ini hanya membaca; tidak ada operasi tulis di sini.
fetch_collection() {
  local name="$1"
  local out="$2"
  local page_token=""
  local page_json=""
  local guard=0
  local -a args

  : > "$out"
  while true; do
    args=(
      --fail-with-body -sS --get
      -H "Authorization: Bearer $ACCESS_TOKEN"
      -H "x-goog-user-project: $PROJECT_ID"
      --data-urlencode "pageSize=300"
    )
    if [ -n "$page_token" ]; then
      args+=(--data-urlencode "pageToken=$page_token")
    fi
    page_json="$(curl "${args[@]}" "$API_BASE/$name")"
    if ! printf '%s' "$page_json" | jq -e 'type == "object"' >/dev/null; then
      echo "Respons Firestore tidak valid saat membaca $name."
      exit 62
    fi
    printf '%s' "$page_json" \
      | jq -c --arg col "$name" '.documents[]? | {collection:$col, id:(.name|split("/")|last), fields:.fields}' \
      >> "$out"
    page_token="$(printf '%s' "$page_json" | jq -r '.nextPageToken // empty')"
    [ -n "$page_token" ] || break
    guard=$((guard + 1))
    if [ "$guard" -gt 5000 ]; then
      echo "Pagination $name melebihi batas aman."
      exit 63
    fi
  done
}

echo
echo "[1/3] Mengunduh cadangan sebelum mengosongkan..."
: > "$BACKUP_FILE"
TOTAL_FOUND=0
for col in "${COLLECTIONS[@]}"; do
  fetch_collection "$col" "$WORK_DIR/$col.ndjson"
  COUNT="$(wc -l < "$WORK_DIR/$col.ndjson" | tr -d ' ')"
  TOTAL_FOUND=$((TOTAL_FOUND + COUNT))
  cat "$WORK_DIR/$col.ndjson" >> "$BACKUP_FILE"
  printf '  %-16s %s dokumen\n' "$col" "$COUNT"
done
printf '  %-16s %s dokumen\n' "TOTAL" "$TOTAL_FOUND"
echo "  Cadangan: $BACKUP_FILE"

if [ "$TOTAL_FOUND" -eq 0 ]; then
  echo
  echo "[2/3] Tidak ada dokumen. Database sudah kosong."
  echo "[3/3] Selesai."
  exit 0
fi

echo
echo "[2/3] Mengosongkan koleksi dengan Firebase CLI..."
for col in "${COLLECTIONS[@]}"; do
  if [ ! -s "$WORK_DIR/$col.ndjson" ]; then
    printf '  %-16s dilewati, sudah kosong\n' "$col"
    continue
  fi
  # Perintah resmi Firebase CLI. Dibatasi pada nama koleksi aplikasi ini saja.
  firebase firestore:delete "$col" \
    --recursive \
    --force \
    --project "$PROJECT_ID" >/dev/null
  printf '  %-16s dikosongkan\n' "$col"
done

echo
echo "[3/3] Memverifikasi..."
LEFTOVER=0
for col in "${COLLECTIONS[@]}"; do
  fetch_collection "$col" "$WORK_DIR/$col-check.ndjson"
  REMAIN="$(wc -l < "$WORK_DIR/$col-check.ndjson" | tr -d ' ')"
  LEFTOVER=$((LEFTOVER + REMAIN))
  if [ "$REMAIN" -ne 0 ]; then
    printf '  SISA %-13s %s dokumen\n' "$col" "$REMAIN"
  fi
done

echo
echo "================================================="
if [ "$LEFTOVER" -eq 0 ]; then
  echo "RESET SELESAI. Database bersih."
else
  echo "RESET SELESAI TETAPI MASIH ADA $LEFTOVER DOKUMEN."
  echo "Jalankan blok yang sama sekali lagi."
fi
echo "Sebelum reset : $TOTAL_FOUND dokumen"
echo "Cadangan      : $BACKUP_FILE"
echo
echo "Unduh berkas cadangan itu lewat Cloud Shell Editor sebelum menutup"
echo "terminal, supaya data lama masih dapat dipulihkan bila diperlukan."
echo "================================================="
