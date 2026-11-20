/* ROP Gudang — UI. Alur: muat parameter (Google Sheet / upload) → upload file Zahir → rekomendasi PR → export Excel.
 * Semua data diproses di browser. Yang disimpan di browser (localStorage): pengaturan, cache parameter, hasil baca file
 * terakhir, dan perubahan manual per file (dikunci dengan SHA-256 file).
 */
(function () {
  "use strict";
  const C = window.ROP_CONFIG || {};
  const Core = window.ROPCore;
  const XP = window.ROPExport;
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d) => Core.fmtNum(n, d);
  const fmtRp = Core.fmtRp;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } },
  };
  const KEY = { settings: "rop.settings.v1", master: "rop.master.v1", stock: "rop.stock.v1", edits: (h) => "rop.edits." + h };
  const emptyEdits = () => ({ final: {}, note: {}, log: [], stockDate: "" });
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const idDate = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso || "");

  const state = {
    local: {},
    settings: {},
    master: null, masterSource: "", masterLoadedAt: null, masterFromCache: false, masterError: "", masterWarn: "",
    parts: [], zahir: null, file: null, gudangKeys: [],
    edits: emptyEdits(),
    result: null,
    tab: "pr",
    sort: { pr: null, all: { key: "nama", dir: 1 }, over: { key: "excessValue", dir: -1 }, issue: null },
    filters: { q: "", brand: "", status: "", edited: false },
  };

  // ---------------- util ----------------
  let toastTimer = null;
  function toast(msg, isErr) {
    const t = $("toast");
    t.textContent = msg; t.className = "toast show" + (isErr ? " err" : "");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = "toast"), isErr ? 6000 : 3000);
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.async = true; s.onload = () => resolve(); s.onerror = () => reject(new Error("Gagal memuat " + src));
      if (/^https?:/.test(src)) s.crossOrigin = "anonymous";
      document.head.appendChild(s);
    });
  }
  async function ensureExcelJS() { if (!window.ExcelJS) await loadScript("vendor/exceljs.min.js"); return window.ExcelJS; }
  async function ensureSheetJS() { if (!window.XLSX) await loadScript(C.SHEETJS_URL); return window.XLSX; }
  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  const safeName = (s) => String(s || "").replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

  function settings() {
    return Object.assign({}, Core.DEFAULT_SETTINGS, C.DEFAULTS || {}, state.settings || {});
  }
  function sheetConf() {
    const s = state.settings || {}, L = (state.local && state.local.MASTER) || {}, M = C.MASTER || {};
    const raw = (s.sheetUrl || L.SHEET_URL || M.SHEET_URL || "").trim();
    const m = raw.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
    const id = m ? m[1] : (/^[a-zA-Z0-9_-]{20,}$/.test(raw) ? raw : "");
    const gidUrl = (raw.match(/[#&?]gid=(\d+)/) || [])[1];
    return { raw, id, gid: String(s.gid || gidUrl || L.GID || M.GID || "0"), tab: s.tab || L.TAB || M.TAB || "PKU", locale: L.LOCALE || M.LOCALE || "id" };
  }

  // ---------------- baca file ----------------
  function cellVal(v) {
    if (v == null) return "";
    if (typeof v === "number" || typeof v === "string") return v;
    if (v instanceof Date) return v.toLocaleDateString("id-ID");
    if (typeof v === "object") {
      if (v.result !== undefined) return cellVal(v.result);
      if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
      if (v.text != null) return String(v.text);
      if (v.error) return "";
    }
    return String(v);
  }
  async function readSheets(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = Core.sniff(bytes);
    let sheets;
    if (kind === "text" || kind === "utf16") sheets = [{ name: file.name, rows: Core.textToRows(Core.decodeText(bytes)) }];
    else if (kind === "html" || kind === "xml2003") sheets = [{ name: file.name, rows: Core.markupToRows(Core.decodeText(bytes), DOMParser, kind) }];
    else if (kind === "zip") {
      const ExcelJS = await ensureExcelJS();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      sheets = wb.worksheets.map((ws) => {
        const rows = [];
        ws.eachRow({ includeEmpty: true }, (row, rn) => { const arr = []; row.eachCell({ includeEmpty: true }, (cell, cn) => { arr[cn - 1] = cellVal(cell.value); }); rows[rn - 1] = Array.from(arr, (x) => (x == null ? "" : x)); });
        return { name: ws.name, rows: Array.from(rows, (r) => r || []) };
      });
    } else if (kind === "ole") {
      let XLSX;
      try { XLSX = await ensureSheetJS(); }
      catch (e) { throw new Error("File .xls biner lama butuh pustaka SheetJS dari internet dan gagal dimuat. Simpan ulang file sebagai .xlsx lalu upload lagi."); }
      const wb = XLSX.read(bytes, { type: "array" });
      sheets = wb.SheetNames.map((n) => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" }) }));
    } else throw new Error("Format file tidak dikenali.");
    return { bytes, kind, sheets };
  }

  // Satu atau beberapa file Zahir (mis. stok gudang SCM + stok Produksi). append = tambahkan ke file yang sudah ada.
  async function handleZahirFiles(fileList, append) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    $("fileChip").className = "chip"; $("fileChip").textContent = "Membaca…";
    try {
      const parts = append ? state.parts.slice() : [];
      let added = 0;
      for (const file of files) {
        if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name}: file terlalu besar (maks 25 MB).`);
        const { bytes, kind, sheets } = await readSheets(file);
        let best = null;
        for (const sh of sheets) { const z = Core.parseZahir(sh.rows); if (!best || z.items.length > best.items.length) best = z; }
        if (!best || !best.items.length) throw new Error(`${file.name}: tidak ada baris produk. Pastikan file adalah laporan Zahir "Daftar Produk Per Gudang" (kolom Kode Produk, Nama Produk, Jumlah, ...).`);
        const hash = await Core.sha256Hex(bytes);
        if (parts.some((p) => p.file.hash === hash)) { toast(`${file.name} sudah ada, dilewati.`); continue; }
        best.source = file.name;
        best.items.forEach((it) => (it.source = file.name));
        parts.push({ file: { name: file.name, size: file.size, kind, hash, loadedAt: Date.now() }, z: best });
        added++;
      }
      if (!added) { renderAll(); return; }
      await setParts(parts, append ? state.edits : null);
      const z = state.zahir;
      toast(`${parts.length} file terbaca: ${z.items.length} baris produk, ${z.gudangs.length} gudang. Dihitung: ${selLabel()}.`);
    } catch (e) {
      console.error(e);
      $("fileChip").className = "chip err"; $("fileChip").textContent = "Gagal dibaca";
      toast(e.message || String(e), true);
    }
  }

  async function setParts(parts, carryEdits) {
    const prevKeys = new Set(state.zahir ? state.zahir.gudangs.map((g) => g.key) : []);
    state.parts = parts;
    if (!parts.length) { state.zahir = null; state.file = null; state.gudangKeys = []; LS.del(KEY.stock); recompute(); return; }
    state.zahir = Core.mergeZahir(parts.map((p) => p.z));
    const hash = parts.length === 1 ? parts[0].file.hash : await Core.sha256Hex(new TextEncoder().encode(parts.map((p) => p.file.hash).join("|")));
    state.file = {
      name: parts.map((p) => p.file.name).join(" + "), size: parts.reduce((a, p) => a + p.file.size, 0),
      kind: Array.from(new Set(parts.map((p) => p.file.kind))).join("/"), hash, loadedAt: Math.max(...parts.map((p) => p.file.loadedAt)), count: parts.length,
    };
    const saved = LS.get(KEY.edits(hash), null);
    state.edits = Object.assign(emptyEdits(), saved || (carryEdits ? JSON.parse(JSON.stringify(carryEdits)) : {}));
    if (!state.edits.stockDate) state.edits.stockDate = today();
    pickGudangs(prevKeys);
    saveStockCache();
    recompute();
  }
  function saveStockCache() {
    if (!LS.set(KEY.stock, { v: 2, parts: state.parts, gudangKeys: state.gudangKeys })) console.warn("Cache file tidak tersimpan (localStorage penuh/diblokir).");
  }

  // Gudang yang dijumlah: default dari config (SCM PKU + Produksi PKU). Bila tidak ada yang cocok: gudang terbesar
  // + gudang bernama "Produksi". Gudang baru yang muncul saat menambah file ikut dicentang bila termasuk default.
  function pickGudangs(prevKeys) {
    const gs = state.zahir ? state.zahir.gudangs : [];
    const exist = new Set(gs.map((g) => g.key));
    const want = (C.DEFAULT_GUDANGS || [C.DEFAULT_GUDANG]).filter(Boolean).map(Core.normHeader);
    let defaults = gs.filter((g) => want.includes(Core.normHeader(g.name)));
    if (!defaults.length && gs.length) {
      const big = gs.slice().sort((a, b) => b.items - a.items)[0];
      defaults = [big].concat(gs.filter((g) => g !== big && /PRODUKSI/i.test(g.name)));
    }
    let keys = (state.gudangKeys || []).filter((k) => exist.has(k));
    if (!keys.length) keys = defaults.map((g) => g.key);
    else for (const g of defaults) if (!(prevKeys && prevKeys.has(g.key)) && !keys.includes(g.key)) keys.push(g.key);
    state.gudangKeys = keys;
  }

  // ---------------- master parameter ----------------
  function setMaster(m, source, fromCache, loadedAt) {
    state.master = m; state.masterSource = source; state.masterFromCache = !!fromCache; state.masterLoadedAt = loadedAt || Date.now(); state.masterError = "";
    if (!fromCache) LS.set(KEY.master, { items: m.items, issues: m.issues, hasColumn: m.hasColumn, locale: m.locale, source, loadedAt: state.masterLoadedAt });
  }
  function masterFromCache() {
    const c = LS.get(KEY.master, null);
    if (!c || !Array.isArray(c.items) || !c.items.length) return null;
    const byCode = {};
    for (const it of c.items) if (!it.duplicate && !byCode[it.code]) byCode[it.code] = it;
    return { m: { ok: true, items: c.items, byCode, issues: c.issues || [], hasColumn: c.hasColumn || {}, locale: c.locale }, source: c.source, loadedAt: c.loadedAt };
  }

  async function loadMasterFromSheet(manual) {
    const sc = sheetConf();
    state.masterWarn = "";
    if (!sc.id) {
      const c = masterFromCache();
      if (c) setMaster(c.m, c.source, true, c.loadedAt);
      else state.masterError = "Sumber parameter belum diatur di perangkat ini. Tempel link Google Sheet parameter (tab PKU) di bawah, cukup sekali.";
      recompute();
      return;
    }
    $("masterChip").className = "chip"; $("masterChip").textContent = "Memuat…";
    const tries = [
      { label: "export CSV", url: `https://docs.google.com/spreadsheets/d/${sc.id}/export?format=csv&gid=${encodeURIComponent(sc.gid)}` },
      { label: "gviz", url: `https://docs.google.com/spreadsheets/d/${sc.id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sc.tab)}` },
    ];
    let lastErr = "";
    for (const t of tries) {
      try {
        const r = await fetch(t.url, { cache: "no-store", credentials: "omit" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const text = await r.text();
        if (/^\s*</.test(text)) throw new Error("Sheet tidak publik (diarahkan ke halaman login)");
        const m = Core.parseMaster(Core.textToRows(text), { localeHint: sc.locale });
        if (!m.ok) throw new Error(m.error);
        setMaster(m, `Google Sheet tab ${sc.tab} (${t.label})`, false);
        if (t.label === "gviz") state.masterWarn = "Parameter dibaca lewat jalur cadangan (gviz). Kode berupa angka murni bisa terlewat; cek Data issue.";
        recompute();
        if (manual) toast(`Parameter dimuat: ${m.items.length} item.`);
        return;
      } catch (e) { lastErr = `${t.label}: ${e.message || e}`; }
    }
    const c = masterFromCache();
    if (c) { setMaster(c.m, c.source, true, c.loadedAt); state.masterWarn = `Google Sheet tidak bisa dibaca (${lastErr}). Memakai parameter tersimpan terakhir.`; }
    else state.masterError = `Google Sheet tidak bisa dibaca (${lastErr}). Pastikan link benar dan sheet dibagikan "Siapa saja yang memiliki link: Pelihat", atau upload file master.`;
    recompute();
    if (manual) toast("Gagal memuat Google Sheet.", true);
  }

  async function handleMasterFile(file) {
    if (!file) return;
    try {
      const { sheets } = await readSheets(file);
      let ok = null, firstErr = "";
      const order = sheets.slice().sort((a, b) => (/^(PKU|MASTER)/i.test(b.name) ? 1 : 0) - (/^(PKU|MASTER)/i.test(a.name) ? 1 : 0));
      for (const sh of order) {
        const m = Core.parseMaster(sh.rows, { localeHint: "id" });
        if (m.ok && m.items.length) { ok = { m, sheet: sh.name }; break; }
        if (!firstErr) firstErr = m.error || "Tidak ada baris parameter.";
      }
      if (!ok) throw new Error(firstErr || "Master tidak terbaca.");
      setMaster(ok.m, `Upload: ${file.name}${sheets.length > 1 ? ` (sheet ${ok.sheet})` : ""}`, false);
      state.masterWarn = "Parameter dari file upload. Pastikan versinya sama dengan sheet yang dipakai tim.";
      recompute();
      toast(`Master dimuat: ${ok.m.items.length} item.`);
    } catch (e) { console.error(e); toast(e.message || String(e), true); }
  }

  // ---------------- hitung ----------------
  function recompute() {
    if (state.zahir && state.master) {
      const stockItems = Core.aggregateStock(state.zahir.items, state.gudangKeys);
      state.result = Core.compute({ stockItems, master: state.master, settings: settings(), edits: state.edits });
    } else state.result = null;
    renderAll();
  }
  function saveEdits() { if (state.file) LS.set(KEY.edits(state.file.hash), state.edits); }
  const selGudangs = () => (state.zahir ? state.zahir.gudangs.filter((g) => state.gudangKeys.includes(g.key)) : []);
  const gudangLabel = (g) => (g ? g.name + (g.induk && g.induk !== g.name ? ` (${g.induk})` : "") : "");
  const selLabel = () => selGudangs().map((g) => g.name).join(" + ");
  const selValue = () => selGudangs().reduce((a, g) => a + (g.value || 0), 0);

  // ---------------- render ----------------
  function renderAll() {
    renderMasterPanel(); renderFilePanel();
    const ready = !!state.result;
    $("results").hidden = !ready;
    $("btnExport").disabled = !ready; $("btnCopy").disabled = !ready; $("btnPO").disabled = !ready;
    if (!ready) return;
    renderToolbar(); renderAlerts(); renderKpis(); renderFilters(); renderTable();
  }

  function renderMasterPanel() {
    const chip = $("masterChip"), info = $("masterInfo");
    if (state.master) {
      const n = state.master.items.length;
      chip.className = "chip " + (state.masterFromCache || state.masterWarn ? "warn" : "ok");
      chip.textContent = `${fmt(n)} item${state.masterFromCache ? " · cache" : ""}`;
      const hc = state.master.hasColumn || {};
      const extra = ["target", "kelipatan", "supplier"].filter((k) => hc[k]).map((k) => ({ target: "Target DSI", kelipatan: "Kelipatan", supplier: "Supplier" }[k]));
      info.innerHTML = `${esc(state.masterSource)} · dimuat ${esc(new Date(state.masterLoadedAt).toLocaleString("id-ID"))}${extra.length ? ` · kolom tambahan: ${esc(extra.join(", "))}` : ""}${state.masterWarn ? `<br><span class="sev-Sedang">${esc(state.masterWarn)}</span>` : ""}`;
    } else if (state.masterError) {
      chip.className = "chip err"; chip.textContent = "Belum ada";
      info.innerHTML = `<span class="sev-Tinggi">${esc(state.masterError)}</span>
        <span class="inline-form"><input type="url" id="inpSheetQuick" placeholder="https://docs.google.com/spreadsheets/d/…/edit" aria-label="Link Google Sheet parameter" value="${esc(state.settings.sheetUrl || "")}"><button type="button" class="btn small primary" id="btnSheetQuick">Simpan &amp; muat</button></span>`;
    } else { chip.className = "chip"; chip.textContent = "Memuat…"; info.textContent = ""; }
    $("btnReloadMaster").disabled = !sheetConf().id;
  }

  function renderFilePanel() {
    const chip = $("fileChip"), box = $("fileInfo");
    if (!state.zahir || !state.file) { box.hidden = true; if (!/err/.test(chip.className)) { chip.className = "chip muted"; chip.textContent = "Belum ada file"; } return; }
    const z = state.zahir, f = state.file;
    const okN = z.recon.filter((r) => r.ok).length;
    chip.className = "chip " + (okN === z.recon.length && !z.unparsed.length ? "ok" : "warn");
    chip.textContent = `${state.parts.length} file · ${fmt(z.items.length)} baris · subtotal ${okN}/${z.recon.length} cocok`;
    $("subtitle").textContent = [z.meta.company, z.meta.title ? z.meta.title.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()) : ""].filter(Boolean).join(" · ") || "Rekomendasi pembelian dari stok Zahir";
    box.hidden = false;
    box.innerHTML = `<div class="files-list">${state.parts.map((p, i) => {
      const gs = Array.from(new Set(p.z.items.map((it) => it.gudang)));
      return `<div class="file-row"><div><b>${esc(p.file.name)}</b><span>Gudang: ${esc(gs.join(", "))} · ${fmt(p.z.items.length)} baris · ${fmt(Math.round(p.file.size / 1024))} KB · ${esc(new Date(p.file.loadedAt).toLocaleString("id-ID"))}</span></div><button type="button" class="btn small ghost" data-remove-file="${i}" aria-label="Hapus file ${esc(p.file.name)}">Hapus</button></div>`;
    }).join("")}</div>
      <div class="file-actions"><label class="btn small" for="fileZahirAdd">+ Tambah file (mis. stok Produksi)</label><span class="muted small">SHA-256 ${esc(f.hash.slice(0, 16))}…</span></div>`;
  }

  function renderToolbar() {
    $("gudangChecks").innerHTML = state.zahir.gudangs.map((g) => `<label class="gchk"><input type="checkbox" value="${esc(g.key)}"${state.gudangKeys.includes(g.key) ? " checked" : ""}> ${esc(gudangLabel(g))} <small>${fmt(g.items)} item</small></label>`).join("");
    $("inpDate").value = state.edits.stockDate || "";
    $("inpBy").value = state.settings.preparedBy || "";
    const s = settings();
    const fromMaster = state.master && state.master.hasColumn && state.master.hasColumn.target;
    $("lblCycle").textContent = `${fmt(s.targetDsi)} hari${fromMaster ? " (default; sebagian item punya target sendiri di master)" : ""}`;
  }

  function alertBox(kind, html) { return `<div class="alert ${kind}"><span class="dot"></span><div>${html}</div></div>`; }
  function renderAlerts() {
    const z = state.zahir, r = state.result, out = [];
    const okN = z.recon.filter((x) => x.ok).length;
    const zr = r.rows.filter((x) => x.inZahir), withStock = zr.filter((x) => x.sohRaw > 0).length, multi = zr.filter((x) => x.sohBy && x.sohBy.length > 1).length;
    if (okN === z.recon.length && !z.unparsed.length) out.push(alertBox("ok", `<b>File Zahir terverifikasi.</b> ${okN} dari ${z.recon.length} subtotal di file cocok dengan jumlah baris produk. Stok dihitung = <b>${esc(selLabel())}</b>${state.gudangKeys.length > 1 ? ` (dijumlah per kode; ${multi} item ada di lebih dari satu gudang)` : ""}. SOH terbaca: <b>${withStock}</b> item ada stok, ${zr.length - withStock} item stok 0. Nilai stok: <b>${fmtRp(selValue())}</b>.`));
    else out.push(alertBox("err", `<b>File Zahir tidak lengkap/berbeda.</b> Subtotal cocok ${okN}/${z.recon.length}${z.unparsed.length ? `, ${z.unparsed.length} baris tidak terbaca` : ""}. Download ulang dari Zahir dan jangan edit file sebelum upload. Rincian di tab Data issue.`));
    if (!r.masterFitsGudang) out.push(alertBox("warn", `<b>Master parameter tampaknya bukan untuk gudang ini.</b> Hanya ${r.kpi.masterMatched} dari ${r.kpi.masterActive} kode master ada di ${esc(selLabel())}. Item master yang tidak ada di file tidak dihitung.`));
    const high = r.issues.filter((i) => i.severity === "Tinggi").length;
    if (high) out.push(alertBox("warn", `<b>${high} data issue prioritas tinggi.</b> ${r.kpi.noParamStock ? `${r.kpi.noParamStock} barang ada stoknya (${fmtRp(r.kpi.noParamValue)}) tetapi tidak punya parameter, jadi tidak pernah direkomendasikan. ` : ""}<a href="#" data-goto="issue">Lihat tab Data issue</a>.`));
    $("alerts").innerHTML = out.join("");
  }

  function renderKpis() {
    const k = state.result.kpi;
    const brands = Object.entries(k.byBrand).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([b, v]) => `${esc(b)} ${fmtRp(v)}`).join(" · ");
    const t = settings().targetDsi;
    const dsiCls = k.dsiActual == null ? "" : k.dsiActual > t * 1.1 ? "blue" : k.dsiActual < t * 0.6 ? "red" : "green";
    const cards = [
      { cls: dsiCls, label: `DSI gudang · target ${fmt(t)} hari`, value: k.dsiActual == null ? "-" : `${fmt(k.dsiActual, 1)} hari`, sub: `Tanpa kelebihan & barang mati: ${k.dsiNoExcess == null ? "-" : fmt(k.dsiNoExcess, 1)} hari · desain parameter: ${k.dsiDesign == null ? "-" : fmt(k.dsiDesign, 1)} hari` },
      { cls: "gold", label: "Perlu order", value: fmt(k.prCount) + " item", sub: `OOS ${k.oos} · Kritis ${k.kritis} · Order ${k.order}` },
      { cls: "", label: "Nilai PR", value: fmtRp(k.prValue), sub: `Kebutuhan riil ${fmtRp(k.needValue)}${k.overNeedValue ? ` · lebih dari kebutuhan ${fmtRp(k.overNeedValue)}` : ""}${k.moqHeldCount ? ` · ${k.moqHeldCount} MOQ ditahan (hemat ${fmtRp(k.moqHeldValue)})` : ""}` },
      { cls: "blue", label: `Kelebihan di atas target`, value: fmtRp(k.excessValue), sub: `${k.excessCount} item bergerak melebihi batas target · ${k.over} item DSI > ${fmt(settings().overstockDays)} hari` },
      { cls: "grey", label: "Tidak bergerak", value: fmtRp(k.deadValue), sub: `${k.dead} item · pemakaian 0` },
      { cls: "violet", label: "Tanpa parameter", value: fmtRp(k.noParamValue), sub: `${k.noParamStock} item ada stok · tidak dihitung` },
    ];
    $("kpis").innerHTML = cards.map((c) => `<div class="card kpi ${c.cls}"><span class="label">${esc(c.label)}</span><span class="value">${c.value}</span><span class="sub">${c.sub}</span></div>`).join("");
  }

  function renderFilters() {
    const rows = state.result.rows;
    const brands = Array.from(new Set(rows.map((r) => r.brand).filter(Boolean))).sort();
    const fb = $("fBrand"), cur = state.filters.brand;
    fb.innerHTML = `<option value="">Semua kategori</option>` + brands.map((b) => `<option${b === cur ? " selected" : ""}>${esc(b)}</option>`).join("");
    const sts = Object.values(Core.STATUS).map((s) => s.label);
    const extra = [["__moqHeld", "— MOQ ditahan"], ["__over", "— PR lebih dari kebutuhan"]];
    $("fStatus").innerHTML = `<option value="">Semua status</option>` + sts.map((s) => `<option${s === state.filters.status ? " selected" : ""}>${esc(s)}</option>`).join("")
      + extra.map(([v, l]) => `<option value="${v}"${v === state.filters.status ? " selected" : ""}>${esc(l)}</option>`).join("");
    const isIssue = state.tab === "issue";
    ["fBrand", "fStatus"].forEach((id) => ($(id).hidden = isIssue));
    $("fEdited").parentElement.hidden = isIssue;
    $("btnResetEdits").hidden = isIssue;
  }

  const stClass = (s) => ({ "OOS": "oos", "Kritis": "kritis", "Order": "order", "Aman": "aman", "Di atas target": "above", "Overstock": "over", "Tidak bergerak": "dead", "Tidak aktif": "idle", "Tanpa parameter": "noparam" }[s] || "idle");

  function tabRows(tab) {
    const rows = state.result.rows;
    if (tab === "pr") return rows.filter((r) => r.final > 0 || (r.hasParam && r.rank <= 2));
    if (tab === "over") return rows.filter((r) => r.status === "Di atas target" || r.status === "Overstock" || r.status === "Tidak bergerak");
    return rows;
  }
  function applyFilters(list) {
    const f = state.filters, q = f.q.trim().toLowerCase();
    return list.filter((r) => (!q || r.kode.toLowerCase().includes(q) || (r.nama || "").toLowerCase().includes(q))
      && (!f.brand || r.brand === f.brand)
      && (!f.status || (f.status === "__moqHeld" ? r.moqHeld : f.status === "__over" ? r.overNeed > 0 : r.status === f.status))
      && (!f.edited || r.finalEdited || r.note));
  }

  const NUM = (key, label, opt) => Object.assign({ key, label, num: true }, opt || {});
  const COLS_ITEM = [
    { key: "rank", label: "Status", render: (r) => `<span class="st st-${stClass(r.status)}">${esc(r.status)}</span>` },
    { key: "kode", label: "Kode", render: (r) => `<span class="mono">${esc(r.kode)}</span>` },
    { key: "nama", label: "Nama barang", cls: "name sticky", render: (r) => `<button type="button" data-detail="${esc(r.code)}">${esc(r.nama)}</button>${r.issues.length ? `<span class="issue-flag" title="${esc(r.issues.join("; "))}">!</span>` : ""}<small>${esc([r.brand, r.kategori].filter(Boolean).join(" · "))}</small>` },
    { key: "satuan", label: "Satuan", render: (r) => esc(r.satuan || r.satuanMaster) },
    NUM("usage", "Pakai/hari", { render: (r) => (r.usage == null ? "-" : fmt(r.usage)) }),
    NUM("sohRaw", "SOH", { render: (r) => {
      const base = !r.inZahir ? '0<small class="tag-miss">tidak ada di file</small>' : r.sohRaw <= 0 ? `${fmt(r.sohRaw)}<small class="tag-oos">habis</small>` : fmt(r.sohRaw);
      const multi = r.sohBy && r.sohBy.length > 1 ? `<small class="tag-multi" title="${esc(r.sohBy.map((x) => `${x.gudang}: ${fmt(x.qty)}`).join(" · "))}">${esc(r.sohBy.map((x) => fmt(x.qty)).join(" + "))}</small>` : "";
      return base + multi;
    } }),
    NUM("dsi", "DSI", { render: (r) => (r.dsi == null ? "-" : r.dsi === 0 ? '0<small class="tag-oos">habis</small>' : fmt(r.dsi, 1)), tdCls: (r) => (r.dsi == null ? "" : r.dsi <= (r.lead || 0) ? "dsi-low" : r.dsi < settings().dsiSafety ? "dsi-mid" : "") }),
    NUM("rop", "ROP (Buf+LT)", { render: (r) => (r.rop == null ? "-" : fmt(r.rop)) }),
    NUM("need", "Kebutuhan", { render: (r) => fmt(r.need || 0), tdCls: () => "strong" }),
    NUM("moq", "MOQ", { render: (r) => (r.moq ? `${fmt(r.moq)}${r.moqDays != null ? `<small class="tag-sub">${fmt(r.moqDays, 1)} hari</small>` : ""}` : "-") }),
    NUM("final", "Final PR", { input: "final" }),
    NUM("overNeed", "Lebih dr kebutuhan", { render: (r) => (r.overNeed > 0 ? `+${fmt(r.overNeed)}<small class="tag-sub">${fmtRp(r.overNeedValue)}</small>` : r.moqHeld ? `0<small class="tag-held" title="MOQ ${esc(fmt(r.moq))} tidak diikuti: menambah ${esc(fmt(r.moqExtraIfFollow))} (${esc(fmt(r.moqExtraIfFollow / (r.usage || 1), 1))} hari)">MOQ ditahan</small>` : "-"), tdCls: (r) => (r.overNeed > 0 ? "over-need" : "") }),
    NUM("dsiAfter", "DSI stlh PR", { render: (r) => (r.dsiAfter == null ? "-" : fmt(r.dsiAfter, 1)) }),
    NUM("nilaiPR", "Nilai PR", { render: (r) => (r.nilaiPR ? fmtRp(r.nilaiPR) : "-"), tdCls: () => "strong" }),
    { key: "note", label: "Catatan", input: "note" },
  ];
  const COLS_OVER = [
    COLS_ITEM[0], COLS_ITEM[1], COLS_ITEM[2], COLS_ITEM[3], COLS_ITEM[4], COLS_ITEM[5], COLS_ITEM[6],
    NUM("max", "Stok maks", { render: (r) => (r.max == null ? "-" : fmt(r.max)) }),
    NUM("excess", "Kelebihan qty", { render: (r) => fmt(r.excess) }),
    NUM("nilaiSOH", "Nilai SOH", { render: (r) => fmtRp(r.nilaiSOH) }),
    NUM("excessValue", "Nilai kelebihan", { render: (r) => fmtRp(r.excessValue), tdCls: () => "strong" }),
    { key: "note", label: "Catatan", input: "note" },
  ];
  const ACTIONS = {
    "Tanpa parameter (ada stok)": "Isi parameter di master (tab PKU).",
    "Tanpa parameter (stok 0)": "Tambah ke master bila masih aktif.",
    "Kode master tidak ada di file Zahir": "Samakan kode master dengan Zahir.",
    "Satuan beda": "Samakan satuan / konversi pemakaian.",
    "Stok negatif di Zahir": "Telusuri & koreksi transaksi Zahir.",
    "Kode ganda di master": "Perbaiki kode di master.",
    "Kode ganda di file Zahir": "Cek master produk Zahir.",
    "Harga kosong": "Isi harga terakhir.",
    "Target DSI tidak tercapai": "Perpendek lead time/buffer, atau tetapkan target khusus item ini.",
    "MOQ melebihi kebutuhan": "Negosiasi MOQ/kemasan lebih kecil atau cari supplier lain; isi Final PR manual bila harus ikut MOQ.",
  };
  function issueList() {
    const z = state.zahir, list = state.result.issues.slice();
    for (const rc of z.recon) if (!rc.ok) list.push({ type: "Subtotal Zahir tidak cocok", kode: "", nama: rc.name, detail: `Qty file ${fmt(rc.qtyFile)} vs hitung ${fmt(rc.qtyCalc)} · nilai file ${fmt(rc.valFile)} vs hitung ${fmt(rc.valCalc)}`, severity: "Tinggi", source: "Zahir" });
    for (const u of z.unparsed) list.push({ type: "Baris tidak terbaca", kode: "", nama: "", detail: `Baris ${u.row}: ${u.text}`, severity: "Sedang", source: "Zahir" });
    for (const w of z.warnings) list.push({ type: "Peringatan file", kode: "", nama: "", detail: w, severity: "Sedang", source: "Zahir" });
    const so = { Tinggi: 0, Sedang: 1, Rendah: 2 };
    return list.sort((a, b) => (so[a.severity] ?? 3) - (so[b.severity] ?? 3) || a.type.localeCompare(b.type));
  }

  function renderTable() {
    const tab = state.tab, tbl = $("tbl");
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    $("cntPr").textContent = tabRows("pr").length; $("cntAll").textContent = state.result.rows.length;
    $("cntOver").textContent = tabRows("over").length;
    const issues = issueList(); $("cntIssue").textContent = issues.length;
    tbl.className = "data";

    if (tab === "issue") {
      const q = state.filters.q.trim().toLowerCase();
      const list = issues.filter((i) => !q || `${i.kode} ${i.nama} ${i.type} ${i.detail}`.toLowerCase().includes(q));
      tbl.innerHTML = `<thead><tr><th>Prioritas</th><th>Jenis</th><th>Kode</th><th>Nama</th><th>Detail</th><th>Tindakan</th></tr></thead><tbody>${list.map((i) => `<tr><td><span class="sev sev-${esc(i.severity)}">${esc(i.severity)}</span></td><td>${esc(i.type)}</td><td class="mono">${esc(i.kode)}</td><td class="wrap">${esc(i.nama)}</td><td class="wrap">${esc(i.detail)}</td><td class="wrap">${esc(ACTIONS[i.type] || "")}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">Tidak ada data issue.</td></tr>`}</tbody>`;
      $("tblFoot").innerHTML = `<span>${list.length} issue · Tinggi ${list.filter((i) => i.severity === "Tinggi").length}</span><span>Perbaikan dilakukan di sumber data (master parameter / Zahir), lalu upload ulang.</span>`;
      return;
    }

    const cols = tab === "over" ? COLS_OVER : COLS_ITEM;
    let list = applyFilters(tabRows(tab));
    const sort = state.sort[tab];
    if (sort) {
      const dir = sort.dir;
      list.sort((a, b) => {
        let va = a[sort.key], vb = b[sort.key];
        if (va == null) va = typeof vb === "string" ? "" : -Infinity; if (vb == null) vb = typeof va === "string" ? "" : -Infinity;
        return (typeof va === "string" ? va.localeCompare(vb, "id") : va - vb) * dir;
      });
    } else list.sort(Core.prioritySort);

    const th = cols.map((c) => {
      const active = sort && sort.key === c.key;
      return `<th data-sort="${c.key}" class="${c.num ? "num " : ""}${(c.cls || "").includes("sticky") ? "sticky" : ""}" scope="col">${esc(c.label)}${active ? `<span class="arrow">${sort.dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`;
    }).join("");
    const body = list.map((r) => `<tr>${cols.map((c) => {
      const cls = [c.num ? "num" : "", c.cls || "", c.tdCls ? c.tdCls(r) : ""].filter(Boolean).join(" ");
      let inner;
      if (c.input === "final") inner = r.hasParam || r.final ? `<input class="cell${r.finalEdited ? " edited" : ""}" type="number" inputmode="decimal" min="0" step="any" data-code="${esc(r.code)}" data-field="final" value="${r.final}" aria-label="Final PR ${esc(r.nama)}" title="Rekomendasi sistem: ${esc(fmt(r.finalAuto))}">` : "-";
      else if (c.input === "note") inner = `<input class="cell text" type="text" maxlength="120" data-code="${esc(r.code)}" data-field="note" value="${esc(r.note)}" aria-label="Catatan ${esc(r.nama)}">`;
      else inner = c.render ? c.render(r) : esc(r[c.key]);
      return `<td${cls ? ` class="${cls}"` : ""}>${inner}</td>`;
    }).join("")}</tr>`).join("");
    let foot = "";
    if (list.length && tab !== "over") {
      const tot = list.reduce((a, r) => a + (r.nilaiPR || 0), 0);
      foot = `<tr class="total">${cols.map((c, i) => `<td class="${c.num ? "num" : ""}${(c.cls || "").includes("sticky") ? " sticky" : ""}">${i === 2 ? `Total ${list.filter((r) => r.final > 0).length} item PR` : c.key === "nilaiPR" ? fmtRp(tot) : ""}</td>`).join("")}</tr>`;
    } else if (list.length) {
      const tot = list.reduce((a, r) => a + (r.excessValue || 0), 0), tot2 = list.reduce((a, r) => a + (r.nilaiSOH || 0), 0);
      foot = `<tr class="total">${cols.map((c, i) => `<td class="${c.num ? "num" : ""}${(c.cls || "").includes("sticky") ? " sticky" : ""}">${i === 2 ? `Total ${list.length} item` : c.key === "excessValue" ? fmtRp(tot) : c.key === "nilaiSOH" ? fmtRp(tot2) : ""}</td>`).join("")}</tr>`;
    }
    tbl.innerHTML = `<thead><tr>${th}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="empty">Tidak ada item untuk filter ini.</td></tr>`}${foot}</tbody>`;
    const edited = state.result.kpi.edited;
    $("tblFoot").innerHTML = `<span>${list.length} baris${edited ? ` · ${edited} item diubah manual (oranye)` : ""}</span><span>Klik nama barang untuk melihat rincian hitungan. Kolom kuning bisa diisi; perubahan tersimpan di browser ini dan ikut ke Excel.</span>`;
  }

  // ---------------- detail item ----------------
  function openDetail(code) {
    const r = state.result.rows.find((x) => x.code === code);
    if (!r) return;
    $("dlgItemTitle").textContent = `${r.nama} · ${r.kode}`;
    const u = esc(r.satuan || r.satuanMaster || "");
    const line = (label, val, f, hl) => `<tr${hl ? ' class="hl"' : ""}><td>${label}</td><td class="num">${val}</td><td class="f">${f || ""}</td></tr>`;
    let html = `<p><span class="st st-${stClass(r.status)}">${esc(r.status)}</span> <span class="muted small">${esc([r.brand, r.kategori, r.gudang].filter(Boolean).join(" · "))}</span></p>`;
    if (r.hasParam) {
      const d = r.usage || 0;
      html += `<table class="calc">
        ${line("Pemakaian / hari", `${fmt(d)} ${u}`, "master")}
        ${line("Buffer", `${fmt(r.buffer)} hari`, "master")}
        ${line("Lead time", `${fmt(r.lead)} hari`, "master")}
        ${line("Target DSI", `${fmt(r.target)} hari`, r.targetFromMaster ? "master" : "default pengaturan")}
        ${line("Safety stock", `${fmt(r.ss)} ${u}`, `${fmt(d)} × ${fmt(r.buffer)}`)}
        ${line("ROP", `${fmt(r.rop)} ${u}`, `${fmt(d)} × (${fmt(r.buffer)} + ${fmt(r.lead)})`, true)}
        ${line("Stok maksimum (dasar PR)", `${fmt(r.max)} ${u}`, r.orderBasis === "target" ? `${fmt(d)} × (MAX(${fmt(r.buffer)} + 1, 2 × ${fmt(r.target)} − ${fmt(r.buffer)}) + ${fmt(r.lead)}) · dasar Target DSI` : `= ROP · ${fmt(d)} × (${fmt(r.buffer)} + ${fmt(r.lead)}) · sesuai master`, true)}
        ${line("Batas stok fisik (target)", `${fmt(r.physMax)} ${u}`, r.orderBasis === "target" ? `${fmt(d)} × MAX(${fmt(r.buffer)} + 1, 2 × ${fmt(r.target)} − ${fmt(r.buffer)})` : `${fmt(d)} × ${r.target > 0 ? `MAX(${fmt(r.buffer)} + 1, ${fmt(r.target)})` : `(${fmt(r.buffer)} + 1)`} · di atas ini = "Di atas target"`)}
        ${line("SOH Zahir", `${fmt(r.sohRaw)} ${u}`, !r.inZahir ? "tidak ada di file → 0" : r.sohBy && r.sohBy.length > 1 ? r.sohBy.map((x) => `${esc(x.gudang)} ${fmt(x.qty)}`).join(" + ") : `file Zahir · ${esc(r.gudang)}`, r.sohBy && r.sohBy.length > 1)}
        ${line("DSI", r.dsi == null ? "-" : `${fmt(r.dsi, 1)} hari`, `SOH ÷ pemakaian · ${esc(r.band)}`)}
        ${line("Kebutuhan", `${fmt(r.need || 0)} ${u}`, r.saran > 0 ? `${fmt(r.max)} − ${fmt(r.soh)} (stok maks − SOH, karena SOH ≤ ROP)` : "SOH di atas ROP / pemakaian 0 → tidak perlu order", true)}
        ${r.needPack !== r.need ? line("Dibulatkan kemasan", `${fmt(r.needPack || 0)} ${u}`, `kelipatan ${fmt(r.kelipatan)}${r.kelipatanFromMaster ? " (master)" : r.kelipatan > 1 ? " (otomatis Gram/Ml)" : ""}`) : ""}
        ${line("MOQ", r.moq ? `${fmt(r.moq)} ${u}` : "-", r.moqDays != null ? `= ${fmt(r.moqDays, 1)} hari pemakaian · MOQ wajar ±${fmt(r.moqSuggest)} (1 siklus order)` : "")}
        ${line("Aturan MOQ", r.moqRule || "-", r.moqHeld ? `ikut MOQ menambah ${fmt(r.moqExtraIfFollow)} ${u} (${fmt(r.moqExtraIfFollow / (r.usage || 1), 1)} hari) > batas ${fmt(settings().moqTolDays)} hari → PR = kebutuhan` : r.moqFollowed ? `menambah ${fmt(r.moqExtraIfFollow)} ${u} ≤ batas ${fmt(settings().moqTolDays)} hari` : "")}
        ${line("Final PR", `${fmt(r.final)} ${u}`, r.finalEdited ? `diubah manual · sistem ${fmt(r.finalAuto)}` : r.overNeed > 0 ? `lebih ${fmt(r.overNeed)} dari kebutuhan` : "sama dengan kebutuhan", true)}
        ${line("DSI setelah PR", r.dsiAfter == null ? "-" : `${fmt(r.dsiAfter, 1)} hari`, "(SOH + Final PR) ÷ pemakaian")}
        ${line("Harga", fmtRp(r.harga), r.hargaSrc ? `sumber ${esc(r.hargaSrc)}${r.hargaZahir && r.hargaMaster ? ` · Zahir ${fmtRp(r.hargaZahir)} · master ${fmtRp(r.hargaMaster)}` : ""}` : "tidak ada")}
        ${line("Nilai PR", fmtRp(r.nilaiPR), "Final PR × harga", true)}
      </table>`;
    } else {
      html += `<p>Kode ini tidak ada di master parameter, jadi tidak dihitung. Stok di Zahir: <b>${fmt(r.sohRaw)} ${u}</b> (${fmtRp(r.sohRaw * (r.hargaZahir || 0))}). Tambahkan Penjualan 1 Hari, Buffer, Lead time, dan MOQ di master.</p>`;
    }
    if (r.issues.length) html += `<p class="small"><b>Data issue:</b></p><ul class="issue-list">${r.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
    $("dlgItemBody").innerHTML = html;
    $("dlgItem").showModal();
  }

  // ---------------- edit manual ----------------
  function applyEdit(code, field, rawVal) {
    const r = state.result.rows.find((x) => x.code === code);
    if (!r) return;
    const E = state.edits;
    if (field !== "final" && field !== "note") return;
    const before = field === "note" ? r.note : r.final;
    let after;
    if (field === "note") {
      after = String(rawVal || "").trim().slice(0, 120);
      if (after) E.note[code] = after; else delete E.note[code];
    } else {
      const v = String(rawVal).trim() === "" ? null : Number(rawVal);
      if (v != null && (!isFinite(v) || v < 0)) { toast("Isi angka ≥ 0.", true); renderTable(); return; }
      if (v == null || v === r.finalAuto) { delete E.final[code]; after = r.finalAuto; } else { E.final[code] = v; after = v; }
    }
    if (String(before) === String(after)) return;
    E.log.push({ t: Date.now(), code, kode: r.kode, nama: r.nama, field: { final: "Final PR", note: "Catatan" }[field], from: before, to: after, system: field === "final" ? r.finalAuto : "", by: state.settings.preparedBy || "" });
    if (E.log.length > 2000) E.log = E.log.slice(-2000);
    saveEdits();
    const ae = document.activeElement;
    const keep = ae && ae.dataset && ae.dataset.code ? { code: ae.dataset.code, field: ae.dataset.field } : null;
    recompute();
    if (keep) {
      const el = $("tbl").querySelector(`input[data-code="${CSS.escape(keep.code)}"][data-field="${keep.field}"]`);
      if (el) { el.focus(); if (el.select) el.select(); }
    }
  }

  // ---------------- export ----------------
  function exportMeta() {
    return {
      gudangLabel: selLabel(), gudangKeys: state.gudangKeys.slice(), company: state.zahir.meta.company, stockDate: idDate(state.edits.stockDate), preparedBy: state.settings.preparedBy || "",
      generatedAt: Date.now(), fileName: state.file.name, fileHash: state.file.hash, masterSource: state.masterSource, masterLoadedAt: state.masterLoadedAt,
    };
  }
  async function doExport() {
    const btn = $("btnExport");
    btn.disabled = true; const old = btn.textContent; btn.textContent = "Menyusun…";
    try {
      const ExcelJS = await ensureExcelJS();
      const meta = exportMeta();
      const wb = XP.buildWorkbook(ExcelJS, { result: state.result, zahir: state.zahir, meta, log: state.edits.log, prioritySort: Core.prioritySort });
      const buf = await wb.xlsx.writeBuffer();
      download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `PR_${safeName(meta.gudangLabel)}_${(state.edits.stockDate || today()).replace(/-/g, "")}.xlsx`);
      toast("Excel tersimpan.");
    } catch (e) { console.error(e); toast("Export gagal: " + (e.message || e), true); }
    finally { btn.textContent = old; btn.disabled = !state.result; }
  }
  async function doTemplate() {
    try {
      const ExcelJS = await ensureExcelJS();
      const wb = XP.buildMasterTemplate(ExcelJS, state.master);
      const buf = await wb.xlsx.writeBuffer();
      download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "Template_Master_ROP.xlsx");
    } catch (e) { console.error(e); toast("Gagal membuat template: " + (e.message || e), true); }
  }
  async function doCopy() {
    const meta = exportMeta();
    const text = Core.prText(state.result.rows, { gudang: meta.gudangLabel, stockDate: meta.stockDate, preparedBy: meta.preparedBy });
    try { await navigator.clipboard.writeText(text); toast("Teks PR tersalin. Tempel di WhatsApp / email."); }
    catch (e) {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      ta.remove(); toast(ok ? "Teks PR tersalin." : "Browser menolak menyalin.", !ok);
    }
  }

  // ---------------- cetak PO ----------------
  const PO_KEY = "rop.po.v1";
  const poSeqKey = (ymd) => "rop.poSeq." + ymd;
  const fmtRp2 = (n) => (n == null || !isFinite(n) ? "-" : "Rp " + Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 }));
  const hasSupplierCol = () => state.result.rows.some((r) => r.final > 0 && r.supplier);
  function addDays(iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d + n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  }
  const longDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }); };
  const defaultPrefix = (iso) => `PO/${iso.replace(/-/g, "")}/`;

  function openPO() {
    if (!state.result) return;
    const s = LS.get(PO_KEY, {}) || {};
    const sup = hasSupplierCol();
    $("poBy").querySelector('option[value="supplier"]').textContent = sup ? "Supplier (kolom “Supplier” di master)" : "Supplier (kolom “Supplier” belum ada di master)";
    $("poBy").value = s.by && (s.by !== "supplier" || sup) ? s.by : sup ? "supplier" : "kategori";
    $("poPrice").checked = s.price !== false;
    $("poConvert").checked = s.convert !== false;
    $("poNote").value = s.note != null ? s.note : `Barang dikirim ke gudang ${selLabel()}. Mohon konfirmasi ketersediaan, harga, dan tanggal kirim sebelum pengiriman.`;
    $("poSign1").value = state.settings.preparedBy || ""; $("poSign2").value = s.sign2 || ""; $("poSign3").value = s.sign3 || "";
    const d = today();
    $("poDate").value = d; $("poDue").value = "";
    setPOPrefix(d);
    renderPOGroups();
    $("dlgPO").showModal();
  }
  function setPOPrefix(iso) {
    const ymd = iso.replace(/-/g, "");
    $("poPrefix").value = defaultPrefix(iso);
    $("poSeq").value = (Number(LS.get(poSeqKey(ymd), 0)) || 0) + 1;
  }
  function renderPOGroups() {
    const by = $("poBy").value;
    const groups = Core.poGroups(state.result.rows, by);
    state.poGroups = groups;
    $("poByHint").textContent = by === "supplier" && !hasSupplierCol() ? "Master belum punya kolom “Supplier”, jadi semua item masuk satu PO dengan kolom supplier kosong. Tambahkan kolom Supplier di tab PKU agar PO otomatis terpisah per supplier." : "";
    $("poGroups").innerHTML = groups.map((g, i) => `<label><input type="checkbox" data-po-group="${i}" checked><span>${esc(g.key)}${g.missingSupplier ? ' <em class="warn">· supplier diisi manual</em>' : ""}</span><b>${g.items.length} item · ${fmtRp(g.total)}</b></label>`).join("") || '<p class="muted small">Tidak ada item dengan Final PR &gt; 0.</p>';
    updatePOSummary();
  }
  function selectedPOGroups() {
    return (state.poGroups || []).filter((g, i) => { const el = $("poGroups").querySelector(`input[data-po-group="${i}"]`); return el && el.checked; });
  }
  function updatePOSummary() {
    const sel = selectedPOGroups();
    $("poSummary").textContent = `${sel.length} PO · ${sel.reduce((a, g) => a + g.items.length, 0)} item · ${fmtRp(sel.reduce((a, g) => a + g.total, 0))}`;
    $("btnDoPrint").disabled = !sel.length;
  }

  function poHtml(g, no, opt) {
    const company = state.zahir.meta.company || "";
    const gud = selLabel();
    const due = opt.due || addDays(opt.date, Math.ceil(g.maxLead || 0));
    const supplier = opt.by === "supplier" && !g.missingSupplier ? g.key : "";
    const lines = g.items.map((r) => ({ r, L: Core.poLine(r, opt.convert) }));
    const total = lines.reduce((a, x) => a + x.L.jumlah, 0);
    const cols = opt.price ? 7 : 5;
    return `<section class="po">
      <div class="po-head">
        <div class="po-company">${esc(company || "Purchase Order")}<small>Gudang ${esc(gud)}</small></div>
        <div class="po-title"><h2>PURCHASE ORDER</h2><table>
          <tr><td>No. PO</td><td><b>${esc(no)}</b></td></tr>
          <tr><td>Tanggal</td><td>${esc(longDate(opt.date))}</td></tr>
          <tr><td>Kirim paling lambat</td><td>${esc(longDate(due))}</td></tr>
        </table></div>
      </div>
      <div class="po-parties">
        <div class="po-box"><div class="lbl">Kepada (supplier)</div>${supplier ? `<div class="val">${esc(supplier)}</div>` : '<div class="line"></div><div class="line"></div>'}</div>
        <div class="po-box"><div class="lbl">Kirim ke</div><div class="val">${esc([company, "Gudang " + gud].filter(Boolean).join(" · "))}</div>${opt.by === "kategori" || opt.by === "brand" ? `<div class="po-sub">Kelompok: ${esc(g.key)}</div>` : ""}</div>
      </div>
      <table class="po-items">
        <thead><tr><th class="r">No</th><th>Kode</th><th>Nama barang</th><th class="r">Qty</th><th>Satuan</th>${opt.price ? '<th class="r">Harga satuan</th><th class="r">Jumlah</th>' : ""}</tr></thead>
        <tbody>${lines.map((x, i) => `<tr><td class="r">${i + 1}</td><td>${esc(x.r.kode)}</td><td>${esc(x.r.nama)}</td><td class="r">${fmt(x.L.qty, 3)}</td><td>${esc(x.L.satuan)}</td>${opt.price ? `<td class="r">${fmtRp2(x.L.harga)}</td><td class="r">${fmtRp(x.L.jumlah)}</td>` : ""}</tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="${opt.price ? 6 : 4}">Total ${lines.length} item</td><td class="r">${opt.price ? fmtRp(total) : ""}</td></tr></tfoot>
      </table>
      ${opt.note ? `<div class="po-note"><b>Catatan:</b> ${esc(opt.note)}</div>` : ""}
      <div class="po-sign">
        ${["Dibuat oleh", "Diperiksa", "Disetujui"].map((t, i) => `<div><div>${t}</div><div class="space"></div><div class="name">${esc(opt.sign[i] || "")}</div></div>`).join("")}
      </div>
      <div class="po-foot">Dicetak ${esc(new Date().toLocaleString("id-ID"))} dari ROP Gudang · stok Zahir ${esc(state.file.name)} (${esc(state.file.hash.slice(0, 8))}) · tanggal stok ${esc(idDate(state.edits.stockDate))} · ${cols === 7 ? "harga = harga beli terakhir/HPP" : "tanpa harga"}</div>
    </section>`;
  }

  function doPrintPO() {
    const groups = selectedPOGroups();
    if (!groups.length) return;
    const opt = {
      by: $("poBy").value, price: $("poPrice").checked, convert: $("poConvert").checked, note: $("poNote").value.trim(),
      prefix: $("poPrefix").value.trim(), seq: Math.max(1, parseInt($("poSeq").value, 10) || 1), date: $("poDate").value || today(), due: $("poDue").value,
      sign: [$("poSign1").value.trim(), $("poSign2").value.trim(), $("poSign3").value.trim()],
    };
    LS.set(PO_KEY, { by: opt.by, price: opt.price, convert: opt.convert, note: opt.note, sign2: opt.sign[1], sign3: opt.sign[2] });
    const numbers = groups.map((g, i) => Core.poNumber(opt.prefix, opt.seq + i));
    $("printArea").innerHTML = groups.map((g, i) => poHtml(g, numbers[i], opt)).join("");
    // nomor urut berikutnya per tanggal (per perangkat) supaya cetak ulang tidak memakai nomor yang sama
    const ymd = (opt.prefix.match(/(\d{8})/) || [])[1] || opt.date.replace(/-/g, "");
    LS.set(poSeqKey(ymd), Math.max(Number(LS.get(poSeqKey(ymd), 0)) || 0, opt.seq + groups.length - 1));
    const items = groups.reduce((a, g) => a + g.items.length, 0), value = groups.reduce((a, g) => a + g.total, 0);
    state.edits.log.push({ t: Date.now(), code: "", kode: numbers.join(", "), nama: groups.map((g) => g.key).join(", "), field: "Cetak PO", from: "", to: `${groups.length} PO`, system: `${items} item · ${fmtRp(value)}`, by: opt.sign[0] || state.settings.preparedBy || "" });
    saveEdits();
    $("dlgPO").close();
    document.body.classList.add("printing");
    const done = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    toast(`${numbers.length} PO siap dicetak (${numbers[0]}${numbers.length > 1 ? " … " + numbers[numbers.length - 1] : ""}). Pilih “Simpan sebagai PDF” untuk menyimpan file.`);
    setTimeout(() => window.print(), 50);
  }

  // ---------------- pengaturan ----------------
  function openSettings() {
    const s = settings(), sc = sheetConf();
    $("setSheet").value = state.settings.sheetUrl || "";
    $("setSheet").placeholder = sc.raw && !state.settings.sheetUrl ? "Dari konfigurasi situs (kosongkan untuk tetap memakai itu)" : "https://docs.google.com/spreadsheets/d/…/edit#gid=0";
    $("setTab").value = state.settings.tab || ""; $("setTab").placeholder = sc.tab;
    $("setGid").value = state.settings.gid || ""; $("setGid").placeholder = sc.gid;
    $("setBasis").value = s.orderBasis === "target" ? "target" : "master";
    $("setTarget").value = s.targetDsi; $("setOver").value = s.overstockDays; $("setMoqTol").value = s.moqTolDays;
    $("setRound").checked = !!s.roundGramMl; $("setStep").value = s.roundStep; $("setPrice").value = s.priceSource;
    $("dlgSettings").showModal();
  }
  function saveSettings() {
    const prevSheet = JSON.stringify(sheetConf());
    const num = (id, def, min) => { const v = Number($(id).value); return isFinite(v) && v >= min ? v : def; };
    const d = Object.assign({}, Core.DEFAULT_SETTINGS, C.DEFAULTS || {});
    Object.assign(state.settings, {
      sheetUrl: $("setSheet").value.trim(), tab: $("setTab").value.trim(), gid: $("setGid").value.trim(),
      orderBasis: $("setBasis").value === "target" ? "target" : "master",
      targetDsi: num("setTarget", d.targetDsi, 0), overstockDays: num("setOver", d.overstockDays, 1), moqTolDays: num("setMoqTol", d.moqTolDays, 0),
      roundGramMl: $("setRound").checked, roundStep: num("setStep", d.roundStep, 1), priceSource: $("setPrice").value === "zahir" ? "zahir" : "master",
    });
    LS.set(KEY.settings, state.settings);
    if (JSON.stringify(sheetConf()) !== prevSheet) loadMasterFromSheet(true); else recompute();
    toast("Pengaturan disimpan.");
  }

  // ---------------- event ----------------
  function bind() {
    $("fileZahir").addEventListener("change", (e) => { handleZahirFiles(e.target.files, false); e.target.value = ""; });
    $("fileZahirAdd").addEventListener("change", (e) => { handleZahirFiles(e.target.files, true); e.target.value = ""; });
    $("fileInfo").addEventListener("click", (e) => {
      const b = e.target.closest("[data-remove-file]");
      if (!b) return;
      const i = Number(b.dataset.removeFile), p = state.parts[i];
      if (!p || !confirm(`Hapus ${p.file.name} dari perhitungan?`)) return;
      setParts(state.parts.filter((_, k) => k !== i), state.edits);
    });
    $("fileMaster").addEventListener("change", (e) => { handleMasterFile(e.target.files[0]); e.target.value = ""; });
    const drop = $("drop");
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => { const fl = e.dataTransfer && e.dataTransfer.files; if (fl && fl.length) handleZahirFiles(fl, false); });
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => e.preventDefault());

    $("btnReloadMaster").addEventListener("click", () => loadMasterFromSheet(true));
    $("btnTemplate").addEventListener("click", doTemplate);
    $("btnExport").addEventListener("click", doExport);
    $("btnCopy").addEventListener("click", doCopy);
    $("btnSettings").addEventListener("click", openSettings);
    $("btnShareLink").addEventListener("click", copyTeamLink);
    $("btnPO").addEventListener("click", openPO);
    $("poBy").addEventListener("change", renderPOGroups);
    $("poGroups").addEventListener("change", updatePOSummary);
    $("btnDoPrint").addEventListener("click", doPrintPO);
    $("poDate").addEventListener("change", (e) => { if (/^PO\/\d{8}\/$/.test($("poPrefix").value) && e.target.value) setPOPrefix(e.target.value); });
    $("stepMaster").addEventListener("click", (e) => { if (e.target.closest("#btnSheetQuick")) saveQuickSheet(); });
    $("stepMaster").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "inpSheetQuick") { e.preventDefault(); saveQuickSheet(); } });
    $("dlgSettings").addEventListener("close", () => { if ($("dlgSettings").returnValue === "save") saveSettings(); });

    $("gudangChecks").addEventListener("change", () => {
      const keys = Array.from($("gudangChecks").querySelectorAll("input:checked")).map((el) => el.value);
      if (!keys.length) { toast("Pilih minimal satu gudang.", true); renderToolbar(); return; }
      state.gudangKeys = keys;
      saveStockCache();
      recompute();
    });
    $("inpDate").addEventListener("change", (e) => { state.edits.stockDate = e.target.value; saveEdits(); });
    $("inpBy").addEventListener("change", (e) => { state.settings.preparedBy = e.target.value.trim().slice(0, 60); LS.set(KEY.settings, state.settings); });

    $("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (!b) return; state.tab = b.dataset.tab; renderFilters(); renderTable(); });
    $("alerts").addEventListener("click", (e) => { const a = e.target.closest("[data-goto]"); if (!a) return; e.preventDefault(); state.tab = a.dataset.goto; renderFilters(); renderTable(); $("tabs").scrollIntoView({ behavior: "smooth", block: "start" }); });
    let qTimer = null;
    $("q").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.filters.q = e.target.value; renderTable(); }, 150); });
    $("fBrand").addEventListener("change", (e) => { state.filters.brand = e.target.value; renderTable(); });
    $("fStatus").addEventListener("change", (e) => { state.filters.status = e.target.value; renderTable(); });
    $("fEdited").addEventListener("change", (e) => { state.filters.edited = e.target.checked; renderTable(); });
    $("btnResetEdits").addEventListener("click", () => {
      const n = Object.keys(state.edits.final).length + Object.keys(state.edits.note).length;
      if (!n) return toast("Belum ada perubahan manual.");
      if (!confirm(`Hapus ${n} perubahan manual (Final PR, catatan) untuk file ini? Log tetap disimpan.`)) return;
      state.edits.log.push({ t: Date.now(), code: "", kode: "", nama: "(semua)", field: "Reset perubahan", from: n, to: 0, system: "", by: state.settings.preparedBy || "" });
      Object.assign(state.edits, { final: {}, note: {} });
      saveEdits(); recompute();
    });

    const tbl = $("tbl");
    tbl.addEventListener("click", (e) => {
      const d = e.target.closest("[data-detail]");
      if (d) return openDetail(d.dataset.detail);
      const th = e.target.closest("th[data-sort]");
      if (th && state.tab !== "issue") {
        const key = th.dataset.sort, cur = state.sort[state.tab];
        state.sort[state.tab] = cur && cur.key === key ? (cur.dir === 1 ? { key, dir: -1 } : null) : { key, dir: ["nama", "kode", "satuan", "note"].includes(key) ? 1 : -1 };
        renderTable();
      }
    });
    tbl.addEventListener("change", (e) => {
      const el = e.target.closest("input.cell");
      if (!el) return;
      const { code, field } = el.dataset, val = el.value;
      setTimeout(() => applyEdit(code, field, val), 0); // tunggu fokus pindah ke sel berikutnya
    });
    tbl.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input.cell")) { e.preventDefault(); e.target.blur(); } });
  }

  // Link aplikasi untuk tim: https://<situs>/#sheet=<ID>&gid=0&tab=PKU
  // Bagian setelah "#" tidak pernah dikirim ke server, jadi link sheet tidak tersimpan di situs maupun repo.
  function readHashConfig() {
    const h = location.hash.replace(/^#/, "");
    if (!h) return false;
    const p = new URLSearchParams(h);
    const raw = p.get("sheet") || "";
    const id = (raw.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || [])[1] || (/^[a-zA-Z0-9_-]{20,}$/.test(raw) ? raw : "");
    if (!id) return false;
    state.settings.sheetUrl = `https://docs.google.com/spreadsheets/d/${id}/edit`;
    const gid = (p.get("gid") || "").replace(/\D/g, "");
    if (gid) state.settings.gid = gid;
    const tab = (p.get("tab") || "").trim().slice(0, 60);
    if (tab) state.settings.tab = tab;
    LS.set(KEY.settings, state.settings);
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* abaikan */ }
    return true;
  }
  function saveQuickSheet() {
    const el = $("inpSheetQuick");
    if (!el) return;
    const raw = el.value.trim();
    const id = (raw.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || [])[1] || (/^[a-zA-Z0-9_-]{20,}$/.test(raw) ? raw : "");
    if (!id) return toast("Link tidak valid. Contoh: https://docs.google.com/spreadsheets/d/…/edit", true);
    state.settings.sheetUrl = `https://docs.google.com/spreadsheets/d/${id}/edit`;
    const gid = (raw.match(/[#&?]gid=(\d+)/) || [])[1];
    if (gid) state.settings.gid = gid;
    LS.set(KEY.settings, state.settings);
    state.masterError = "";
    loadMasterFromSheet(true);
  }
  function teamLink() {
    const sc = sheetConf();
    if (!sc.id) return "";
    return `${location.origin}${location.pathname}#sheet=${sc.id}&gid=${encodeURIComponent(sc.gid)}&tab=${encodeURIComponent(sc.tab)}`;
  }
  async function copyTeamLink() {
    const link = teamLink();
    if (!link) return toast("Isi dan simpan link Google Sheet dulu.", true);
    try { await navigator.clipboard.writeText(link); toast("Link aplikasi untuk tim tersalin."); }
    catch (e) { prompt("Salin link ini untuk tim:", link); }
  }

  // ---------------- start ----------------
  async function init() {
    state.settings = LS.get(KEY.settings, {}) || {};
    // Pengaturan tersimpan sebelum ada "Dasar qty order": pakai default baru (kebutuhan = buffer + lead time, tanpa pembulatan Gram/Ml otomatis)
    if (!state.settings.orderBasis) { delete state.settings.roundGramMl; state.settings.orderBasis = "master"; LS.set(KEY.settings, state.settings); }
    const fromHash = readHashConfig();
    try {
      const r = await fetch("config.local.json", { cache: "no-store" });
      if (r.ok && /json/.test(r.headers.get("content-type") || "")) state.local = await r.json();
    } catch (e) { /* tidak ada config lokal */ }
    bind();
    const cached = LS.get(KEY.stock, null);
    if (cached && Array.isArray(cached.parts) && cached.parts.length) {
      state.gudangKeys = cached.gudangKeys || [];
      state.zahir = Core.mergeZahir(cached.parts.map((p) => p.z)); // gudang lama dianggap sudah dipilih pengguna
      await setParts(cached.parts, null);
    } else if (cached && cached.zahir && cached.file) { // format cache versi 1 (satu file)
      state.gudangKeys = cached.gudangKey ? [cached.gudangKey] : [];
      state.zahir = cached.zahir;
      await setParts([{ file: cached.file, z: cached.zahir }], null);
    }
    renderAll();
    await loadMasterFromSheet(false);
    recompute();
    if (fromHash && state.master && !state.masterError) toast("Sumber parameter tersimpan dari link. Berikutnya cukup buka alamat aplikasi.");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  // Untuk tes & debugging di console
  window.ROPApp = { state, recompute, handleZahirFiles, handleMasterFile, loadMasterFromSheet };
})();
