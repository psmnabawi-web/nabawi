#!/usr/bin/env bash
# Deploy Dashboard SSSG ke Firebase Hosting.
# Pakai:  bash deploy.sh            (default PROJECT_ID=iw-sssg)
#         PROJECT_ID=lain bash deploy.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-iw-sssg}"
DISPLAY_NAME="${DISPLAY_NAME:-IW SSSG Dashboard}"

cd "$(dirname "$0")"

# 1) Pakai firebase-tools TERBARU via npx (tanpa sudo). Versi <15.22.3 punya bug
#    "Premature close" saat login di Node 24.17 (firebase-tools#10692).
FB="npx -y firebase-tools@latest"

# 2) Pastikan kredensial valid. Kalau tidak, jalankan login (butuh browser).
if ! $FB projects:list >/dev/null 2>&1; then
  echo "==> Kredensial tidak valid / belum login. Menjalankan firebase login..."
  $FB login --reauth
fi

# 3) Buat project kalau belum ada (cek via JSON, bukan grep bebas).
if $FB projects:list --json 2>/dev/null \
     | python3 -c "import json,sys; d=json.load(sys.stdin); ids=[p.get('projectId') for p in (d.get('result') or [])]; sys.exit(0 if '$PROJECT_ID' in ids else 1)"; then
  echo "==> Project '$PROJECT_ID' sudah ada."
else
  echo "==> Project '$PROJECT_ID' belum ada. Membuat..."
  $FB projects:create "$PROJECT_ID" --display-name "$DISPLAY_NAME"
fi

# 4) Pilih project lalu deploy hosting.
$FB use "$PROJECT_ID"
$FB deploy --only hosting --project "$PROJECT_ID"

echo ""
echo "Selesai. URL:"
echo "  https://$PROJECT_ID.web.app"
echo "  https://$PROJECT_ID.firebaseapp.com"
