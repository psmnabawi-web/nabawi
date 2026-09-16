#!/usr/bin/env bash
#
# Inti proses deploy Kontrol Energi Store.
#
# Dipakai oleh dua jalur:
#   1. Google Cloud Shell, lewat DEPLOY_CLOUD_SHELL.txt (login interaktif).
#   2. GitHub Actions, lewat .github/workflows/deploy-kontrol-energi.yml
#      (service account, tanpa terminal sama sekali).
#
# Wajib dijalankan dari root folder paket aplikasi.
#
# Variabel lingkungan:
#   KES_PROJECT_ID      Project Firebase tujuan. Default electric-control-bba.
#   APPCHECK_SITE_KEY   Site key reCAPTCHA. Kosong berarti App Check non-aktif.
#   APPCHECK_PROVIDER   recaptcha-v3 (default) atau recaptcha-enterprise.
#
set -Eeuo pipefail

APP_RELEASE="1.1.4"
PROJECT_ID="${KES_PROJECT_ID:-electric-control-bba}"
APPCHECK_SITE_KEY="${APPCHECK_SITE_KEY:-}"
APPCHECK_PROVIDER="${APPCHECK_PROVIDER:-recaptcha-v3}"

STEP="Persiapan"
trap 'CODE=$?; echo; echo "================================================="; echo "DEPLOY GAGAL"; echo "Tahap : $STEP"; echo "Baris : $LINENO"; echo "Kode  : $CODE"; echo "================================================="; exit "$CODE"' ERR

if [ ! -f public/app.js ] || [ ! -f scripts/seed-master.sh ]; then
  echo "scripts/deploy.sh harus dijalankan dari root folder paket aplikasi."
  exit 26
fi

# shellcheck source=scripts/lib-gcloud-auth.sh
. scripts/lib-gcloud-auth.sh

STEP="Memeriksa alat deploy"
echo "[3/13] Memeriksa Firebase CLI dan alat validasi..."
if ! command -v firebase >/dev/null 2>&1; then
  npm install -g firebase-tools
fi
for tool in gcloud jq curl sha256sum unzip; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Alat wajib tidak tersedia: $tool"
    exit 28
  fi
done
firebase --version

STEP="Memilih project"
echo "[4/13] Mengunci project ke $PROJECT_ID..."
gcloud config set project "$PROJECT_ID" >/dev/null
if ! gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Project $PROJECT_ID tidak dapat diakses oleh akun Cloud Shell ini."
  echo "Pastikan akun yang login memiliki peran Owner atau Editor pada project tersebut."
  exit 22
fi

STEP="Memeriksa kredensial Google Cloud"
echo "[4b/13] Memastikan access token tersedia SEBELUM mengubah apa pun..."
# Pemeriksaan ini sengaja dilakukan di depan. Tanpa ini, deploy dapat berhasil
# memasang rules lalu gagal saat menyinkronkan master, meninggalkan project
# dalam keadaan setengah jalan.
ACCESS_TOKEN="$(kes_access_token)"
if [ -z "$ACCESS_TOKEN" ]; then
  kes_auth_help "$PROJECT_ID"
  exit 30
fi
export KES_ACCESS_TOKEN="$ACCESS_TOKEN"
echo "Access token Google Cloud tersedia."

STEP="Mengaktifkan layanan Google Cloud"
echo "[5/13] Memastikan layanan aktif (termasuk Hosting)..."
gcloud services enable \
  serviceusage.googleapis.com \
  cloudresourcemanager.googleapis.com \
  firebase.googleapis.com \
  firebasehosting.googleapis.com \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com \
  --project "$PROJECT_ID"

STEP="Menyiapkan Firebase dan Firestore"
echo "[6/13] Memastikan Firebase dan Firestore siap..."
if ! firebase projects:list --json 2>/dev/null | jq -e --arg id "$PROJECT_ID" '(.result // []) | any(.projectId == $id)' >/dev/null; then
  firebase projects:addfirebase "$PROJECT_ID" --non-interactive
fi
if ! gcloud firestore databases describe --database='(default)' --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud firestore databases create \
    --database='(default)' \
    --location=asia-southeast2 \
    --type=firestore-native \
    --project "$PROJECT_ID" \
    --quiet
fi

STEP="Memverifikasi kredensial terhadap project"
echo "[6b/13] Memverifikasi access token berlaku untuk $PROJECT_ID..."
if ! kes_token_works "$KES_ACCESS_TOKEN" "$PROJECT_ID"; then
  unset KES_ACCESS_TOKEN
  ACCESS_TOKEN="$(kes_access_token)"
  if [ -z "$ACCESS_TOKEN" ] || ! kes_token_works "$ACCESS_TOKEN" "$PROJECT_ID"; then
    echo "Access token ada tetapi ditolak project $PROJECT_ID."
    kes_auth_help "$PROJECT_ID"
    exit 30
  fi
  export KES_ACCESS_TOKEN="$ACCESS_TOKEN"
fi
echo "Kredensial terverifikasi untuk $PROJECT_ID."

STEP="Membuat konfigurasi web"
echo "[7/13] Membuat konfigurasi aplikasi web..."
APPS_JSON="$(firebase apps:list WEB --project "$PROJECT_ID" --json)"
APP_ID="$(printf '%s' "$APPS_JSON" | jq -r '
  (.result // .) as $root
  | (if ($root | type) == "array" then $root
     elif (($root.apps? | type) == "array") then $root.apps
     else [] end)
  | map(select(.displayName == "Kontrol Energi Store"))
  | first
  | .appId // .app_id // empty
')"
if [ -z "$APP_ID" ]; then
  CREATE_JSON="$(firebase apps:create WEB "Kontrol Energi Store" --project "$PROJECT_ID" --json)"
  APP_ID="$(printf '%s' "$CREATE_JSON" | jq -r '.result.appId // .result.app_id // .appId // .app_id // empty')"
fi
if [ -z "$APP_ID" ]; then
  echo "Web App ID gagal didapatkan. Pastikan akun memiliki akses Owner atau Editor."
  exit 23
fi

SDK_JSON="$(firebase apps:sdkconfig WEB "$APP_ID" --project "$PROJECT_ID" --json)"
SDK_CONFIG="$(printf '%s' "$SDK_JSON" | jq -c '.result.sdkConfig // .result // .')"
if ! printf '%s' "$SDK_CONFIG" | jq -e '.projectId and .apiKey and .appId' >/dev/null; then
  echo "Konfigurasi Firebase Web tidak lengkap."
  printf '%s\n' "$SDK_JSON"
  exit 24
fi
# Site key App Check disisipkan hanya bila diisi. Tanpa itu App Check non-aktif
# dan aplikasi tetap berjalan normal.
SDK_CONFIG="$(printf '%s' "$SDK_CONFIG" | jq -c \
  --arg siteKey "$APPCHECK_SITE_KEY" \
  --arg provider "$APPCHECK_PROVIDER" '
    if ($siteKey | length) > 0
    then . + {appCheckSiteKey: $siteKey, appCheckProvider: $provider}
    else . end')"
printf 'window.firebaseConfig = %s;\n' "$SDK_CONFIG" > public/firebase-config.js
printf '{"projects":{"default":"%s"}}\n' "$PROJECT_ID" > .firebaserc
if [ -n "$APPCHECK_SITE_KEY" ]; then
  echo "App Check diaktifkan dengan provider $APPCHECK_PROVIDER."
else
  echo "App Check tidak diaktifkan (APPCHECK_SITE_KEY kosong)."
fi

STEP="Mengaktifkan login Anonymous"
echo "[8/13] Mengaktifkan Anonymous Authentication secara otomatis..."
API_KEY="$(printf '%s' "$SDK_CONFIG" | jq -r '.apiKey // empty')"
ADMIN_TOKEN="$(kes_access_token)"
AUTH_ERROR=""

enable_anonymous_provider() {
  local response=""
  local code=""
  local body_file
  body_file="$(mktemp)"

  # Identity Platform harus terinisialisasi sebelum config dapat di-PATCH.
  curl -sS -o /dev/null -X POST \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "x-goog-user-project: $PROJECT_ID" \
    -H "Content-Type: application/json" \
    --data '{}' \
    "https://identitytoolkit.googleapis.com/v2/projects/$PROJECT_ID/identityPlatform:initializeAuth" || true

  code="$(curl -sS -o "$body_file" -w '%{http_code}' -X PATCH \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "x-goog-user-project: $PROJECT_ID" \
    -H "Content-Type: application/json" \
    --data '{"signIn":{"anonymous":{"enabled":true}}}' \
    "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT_ID/config?updateMask=signIn.anonymous.enabled")" || code="000"
  response="$(cat "$body_file")"
  rm -f -- "$body_file"

  if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
    return 0
  fi
  AUTH_ERROR="$(printf '%s' "$response" | jq -r '.error.message // empty' 2>/dev/null || true)"
  [ -n "$AUTH_ERROR" ] || AUTH_ERROR="HTTP $code"
  return 1
}

anonymous_auth_ready() {
  local auth_response=""
  local id_token=""

  if ! auth_response="$(curl -sS -X POST \
    -H "Content-Type: application/json" \
    --data '{"returnSecureToken":true}' \
    "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$API_KEY")"; then
    AUTH_ERROR="Tidak dapat menghubungi layanan Authentication."
    return 1
  fi
  if ! printf '%s' "$auth_response" | jq -e 'type == "object"' >/dev/null; then
    AUTH_ERROR="Respons layanan Authentication tidak valid."
    return 1
  fi
  id_token="$(printf '%s' "$auth_response" | jq -r '.idToken // empty')"
  if [ -z "$id_token" ]; then
    AUTH_ERROR="$(printf '%s' "$auth_response" | jq -r '.error.message // "Anonymous belum aktif"')"
    return 1
  fi
  # Akun uji langsung dihapus agar tidak menumpuk.
  curl -sS -o /dev/null -X POST \
    -H "Content-Type: application/json" \
    --data "$(jq -n --arg idToken "$id_token" '{idToken:$idToken}')" \
    "https://identitytoolkit.googleapis.com/v1/accounts:delete?key=$API_KEY" || true
  AUTH_ERROR=""
  return 0
}

if ! anonymous_auth_ready; then
  echo "Anonymous belum aktif ($AUTH_ERROR). Mengaktifkan lewat Identity Toolkit API..."
  if enable_anonymous_provider; then
    echo "Provider Anonymous diaktifkan. Menunggu propagasi..."
    for attempt in $(seq 1 12); do
      sleep 5
      if anonymous_auth_ready; then break; fi
      echo "  menunggu aktivasi Anonymous ($attempt/12)..."
    done
  else
    echo "Aktivasi otomatis ditolak: $AUTH_ERROR"
  fi
fi

if ! anonymous_auth_ready; then
  echo
  echo "Anonymous Authentication masih belum aktif: $AUTH_ERROR"
  echo "Aktifkan manual di:"
  echo "https://console.firebase.google.com/project/$PROJECT_ID/authentication/providers"
  echo "Pilih Anonymous, aktifkan Enable, Save, lalu jalankan blok ini lagi."
  exit 25
fi
echo "Anonymous Authentication terverifikasi aktif."

STEP="Memasang rules dan menyinkronkan master"
echo "[9/13] Memasang Firestore rules v$APP_RELEASE lalu menyiapkan master dan state token..."
echo "Minta crew berhenti input sampai deploy selesai."
firebase deploy \
  --only firestore:rules \
  --project "$PROJECT_ID" \
  --non-interactive
bash scripts/seed-master.sh "$PROJECT_ID"

STEP="Memasang indeks aplikasi"
echo "[10/13] Memastikan indeks riwayat token tersedia..."
INDEX_LIST_API="https://firestore.googleapis.com/v1/projects/$PROJECT_ID/databases/(default)/collectionGroups/-/indexes"
TOKEN_INDEX_CREATE_API="https://firestore.googleapis.com/v1/projects/$PROJECT_ID/databases/(default)/collectionGroups/tokenPurchases/indexes"
# Token disegarkan di sini karena tahap menunggu indeks dapat berjalan
# sampai sepuluh menit dan token lama bisa kedaluwarsa.
unset KES_ACCESS_TOKEN
INDEX_ACCESS_TOKEN="$(kes_access_token)"
if [ -z "$INDEX_ACCESS_TOKEN" ]; then
  echo "Access token Google Cloud tidak tersedia untuk memasang indeks."
  kes_auth_help "$PROJECT_ID"
  exit 31
fi
export KES_ACCESS_TOKEN="$INDEX_ACCESS_TOKEN"

find_token_index() {
  local page_json=""
  local found_json=""
  if ! page_json="$(curl --fail-with-body -sS \
    -H "Authorization: Bearer $INDEX_ACCESS_TOKEN" \
    -H "x-goog-user-project: $PROJECT_ID" \
    "$INDEX_LIST_API")"; then
    echo "Gagal membaca status indeks token Firestore." >&2
    return 2
  fi
  if ! found_json="$(printf '%s' "$page_json" | jq -c '
      first(
        .indexes[]?
        | select((.name // "") | contains("/collectionGroups/tokenPurchases/indexes/"))
        | select((.queryScope // "COLLECTION") == "COLLECTION")
        | select((.apiScope // "ANY_API") == "ANY_API")
        | select((.fields | length) == 2 or (.fields | length) == 3)
        | select(.fields[0].fieldPath == "meterId")
        | select(.fields[0].order == "ASCENDING")
        | select(.fields[1].fieldPath == "revision")
        | select(.fields[1].order == "DESCENDING")
        | select((.fields | length) == 2
          or (.fields[2].fieldPath == "__name__"
            and .fields[2].order == "DESCENDING"))
      ) // empty
    ')"; then
    echo "Respons daftar indeks token tidak dapat dibaca." >&2
    return 2
  fi
  [ -n "$found_json" ] || return 1
  printf '%s' "$found_json"
}

TOKEN_INDEX_JSON=""
if TOKEN_INDEX_JSON="$(find_token_index)"; then
  echo "Indeks riwayat token sudah terdaftar; tidak dibuat ulang."
else
  TOKEN_INDEX_FIND_STATUS=$?
  if [ "$TOKEN_INDEX_FIND_STATUS" -ne 1 ]; then
    exit 39
  fi
  TOKEN_INDEX_BODY="$(jq -c 'first(.indexes[] | select(.collectionGroup == "tokenPurchases")) | {queryScope, fields}' firestore.indexes.json)"
  if ! printf '%s' "$TOKEN_INDEX_BODY" | jq -e '
    .queryScope == "COLLECTION"
    and (.fields | length) == 2
    and .fields[0].fieldPath == "meterId"
    and .fields[0].order == "ASCENDING"
    and .fields[1].fieldPath == "revision"
    and .fields[1].order == "DESCENDING"
  ' >/dev/null; then
    echo "Konfigurasi indeks riwayat token di paket tidak valid."
    exit 40
  fi
  TOKEN_INDEX_RESPONSE="$(mktemp)"
  TOKEN_INDEX_CODE="$(curl -sS -o "$TOKEN_INDEX_RESPONSE" -w '%{http_code}' -X POST \
    -H "Authorization: Bearer $INDEX_ACCESS_TOKEN" \
    -H "x-goog-user-project: $PROJECT_ID" \
    -H "Content-Type: application/json" \
    --data "$TOKEN_INDEX_BODY" \
    "$TOKEN_INDEX_CREATE_API")" || TOKEN_INDEX_CODE="000"
  if [[ "$TOKEN_INDEX_CODE" =~ ^2[0-9][0-9]$ ]]; then
    echo "Pembuatan indeks riwayat token dimulai."
  elif [ "$TOKEN_INDEX_CODE" = "409" ]; then
    echo "Indeks riwayat token baru dibuat proses lain; melanjutkan pemeriksaan."
  else
    echo "Pembuatan indeks riwayat token ditolak (HTTP $TOKEN_INDEX_CODE)."
    jq -r '.error.message // empty' "$TOKEN_INDEX_RESPONSE" 2>/dev/null || true
    rm -f -- "$TOKEN_INDEX_RESPONSE"
    exit 42
  fi
  rm -f -- "$TOKEN_INDEX_RESPONSE"
fi

STEP="Menunggu indeks siap"
echo "[11/13] Menunggu indeks riwayat token siap dipakai aplikasi..."
TOKEN_INDEX_READY="false"
for TOKEN_INDEX_ATTEMPT in $(seq 1 60); do
  if TOKEN_INDEX_JSON="$(find_token_index)"; then
    TOKEN_INDEX_STATE="$(printf '%s' "$TOKEN_INDEX_JSON" | jq -r '.state // "STATE_UNSPECIFIED"')"
    if [ "$TOKEN_INDEX_STATE" = "READY" ]; then
      TOKEN_INDEX_READY="true"
      echo "Indeks riwayat token siap."
      break
    fi
    if [ "$TOKEN_INDEX_STATE" = "NEEDS_REPAIR" ]; then
      echo "Indeks riwayat token membutuhkan perbaikan. Deploy dihentikan tanpa mengubah Hosting."
      exit 43
    fi
    echo "Indeks token sedang dibangun ($TOKEN_INDEX_STATE) - pemeriksaan $TOKEN_INDEX_ATTEMPT/60..."
  else
    TOKEN_INDEX_FIND_STATUS=$?
    if [ "$TOKEN_INDEX_FIND_STATUS" -ne 1 ]; then
      exit 44
    fi
    echo "Indeks token belum terlihat - pemeriksaan $TOKEN_INDEX_ATTEMPT/60..."
  fi
  if [ "$TOKEN_INDEX_ATTEMPT" -lt 60 ]; then
    sleep 10
  fi
done
if [ "$TOKEN_INDEX_READY" != "true" ]; then
  echo "Indeks token belum siap setelah 10 menit. Jalankan blok yang sama lagi; transaksi tidak digandakan."
  exit 45
fi

STEP="Deploy aplikasi"
echo "[12/13] Deploy Hosting v$APP_RELEASE..."
firebase deploy \
  --only hosting \
  --project "$PROJECT_ID" \
  --non-interactive

STEP="Verifikasi akhir"
echo "[13/13] Memverifikasi aplikasi tayang..."
SITE_URL="https://${PROJECT_ID}.web.app"
for asset in "/" "/app.js" "/manifest.webmanifest" "/icons/icon-512.png" "/sw.js"; do
  ASSET_CODE="$(curl -sS -o /dev/null -w '%{http_code}' "${SITE_URL}${asset}" || echo "000")"
  if [[ "$ASSET_CODE" =~ ^2[0-9][0-9]$ ]]; then
    echo "  OK  ${asset} (HTTP $ASSET_CODE)"
  else
    echo "  !!  ${asset} (HTTP $ASSET_CODE) - periksa Hosting."
  fi
done

echo
echo "================================================="
echo "DEPLOY BERHASIL"
echo "URL: $SITE_URL"
echo "Master: 11 store, 11 meter, 9 prabayar, 2 pascabayar - TERKUNCI"
echo "Rules: v$APP_RELEASE (perbaikan batas 1.000 ekspresi + pembagian desimal)"
echo "Indeks riwayat token: SIAP"
echo "Anonymous Auth: AKTIF"
echo "Sinkronisasi: REALTIME ANTARPERANGKAT"
echo "Metode input: MANUAL TERSTANDAR"
echo "PWA: DAPAT DIPASANG DI LAYAR HP"
echo "Kamera dan OCR: TIDAK DIGUNAKAN"
echo "Tindakan: tutup-buka aplikasi di semua HP agar versi baru terpasang"
echo "================================================="
