/* ROP Gudang — logika inti (tanpa DOM). Dipakai di browser (window.ROPCore) dan di Node (require) untuk tes.
 *
 * Alur: file Zahir "Daftar Produk Per Gudang" → parseZahir() → stok per gudang
 *       master parameter (Google Sheet tab PKU / upload) → parseMaster()
 *       compute() → baris rekomendasi pembelian (ROP, Saran PR, Final PR, status) + KPI + data issue
 *
 * Rumus (identik dengan sheet "Perhitungan Kebutuhan /ROP WH", ditambah PO outstanding & siklus order):
 *   Safety stock  = Pemakaian/hari × Buffer (hari)
 *   ROP           = Pemakaian/hari × (Buffer + Lead time)          ← "Total Safety" di sheet lama
 *   Stok maksimum = Pemakaian/hari × MAX(Target DSI, Buffer + Lead time)   ← target DSI default 7 hari; 0 = sama persis dengan sheet lama
 *   Posisi stok   = SOH (min 0) + PO outstanding
 *   Saran PR      = Stok maksimum − Posisi stok, bila Posisi ≤ ROP (dan < Stok maksimum); selain itu 0
 *   Final PR      = 0 bila Saran 0; selain itu MAX(MOQ, CEILING(Saran, kelipatan))
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ROPCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- util ----------
  const normCode = (v) => (v == null ? "" : String(v)).replace(/\s+/g, "").toUpperCase();
  const normText = (v) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
  const normHeader = (v) => normText(v).toUpperCase();
  const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");
  const PATH_SEP = " › ";
  const round6 = (n) => Math.round(n * 1e6) / 1e6;

  // Angka dari teks. locale "en": 1,234.56 · "id": 1.234,56. Bila kedua pemisah ada, pemisah terakhir = desimal.
  function parseNum(v, locale) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    let s = String(v).trim();
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); } // (1,234.00) = negatif (format akuntansi)
    s = s.replace(/[^\d.,\-]/g, "");
    if (!s || !/\d/.test(s)) return null;
    if (s.includes("-")) { neg = neg || /^-/.test(s) || /-$/.test(s); s = s.replace(/-/g, ""); }
    const ld = s.lastIndexOf("."), lc = s.lastIndexOf(",");
    if (ld >= 0 && lc >= 0) {
      s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    } else if (lc >= 0) {
      const thousandsLike = /^\d{1,3}(,\d{3})+$/.test(s);
      s = (locale === "en" ? thousandsLike : (thousandsLike && (s.match(/,/g) || []).length > 1)) ? s.replace(/,/g, "") : s.replace(",", ".");
    } else if (ld >= 0) {
      const thousandsLike = /^\d{1,3}(\.\d{3})+$/.test(s);
      if (thousandsLike && (locale === "id" || (s.match(/\./g) || []).length > 1)) s = s.replace(/\./g, "");
    }
    const n = Number(s);
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  }

  // Tebak locale angka dari kumpulan teks. Desimal koma (",5" / ",50") → id; desimal titik 1-2 digit → en.
  function detectLocale(values, fallback) {
    let id = 0, en = 0;
    for (const v of values) {
      if (typeof v !== "string") continue;
      const s = v.trim();
      if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^-?\d+,\d{1,2}$/.test(s)) id++;
      else if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(s) || /^-?\d+\.\d{1,2}$/.test(s)) en++;
    }
    if (id > en) return "id";
    if (en > id) return "en";
    return fallback || "en";
  }

  // ---------- baca file ----------
  function sniff(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length >= 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "ole"; // .xls biner (BIFF)
    if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "zip"; // .xlsx
    let i = 0;
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
    if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) return "utf16";
    while (i < b.length && i < 512 && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
    if (b[i] === 0x3c) { // "<"
      const head = String.fromCharCode.apply(null, Array.from(b.subarray(i, Math.min(b.length, i + 400)))).toLowerCase();
      if (head.includes("<workbook") || head.includes("urn:schemas-microsoft-com:office:spreadsheet")) return "xml2003";
      return "html";
    }
    return "text";
  }

  function decodeText(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) return new TextDecoder(b[0] === 0xff ? "utf-16le" : "utf-16be").decode(b);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(b).replace(/^﻿/, ""); }
    catch (e) { return new TextDecoder("windows-1252").decode(b); }
  }

  // Teks → baris. Pemisah dideteksi: tab (format export Zahir), lalu ";" atau ",". Mendukung kutip ganda.
  function textToRows(text) {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const sample = lines.slice(0, 60).join("\n");
    const count = (ch) => (sample.match(new RegExp(ch === "|" ? "\\|" : ch, "g")) || []).length;
    let delim = "\t";
    if (!sample.includes("\t")) delim = count(";") > count(",") ? ";" : ",";
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
        continue;
      }
      if (ch === '"' && cell === "") { q = true; continue; }
      if (ch === delim) { row.push(cell); cell = ""; continue; }
      if (ch === "\r") continue;
      if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
      cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // Tabel HTML / SpreadsheetML 2003 → baris. Butuh DOMParser (browser) yang dioper dari luar.
  function markupToRows(text, DOMParserCtor, kind) {
    const doc = new DOMParserCtor().parseFromString(text, kind === "xml2003" ? "application/xml" : "text/html");
    const out = [];
    if (kind === "xml2003") {
      const rowsEl = doc.getElementsByTagName("Row").length ? doc.getElementsByTagName("Row") : doc.getElementsByTagNameNS("*", "Row");
      for (const r of Array.from(rowsEl)) {
        const row = [];
        for (const c of Array.from(r.children)) {
          if (c.localName !== "Cell") continue;
          const idx = c.getAttribute("ss:Index") || c.getAttributeNS("urn:schemas-microsoft-com:office:spreadsheet", "Index");
          if (idx) while (row.length < Number(idx) - 1) row.push("");
          row.push((c.textContent || "").trim());
        }
        out.push(row);
      }
      return out;
    }
    for (const tr of Array.from(doc.querySelectorAll("tr"))) {
      const row = [];
      for (const td of Array.from(tr.children)) {
        if (!/^(td|th)$/i.test(td.tagName)) continue;
        row.push((td.textContent || "").replace(/ /g, " ").trim());
        const span = Number(td.getAttribute("colspan") || 1);
        for (let k = 1; k < span; k++) row.push("");
      }
      out.push(row);
    }
    return out;
  }

  // ---------- parser Zahir "Daftar Produk Per Gudang" ----------
  // Struktur file (tab-separated, ekstensi .xls):
  //   PT. ... / DAFTAR PRODUK PER GUDANG         ← preambule (tanpa baris "Total")
  //   SCM PKU                                     ← grup induk (ditutup "Total SCM PKU" di akhir file)
  //   Kode Produk | Nama Produk | Jumlah | Satuan Ukur | Mata Uang | Harga Satuan | Total
  //   SCM PKU                                     ← gudang
  //   Bahan Baku - Buah                           ← kategori
  //   BB001 | Anggur Merah | 6840 | Gram | IDR | 72.09 | 493,108.93
  //   Total Bahan Baku - Buah | | 47060 | | | 615.78 | 4,561,753.42
  //   ...  Total SCM PKU (gudang) · Sales (gudang) ... Total Sales · Total SCM PKU (induk)
  // Grup dicocokkan dengan baris "Total <nama>" seperti tanda kurung, jadi kedalaman grup tidak dibatasi.
  const HEADER_ALIASES = {
    kode: ["KODE PRODUK", "KODE BARANG", "KODE"],
    nama: ["NAMA PRODUK", "NAMA BARANG", "NAMA"],
    qty: ["JUMLAH", "KUANTITAS", "QTY", "STOK", "SALDO"],
    satuan: ["SATUAN UKUR", "SATUAN"],
    mataUang: ["MATA UANG"],
    harga: ["HARGA SATUAN", "HARGA", "HPP"],
    total: ["TOTAL", "NILAI", "JUMLAH NILAI"],
  };

  function zahirHeaderMap(row) {
    const H = row.map(normHeader);
    if (!H.length || !/^KODE( PRODUK| BARANG)?$/.test(H[0])) return null;
    const map = {};
    for (const key of Object.keys(HEADER_ALIASES)) {
      for (const alias of HEADER_ALIASES[key]) {
        const idx = H.findIndex((h, i) => h === alias && !Object.values(map).includes(i));
        if (idx >= 0) { map[key] = idx; break; }
      }
    }
    return map.kode != null && map.qty != null ? map : null;
  }

  function parseZahir(rows, opts) {
    opts = opts || {};
    const cellsText = [];
    for (const r of rows) for (const c of r) if (typeof c === "string") cellsText.push(c);
    const locale = opts.locale || detectLocale(cellsText.slice(0, 3000), "en");
    const num = (v) => parseNum(v, locale);
    const warnings = [];
    let col = null, headerSeen = false;
    const preamble = [];
    const stack = [];   // grup terbuka
    const groups = [];  // semua grup yang pernah dibuka
    const items = [];
    const unparsed = [];

    rows.forEach((raw, rowIdx) => {
      const r = raw.map((c) => (c == null ? "" : c));
      while (r.length && isBlank(r[r.length - 1])) r.pop();
      if (!r.length || r.every(isBlank)) return;
      const hm = zahirHeaderMap(r);
      if (hm) { col = hm; headerSeen = true; return; }
      const nonEmpty = r.filter((c) => !isBlank(c)).length;
      const first = normText(r[0]);
      if (nonEmpty === 1 && first) {
        const g = { name: first, key: normHeader(first), afterHeader: headerSeen, closed: false, row: rowIdx + 1, qtyFile: null, valFile: null, children: 0 };
        groups.push(g); stack.push(g);
        return;
      }
      const mTot = first.match(/^total\s+(.+)$/i);
      if (mTot) {
        const key = normHeader(mTot[1]);
        let idx = -1;
        for (let i = stack.length - 1; i >= 0; i--) if (stack[i].key === key) { idx = i; break; }
        if (idx >= 0) {
          const g = stack[idx];
          const c = col || { qty: 2, total: 6 };
          g.closed = true; g.closeRow = rowIdx + 1;
          g.qtyFile = num(r[c.qty]); g.valFile = c.total != null ? num(r[c.total]) : null;
          for (let i = stack.length - 1; i > idx; i--) if (!stack[i].closed) warnings.push(`Grup "${stack[i].name}" (baris ${stack[i].row}) tidak punya baris Total.`);
          stack.length = idx;
          return;
        }
      }
      const c = col || { kode: 0, nama: 1, qty: 2, satuan: 3, mataUang: 4, harga: 5, total: 6 };
      const kode = normText(r[c.kode]);
      const nama = c.nama != null ? normText(r[c.nama]) : "";
      const qty = num(r[c.qty]);
      if (!kode || qty == null) { unparsed.push({ row: rowIdx + 1, text: r.map(normText).join(" | ") }); return; }
      items.push({
        row: rowIdx + 1, groups: stack.slice(), kode, code: normCode(kode), nama, qty,
        satuan: c.satuan != null ? normText(r[c.satuan]) : "",
        mataUang: c.mataUang != null ? normText(r[c.mataUang]) : "",
        harga: c.harga != null ? num(r[c.harga]) || 0 : 0,
        total: c.total != null ? num(r[c.total]) : null,
      });
    });

    if (!headerSeen) warnings.push('Baris header "Kode Produk | Nama Produk | Jumlah ..." tidak ditemukan. Kolom dibaca dengan urutan standar Zahir.');
    // Grup sebelum header yang tidak pernah ditutup = judul laporan (nama perusahaan, judul), bukan grup.
    const isGroup = (g) => g.closed || g.afterHeader;
    for (const g of groups) {
      if (!g.closed && g.afterHeader) warnings.push(`Grup "${g.name}" (baris ${g.row}) tidak punya baris Total; file mungkin terpotong.`);
      if (!g.closed && !g.afterHeader) preamble.push(g.name);
    }

    const gudangMap = new Map();
    for (const it of items) {
      const path = it.groups.filter(isGroup);
      delete it.groups;
      it.path = path.map((g) => g.name);
      it._groups = path;
      const n = path.length;
      it.kategori = n >= 2 ? path[n - 1].name : "";
      it.gudang = n >= 2 ? path[n - 2].name : n === 1 ? path[0].name : "(Tanpa gudang)";
      it.induk = n >= 3 ? path.slice(0, n - 2).map((g) => g.name).join(" › ") : "";
      it.gkey = (it.induk ? it.induk + " › " : "") + it.gudang;
      if (it.total == null) it.total = round6(it.qty * it.harga);
      let gd = gudangMap.get(it.gkey);
      if (!gd) { gd = { key: it.gkey, name: it.gudang, induk: it.induk, items: 0, qty: 0, value: 0 }; gudangMap.set(it.gkey, gd); }
      gd.items++; gd.qty += it.qty; gd.value += it.total;
    }

    for (const it of items) it.pathStr = it.path.join(PATH_SEP);

    // Rekonsiliasi: total per grup di file vs jumlah baris produk di bawahnya.
    // prefix = jalur grup ("SCM PKU › SCM PKU › Adonan"); dipakai juga untuk rumus SUMIFS di Excel.
    const recon = [];
    for (const g of groups) {
      if (!g.closed) continue;
      let q = 0, v = 0, n = 0, prefix = g.name, depth = 0;
      for (const it of items) {
        const idx = it._groups.indexOf(g);
        if (idx < 0) continue;
        if (n === 0) { prefix = it._groups.slice(0, idx + 1).map((x) => x.name).join(PATH_SEP); depth = idx; }
        q += it.qty; v += it.total; n++;
      }
      const tolV = Math.max(1, n * 0.01);
      const okQ = g.qtyFile == null || Math.abs(g.qtyFile - q) < 0.005;
      const okV = g.valFile == null || Math.abs(g.valFile - v) <= tolV;
      recon.push({ name: g.name, prefix, depth, items: n, qtyFile: g.qtyFile, qtyCalc: round6(q), valFile: g.valFile, valCalc: Math.round(v * 100) / 100, ok: okQ && okV, row: g.row });
    }

    // kode ganda dalam gudang yang sama
    const seen = new Map(), dups = [];
    for (const it of items) {
      const k = it.gkey + "|" + it.code;
      if (seen.has(k)) dups.push({ gkey: it.gkey, kode: it.kode, nama: it.nama, rows: [seen.get(k).row, it.row] });
      else seen.set(k, it);
    }
    for (const it of items) delete it._groups;

    return {
      meta: { company: preamble[0] || "", title: preamble[1] || "", locale },
      items, recon, warnings, unparsed, duplicates: dups,
      gudangs: Array.from(gudangMap.values()).map((g) => ({ ...g, value: Math.round(g.value * 100) / 100 })),
    };
  }

  // ---------- master parameter ----------
  // Dibaca berdasarkan NAMA header (bukan posisi kolom), jadi tab "PKU" di Google Sheet bisa dipakai apa adanya.
  const MASTER_FIELDS = [
    { key: "kode", label: "Kode Barang", required: true, test: (h) => /\bKODE\b/.test(h) },
    { key: "nama", label: "Nama", test: (h) => /^NAMA( BARANG| PRODUK)?$/.test(h) || /^\S+ NAMA$/.test(h) },
    { key: "satuan", label: "Satuan", test: (h) => /\bSATUAN\b/.test(h) },
    { key: "brand", label: "Kategori", test: (h) => /\b(KATEGORI|BRAND)\b/.test(h) },
    { key: "usage", label: "Penjualan 1 Hari", required: true, test: (h) => /PENJUALAN 1 HARI|PEMAKAIAN|KEBUTUHAN 1 HARI|USAGE|RATA-?RATA (PER |\/ ?)HARI|PENJUALAN PER HARI/.test(h) },
    { key: "buffer", label: "Buffer Stock (Hari)", required: true, test: (h) => (/BUFFER/.test(h) && /\(\s*HARI\s*\)|\bHARI\b/.test(h) && !/JLH|JUMLAH|QTY/.test(h)) || /^SAFETY STO(CK|K) \(HARI\)$/.test(h) },
    { key: "lead", label: "Lead Time (Hari)", required: true, test: (h) => /LEAD ?TIME/.test(h) && /HARI/.test(h) },
    { key: "target", label: "Target DSI (Hari)", test: (h) => /TARGET DSI|DSI TARGET|TARGET STOK \(HARI\)/.test(h) },
    { key: "moq", label: "Minimum Order", test: (h) => /MINIMUM ORDER|\bMOQ\b|MIN(IMAL)? ORDER/.test(h) },
    { key: "kelipatan", label: "Kelipatan Order", test: (h) => /KELIPATAN|PACK SIZE/.test(h) },
    { key: "harga", label: "Harga", test: (h) => /(^|\s)HARGA( TERAKHIR| BELI| SATUAN| PEMBELIAN)?$/.test(h) },
    { key: "onOrder", label: "PO Outstanding", test: (h) => /PO OUTSTANDING|OUTSTANDING PO|ON ORDER|DALAM PERJALANAN/.test(h) },
    { key: "aktif", label: "Aktif", test: (h) => /^AKTIF$|^STATUS AKTIF$/.test(h) },
    { key: "supplier", label: "Supplier", test: (h) => /^(NAMA )?(SUPPLIER|VENDOR|PEMASOK)( UTAMA)?$/.test(h) },
  ];
  const NUM_FIELDS = ["usage", "buffer", "lead", "target", "moq", "kelipatan", "harga", "onOrder"];

  function findMasterHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const H = (rows[i] || []).map(normHeader);
      const map = {};
      for (const f of MASTER_FIELDS) {
        const idx = H.findIndex((h, j) => h && f.test(h) && !Object.values(map).includes(j));
        if (idx >= 0) map[f.key] = idx;
      }
      if (map.kode != null && (map.usage != null || map.buffer != null || map.lead != null)) return { row: i, map };
    }
    return null;
  }

  function parseMaster(rows, opts) {
    opts = opts || {};
    const hdr = findMasterHeader(rows);
    if (!hdr) return { ok: false, error: 'Header master tidak ditemukan. Wajib ada kolom: "Kode Barang", "Penjualan 1 Hari", "Buffer Stock (Hari)", "Lead Time (Hari)".', items: [], byCode: {}, issues: [] };
    const missing = MASTER_FIELDS.filter((f) => f.required && hdr.map[f.key] == null).map((f) => f.label);
    if (missing.length) return { ok: false, error: "Kolom wajib tidak ditemukan di master: " + missing.join(", ") + ".", items: [], byCode: {}, issues: [], headerMap: hdr.map };
    const body = rows.slice(hdr.row + 1);
    const numTexts = [];
    for (const r of body) for (const k of NUM_FIELDS) { const v = r[hdr.map[k]]; if (typeof v === "string") numTexts.push(v); }
    const locale = opts.locale || detectLocale(numTexts.slice(0, 5000), opts.localeHint || "id");
    const items = [], byCode = {}, issues = [];
    let blankCode = 0;
    body.forEach((r, i) => {
      const get = (k) => (hdr.map[k] == null ? null : r[hdr.map[k]]);
      const kode = normText(get("kode"));
      const nama = normText(get("nama"));
      const usageRaw = get("usage");
      if (!kode) { if (nama && !isBlank(usageRaw)) blankCode++; return; }
      const it = { kode, code: normCode(kode), nama, satuan: normText(get("satuan")), brand: normText(get("brand")), supplier: normText(get("supplier")), row: hdr.row + i + 2 };
      for (const k of NUM_FIELDS) {
        const v = get(k);
        const n = parseNum(v, locale);
        it[k] = n;
        if (!isBlank(v) && n == null && hdr.map[k] != null) issues.push({ type: "Angka tidak terbaca", kode, nama, detail: `Kolom ${MASTER_FIELDS.find((f) => f.key === k).label} = "${normText(v)}" (baris ${it.row})` });
      }
      const akt = get("aktif");
      it.aktif = isBlank(akt) ? true : !/^(TIDAK|NO|N|0|FALSE|NONAKTIF|NON AKTIF)$/i.test(normText(akt));
      if (it.usage != null && it.usage < 0) issues.push({ type: "Nilai negatif", kode, nama, detail: `Penjualan 1 Hari = ${it.usage}` });
      if (byCode[it.code]) {
        issues.push({ type: "Kode ganda di master", kode, nama, detail: `Juga dipakai "${byCode[it.code].nama}" (baris ${byCode[it.code].row}). Yang dipakai: baris ${byCode[it.code].row}.` });
        it.duplicate = true;
      } else byCode[it.code] = it;
      items.push(it);
    });
    if (blankCode) issues.push({ type: "Baris tanpa kode", kode: "", nama: "", detail: `${blankCode} baris punya nama & pemakaian tetapi kode kosong (tidak dihitung). Bila sumbernya Google Sheet via gviz, kode berupa angka (mis. 12107) bisa hilang; format kolom kode sebagai teks.` });
    return { ok: true, items, byCode, issues, headerMap: hdr.map, headerRow: hdr.row + 1, locale, hasColumn: Object.fromEntries(MASTER_FIELDS.map((f) => [f.key, hdr.map[f.key] != null])) };
  }

  // ---------- perhitungan ROP ----------
  const DEFAULT_SETTINGS = { targetDsi: 7, overstockDays: 30, roundGramMl: true, roundStep: 1000, priceSource: "master", dsiMin: 3.5, dsiSafety: 6.5 };
  const STATUS = {
    OOS: { label: "OOS", rank: 0, desc: "Stok habis padahal ada pemakaian" },
    KRITIS: { label: "Kritis", rank: 1, desc: "Stok tidak cukup sampai barang datang (DSI ≤ lead time)" },
    ORDER: { label: "Order", rank: 2, desc: "Posisi stok di bawah/sama dengan ROP" },
    AMAN: { label: "Aman", rank: 3, desc: "Di atas ROP, DSI tidak melebihi target" },
    ABOVE: { label: "Di atas target", rank: 4, desc: "DSI di atas target (stok maksimum)" },
    OVER: { label: "Overstock", rank: 5, desc: "DSI melebihi batas overstock" },
    DEAD: { label: "Tidak bergerak", rank: 6, desc: "Ada stok, pemakaian/hari = 0" },
    IDLE: { label: "Tidak aktif", rank: 7, desc: "Stok 0 dan pemakaian 0" },
    NOPARAM: { label: "Tanpa parameter", rank: 8, desc: "Kode tidak ada di master parameter" },
  };
  const ROUND_UNITS = /^(GRAM|GR|G|GRM|ML|MILILITER|MILLILITER)$/i;

  function ceilStep(x, step) {
    if (!(step > 0)) step = 1;
    return round6(Math.ceil(round6(x / step)) * step);
  }

  function dsiBand(dsi, s) {
    if (dsi == null) return "";
    if (dsi < s.dsiMin) return "Min ≤3 hari";
    if (dsi < s.dsiSafety) return "Safety 4–6 hari";
    return "Max ≥7 hari";
  }

  function compute(input) {
    const s = Object.assign({}, DEFAULT_SETTINGS, input.settings || {});
    const edits = input.edits || {};
    const eFinal = edits.final || {}, eOn = edits.onOrder || {}, eNote = edits.note || {};
    const stock = (input.stockItems || []);
    const master = input.master || { items: [], byCode: {} };
    const stockByCode = new Map();
    const dupStock = [];
    for (const it of stock) { if (stockByCode.has(it.code)) dupStock.push(it); else stockByCode.set(it.code, it); }

    const codes = [];
    const seenCodes = new Set();
    for (const it of stock) if (!seenCodes.has(it.code)) { seenCodes.add(it.code); codes.push(it.code); }
    // Kode master yang tidak ada di file dihitung stok 0 (sama dengan VLOOKUP sheet lama), TETAPI hanya bila master memang
    // untuk gudang ini (≥ 50% kode master aktif ada di gudang). Untuk gudang lain (mis. "Sales") baris itu tidak ditambahkan.
    const activeMaster = master.items.filter((m) => !m.duplicate && m.aktif !== false);
    const matched = activeMaster.filter((m) => stockByCode.has(m.code)).length;
    const masterFitsGudang = activeMaster.length === 0 || matched >= 0.5 * activeMaster.length;
    if (masterFitsGudang) for (const m of activeMaster) if (!seenCodes.has(m.code)) { seenCodes.add(m.code); codes.push(m.code); }

    const rows = [];
    const issues = (master.issues || []).map((x) => ({ ...x, severity: x.type === "Kode ganda di master" ? "Tinggi" : "Sedang", source: "Master" }));
    for (const d of dupStock) issues.push({ type: "Kode ganda di file Zahir", kode: d.kode, nama: d.nama, detail: `Baris ${d.row}; yang dipakai baris pertama.`, severity: "Tinggi", source: "Zahir" });

    for (const code of codes) {
      const st = stockByCode.get(code) || null;
      const m = master.byCode[code] || null;
      const row = {
        code, kode: st ? st.kode : m.kode, nama: st ? st.nama : m.nama,
        satuan: st ? st.satuan : m.satuan, satuanMaster: m ? m.satuan : "",
        brand: m ? m.brand : "", supplier: m ? m.supplier || "" : "", kategori: st ? st.kategori : "", gudang: st ? st.gudang : "",
        inZahir: !!st, hasParam: !!m, aktif: m ? m.aktif !== false : true,
        sohRaw: st ? st.qty : 0, hargaZahir: st ? st.harga : 0, hargaMaster: m && m.harga > 0 ? m.harga : 0,
        issues: [],
      };
      const soh = Math.max(0, row.sohRaw);
      const d = m && m.usage > 0 ? m.usage : 0;
      row.usage = m ? (m.usage || 0) : null;
      row.buffer = m ? (m.buffer || 0) : null;
      row.lead = m ? (m.lead || 0) : null;
      row.target = m ? (m.target != null && m.target >= 0 ? m.target : s.targetDsi) || 0 : null;
      row.targetFromMaster = !!(m && m.target != null && m.target >= 0);
      row.moq = m ? (m.moq || 0) : null;
      const unit = row.satuan || row.satuanMaster || "";
      row.kelipatan = m ? (m.kelipatan > 0 ? m.kelipatan : (s.roundGramMl && ROUND_UNITS.test(unit.trim()) ? s.roundStep : 1)) : null;
      row.kelipatanFromMaster = !!(m && m.kelipatan > 0);
      const onOrderMaster = m && m.onOrder > 0 ? m.onOrder : 0;
      row.onOrder = eOn[code] != null ? eOn[code] : onOrderMaster;
      row.onOrderEdited = eOn[code] != null;
      if (s.priceSource === "zahir") { row.harga = row.hargaZahir > 0 ? row.hargaZahir : row.hargaMaster; row.hargaSrc = row.hargaZahir > 0 ? "Zahir" : row.hargaMaster > 0 ? "Master" : ""; }
      else { row.harga = row.hargaMaster > 0 ? row.hargaMaster : row.hargaZahir; row.hargaSrc = row.hargaMaster > 0 ? "Master" : row.hargaZahir > 0 ? "Zahir" : ""; }
      row.soh = soh;
      row.note = eNote[code] || "";

      if (m) {
        row.ss = round6(d * row.buffer);
        row.rop = round6(d * (row.buffer + row.lead));
        row.max = round6(d * Math.max(row.target, row.buffer + row.lead));
        row.pos = round6(soh + row.onOrder);
        row.dsi = d > 0 ? round6(soh / d) : null;
        const need = d > 0 && row.pos <= row.rop && row.pos < row.max;
        row.saran = need ? round6(row.max - row.pos) : 0;
        row.finalAuto = row.saran > 0 ? Math.max(row.moq || 0, ceilStep(row.saran, row.kelipatan)) : 0;
        row.final = eFinal[code] != null ? eFinal[code] : row.finalAuto;
        row.finalEdited = eFinal[code] != null && eFinal[code] !== row.finalAuto;
        row.dsiAfter = d > 0 ? round6((row.pos + row.final) / d) : null;
        let st2;
        if (d <= 0) st2 = soh > 0 ? STATUS.DEAD : STATUS.IDLE;
        else if (soh <= 0) st2 = STATUS.OOS;
        else if (row.dsi <= row.lead) st2 = STATUS.KRITIS;
        else if (need) st2 = STATUS.ORDER;
        else if (row.dsi > s.overstockDays) st2 = STATUS.OVER;
        else if (soh > row.max) st2 = STATUS.ABOVE;
        else st2 = STATUS.AMAN;
        row.status = st2.label; row.rank = st2.rank;
        row.band = dsiBand(row.dsi, s);
        row.excess = d > 0 ? Math.max(0, round6(soh - row.max)) : soh; // kelebihan di atas stok maksimum (target)
      } else {
        Object.assign(row, { ss: null, rop: null, max: null, pos: soh + (row.onOrder || 0), dsi: null, saran: 0, finalAuto: 0, final: eFinal[code] != null ? eFinal[code] : 0, finalEdited: eFinal[code] != null, dsiAfter: null, status: STATUS.NOPARAM.label, rank: STATUS.NOPARAM.rank, band: "" });
      }
      row.nilaiPR = Math.round(row.final * (row.harga || 0) * 100) / 100;
      row.nilaiSOH = Math.round(soh * (row.harga || 0) * 100) / 100;
      row.excess = row.excess || 0;
      row.excessValue = Math.round(row.excess * (row.harga || 0) * 100) / 100;

      // data issue per baris
      const add = (type, detail, severity) => { row.issues.push(type); issues.push({ type, kode: row.kode, nama: row.nama, detail, severity, source: "Hitung" }); };
      if (!m && row.sohRaw > 0) add("Tanpa parameter (ada stok)", `Stok ${fmtNum(row.sohRaw)} ${row.satuan}, nilai ${fmtNum(Math.round(row.sohRaw * row.hargaZahir))}. Tidak pernah masuk rekomendasi.`, "Tinggi");
      else if (!m) add("Tanpa parameter (stok 0)", "Tambahkan ke master bila barang masih aktif.", "Rendah");
      if (m && !st) add("Kode master tidak ada di file Zahir", `Dihitung dengan stok 0${row.final > 0 ? `, Final PR ${fmtNum(row.final)}` : ""}. Cek penulisan kode.`, row.final > 0 ? "Tinggi" : "Sedang");
      if (m && st && row.satuanMaster && row.satuan && row.satuanMaster.toUpperCase() !== row.satuan.toUpperCase()) add("Satuan beda", `Zahir: ${row.satuan} · Master: ${row.satuanMaster}. Pemakaian/hari harus dalam satuan Zahir.`, "Tinggi");
      if (row.sohRaw < 0) add("Stok negatif di Zahir", `Stok ${fmtNum(row.sohRaw)} dihitung 0.`, "Tinggi");
      if (m && row.final > 0 && !(row.harga > 0)) add("Harga kosong", "Nilai PR tidak terhitung.", "Sedang");
      if (m && d > 0 && row.target > 0 && row.buffer + row.lead > row.target) add("Target DSI tidak tercapai", `Buffer ${fmtNum(row.buffer)} + lead time ${fmtNum(row.lead)} = ${fmtNum(row.buffer + row.lead)} hari > target ${fmtNum(row.target)} hari. Stok maksimum memakai ${fmtNum(row.buffer + row.lead)} hari.`, "Rendah");
      rows.push(row);
    }

    const kpi = summarize(rows, s);
    kpi.masterMatched = matched; kpi.masterActive = activeMaster.length;
    return { rows, issues, kpi, settings: s, masterFitsGudang };
  }

  function summarize(rows, s) {
    const k = { items: rows.length, withParam: 0, prCount: 0, prValue: 0, oos: 0, kritis: 0, order: 0, above: 0, over: 0, overValue: 0, dead: 0, deadValue: 0, noParamStock: 0, noParamValue: 0, stockValue: 0, byBrand: {}, edited: 0,
      excessCount: 0, excessValue: 0, paramStockValue: 0, usageValue: 0, afterValue: 0, targetDsi: s.targetDsi };
    for (const r of rows) {
      if (r.hasParam) k.withParam++;
      k.stockValue += r.nilaiSOH;
      if (r.final > 0) { k.prCount++; k.prValue += r.nilaiPR; const b = r.brand || "(Tanpa kategori)"; k.byBrand[b] = (k.byBrand[b] || 0) + r.nilaiPR; }
      if (r.status === "OOS") k.oos++;
      if (r.status === "Kritis") k.kritis++;
      if (r.status === "Order") k.order++;
      if (r.status === "Overstock") { k.over++; k.overValue += r.nilaiSOH; }
      if (r.status === "Tidak bergerak") { k.dead++; k.deadValue += r.nilaiSOH; }
      if (!r.hasParam && r.sohRaw > 0) { k.noParamStock++; k.noParamValue += Math.max(0, r.sohRaw) * (r.hargaZahir || 0); }
      if (r.finalEdited || r.onOrderEdited) k.edited++;
      if (r.status === "Di atas target") k.above++;
      if (r.hasParam) {
        // DSI gudang (berbobot nilai) = nilai stok ÷ nilai pemakaian per hari; sama dengan kolom DSI di sheet lama (Value SOH ÷ Value Penjualan)
        k.paramStockValue += r.nilaiSOH;
        k.usageValue += (r.usage > 0 ? r.usage : 0) * (r.harga || 0);
        k.afterValue += ((r.pos || 0) + (r.final || 0)) * (r.harga || 0);
        if (r.usage > 0 && r.excess > 0) { k.excessCount++; k.excessValue += r.excessValue; }
      }
    }
    k.dsiActual = k.usageValue > 0 ? Math.round((k.paramStockValue / k.usageValue) * 100) / 100 : null;
    k.dsiAfterPR = k.usageValue > 0 ? Math.round((k.afterValue / k.usageValue) * 100) / 100 : null;
    for (const f of ["prValue", "overValue", "deadValue", "noParamValue", "stockValue", "excessValue", "paramStockValue", "usageValue", "afterValue"]) k[f] = Math.round(k[f]);
    return k;
  }

  // Urutan prioritas daftar PR: OOS → Kritis → Order → lainnya; lalu DSI terkecil; lalu nilai PR terbesar.
  function prioritySort(a, b) {
    const ra = a.rank <= 2 ? a.rank : 3, rb = b.rank <= 2 ? b.rank : 3;
    if (ra !== rb) return ra - rb;
    const da = a.dsi == null ? Infinity : a.dsi, db = b.dsi == null ? Infinity : b.dsi;
    if (da !== db) return da - db;
    return (b.nilaiPR || 0) - (a.nilaiPR || 0);
  }

  function fmtNum(n, dec) {
    if (n == null || !isFinite(n)) return "-";
    const d = dec != null ? dec : (Math.abs(n % 1) > 1e-9 ? 2 : 0);
    return Number(n).toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: d });
  }
  const fmtRp = (n) => (n == null || !isFinite(n) ? "-" : "Rp " + Math.round(n).toLocaleString("id-ID"));

  // Teks ringkas PR untuk dikirim ke purchasing (WhatsApp / email).
  function prText(rows, meta) {
    const list = rows.filter((r) => r.final > 0).sort(prioritySort);
    const total = list.reduce((a, r) => a + r.nilaiPR, 0);
    const lines = [];
    lines.push(`*Rekomendasi Pembelian ${meta.gudang || ""}*`.replace(/\s+\*$/, "*"));
    if (meta.stockDate) lines.push(`Tanggal stok: ${meta.stockDate}`);
    lines.push(`Jumlah item: ${list.length} · Nilai: ${fmtRp(total)}`);
    const groups = [["OOS", "Stok habis"], ["Kritis", "Kritis"], ["Order", "Order"]];
    let no = 0;
    for (const [st, title] of groups) {
      const g = list.filter((r) => r.status === st);
      if (!g.length) continue;
      lines.push("", `*${title} (${g.length})*`);
      for (const r of g) lines.push(`${++no}. ${r.nama} (${r.kode}): ${fmtNum(r.final)} ${r.satuan}${r.harga > 0 ? ` · ${fmtRp(r.nilaiPR)}` : ""}${r.note ? ` · ${r.note}` : ""}`);
    }
    const rest = list.filter((r) => !["OOS", "Kritis", "Order"].includes(r.status));
    if (rest.length) {
      lines.push("", `*Lainnya / manual (${rest.length})*`);
      for (const r of rest) lines.push(`${++no}. ${r.nama} (${r.kode}): ${fmtNum(r.final)} ${r.satuan}${r.note ? ` · ${r.note}` : ""}`);
    }
    if (meta.preparedBy) lines.push("", `Disusun: ${meta.preparedBy}`);
    return lines.join("\n");
  }

  // ---------- Purchase Order ----------
  // Kelompok PO: supplier (kolom "Supplier" di master) · kategori (Zahir) · brand (kolom Kategori master) · satu.
  const PO_GROUP_LABEL = { supplier: "(Supplier belum diisi)", kategori: "(Tanpa kategori)", brand: "(Tanpa kategori)", satu: "Semua item" };
  function poGroups(rows, by) {
    const key = (r) => (by === "supplier" ? r.supplier : by === "kategori" ? r.kategori : by === "brand" ? r.brand : "") || PO_GROUP_LABEL[by] || PO_GROUP_LABEL.satu;
    const map = new Map();
    for (const r of rows) {
      if (!(r.final > 0)) continue;
      const k = by === "satu" ? PO_GROUP_LABEL.satu : key(r);
      let g = map.get(k);
      if (!g) { g = { key: k, items: [], total: 0, maxLead: 0, missingSupplier: by === "supplier" && !r.supplier }; map.set(k, g); }
      g.items.push(r); g.total += r.nilaiPR || 0; g.maxLead = Math.max(g.maxLead, r.lead || 0);
    }
    const out = Array.from(map.values());
    for (const g of out) { g.items.sort((a, b) => (a.nama || "").localeCompare(b.nama || "", "id")); g.total = Math.round(g.total * 100) / 100; }
    return out.sort((a, b) => (a.missingSupplier - b.missingSupplier) || a.key.localeCompare(b.key, "id"));
  }
  // Baris PO: Gram → Kg dan Ml → Liter (qty ÷ 1000, harga × 1000) bila convert = true. Jumlah tidak berubah.
  function poLine(r, convert) {
    const unit = (r.satuan || r.satuanMaster || "").trim();
    const U = unit.toUpperCase();
    let qty = r.final, price = r.harga || 0, sat = unit;
    if (convert && /^(GRAM|GR|G|GRM)$/.test(U)) { qty = round6(qty / 1000); price = round6(price * 1000); sat = "Kg"; }
    else if (convert && /^(ML|MILILITER|MILLILITER)$/.test(U)) { qty = round6(qty / 1000); price = round6(price * 1000); sat = "Liter"; }
    return { qty, satuan: sat, harga: price, jumlah: Math.round((r.final * (r.harga || 0)) * 100) / 100 };
  }
  function poNumber(prefix, seq) { return `${prefix}${String(seq).padStart(3, "0")}`; }

  async function sha256Hex(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const subtle = (typeof crypto !== "undefined" && crypto.subtle) ? crypto.subtle : null;
    if (!subtle) return "";
    const h = await subtle.digest("SHA-256", b);
    return Array.from(new Uint8Array(h)).map((x) => x.toString(16).padStart(2, "0")).join("");
  }

  return {
    normCode, normText, normHeader, parseNum, detectLocale, sniff, decodeText, textToRows, markupToRows,
    parseZahir, parseMaster, compute, summarize, prioritySort, prText, ceilStep, dsiBand, sha256Hex, fmtNum, fmtRp, poGroups, poLine, poNumber,
    MASTER_FIELDS, DEFAULT_SETTINGS, STATUS,
  };
});
