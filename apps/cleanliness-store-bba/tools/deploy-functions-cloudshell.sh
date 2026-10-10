#!/usr/bin/env bash
# Deploy Cloud Functions app Bangor Cleanliness Control (scoreEvidence, finalizeSession) dari Cloud Shell.
# AI scoring lewat endpoint OpenAI-compatible (default, mis. relay Qwen) atau Gemma 4 lewat Gemini API, dengan Vertex AI
# sebagai cadangan otomatis. API key diminta lewat prompt dan disimpan di Secret Manager, tidak pernah masuk repo.
#   curl -sL https://raw.githubusercontent.com/psmnabawi-web/nabawi/claude/upbeat-babbage-wb9ksk/apps/cleanliness-store-bba/tools/deploy-functions-cloudshell.sh | bash
# Opsi lewat env di depan perintah:
#   PROVIDER=openai|gemini    mesin utama (default openai)
#   BASE_URL=https://.../v1   endpoint OpenAI-compatible (default https://bandelbanget.xyz/v1)
#   MODEL=<id>                model utama. openai: bila kosong dipilih otomatis dari /v1/models yang mengandung "vl"/"vision";
#                             gemini: default gemma-4-31b-it
#   FALLBACK=vertex|gemini|openai|none   cadangan otomatis (default vertex)
#   ROTATE=1                  ganti isi secret API key yang sudah ada
set -euo pipefail
P=cleanliness-store-bba; R=asia-southeast1; REPO=psmnabawi-web/nabawi; BRANCH="${BRANCH:-claude/upbeat-babbage-wb9ksk}"
RAW="${RAW:-https://raw.githubusercontent.com/$REPO/$BRANCH/apps/cleanliness-store-bba/functions}"
PROVIDER="${PROVIDER:-openai}"; FALLBACK="${FALLBACK:-vertex}"; BASE_URL="${BASE_URL:-https://bandelbanget.xyz/v1}"; BASE_URL="${BASE_URL%/}"
case "$PROVIDER" in
  openai) SECRET=OPENAI_API_KEY; HINT="API key untuk endpoint $BASE_URL" ;;
  gemini) SECRET=GEMINI_API_KEY; HINT="GEMINI_API_KEY dari https://aistudio.google.com/apikey"; MODEL="${MODEL:-gemma-4-31b-it}" ;;
  *) echo "PROVIDER harus openai atau gemini"; exit 1 ;;
esac
step() { printf '\n== %s ==\n' "$*"; }

step "1/5 Project $P & API"
gcloud config set project "$P" >/dev/null
gcloud services enable secretmanager.googleapis.com cloudfunctions.googleapis.com cloudbuild.googleapis.com run.googleapis.com artifactregistry.googleapis.com >/dev/null
PN=$(gcloud projects describe "$P" --format='value(projectNumber)'); SA="$PN-compute@developer.gserviceaccount.com"

step "2/5 Secret $SECRET"
if ! gcloud secrets describe "$SECRET" >/dev/null 2>&1; then
  read -rsp "Tempel $HINT (tidak ditampilkan): " KEY < /dev/tty; echo
  [ -n "$KEY" ] || { echo "key kosong"; exit 1; }
  printf '%s' "$KEY" | gcloud secrets create "$SECRET" --data-file=- --replication-policy=automatic >/dev/null; echo "secret dibuat"
elif [ -n "${ROTATE:-}" ]; then
  read -rsp "Tempel $SECRET baru: " KEY < /dev/tty; echo
  printf '%s' "$KEY" | gcloud secrets versions add "$SECRET" --data-file=- >/dev/null; echo "versi baru ditambahkan"
else echo "secret sudah ada (pakai ROTATE=1 untuk mengganti)"; fi
unset KEY
gcloud secrets add-iam-policy-binding "$SECRET" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null
echo "akses secret untuk $SA: OK"

if [ "$PROVIDER" = openai ]; then
  step "3/5 Cek endpoint $BASE_URL: daftar model & uji gambar"
  KEYVAL=$(gcloud secrets versions access latest --secret="$SECRET")
  MODELS=$(curl -sS --max-time 30 "$BASE_URL/models" -H "Authorization: Bearer $KEYVAL" | jq -r '.data[]?.id // empty' 2>/dev/null || true)
  if [ -n "$MODELS" ]; then echo "model tersedia:"; echo "$MODELS" | sed 's/^/  /'; else echo "daftar model tidak terbaca dari $BASE_URL/models (lanjut dengan MODEL yang diberikan)"; fi
  MODEL="${MODEL:-$(echo "$MODELS" | grep -iE 'vl|vision' | head -1 || true)}"
  [ -n "$MODEL" ] || { echo "Tidak bisa menentukan model vision. Jalankan ulang dengan MODEL=<id> di depan perintah (lihat daftar di atas)."; exit 1; }
  PNG="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="
  REQ=$(jq -nc --arg m "$MODEL" --arg png "$PNG" '{model:$m,temperature:0,max_tokens:80,messages:[{role:"user",content:[{type:"text",text:"Balas hanya JSON {\"ok\":true,\"warna\":\"...\"} dengan warna dominan gambar."},{type:"image_url",image_url:{url:("data:image/png;base64,"+$png)}}]}]}')
  RESP=$(curl -sS --max-time 90 -w '\n%{http_code}' "$BASE_URL/chat/completions" -H "Authorization: Bearer $KEYVAL" -H 'Content-Type: application/json' -d "$REQ" || true)
  unset KEYVAL
  CODE=$(tail -n1 <<<"$RESP"); BODY=$(sed '$d' <<<"$RESP")
  echo "uji vision $MODEL: HTTP ${CODE:-000} · $(jq -r '.choices[0].message.content // .error.message // empty' <<<"$BODY" 2>/dev/null | tr '\n' ' ' | head -c 160)"
  [ "${CODE:-000}" = "200" ] || { echo "Endpoint/model belum siap menerima gambar. Perbaiki dulu (MODEL=..., BASE_URL=..., atau key) lalu jalankan lagi."; exit 1; }
else
  step "3/5 Model Gemini API: $MODEL"
fi

step "4/5 Ambil source dari branch $BRANCH & deploy"
W=$(mktemp -d); for f in index.js ai.js control-points.js package.json; do curl -fsSL "$RAW/$f" -o "$W/$f" || { echo "gagal unduh $f"; exit 1; }; done
FB_MODEL="gemini-2.5-flash"; case "$FALLBACK" in gemini) FB_MODEL="gemma-4-31b-it" ;; openai) FB_MODEL="$MODEL" ;; esac
cat > "$W/env.yaml" <<YAML
CLEANLINESS_AI_PROVIDER: "$PROVIDER"
CLEANLINESS_AI_MODEL: "$MODEL"
OPENAI_BASE_URL: "$BASE_URL"
CLEANLINESS_AI_FALLBACK: "$FALLBACK"
CLEANLINESS_AI_FALLBACK_MODEL: "$FB_MODEL"
CLEANLINESS_AI_LOCATION: "global"
FIREBASE_CONFIG: '{"projectId":"$P","storageBucket":"$P.firebasestorage.app"}'
YAML
SECRETS=""; for S in OPENAI_API_KEY GEMINI_API_KEY; do gcloud secrets describe "$S" >/dev/null 2>&1 && SECRETS="${SECRETS:+$SECRETS,}$S=$S:latest"; done
echo "mesin utama: $PROVIDER / $MODEL · cadangan: $FALLBACK / $FB_MODEL · secret terpasang: $SECRETS"
COMMON=(--gen2 --region "$R" --runtime nodejs22 --source "$W" --trigger-http --allow-unauthenticated --memory 1Gi --timeout 120s --max-instances 10 --update-labels deployment-tool=cli-firebase,deployment-callable=true --quiet)
gcloud functions deploy scoreEvidence "${COMMON[@]}" --entry-point scoreEvidence --env-vars-file "$W/env.yaml" --set-secrets "$SECRETS"
gcloud functions deploy finalizeSession "${COMMON[@]}" --entry-point finalizeSession --env-vars-file "$W/env.yaml"

step "5/6 Cek fungsi hidup"
for FN in scoreEvidence finalizeSession; do
  printf '%-16s ' "$FN"; curl -s -X POST "https://$R-$P.cloudfunctions.net/$FN" -H 'Content-Type: application/json' -d '{"data":{}}' | head -c 160; echo
done
echo; echo "Harapan: keduanya menjawab error INVALID_ARGUMENT (berarti fungsi aktif dan menolak input kosong)."

step "6/6 Izinkan GitHub Actions men-deploy functions berikutnya (tanpa Cloud Shell)"
DEPLOYER="hosting-deployer@$P.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "$DEPLOYER" >/dev/null 2>&1; then
  for ROLE in roles/cloudfunctions.admin roles/run.admin roles/cloudbuild.builds.editor roles/secretmanager.viewer roles/serviceusage.serviceUsageConsumer roles/artifactregistry.reader; do
    gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$DEPLOYER" --role="$ROLE" --condition=None --quiet >/dev/null
  done
  gcloud iam service-accounts add-iam-policy-binding "$SA" --member="serviceAccount:$DEPLOYER" --role=roles/iam.serviceAccountUser --quiet >/dev/null
  echo "OK: workflow GitHub 'Deploy Cleanliness Store BBA' dengan target 'functions' kini bisa men-deploy backend tanpa Cloud Shell."
else
  echo "service account $DEPLOYER belum ada (setup-cloudshell.sh belum pernah dijalankan); langkah ini dilewati."
fi
echo "Setelah crew memotret 1 titik, cek mesin yang dipakai:"
echo "  gcloud functions logs read scoreEvidence --region $R --limit 20 | grep -E 'scoreEvidence ok|fallback|rate limit'"
