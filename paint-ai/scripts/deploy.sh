#!/usr/bin/env bash
# Deploy AI Content Intelligence (paint-ai) to its OWN Firebase project.
# Usage (from the paint-ai folder):
#   bash scripts/deploy.sh <NEW_PROJECT_ID> [region]
# Example:
#   bash scripts/deploy.sh paint-content-ai-prod asia-southeast2
set -euo pipefail

PROJECT_ID="${1:-}"
REGION="${2:-asia-southeast2}"

# Projects that belong to other apps in this repository. Deploying here would overwrite their rules.
PROTECTED_PROJECTS=("almaz-cleanliness-508507")

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

if [[ -z "$PROJECT_ID" ]]; then
  red "Usage: bash scripts/deploy.sh <NEW_PROJECT_ID> [region]"
  exit 1
fi
for p in "${PROTECTED_PROJECTS[@]}"; do
  if [[ "$PROJECT_ID" == "$p" ]]; then
    red "Refusing to deploy: '$PROJECT_ID' is used by another app (Store Cleanliness). Create a NEW Firebase project for paint-ai."
    exit 1
  fi
done

cd "$(dirname "$0")/.."
FIREBASE="npx --yes firebase-tools@15"

step "Checking prerequisites"
node -e 'const [maj]=process.versions.node.split(".").map(Number); if (maj < 22) { console.error("Node.js 22+ is required (found " + process.versions.node + ")"); process.exit(1) }'
if [[ ! -f .env.local && ! -f .env.production.local ]]; then
  red "Missing .env.local — copy .env.example and fill in the Firebase web config of project '$PROJECT_ID'."
  exit 1
fi
ENV_FILE=".env.production.local"; [[ -f "$ENV_FILE" ]] || ENV_FILE=".env.local"
ENV_PROJECT="$(grep -E '^VITE_FIREBASE_PROJECT_ID=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' || true)"
if [[ "$ENV_PROJECT" != "$PROJECT_ID" ]]; then
  red "$ENV_FILE has VITE_FIREBASE_PROJECT_ID='$ENV_PROJECT' but you are deploying to '$PROJECT_ID'."
  exit 1
fi
if grep -qE '^VITE_USE_EMULATORS=true' "$ENV_FILE"; then
  red "$ENV_FILE has VITE_USE_EMULATORS=true. Set it to false (or use .env.production.local) before deploying."
  exit 1
fi
if [[ ! -f functions/.env ]]; then
  cp functions/.env.example functions/.env
  sed -i.bak "s/^FUNCTIONS_REGION=.*/FUNCTIONS_REGION=${REGION}/" functions/.env && rm -f functions/.env.bak
  red "Created functions/.env from the example. Set SUPER_ADMIN_EMAILS (and providers) in it, then run this script again."
  exit 1
fi
FN_REGION="$(grep -E '^FUNCTIONS_REGION=' functions/.env | cut -d= -f2- || true)"
VITE_REGION="$(grep -E '^VITE_FUNCTIONS_REGION=' "$ENV_FILE" | cut -d= -f2- || true)"
if [[ -n "$VITE_REGION" && "$FN_REGION" != "$VITE_REGION" ]]; then
  red "Region mismatch: functions/.env FUNCTIONS_REGION=$FN_REGION but $ENV_FILE VITE_FUNCTIONS_REGION=$VITE_REGION."
  exit 1
fi

step "Installing dependencies"
npm ci
npm ci --prefix functions

step "Quality gate (lint, typecheck, unit tests)"
npm run lint
npm run typecheck
npm test
npm --prefix functions run lint
npm --prefix functions test

step "Firebase login"
$FIREBASE login

step "Firestore database (${REGION})"
$FIREBASE firestore:databases:create "(default)" --location="$REGION" --project "$PROJECT_ID" 2>/dev/null \
  && green "Created Firestore (default) in $REGION" \
  || echo "Firestore (default) already exists — keeping its location."

step "Secrets (Secret Manager). Type the API key, or 'disabled' for providers you do not use."
for SECRET in GEMINI_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY RUNWAY_API_KEY KLING_ACCESS_KEY KLING_SECRET_KEY FAL_KEY HEYGEN_API_KEY; do
  if $FIREBASE functions:secrets:get "$SECRET" --project "$PROJECT_ID" >/dev/null 2>&1; then
    echo "✓ $SECRET already set"
  else
    echo "→ $SECRET"
    $FIREBASE functions:secrets:set "$SECRET" --project "$PROJECT_ID"
  fi
done

step "Deploying rules, indexes, storage rules, functions and hosting to ${PROJECT_ID}"
$FIREBASE deploy --project "$PROJECT_ID" --only firestore:rules,firestore:indexes,storage,functions,hosting

green "Done. Open https://${PROJECT_ID}.web.app and sign in with an email listed in SUPER_ADMIN_EMAILS."
