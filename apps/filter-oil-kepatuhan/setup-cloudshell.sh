#!/usr/bin/env bash
# Setup sekali jalan untuk halaman web Kepatuhan Filter Oil. Jalankan di Cloud Shell akun Owner project:
#   curl -sL https://raw.githubusercontent.com/psmnabawi-web/nabawi/claude/adoring-dijkstra-78ese7/apps/filter-oil-kepatuhan/setup-cloudshell.sh | bash
#
# Yang dibuat (gratis, project tetap Spark):
#   - Service account kepatuhan-deployer dengan role Firebase Hosting Admin (hanya untuk menerbitkan halaman web,
#     tidak punya akses ke database Firestore).
#   - Izin GitHub Actions di repo psmnabawi-web/nabawi memakai service account tsb lewat Workload Identity
#     (pool github-actions yang sudah dibuat setup blast WA). Tanpa key/secret.
# Aman dijalankan ulang.
set -euo pipefail

P=trecking-filter-oil-store
REPO=psmnabawi-web/nabawi
SA=kepatuhan-deployer
EMAIL="$SA@$P.iam.gserviceaccount.com"
POOL=github-actions

step() { printf '\n== %s ==\n' "$*"; }

step "1/4 Pilih project $P"
gcloud config set project "$P" >/dev/null
PN=$(gcloud projects describe "$P" --format='value(projectNumber)')
if ! gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1; then
  echo "Workload Identity Pool '$POOL' belum ada. Jalankan dulu setup blast WA:"
  echo "  curl -sL https://raw.githubusercontent.com/psmnabawi-web/nabawi/claude/adoring-dijkstra-78ese7/apps/filter-oil-wa/setup-cloudshell.sh | bash"
  exit 1
fi

step "2/4 Aktifkan API Firebase Hosting"
gcloud services enable firebasehosting.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

step "3/4 Service account $EMAIL (Firebase Hosting Admin)"
if ! gcloud iam service-accounts describe "$EMAIL" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA" --display-name="Deploy halaman Kepatuhan Filter Oil"
  sleep 15 # tunggu service account baru tersebar sebelum diberi role
fi
gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$EMAIL" --role="roles/firebasehosting.admin" --condition=None --quiet >/dev/null
echo "role Firebase Hosting Admin: OK"

step "4/4 Izinkan GitHub Actions repo $REPO memakai service account"
gcloud iam service-accounts add-iam-policy-binding "$EMAIL" --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PN/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO" --quiet >/dev/null
echo "workloadIdentityUser: OK"

printf '\n===============================================\n SELESAI. Setup halaman Kepatuhan Filter Oil berhasil.\n Service account: %s\n===============================================\n' "$EMAIL"
