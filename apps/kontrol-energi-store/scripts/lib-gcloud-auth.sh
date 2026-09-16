#!/usr/bin/env bash
#
# Pengambilan access token Google Cloud yang tahan banting.
#
# Latar belakang: pada Cloud Shell yang dibuka dari Firebase Console, perintah
# `gcloud auth print-access-token` dapat gagal dengan "You do not currently have
# an active account selected" walaupun perintah gcloud lain berhasil. Fungsi ini
# mencoba beberapa sumber kredensial secara berurutan sehingga deploy tidak
# berhenti di tengah jalan.
#
# Pemakaian:
#   source scripts/lib-gcloud-auth.sh
#   TOKEN="$(kes_access_token)"

# Mengembalikan access token pada stdout, atau string kosong bila tidak ada.
kes_access_token() {
  local token=""
  local account=""

  # Sumber 1: token yang sudah disiapkan pemanggil (mis. langkah sebelumnya).
  if [ -n "${KES_ACCESS_TOKEN:-}" ]; then
    printf '%s' "$KES_ACCESS_TOKEN"
    return 0
  fi

  if command -v gcloud >/dev/null 2>&1; then
    # Sumber 2: akun aktif gcloud.
    token="$(gcloud auth print-access-token 2>/dev/null || true)"

    # Sumber 3: ada kredensial tersimpan tetapi tidak ada yang aktif.
    if [ -z "$token" ]; then
      account="$(gcloud auth list --format='value(account)' 2>/dev/null | head -1 || true)"
      if [ -n "$account" ]; then
        gcloud config set account "$account" >/dev/null 2>&1 || true
        token="$(gcloud auth print-access-token 2>/dev/null || true)"
      fi
    fi

    # Sumber 4: service account JSON lewat GOOGLE_APPLICATION_CREDENTIALS.
    if [ -z "$token" ] && [ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ] \
      && [ -f "${GOOGLE_APPLICATION_CREDENTIALS}" ]; then
      gcloud auth activate-service-account \
        --key-file="$GOOGLE_APPLICATION_CREDENTIALS" >/dev/null 2>&1 || true
      token="$(gcloud auth print-access-token 2>/dev/null || true)"
    fi
  fi

  # Sumber 5: metadata server. Tersedia di Cloud Shell, Compute Engine, dan
  # Cloud Build, dan tidak bergantung pada konfigurasi akun gcloud.
  if [ -z "$token" ] && command -v curl >/dev/null 2>&1; then
    token="$(curl -sS --max-time 8 \
      -H 'Metadata-Flavor: Google' \
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' \
      2>/dev/null | jq -r '.access_token // empty' 2>/dev/null || true)"
  fi

  printf '%s' "$token"
}

# Mencetak petunjuk perbaikan bila token tidak bisa didapat.
kes_auth_help() {
  local project_id="${1:-}"
  echo
  echo "Tidak ada kredensial Google Cloud yang dapat dipakai."
  echo
  if command -v gcloud >/dev/null 2>&1; then
    echo "Akun yang terdaftar pada gcloud saat ini:"
    gcloud auth list 2>&1 | sed 's/^/  /' || true
    echo
  fi
  echo "Jalankan dua baris berikut di Cloud Shell, lalu ulangi blok deploy:"
  echo
  echo "  gcloud auth login"
  if [ -n "$project_id" ]; then
    echo "  gcloud config set project $project_id"
  fi
  echo
  echo "Mengulang blok deploy aman. Master dan saldo token tidak akan digandakan."
}

# Memastikan token benar-benar berlaku untuk project yang dituju.
# Argumen: <token> <project_id>. Mengembalikan 0 bila valid.
kes_token_works() {
  local token="$1"
  local project_id="$2"
  local code=""
  [ -n "$token" ] || return 1
  code="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $token" \
    -H "x-goog-user-project: $project_id" \
    "https://firebase.googleapis.com/v1beta1/projects/$project_id" 2>/dev/null || echo "000")"
  [[ "$code" =~ ^2[0-9][0-9]$ ]]
}
