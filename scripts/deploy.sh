#!/usr/bin/env bash
# =====================================================================
# Deploy Store Cleanliness Control ke Firebase (Auth + Firestore + Storage + App Hosting)
# Jalankan sekali dari laptop (butuh: node 20+, git, akun Google). Idempotent: aman diulang.
#
#   bash scripts/deploy.sh <PROJECT_ID> [REGION] [GITHUB_OWNER/REPO] [BRANCH]
#   contoh: bash scripts/deploy.sh nabawi-clean asia-southeast1 psmnabawi-web/nabawi main
# =====================================================================
set -euo pipefail

PROJECT_ID="${1:?PROJECT_ID wajib. Contoh: bash scripts/deploy.sh nabawi-clean}"
REGION="${2:-asia-southeast1}"
GH_REPO="${3:-psmnabawi-web/nabawi}"
BRANCH="${4:-main}"
BACKEND_ID="store-cleanliness"
ENV_FILE=".env.local"

need() { command -v "$1" >/dev/null 2>&1 || { echo "!! $1 tidak ditemukan. $2"; exit 1; }; }
need node "Install Node.js 20+ dari https://nodejs.org"
need npx "Node.js sudah termasuk npx"
need gcloud "Install Google Cloud SDK: https://cloud.google.com/sdk/docs/install"

FB="npx --yes firebase-tools@latest"

echo "== 1/8 Login Google (browser akan terbuka) =="
gcloud auth login --brief --quiet >/dev/null 2>&1 || gcloud auth login
$FB login --no-localhost >/dev/null 2>&1 || $FB login

echo "== 2/8 Project $PROJECT_ID =="
if ! gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud projects create "$PROJECT_ID" --name="Store Cleanliness" --quiet
fi
gcloud config set project "$PROJECT_ID" --quiet
$FB projects:addfirebase "$PROJECT_ID" >/dev/null 2>&1 || true
$FB use "$PROJECT_ID" --add >/dev/null 2>&1 || $FB use "$PROJECT_ID"

echo "== 3/8 Billing (Blaze) =="
if ! gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null | grep -q True; then
  echo ">> Project belum punya billing. App Hosting & Storage wajib plan Blaze (pemakaian kecil tetap Rp0, hanya perlu kartu)."
  echo ">> Buka: https://console.firebase.google.com/project/$PROJECT_ID/usage/details lalu klik Upgrade -> Blaze, kemudian jalankan script ini lagi."
  exit 1
fi

echo "== 4/8 Aktifkan API =="
gcloud services enable \
  firebase.googleapis.com firestore.googleapis.com firebasestorage.googleapis.com storage.googleapis.com \
  identitytoolkit.googleapis.com firebaseapphosting.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com developerconnect.googleapis.com \
  aiplatform.googleapis.com generativelanguage.googleapis.com --quiet

echo "== 5/8 Firestore, Storage, Auth =="
gcloud firestore databases describe --database='(default)' >/dev/null 2>&1 || \
  gcloud firestore databases create --database='(default)' --location="$REGION" --quiet
$FB deploy --only firestore:rules,firestore:indexes --project "$PROJECT_ID"
# Storage default bucket + rules (jika bucket belum ada, buat lewat console sekali: Build > Storage > Get started)
$FB deploy --only storage --project "$PROJECT_ID" || echo ">> Storage belum diinisialisasi. Buka Firebase Console > Build > Storage > Get started, lalu jalankan ulang script."
echo ">> Aktifkan Authentication > Sign-in method > Email/Password di console jika belum:"
echo "   https://console.firebase.google.com/project/$PROJECT_ID/authentication/providers"

echo "== 6/8 Web app config -> $ENV_FILE & apphosting.yaml =="
APP_ID=$($FB apps:list WEB --project "$PROJECT_ID" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).result||[];console.log(r[0]?.appId||"")})')
if [ -z "$APP_ID" ]; then
  APP_ID=$($FB apps:create WEB "Store Cleanliness Web" --project "$PROJECT_ID" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.appId))')
fi
CFG=$($FB apps:sdkconfig WEB "$APP_ID" --project "$PROJECT_ID" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s).result.sdkConfig;console.log([c.apiKey,c.authDomain,c.projectId,c.storageBucket,c.messagingSenderId,c.appId].join("|"))})')
IFS='|' read -r API_KEY AUTH_DOMAIN PID BUCKET SENDER_ID APPID <<<"$CFG"

if [ ! -f "$ENV_FILE" ]; then cp .env.example "$ENV_FILE"; fi
setenv() { grep -q "^$1=" "$ENV_FILE" && sed -i.bak "s|^$1=.*|$1=$2|" "$ENV_FILE" || echo "$1=$2" >> "$ENV_FILE"; rm -f "$ENV_FILE.bak"; }
setenv NEXT_PUBLIC_FIREBASE_API_KEY "$API_KEY"
setenv NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN "$AUTH_DOMAIN"
setenv NEXT_PUBLIC_FIREBASE_PROJECT_ID "$PID"
setenv NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET "$BUCKET"
setenv NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID "$SENDER_ID"
setenv NEXT_PUBLIC_FIREBASE_APP_ID "$APPID"

sed -i.bak -e "s|__FIREBASE_API_KEY__|$API_KEY|" -e "s|__FIREBASE_AUTH_DOMAIN__|$AUTH_DOMAIN|" -e "s|__FIREBASE_PROJECT_ID__|$PID|" \
  -e "s|__FIREBASE_STORAGE_BUCKET__|$BUCKET|" -e "s|__FIREBASE_MESSAGING_SENDER_ID__|$SENDER_ID|" -e "s|__FIREBASE_APP_ID__|$APPID|" apphosting.yaml
rm -f apphosting.yaml.bak

echo "== 7/8 Secrets (Gemini API key & admin email) =="
if ! grep -q '^GEMINI_API_KEY=.\+' "$ENV_FILE"; then
  echo ">> Buat API key gratis di https://aistudio.google.com/apikey lalu tempel di sini."
  read -r -p "GEMINI_API_KEY: " GKEY
  setenv GEMINI_API_KEY "$GKEY"
fi
GKEY=$(grep '^GEMINI_API_KEY=' "$ENV_FILE" | cut -d= -f2-)
ADMINS=$(grep '^ADMIN_EMAILS=' "$ENV_FILE" | cut -d= -f2-)
printf '%s' "$GKEY"   | $FB apphosting:secrets:set GEMINI_API_KEY --project "$PROJECT_ID" --data-file=- --force
printf '%s' "$ADMINS" | $FB apphosting:secrets:set ADMIN_EMAILS   --project "$PROJECT_ID" --data-file=- --force

# Service account untuk seed lokal (opsional). Di App Hosting tidak perlu.
if ! grep -q '^FIREBASE_SERVICE_ACCOUNT_JSON=.\+' "$ENV_FILE"; then
  SA="firebase-adminsdk-local@$PROJECT_ID.iam.gserviceaccount.com"
  gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || gcloud iam service-accounts create firebase-adminsdk-local --display-name="Local admin (seed)" --quiet
  for ROLE in roles/datastore.user roles/storage.objectAdmin roles/firebaseauth.admin roles/aiplatform.user; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$ROLE" --quiet >/dev/null
  done
  gcloud iam service-accounts keys create /tmp/sa.json --iam-account="$SA" --quiet
  setenv FIREBASE_SERVICE_ACCOUNT_JSON "$(node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync("/tmp/sa.json","utf8"))))')"
  rm -f /tmp/sa.json
fi

echo "== Seed 57 indikator + store contoh =="
npm install --silent
npm run seed

echo "== 8/8 App Hosting backend (auto-deploy dari GitHub $GH_REPO@$BRANCH) =="
git add apphosting.yaml && git commit -qm "chore: apphosting config for $PROJECT_ID" || true
git push origin HEAD || true
if ! $FB apphosting:backends:get "$BACKEND_ID" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo ">> Akan membuka wizard: pilih repo $GH_REPO, branch $BRANCH, root directory '/', region $REGION."
  $FB apphosting:backends:create --project "$PROJECT_ID" --location "$REGION" --backend "$BACKEND_ID" || \
  $FB apphosting:backends:create --project "$PROJECT_ID"
fi
# Beri izin service account App Hosting agar bisa akses Firestore/Storage/Auth/Vertex.
AH_SA="firebase-app-hosting-compute@$PROJECT_ID.iam.gserviceaccount.com"
for ROLE in roles/datastore.user roles/storage.objectAdmin roles/firebaseauth.admin roles/aiplatform.user roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$AH_SA" --role="$ROLE" --quiet >/dev/null 2>&1 || true
done
$FB apphosting:rollouts:create "$BACKEND_ID" --project "$PROJECT_ID" --git-branch "$BRANCH" || true

echo
echo "=============================================================="
echo "Selesai. Cek status: $FB apphosting:backends:list --project $PROJECT_ID"
echo "URL app ada di kolom 'Domain'. Tes: https://<domain>/api/health"
echo "Langkah terakhir: buka /register, daftar dengan email di ADMIN_EMAILS -> menu Admin -> tambah store & user."
echo "=============================================================="
