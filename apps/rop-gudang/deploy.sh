#!/usr/bin/env bash
# Deploy ROP Gudang ke Firebase Hosting. Bisa diulang kapan saja (update versi).
#
#   bash deploy.sh "https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0"
#   PROJECT_ID=nama-lain bash deploy.sh "<link>"     # bila ID project default sudah dipakai orang lain
#
# Link Google Sheet parameter ditulis ke public/config.local.json (tidak di-commit; repo publik) dan ikut ter-deploy,
# sehingga semua pengguna situs langsung memakai sheet yang sama.
# PENTING: ubah akses sheet menjadi "Siapa saja yang memiliki link: Pelihat" (bukan Editor) sebelum deploy.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-rop-gudang-pku}"
SHEET_URL="${1:-${ROP_SHEET_URL:-}}"
TAB="${ROP_SHEET_TAB:-PKU}"
GID="${ROP_SHEET_GID:-}"

cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Butuh Node.js 20+ (Cloud Shell sudah ada)."; exit 1; }

# 1) Konfigurasi sumber parameter
if [ -n "$SHEET_URL" ]; then
  case "$SHEET_URL" in
    *docs.google.com/spreadsheets/d/*) ;;
    *) echo "Link Google Sheet tidak valid: $SHEET_URL"; exit 1 ;;
  esac
  node -e 'const [u,g,t]=process.argv.slice(1); const gid=g||((u.match(/[#&?]gid=(\d+)/)||[])[1])||"0"; process.stdout.write(JSON.stringify({MASTER:{SHEET_URL:u,GID:gid,TAB:t}},null,2)+"\n")' "$SHEET_URL" "$GID" "$TAB" > public/config.local.json
  echo "==> public/config.local.json ditulis (tab $TAB)."
elif [ -f public/config.local.json ]; then
  echo "==> Memakai public/config.local.json yang sudah ada."
else
  echo "PERINGATAN: link Google Sheet kosong. Pengguna harus mengisi link di menu Pengaturan atau upload file master."
fi

# 2) Tes logika sebelum terbit
node --test test/core.test.cjs >/dev/null && echo "==> Tes logika lulus."

# 3) Firebase CLI terbaru via npx (tanpa sudo)
FB="npx -y firebase-tools@latest"
if ! $FB projects:list >/dev/null 2>&1; then
  echo "==> Login Firebase..."
  if [ -n "${CLOUD_SHELL:-}" ]; then $FB login --no-localhost; else $FB login --reauth; fi
fi

# 4) Project (dibuat bila belum ada)
if $FB projects:list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const ids=((JSON.parse(s).result)||[]).map(p=>p.projectId);process.exit(ids.includes(process.argv[1])?0:1)})' "$PROJECT_ID"; then
  echo "==> Project $PROJECT_ID sudah ada."
else
  echo "==> Membuat project $PROJECT_ID ..."
  if ! $FB projects:create "$PROJECT_ID" --display-name "ROP Gudang"; then
    echo "Gagal membuat project. ID project berlaku global; coba nama lain: PROJECT_ID=rop-gudang-pku-2 bash deploy.sh \"<link>\""
    exit 1
  fi
fi
$FB hosting:sites:create "$PROJECT_ID" --project "$PROJECT_ID" --non-interactive >/dev/null 2>&1 || true

# 5) Deploy
$FB deploy --only hosting --project "$PROJECT_ID" --non-interactive

echo ""
echo "Selesai. Buka: https://$PROJECT_ID.web.app"
