#!/usr/bin/env bash
# Setup sekali jalan untuk blast WA Scoring Filter Oil. Jalankan di Cloud Shell akun Owner project:
#   curl -sL https://raw.githubusercontent.com/psmnabawi-web/nabawi/claude/ecstatic-franklin-hhjvmk/apps/filter-oil-wa/setup-cloudshell.sh | bash
#
# Yang dibuat (semua gratis, project tetap Spark):
#   1. Service account wa-blast-reader dengan role Cloud Datastore Viewer (hanya BACA Firestore, tidak bisa mengubah data).
#   2. Workload Identity Pool "github-actions" + provider "nabawi-repo": GitHub Actions di repo psmnabawi-web/nabawi
#      boleh memakai service account tsb TANPA key/secret. Repo lain tidak bisa.
# Aman dijalankan ulang: yang sudah ada dilewati.
set -euo pipefail

P=trecking-filter-oil-store
REPO=psmnabawi-web/nabawi
SA=wa-blast-reader
EMAIL="$SA@$P.iam.gserviceaccount.com"
POOL=github-actions
PROVIDER=nabawi-repo

step() { printf '\n== %s ==\n' "$*"; }

step "1/6 Pilih project $P"
gcloud config set project "$P" >/dev/null
PN=$(gcloud projects describe "$P" --format='value(projectNumber)')
echo "project number: $PN"

step "2/6 Aktifkan API (IAM, STS, IAM Credentials, Sheets)"
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com sheets.googleapis.com

step "3/6 Service account read-only $EMAIL"
if ! gcloud iam service-accounts describe "$EMAIL" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA" --display-name="WA blast scoring (read-only)"
  sleep 15 # tunggu service account baru tersebar sebelum diberi role
fi
gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$EMAIL" --role="roles/datastore.viewer" --condition=None --quiet >/dev/null
echo "role Cloud Datastore Viewer: OK"

step "4/6 Workload Identity Pool $POOL"
gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions"

step "5/6 Provider GitHub $PROVIDER (hanya repo $REPO)"
gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --location=global --workload-identity-pool="$POOL" \
    --display-name="$REPO" --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='$REPO'"

step "6/6 Izinkan repo $REPO memakai service account"
gcloud iam service-accounts add-iam-policy-binding "$EMAIL" --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PN/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO" --quiet >/dev/null
echo "workloadIdentityUser: OK"

printf '\n===============================================\n SELESAI. Setup blast WA Filter Oil berhasil.\n Project number: %s\n Service account: %s\n===============================================\n' "$PN" "$EMAIL"
