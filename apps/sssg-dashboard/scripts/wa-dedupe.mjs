#!/usr/bin/env node
// Pengaman anti-kirim-ganda untuk workflow WA Blast.
// GitHub bisa menunda atau melewatkan jadwal, jadi workflow memasang slot cron cadangan dan bisa dipicu dari luar
// (cron-job.org → workflow_dispatch). Agar grup tidak menerima laporan dua kali, run TERJADWAL dilewati bila sudah ada
// run lain yang BERHASIL MENGIRIM (ditandai artifact "sent-<run_id>") dalam WINDOW_MIN menit terakhir.
// Run manual (workflow_dispatch) tidak pernah dilewati: itu perintah eksplisit.
//
// Env (semua disediakan GitHub Actions kecuali WINDOW_MIN): GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID,
// GITHUB_TOKEN (butuh permissions actions: read), GITHUB_OUTPUT, WINDOW_MIN (default 150 menit).
import { appendFileSync } from "node:fs";

const API = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const REPO = process.env.GITHUB_REPOSITORY || "psmnabawi-web/nabawi";
const SELF = String(process.env.GITHUB_RUN_ID || "");
const WINDOW_MIN = Math.max(1, +(process.env.WINDOW_MIN || 150) || 150);
const headers = { Accept: "application/vnd.github+json", "User-Agent": "wa-blast-dedupe" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function api(path) {
  const r = await fetch(`${API}/repos/${REPO}/${path}`, { headers, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`GitHub API ${path}: HTTP ${r.status}`);
  return r.json();
}
function finish(skip, why) {
  console.log(`${skip ? "LEWATI" : "LANJUT"}: ${why}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `skip=${skip}\n`);
}

try {
  const since = Date.now() - WINDOW_MIN * 60_000;
  const runs = (await api("actions/workflows/wa-blast.yml/runs?status=success&per_page=15")).workflow_runs || [];
  const recent = runs.filter(r => String(r.id) !== SELF
    && ["schedule", "workflow_dispatch"].includes(r.event)
    && new Date(r.created_at).getTime() >= since);
  let hit = null;
  for (const r of recent) {
    const arts = (await api(`actions/runs/${r.id}/artifacts?per_page=20`)).artifacts || [];
    if (arts.some(a => /^sent-/.test(a.name))) { hit = r; break; }
  }
  if (hit) finish(true, `run ${hit.id} (${hit.event}, ${hit.created_at}) sudah mengirim dalam ${WINDOW_MIN} menit terakhir`);
  else finish(false, `tidak ada kiriman lain dalam ${WINDOW_MIN} menit terakhir (${recent.length} run diperiksa)`);
} catch (e) {
  // Bila pengecekan gagal, lebih aman tetap mengirim daripada diam (risiko ganda kecil, risiko tidak terkirim nyata).
  console.log(`::warning::pengecekan kiriman ganda gagal (${e.message}); lanjut mengirim`);
  finish(false, "pengecekan gagal, tetap kirim");
}
