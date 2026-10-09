#!/usr/bin/env bash
# Setup sekali jalan + deploy app Bangor Cleanliness Control (project Firebase cleanliness-store-bba).
# Jalankan di Cloud Shell akun Owner project (psmnabawi@gmail.com):
#   curl -sL https://raw.githubusercontent.com/psmnabawi-web/nabawi/claude/upbeat-babbage-wb9ksk/apps/cleanliness-store-bba/setup-cloudshell.sh | bash
#
# Yang dilakukan (gratis):
#   1-4. Service account hosting-deployer@cleanliness-store-bba dengan role Firebase Hosting Admin saja (tidak bisa
#        membaca Firestore/Storage), dan izin GitHub Actions repo psmnabawi-web/nabawi memakainya lewat Workload
#        Identity (pool github-actions yang sudah ada di project trecking-filter-oil-store). Tanpa key/secret.
#        Setelah ini, deploy berikutnya bisa dari GitHub Actions (workflow "Deploy Cleanliness Store BBA").
#   5.   Deploy isi public/ dari branch ini ke https://cleanliness-store-bba.web.app memakai login Cloud Shell Anda.
# Aman dijalankan ulang. SKIP_SETUP=1 → langsung deploy saja. SKIP_DEPLOY=1 → setup saja. FORCE_DEPLOY=1 → abaikan
# pengaman versi live (lihat scripts/deploy-hosting.mjs).
set -euo pipefail

P=cleanliness-store-bba
POOL_PROJECT=trecking-filter-oil-store
POOL=github-actions
REPO=psmnabawi-web/nabawi
BRANCH="${BRANCH:-claude/upbeat-babbage-wb9ksk}"
SA=hosting-deployer
EMAIL="$SA@$P.iam.gserviceaccount.com"
RAW="${RAW:-https://raw.githubusercontent.com/$REPO/$BRANCH/apps/cleanliness-store-bba}"

step() { printf '\n== %s ==\n' "$*"; }

if [ -z "${SKIP_SETUP:-}" ]; then
  step "1/5 Pilih project $P"
  gcloud config set project "$P" >/dev/null
  gcloud projects describe "$P" --format='value(projectId)' >/dev/null

  step "2/5 Aktifkan API Firebase Hosting + Workload Identity"
  gcloud services enable firebasehosting.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

  step "3/5 Service account $EMAIL (Firebase Hosting Admin)"
  if ! gcloud iam service-accounts describe "$EMAIL" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$SA" --display-name="Deploy app Bangor Cleanliness Control (GitHub Actions)"
    sleep 15 # tunggu service account baru tersebar sebelum diberi role
  fi
  gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$EMAIL" --role="roles/firebasehosting.admin" --condition=None --quiet >/dev/null
  echo "role Firebase Hosting Admin: OK"

  step "4/5 Izinkan GitHub Actions repo $REPO memakai service account"
  if PN=$(gcloud projects describe "$POOL_PROJECT" --format='value(projectNumber)' 2>/dev/null) \
     && gcloud iam workload-identity-pools describe "$POOL" --location=global --project="$POOL_PROJECT" >/dev/null 2>&1; then
    gcloud iam service-accounts add-iam-policy-binding "$EMAIL" --role="roles/iam.workloadIdentityUser" \
      --member="principalSet://iam.googleapis.com/projects/$PN/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO" --quiet >/dev/null
    echo "workloadIdentityUser: OK (pool $POOL di project $POOL_PROJECT, nomor $PN)"
  else
    echo "PERINGATAN: pool $POOL di project $POOL_PROJECT tidak terbaca, deploy lewat GitHub Actions belum bisa dipakai."
    echo "           Deploy dari Cloud Shell (langkah 5) tetap jalan."
  fi
fi

if [ -z "${SKIP_DEPLOY:-}" ]; then
  step "5/5 Deploy public/ dari branch $BRANCH ke https://$P.web.app"
  command -v node >/dev/null || { echo "node tidak ditemukan di Cloud Shell"; exit 1; }
  W=$(mktemp -d)
  mkdir -p "$W/public" "$W/scripts"
  for f in scripts/deploy-hosting.mjs snapshot.json \
           public/index.html public/app.js public/master-data.js public/styles.css public/firebase-config.js \
           public/favicon.ico public/favicon.png public/bangor-logo.png; do
    curl -fsSL "$RAW/$f" -o "$W/$f" || { echo "gagal mengunduh $RAW/$f"; exit 1; }
  done
  echo "file terunduh ke $W"
  ACCESS_TOKEN="$(gcloud auth print-access-token)" DEPLOY_LABEL="cloud shell $(date -u +%Y-%m-%dT%H:%MZ)" \
    FORCE_DEPLOY="${FORCE_DEPLOY:-}" node "$W/scripts/deploy-hosting.mjs"
fi

printf '\n===============================================\n SELESAI.\n Situs    : https://%s.web.app\n Service account GitHub Actions: %s\n===============================================\n' "$P" "$EMAIL"
