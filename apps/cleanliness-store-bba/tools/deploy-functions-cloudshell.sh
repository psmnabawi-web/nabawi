#!/usr/bin/env bash
# Deploy Cloud Functions app Bangor Cleanliness Control (scoreEvidence, finalizeSession) dari Cloud Shell, dengan AI scoring
# memakai Gemma 4 lewat Gemini API (free tier) dan Vertex AI sebagai cadangan otomatis.
#   curl -sL https://raw.githubusercontent.com/psmnabawi-web/nabawi/claude/upbeat-babbage-wb9ksk/apps/cleanliness-store-bba/tools/deploy-functions-cloudshell.sh | bash
# Opsi lewat env di depan perintah:
#   MODEL=gemma-4-26b-a4b-it   model utama (default gemma-4-31b-it)
#   FALLBACK=none              matikan cadangan Vertex (default vertex)
#   ROTATE=1                   ganti isi secret GEMINI_API_KEY yang sudah ada
set -euo pipefail
P=cleanliness-store-bba; R=asia-southeast1; REPO=psmnabawi-web/nabawi; BRANCH="${BRANCH:-claude/upbeat-babbage-wb9ksk}"
RAW="${RAW:-https://raw.githubusercontent.com/$REPO/$BRANCH/apps/cleanliness-store-bba/functions}"
MODEL="${MODEL:-gemma-4-31b-it}"; FALLBACK="${FALLBACK:-vertex}"
step() { printf '\n== %s ==\n' "$*"; }

step "1/5 Project $P & API"
gcloud config set project "$P" >/dev/null
gcloud services enable secretmanager.googleapis.com cloudfunctions.googleapis.com cloudbuild.googleapis.com run.googleapis.com artifactregistry.googleapis.com >/dev/null
PN=$(gcloud projects describe "$P" --format='value(projectNumber)'); SA="$PN-compute@developer.gserviceaccount.com"

step "2/5 Secret GEMINI_API_KEY"
if ! gcloud secrets describe GEMINI_API_KEY >/dev/null 2>&1; then
  read -rsp "Tempel GEMINI_API_KEY dari https://aistudio.google.com/apikey (tidak ditampilkan): " KEY < /dev/tty; echo
  [ -n "$KEY" ] || { echo "key kosong"; exit 1; }
  printf '%s' "$KEY" | gcloud secrets create GEMINI_API_KEY --data-file=- --replication-policy=automatic >/dev/null; echo "secret dibuat"
elif [ -n "${ROTATE:-}" ]; then
  read -rsp "Tempel GEMINI_API_KEY baru: " KEY < /dev/tty; echo
  printf '%s' "$KEY" | gcloud secrets versions add GEMINI_API_KEY --data-file=- >/dev/null; echo "versi baru ditambahkan"
else echo "secret sudah ada (pakai ROTATE=1 untuk mengganti)"; fi
gcloud secrets add-iam-policy-binding GEMINI_API_KEY --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null
echo "akses secret untuk $SA: OK"

step "3/5 Ambil source functions dari branch $BRANCH"
W=$(mktemp -d); for f in index.js ai.js control-points.js package.json; do curl -fsSL "$RAW/$f" -o "$W/$f" || { echo "gagal unduh $f"; exit 1; }; done
cat > "$W/env.yaml" <<YAML
CLEANLINESS_AI_PROVIDER: "gemini"
CLEANLINESS_AI_MODEL: "$MODEL"
CLEANLINESS_AI_FALLBACK: "$FALLBACK"
CLEANLINESS_AI_FALLBACK_MODEL: "gemini-2.5-flash"
CLEANLINESS_AI_LOCATION: "global"
FIREBASE_CONFIG: '{"projectId":"$P","storageBucket":"$P.firebasestorage.app"}'
YAML
echo "model utama: $MODEL · cadangan: $FALLBACK"

step "4/5 Deploy scoreEvidence (AI) & finalizeSession"
COMMON=(--gen2 --region "$R" --runtime nodejs22 --source "$W" --trigger-http --allow-unauthenticated --memory 1Gi --timeout 120s --max-instances 10 --update-labels deployment-tool=cli-firebase,deployment-callable=true --quiet)
gcloud functions deploy scoreEvidence "${COMMON[@]}" --entry-point scoreEvidence --env-vars-file "$W/env.yaml" --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest
gcloud functions deploy finalizeSession "${COMMON[@]}" --entry-point finalizeSession --env-vars-file "$W/env.yaml"

step "5/5 Cek fungsi hidup"
for FN in scoreEvidence finalizeSession; do
  printf '%-16s ' "$FN"; curl -s -X POST "https://$R-$P.cloudfunctions.net/$FN" -H 'Content-Type: application/json' -d '{"data":{}}' | head -c 160; echo
done
echo; echo "Harapan: keduanya menjawab error INVALID_ARGUMENT (berarti fungsi aktif dan menolak input kosong)."
echo "Setelah crew memotret 1 titik, cek mesin yang dipakai:"
echo "  gcloud functions logs read scoreEvidence --region $R --limit 20 | grep -E 'scoreEvidence ok|fallback|rate limit'"
