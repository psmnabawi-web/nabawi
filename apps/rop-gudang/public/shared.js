/* ROP Gudang — data bersama tim (Firebase Firestore, project yang sama dengan hosting).
 *
 * Model "kode tim": semua data tim disimpan di ropGudang/{kodeTim}. Kode tim = 43 karakter acak yang hanya ada
 * di link tim (#team=...). Tanpa kode tidak bisa membaca/menulis; daftar kode tidak bisa dilihat (rules: list ditolak).
 *
 *   ropGudang/{kode}                 { sheet:{url,gid,tab}, current:{id,at,by,name,count,items,hash}, updatedAt, updatedBy }
 *   ropGudang/{kode}/uploads/{id}    { v, at, by, name, size, count, items, hash, gudangKeys, json }   ← file Zahir terurai (tidak diubah)
 *   ropGudang/{kode}/edits/{hash}    { final:{kode:qty}, note:{kode:teks}, log:[...], stockDate, gudangKeys, updatedAt, updatedBy }
 *   ropGudang/{kode}/poSeq/{yyyymmdd} { n }                          ← nomor PO terakhir per tanggal (transaksi, tidak dobel)
 *
 * Dipakai oleh app.js lewat window.ROPShared.connect(...). Butuh vendor/firebase-app-compat.js + firebase-firestore-compat.js.
 */
(function (root) {
  "use strict";

  const MAX_JSON = 1000000; // batas rules (dokumen Firestore maks 1 MiB)

  function newTeamKey() {
    const b = new Uint8Array(32);
    (root.crypto || {}).getRandomValues(b);
    let s = "";
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); // 43 karakter base64url
  }
  const isTeamKey = (k) => typeof k === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(k);

  function connect(opts) {
    const fb = root.firebase;
    if (!fb || !fb.firestore) throw new Error("SDK Firebase belum dimuat.");
    if (!isTeamKey(opts.teamKey)) throw new Error("Kode tim tidak valid.");
    const app = fb.apps.find((a) => a.name === "rop") || fb.initializeApp(opts.config, "rop");
    const db = app.firestore();
    if (opts.emulator && !connect._emu) {
      const [host, port] = String(opts.emulator).split(":");
      db.useEmulator(host, Number(port));
      connect._emu = true;
    }
    const FV = fb.firestore.FieldValue;
    const rootRef = db.collection("ropGudang").doc(opts.teamKey);
    const uploads = rootRef.collection("uploads");
    const editsRef = (hash) => rootRef.collection("edits").doc(hash);
    const by = () => String((opts.getBy && opts.getBy()) || "").slice(0, 80);

    return {
      teamKey: opts.teamKey,
      onRoot(cb, errCb) { return rootRef.onSnapshot((s) => cb(s.exists ? s.data() : null, s.metadata), errCb); },
      onEdits(hash, cb, errCb) { return editsRef(hash).onSnapshot((s) => cb(s.exists ? s.data() : null, s.metadata), errCb); },

      // Simpan file terbaru untuk semua orang. edits = perubahan yang dibawa (tambah/hapus file); hanya dipakai bila
      // dokumen edits untuk hash ini belum ada (file yang sama di-upload ulang tetap memakai perubahan tim).
      async publish({ parts, file, gudangKeys, stockDate, edits }) {
        const json = JSON.stringify({ v: 2, parts });
        if (json.length > MAX_JSON) throw new Error(`File terlalu besar untuk dibagikan (${Math.round(json.length / 1024)} KB, maks ${Math.round(MAX_JSON / 1024)} KB).`);
        const at = Date.now(), who = by();
        const items = parts.reduce((a, p) => a + ((p.z && p.z.items && p.z.items.length) || 0), 0);
        const meta = { at, by: who, name: String(file.name || "").slice(0, 300), size: file.size || 0, count: parts.length, items, hash: file.hash };
        const ref = uploads.doc();
        await ref.set(Object.assign({ v: 2, gudangKeys: gudangKeys || [], json }, meta));
        const eRef = editsRef(file.hash);
        await db.runTransaction(async (tx) => {
          const e = await tx.get(eRef);
          if (!e.exists) {
            const base = edits || {};
            tx.set(eRef, { final: base.final || {}, note: base.note || {}, log: (base.log || []).slice(-2000), stockDate: stockDate || base.stockDate || "", gudangKeys: gudangKeys || [], updatedAt: at, updatedBy: who });
          }
          tx.set(rootRef, { current: Object.assign({ id: ref.id }, meta), updatedAt: at, updatedBy: who }, { merge: true });
        });
        return ref.id;
      },
      async loadUpload(id) {
        const s = await uploads.doc(id).get();
        if (!s.exists) throw new Error("Data upload tidak ditemukan.");
        const d = s.data();
        const body = JSON.parse(d.json);
        return { id, meta: d, parts: body.parts || [] };
      },
      async listUploads(limit) {
        const q = await uploads.orderBy("at", "desc").limit(limit || 10).get();
        return q.docs.map((s) => { const d = s.data(); return { id: s.id, at: d.at, by: d.by, name: d.name, count: d.count, items: d.items, hash: d.hash, size: d.size }; });
      },
      async useUpload(u) { // kembalikan versi lama sebagai "terbaru"
        const at = Date.now(), who = by();
        await rootRef.set({ current: { id: u.id, at: u.at, by: u.by || "", name: u.name || "", count: u.count || 1, items: u.items || 0, hash: u.hash, restoredAt: at, restoredBy: who }, updatedAt: at, updatedBy: who }, { merge: true });
      },
      async setSheet(sheet) {
        await rootRef.set({ sheet: { url: sheet.url, gid: String(sheet.gid || "0"), tab: String(sheet.tab || "PKU").slice(0, 60) }, updatedAt: Date.now(), updatedBy: by() }, { merge: true });
      },
      // Satu perubahan Final PR / catatan: digabung per kode (orang lain yang mengedit kode berbeda tidak tertimpa)
      async edit(hash, field, code, value, logEntry) {
        const data = { [field]: { [code]: value == null ? FV.delete() : value }, updatedAt: Date.now(), updatedBy: by() };
        if (logEntry) data.log = FV.arrayUnion(logEntry);
        await editsRef(hash).set(data, { merge: true });
      },
      async setMeta(hash, fields, logEntry) {
        const data = Object.assign({}, fields, { updatedAt: Date.now(), updatedBy: by() });
        if (logEntry) data.log = FV.arrayUnion(logEntry);
        await editsRef(hash).set(data, { merge: true });
      },
      async resetEdits(hash, logEntry) {
        await editsRef(hash).set({ final: {}, note: {}, updatedAt: Date.now(), updatedBy: by() }, { mergeFields: ["final", "note", "updatedAt", "updatedBy"] });
        if (logEntry) await editsRef(hash).set({ log: FV.arrayUnion(logEntry) }, { merge: true });
      },
      async peekPoSeq(ymd) { const s = await rootRef.collection("poSeq").doc(ymd).get(); return s.exists ? Number(s.data().n) || 0 : 0; },
      // Ambil blok nomor PO: mulai = MAX(nomor diminta, terakhir + 1). Dua perangkat yang mencetak bersamaan tidak dapat nomor sama.
      async takePoSeq(ymd, count, wantStart) {
        const ref = rootRef.collection("poSeq").doc(ymd);
        return db.runTransaction(async (tx) => {
          const s = await tx.get(ref);
          const last = s.exists ? Number(s.data().n) || 0 : 0;
          const start = Math.max(wantStart || 1, last + 1);
          tx.set(ref, { n: start + count - 1, updatedAt: Date.now() });
          return start;
        });
      },
    };
  }

  root.ROPShared = { connect, newTeamKey, isTeamKey };
})(typeof self !== "undefined" ? self : this);
