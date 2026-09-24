#!/usr/bin/env bash
# Deploy AI Content Intelligence (paint-ai) to its OWN Firebase project — one command.
#
# Usage (from the paint-ai folder, on your laptop):
#   bash scripts/deploy.sh <PROJECT_ID> [region] [super_admin_emails]
# Example:
#   bash scripts/deploy.sh content-ai-iw asia-southeast2 you@gmail.com
# Re-run faster (skip npm ci + tests when node_modules already exist):
#   SKIP_CHECKS=1 bash scripts/deploy.sh content-ai-iw asia-southeast2 you@gmail.com
#
# What it does: checks → npm ci → lint/typecheck/tests → firebase login → Firestore (create/verify region)
# → web config into .env.production.local (auto) → functions/.env (auto) → secrets → deploy (retry once).
# Works with macOS bash 3.2.
set -euo pipefail

PROJECT_ID="${1:-}"
REGION="${2:-asia-southeast2}"
ADMIN_EMAILS="${3:-}"

# Projects that belong to other apps in this repository. Deploying here would overwrite their rules.
PROTECTED_PROJECTS="almaz-cleanliness-508507"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

if [ -z "$PROJECT_ID" ]; then
  red "Usage: bash scripts/deploy.sh <PROJECT_ID> [region] [super_admin_emails]"
  exit 1
fi
for p in $PROTECTED_PROJECTS; do
  if [ "$PROJECT_ID" = "$p" ]; then
    red "Refusing to deploy: '$PROJECT_ID' is used by another app (Store Cleanliness). Use the paint-ai project."
    exit 1
  fi
done

cd "$(dirname "$0")/.."
FIREBASE="npx --yes firebase-tools@15"
ENV_FILE=".env.production.local"

# Reads a JSON document from stdin and prints the value at a dotted path (empty if missing).
json_get() {
  node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const i = s.indexOf("{"); if (i < 0) return;
      try {
        let v = JSON.parse(s.slice(i));
        for (const k of process.argv[1].split(".")) v = v == null ? undefined : v[k];
        if (v !== undefined && v !== null) process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
      } catch {}
    });' "$1"
}

# Sets KEY=VALUE in a dotenv file (adds the line if missing). Portable (no sed -i).
set_env() {
  node -e '
    const fs = require("fs"); const [file, key, value] = process.argv.slice(1);
    const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\n+$/, "").split("\n") : [];
    const i = lines.findIndex((l) => l.startsWith(key + "="));
    if (i >= 0) lines[i] = key + "=" + value; else lines.push(key + "=" + value);
    fs.writeFileSync(file, lines.join("\n").replace(/\n*$/, "\n"));' "$1" "$2" "$3"
}
get_env() { grep -E "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true; }

# Every Google API the platform uses. A brand-new Cloud project has none of them enabled.
REQUIRED_APIS="firestore.googleapis.com,firebaserules.googleapis.com,firebasestorage.googleapis.com,storage.googleapis.com,firebasehosting.googleapis.com,identitytoolkit.googleapis.com,cloudfunctions.googleapis.com,run.googleapis.com,cloudbuild.googleapis.com,artifactregistry.googleapis.com,eventarc.googleapis.com,pubsub.googleapis.com,cloudscheduler.googleapis.com,secretmanager.googleapis.com"
ENABLE_APIS_URL="https://console.cloud.google.com/flows/enableapi?apiid=${REQUIRED_APIS}&project=${PROJECT_ID}"

api_disabled() { printf '%s' "$1" | grep -qiE 'has not been used in project|SERVICE_DISABLED|is disabled|API has not been enabled'; }

wait_for_apis() {
  red "Some Google Cloud APIs are not enabled yet on $PROJECT_ID."
  echo "Open this link (signed in with the same Google account as the Firebase CLI), click ENABLE, wait ~1-2 minutes:"
  echo ""
  echo "  $ENABLE_APIS_URL"
  echo ""
  printf 'Press Enter when the APIs are enabled… '
  read -r _
}

step "1/8 Checking prerequisites"
node -e 'const [maj]=process.versions.node.split(".").map(Number); if (maj < 22) { console.error("Node.js 22+ is required (found " + process.versions.node + "). Install from https://nodejs.org"); process.exit(1) }'
if [ -f "$ENV_FILE" ] && [ "$(get_env "$ENV_FILE" VITE_FIREBASE_PROJECT_ID)" != "$PROJECT_ID" ]; then
  red "$ENV_FILE belongs to project '$(get_env "$ENV_FILE" VITE_FIREBASE_PROJECT_ID)'. Delete it or deploy to that project."
  exit 1
fi

if [ "${SKIP_CHECKS:-}" = "1" ] && [ -d node_modules ] && [ -d functions/node_modules ]; then
  step "2-3/8 Skipping install + quality gate (SKIP_CHECKS=1)"
else
  step "2/8 Installing dependencies"
  npm ci
  npm ci --prefix functions

  step "3/8 Quality gate (lint, typecheck, unit tests)"
  npm run lint
  npm run typecheck
  npm test
  npm --prefix functions run lint
  npm --prefix functions test
fi

step "4/8 Firebase login (a browser window opens)"
$FIREBASE login

step "5/8 Firestore database"
DB_LOCATION=""
for ATTEMPT in 1 2 3 4 5; do
  DB_OUT="$($FIREBASE firestore:databases:get "(default)" --project "$PROJECT_ID" --json 2>&1 || true)"
  if api_disabled "$DB_OUT"; then
    wait_for_apis
    continue
  fi
  DB_LOCATION="$(printf '%s' "$DB_OUT" | json_get result.locationId)"
  if [ -n "$DB_LOCATION" ]; then break; fi
  CREATE_OUT="$($FIREBASE firestore:databases:create "(default)" --location="$REGION" --project "$PROJECT_ID" 2>&1 || true)"
  if api_disabled "$CREATE_OUT"; then
    wait_for_apis
    continue
  fi
  if printf '%s' "$CREATE_OUT" | grep -qiE 'error'; then
    red "Could not create Firestore:"
    printf '%s\n' "$CREATE_OUT"
    exit 1
  fi
  DB_LOCATION="$REGION"
  green "Created Firestore (default) in $REGION"
  break
done
if [ -z "$DB_LOCATION" ]; then
  red "Firestore is still not reachable. Enable the APIs ($ENABLE_APIS_URL), wait a few minutes, then re-run with SKIP_CHECKS=1."
  exit 1
fi
if [ "$DB_LOCATION" != "$REGION" ]; then
  case "$DB_LOCATION" in
    nam5) SUGGEST="us-central1" ;;
    eur3) SUGGEST="europe-west1" ;;
    *) SUGGEST="$DB_LOCATION" ;;
  esac
  red "Firestore already exists in '$DB_LOCATION', but functions would deploy to '$REGION'."
  red "Firestore triggers must run next to the database. Re-run with:  bash scripts/deploy.sh $PROJECT_ID $SUGGEST ${ADMIN_EMAILS}"
  exit 1
fi
green "Firestore (default) is in $DB_LOCATION"

step "6/8 App configuration"
if [ ! -f "$ENV_FILE" ]; then
  SDK_JSON="$($FIREBASE apps:sdkconfig WEB --project "$PROJECT_ID" --json)"
  API_KEY="$(printf '%s' "$SDK_JSON" | json_get result.sdkConfig.apiKey)"
  if [ -z "$API_KEY" ]; then
    red "Could not read the web app config. Create a Web app in Firebase Console > Project settings > Your apps, then re-run."
    exit 1
  fi
  {
    echo "# Generated by scripts/deploy.sh for $PROJECT_ID (public web config, not secret)."
    echo "VITE_FIREBASE_API_KEY=$API_KEY"
    echo "VITE_FIREBASE_AUTH_DOMAIN=$(printf '%s' "$SDK_JSON" | json_get result.sdkConfig.authDomain)"
    echo "VITE_FIREBASE_PROJECT_ID=$(printf '%s' "$SDK_JSON" | json_get result.sdkConfig.projectId)"
    echo "VITE_FIREBASE_STORAGE_BUCKET=$(printf '%s' "$SDK_JSON" | json_get result.sdkConfig.storageBucket)"
    echo "VITE_FIREBASE_MESSAGING_SENDER_ID=$(printf '%s' "$SDK_JSON" | json_get result.sdkConfig.messagingSenderId)"
    echo "VITE_FIREBASE_APP_ID=$(printf '%s' "$SDK_JSON" | json_get result.sdkConfig.appId)"
    echo "VITE_FUNCTIONS_REGION=$REGION"
    echo "VITE_USE_EMULATORS=false"
  } > "$ENV_FILE"
  green "Wrote $ENV_FILE"
fi
if [ "$(get_env "$ENV_FILE" VITE_FIREBASE_PROJECT_ID)" != "$PROJECT_ID" ]; then
  red "$ENV_FILE is for another project."
  exit 1
fi
set_env "$ENV_FILE" VITE_FUNCTIONS_REGION "$REGION"
set_env "$ENV_FILE" VITE_USE_EMULATORS false

if [ ! -f functions/.env ]; then
  cp functions/.env.example functions/.env
fi
set_env functions/.env FUNCTIONS_REGION "$REGION"
if [ -n "$ADMIN_EMAILS" ]; then
  set_env functions/.env SUPER_ADMIN_EMAILS "$ADMIN_EMAILS"
fi
if [ -z "$(get_env functions/.env SUPER_ADMIN_EMAILS)" ]; then
  printf 'Super admin email(s), comma separated: '
  read -r ADMIN_EMAILS
  set_env functions/.env SUPER_ADMIN_EMAILS "$ADMIN_EMAILS"
fi
green "functions/.env → region $REGION, super admin: $(get_env functions/.env SUPER_ADMIN_EMAILS)"

step "7/8 Secrets (Secret Manager) — paste the key, or just press Enter for providers you do not use yet"
secret_hint() {
  case "$1" in
    GEMINI_API_KEY) echo "Google Gemini — free key: https://aistudio.google.com/apikey (recommended to start)" ;;
    OPENAI_API_KEY) echo "OpenAI — https://platform.openai.com/api-keys" ;;
    ANTHROPIC_API_KEY) echo "Anthropic Claude — https://console.anthropic.com/settings/keys" ;;
    RUNWAY_API_KEY) echo "Runway video — https://dev.runwayml.com" ;;
    KLING_ACCESS_KEY) echo "Kling video — API key (or access key if you use AK/SK)" ;;
    KLING_SECRET_KEY) echo "Kling video — secret key (press Enter when using a single API key)" ;;
    FAL_KEY) echo "Pika video via fal.ai — https://fal.ai/dashboard/keys" ;;
    HEYGEN_API_KEY) echo "HeyGen avatar video — https://app.heygen.com/settings" ;;
  esac
}
for SECRET in GEMINI_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY RUNWAY_API_KEY KLING_ACCESS_KEY KLING_SECRET_KEY FAL_KEY HEYGEN_API_KEY; do
  # "access" succeeds only when the secret has a usable version (a secret created without a value does not count).
  if $FIREBASE functions:secrets:access "$SECRET" --project "$PROJECT_ID" >/dev/null 2>&1; then
    echo "✓ $SECRET already set (change later with: npx firebase-tools functions:secrets:set $SECRET --project $PROJECT_ID)"
    continue
  fi
  echo "→ $SECRET  ($(secret_hint "$SECRET"))"
  printf '  Value (hidden; press Enter alone = disabled): '
  read -r -s SECRET_VALUE
  echo ""
  if [ -z "$SECRET_VALUE" ]; then SECRET_VALUE="disabled"; fi
  printf '%s' "$SECRET_VALUE" | $FIREBASE functions:secrets:set "$SECRET" --data-file=- --project "$PROJECT_ID" --non-interactive >/dev/null
  if [ "$SECRET_VALUE" = "disabled" ]; then echo "  ✓ $SECRET = disabled"; else echo "  ✓ $SECRET saved"; fi
  SECRET_VALUE=""
done

step "8/8 Deploying rules, indexes, storage rules, functions and hosting to $PROJECT_ID"
DEPLOY_TARGETS="firestore:rules,firestore:indexes,storage,functions,hosting"
if ! $FIREBASE deploy --project "$PROJECT_ID" --only "$DEPLOY_TARGETS"; then
  red "First deploys sometimes fail while Google provisions service accounts (Eventarc / Cloud Build)."
  red "If the error says Storage is not set up: Firebase Console > Storage > Get started, then continue."
  echo "APIs used by this platform (enable if any is missing): $ENABLE_APIS_URL"
  printf 'Press Enter to retry the deploy… '
  read -r _
  $FIREBASE deploy --project "$PROJECT_ID" --only "$DEPLOY_TARGETS"
fi

green ""
green "Done → https://${PROJECT_ID}.web.app"
green "Sign in with $(get_env functions/.env SUPER_ADMIN_EMAILS) (Google, or email/password + verification link)."
