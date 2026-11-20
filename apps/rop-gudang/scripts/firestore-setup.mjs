// Dipakai workflow deploy (sekali jalan, aman diulang): aktifkan Cloud Firestore API dan buat database (default)
// di asia-southeast2 (Jakarta) bila belum ada. Tidak menyentuh data. Butuh env PROJECT dan FIREBASE_TOKEN (firebase login:ci).
//   node scripts/firestore-setup.mjs
const P = process.env.PROJECT;
const LOCATION = process.env.FIRESTORE_LOCATION || "asia-southeast2";
if (!P || !process.env.FIREBASE_TOKEN) { console.error("PROJECT / FIREBASE_TOKEN kosong"); process.exit(1); }

// token akses dari refresh token "firebase login:ci" (client OAuth publik firebase-tools)
const tok = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: process.env.FIREBASE_TOKEN,
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com", client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi" }),
}).then((r) => r.json());
if (!tok.access_token) { console.error("Gagal mendapat token akses:", tok.error || "?"); process.exit(1); }
const H = { authorization: "Bearer " + tok.access_token, "content-type": "application/json" };
const call = async (method, url, body) => {
  const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* kosong */ }
  return { status: r.status, j };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitOp(base, op, label) {
  for (let i = 0; i < 60 && op && !op.done; i++) { await sleep(5000); op = (await call("GET", `${base}/${op.name}`)).j; }
  if (!op || !op.done) throw new Error(`${label}: belum selesai setelah 5 menit`);
  if (op.error) throw new Error(`${label}: ${op.error.message}`);
}

// 1) Cloud Firestore API
const svc = await call("GET", `https://serviceusage.googleapis.com/v1/projects/${P}/services/firestore.googleapis.com`);
if (svc.status !== 200) throw new Error(`Cek API Firestore gagal (HTTP ${svc.status})`);
if (svc.j.state !== "ENABLED") {
  console.log("Mengaktifkan Cloud Firestore API…");
  const en = await call("POST", `https://serviceusage.googleapis.com/v1/projects/${P}/services/firestore.googleapis.com:enable`, {});
  if (en.status !== 200) throw new Error(`Aktifkan API Firestore gagal (HTTP ${en.status}): ${en.j && en.j.error && en.j.error.message}`);
  await waitOp("https://serviceusage.googleapis.com/v1", en.j, "Aktifkan API Firestore");
  await sleep(20000); // propagasi
} else console.log("Cloud Firestore API sudah aktif.");

// 2) Database (default)
let db = await call("GET", `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)`);
for (let i = 0; i < 6 && db.status === 403; i++) { await sleep(10000); db = await call("GET", `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)`); }
if (db.status === 200) console.log(`Database (default) sudah ada: ${db.j.locationId}, ${db.j.type}.`);
else if (db.status === 404) {
  console.log(`Membuat database (default) di ${LOCATION}…`);
  const cr = await call("POST", `https://firestore.googleapis.com/v1/projects/${P}/databases?databaseId=(default)`, { type: "FIRESTORE_NATIVE", locationId: LOCATION });
  if (cr.status !== 200) throw new Error(`Buat database gagal (HTTP ${cr.status}): ${cr.j && cr.j.error && cr.j.error.message}`);
  await waitOp("https://firestore.googleapis.com/v1", cr.j, "Buat database");
  console.log("Database (default) dibuat.");
} else throw new Error(`Cek database gagal (HTTP ${db.status}): ${db.j && db.j.error && db.j.error.message}`);
