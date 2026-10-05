
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc, setDoc, getDoc, query, orderBy, limit,
  serverTimestamp, where, writeBatch
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

const cfg = await fetch("./firebase-config.json", { cache: "no-store" }).then(r => {
  if (!r.ok) throw new Error("firebase-config.json tidak tersedia. Jalankan deploy script terbaru.");
  return r.json();
});

const app = initializeApp(cfg);
const db = getFirestore(app);

const $ = id => document.getElementById(id);
const state = {
  stores: [],
  crews: [],
  settings: null,
  selectedFile: null,
  selectedMode: null,
  evidenceMeta: null,
  evidenceDataUrl: null,
  storeAliasToCanonical: new Map()
};

const defaultSettings = {
  slot1: "09:00",
  slot2: "16:00",
  slot3: "23:30",
  toleranceMin: 30,
  maxAgeHours: 24
};

function toast(msg, ms = 3200){
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => el.classList.add("hidden"), ms);
}
function pad(n){ return String(n).padStart(2, "0"); }
function toDateKey(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function toTime(d){ return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
function fmtDate(d){ return new Intl.DateTimeFormat("id-ID",{day:"2-digit",month:"long",year:"numeric"}).format(d); }
function fmtDay(d){ return new Intl.DateTimeFormat("id-ID",{weekday:"long"}).format(d); }
function formatDateShort(dateKey){
  const [y,m,d] = String(dateKey).split("-");
  return `${d}/${m}`;
}
function minutesOf(timeStr){
  const [h,m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}
function dateRangeKeys(from, to){
  const out = [];
  let d = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while(d <= end){
    out.push(toDateKey(d));
    d.setDate(d.getDate()+1);
  }
  return out;
}
function statusClass(s){
  return s === "ON TIME" ? "good" : ((s === "EARLY" || s === "LATE") ? "warn" : "bad");
}
function trustClass(t){
  return t === "HIGH" ? "good" : (t === "MEDIUM" ? "warn" : "bad");
}
function safe(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#039;"
  }[c]));
}


const STORE_CANONICAL_RULES = [
  { id:"TRIAL-BERINGIN", name:"Beringin", aliases:["BERINGIN","BERINGIN RAYA"] },
  { id:"TRIAL-JAGAKARSA", name:"Jagakarsa", aliases:["JAGAKARSA","CIGANJUR JAGAKARSA"] },
  { id:"TRIAL-CIKANDE", name:"Cikande", aliases:["CIKANDE"] },
  { id:"TRIAL-GRAHA-RAYA", name:"Graha Raya", aliases:["GRAHA RAYA"] },
  { id:"TRIAL-SEKTOR-9", name:"Jombang Sektor 9", aliases:["JOMBANG","SEKTOR 9","JOMBANG SEKTOR 9"] },
  { id:"TRIAL-KEDOYA", name:"Kedoya", aliases:["KEDOYA"] },
  { id:"TRIAL-KOJA", name:"Koja", aliases:["KOJA"] },
  { id:"TRIAL-KRAMATWATU", name:"Kramatwatu", aliases:["KRAMATWATU"] },
  { id:"TRIAL-SEPATAN", name:"Sepatan", aliases:["SEPATAN"] },
  { id:"TRIAL-ZAMBRUD", name:"Zamrud", aliases:["ZAMRUD","ZAMBRUD"] }
];
function normalizeStoreKey(v){
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[_\-]+/g," ").replace(/[^A-Z0-9 ]+/g," ")
    .replace(/\s+/g," ").trim();
}
function canonicalStoreIdentity(id, name){
  const idKey = normalizeStoreKey(id);
  const nameKey = normalizeStoreKey(name);
  for(const rule of STORE_CANONICAL_RULES){
    const aliases = new Set([normalizeStoreKey(rule.id), ...rule.aliases.map(normalizeStoreKey)]);
    if(aliases.has(idKey) || aliases.has(nameKey)) return {id:rule.id, name:rule.name, known:true};
  }
  return {id:String(id || ""), name:String(name || id || ""), known:false};
}
function earliestDate(a,b){
  if(!a) return b || "";
  if(!b) return a || "";
  return a < b ? a : b;
}
function canonicalizeStoreDocs(rawStores){
  const groups = new Map();
  const aliasMap = new Map();
  for(const s of rawStores){
    const c = canonicalStoreIdentity(s.id, s.name);
    aliasMap.set(s.id, c.id);
    const existing = groups.get(c.id);
    const merged = existing ? {
      ...existing,
      name: c.known ? c.name : (existing.name || s.name || c.id),
      area: existing.area && existing.area !== "-" ? existing.area : (s.area || "-"),
      active: existing.active !== false || s.active !== false,
      activeFrom: earliestDate(existing.activeFrom, s.activeFrom),
      sourceIds: [...new Set([...(existing.sourceIds || []), s.id])]
    } : {
      ...s,
      id: c.id,
      name: c.known ? c.name : (s.name || c.id),
      sourceIds: [s.id]
    };
    groups.set(c.id, merged);
  }
  state.storeAliasToCanonical = aliasMap;
  for(const rule of STORE_CANONICAL_RULES) state.storeAliasToCanonical.set(rule.id, rule.id);
  return [...groups.values()].sort((a,b)=>(a.name||"").localeCompare(b.name||""));
}
function canonicalizeCrewDocs(rawCrews){
  const dedup = new Map();
  for(const c of rawCrews){
    const canonicalStoreId = state.storeAliasToCanonical.get(c.storeId) || canonicalStoreIdentity(c.storeId, "").id || c.storeId;
    const mapped = {...c, storeId: canonicalStoreId};
    const key = `${canonicalStoreId}|${normalizeStoreKey(c.name || c.id)}`;
    const existing = dedup.get(key);
    const preferMapped = !existing || (String(c.id).startsWith("TRIAL-") && !String(existing.id).startsWith("TRIAL-"));
    if(preferMapped) dedup.set(key, mapped);
  }
  return [...dedup.values()].sort((a,b)=>(a.name||"").localeCompare(b.name||""));
}
function normalizeRecordStore(r){
  const c = canonicalStoreIdentity(r?.storeId, r?.storeName);
  if(!c.known && state.storeAliasToCanonical.has(r?.storeId)){
    const cid = state.storeAliasToCanonical.get(r.storeId);
    const st = state.stores.find(s=>s.id===cid);
    return {...r, storeId:cid, storeName:st?.name || r.storeName || cid};
  }
  return c.known ? {...r, storeId:c.id, storeName:c.name} : r;
}
function recordFreshness(r){
  return Number(r?.evidenceEpochMs || r?.changeEpochMs || 0);
}
function dedupeFilterRecords(records){
  const map = new Map();
  for(const raw of records){
    const r = normalizeRecordStore(raw);
    const key = `${r.dateKey}|${r.storeId}|${r.slotId}`;
    const existing = map.get(key);
    if(!existing || recordFreshness(r) >= recordFreshness(existing)) map.set(key, r);
  }
  return [...map.values()];
}

function setConnectionBadge(text, cls, title=""){
  const el = $("syncBadge");
  el.textContent = text;
  el.className = `status-badge ${cls}`;
  el.title = title || "";
}

function activatePage(btn){
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(x => x.classList.remove("active"));
  btn.classList.add("active");
  $(btn.dataset.tab).classList.add("active");
  const title = btn.dataset.title || btn.textContent.trim();
  const subtitle = btn.dataset.subtitle || "Compliance Filtrasi Minyak";
  if($("pageTitle")) $("pageTitle").textContent = title;
  if($("pageSubtitle")) $("pageSubtitle").textContent = subtitle;
  closeSidebar();
  if(btn.dataset.tab === "dashboard") loadDashboard();
  if(btn.dataset.tab === "oilchange") loadOilChangeHistory();
  if(btn.dataset.tab === "master") refreshMasterTables();
}
function openSidebar(){ $("sidebar")?.classList.add("open"); $("sidebarOverlay")?.classList.add("show"); }
function closeSidebar(){ $("sidebar")?.classList.remove("open"); $("sidebarOverlay")?.classList.remove("show"); }
document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => activatePage(btn)));
$("mobileMenuBtn")?.addEventListener("click", openSidebar);
$("sidebarOverlay")?.addEventListener("click", closeSidebar);

async function ensureSettings(){
  const ref = doc(db, "settings", "app");
  const snap = await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref, { ...defaultSettings, updatedAt: serverTimestamp() });
    state.settings = { ...defaultSettings };
  } else {
    state.settings = { ...defaultSettings, ...snap.data() };
  }
  $("slot1").value = state.settings.slot1;
  $("slot2").value = state.settings.slot2;
  $("slot3").value = state.settings.slot3;
  $("toleranceMin").value = state.settings.toleranceMin;
  $("maxAgeHours").value = state.settings.maxAgeHours;
}

async function seedTrialCrewV20(){
  const markerRef = doc(db, "settings", "trialCrewSeedV20");
  const markerSnap = await getDoc(markerRef);
  if(markerSnap.exists() && markerSnap.data()?.completed === true) return { changed:false, message:"Data crew sudah sinkron." };

  const response = await fetch("./data/crew-trial-v19.json", { cache: "no-store" });
  if(!response.ok) throw new Error("Data crew trial tidak dapat dibaca.");
  const seed = await response.json();
  const activeFrom = toDateKey(new Date());

  // Hanya 2 query awal, lalu seluruh data yang belum ada ditulis dalam satu batch.
  // Ini menggantikan pola v19 yang melakukan get/set satu-per-satu dan membuat UI menunggu terlalu lama.
  const [storeSnap, crewSnap] = await Promise.all([
    getDocs(collection(db, "stores")),
    getDocs(collection(db, "crews"))
  ]);
  const existingStores = new Set(storeSnap.docs.map(d => d.id));
  const existingCrews = new Set(crewSnap.docs.map(d => d.id));

  const batch = writeBatch(db);
  let storeAdded = 0;
  let crewAdded = 0;

  for(const s of seed.stores || []){
    if(!existingStores.has(s.storeId)){
      batch.set(doc(db, "stores", s.storeId), {
        name: s.storeName,
        area: s.area || "Outlet Trial",
        active: true,
        activeFrom,
        source: "List Nama Karyawan Outlet Trial.xlsx",
        createdAt: serverTimestamp()
      });
      storeAdded++;
    }

    for(const c of s.crews || []){
      if(!existingCrews.has(c.crewId)){
        batch.set(doc(db, "crews", c.crewId), {
          name: c.crewName,
          storeId: s.storeId,
          active: true,
          source: "List Nama Karyawan Outlet Trial.xlsx",
          createdAt: serverTimestamp()
        });
        crewAdded++;
      }
    }
  }

  batch.set(markerRef, {
    completed: true,
    version: "v20",
    sourceVersion: seed.version || "v19",
    storeCount: (seed.stores || []).length,
    crewCount: (seed.stores || []).reduce((n,s) => n + (s.crews || []).length, 0),
    storeAdded,
    crewAdded,
    completedAt: serverTimestamp()
  }, { merge:true });

  await batch.commit();
  return {
    changed: storeAdded > 0 || crewAdded > 0,
    message: `Sinkronisasi selesai: ${storeAdded} store baru, ${crewAdded} crew baru.`
  };
}

async function loadMasters(){
  const [ss, cs] = await Promise.all([
    getDocs(collection(db, "stores")),
    getDocs(collection(db, "crews"))
  ]);
  const rawStores = ss.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(s => s.id !== "BB001" && (s.name || "") !== "Burger Bangor - Store 01");
  state.stores = canonicalizeStoreDocs(rawStores);

  const rawCrews = cs.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(c => c.id !== "CR001" && (c.name || "") !== "Crew 01");
  state.crews = canonicalizeCrewDocs(rawCrews);
  renderSelectors();
}

function renderSelectors(){
  const active = state.stores.filter(s => s.active !== false);
  const storeOptions = `<option value="">Pilih store...</option>` + active.map(s =>
    `<option value="${safe(s.id)}">${safe(s.name || s.id)}</option>`
  ).join("");
  $("storeSelect").innerHTML = storeOptions;
  $("crewStoreInput").innerHTML = storeOptions;
  if($("oilChangeStore")) $("oilChangeStore").innerHTML = storeOptions;
  $("dashStore").innerHTML = `<option value="ALL">ALL STORE</option>` + active.map(s =>
    `<option value="${safe(s.id)}">${safe(s.name || s.id)}</option>`
  ).join("");
  renderCrewSelect();
  renderOilChangeCrew();
}
function renderCrewSelect(){
  const store = $("storeSelect").value;
  const list = state.crews.filter(c => !store || c.storeId === store);
  $("crewSelect").innerHTML = `<option value="">Pilih crew...</option>` + list.map(c =>
    `<option value="${safe(c.id)}">${safe(c.name || c.id)}</option>`
  ).join("");
}
$("storeSelect").addEventListener("change", renderCrewSelect);

function renderOilChangeCrew(){
  const store = $("oilChangeStore")?.value || "";
  const list = state.crews.filter(c => !store || c.storeId === store);
  if($("oilChangeCrew")){
    $("oilChangeCrew").innerHTML = `<option value="">Pilih crew...</option>` + list.map(c =>
      `<option value="${safe(c.id)}">${safe(c.name || c.id)}</option>`
    ).join("");
  }
}
$("oilChangeStore")?.addEventListener("change", renderOilChangeCrew);

$("btnSaveSettings").addEventListener("click", async () => {
  const data = {
    slot1: $("slot1").value,
    slot2: $("slot2").value,
    slot3: $("slot3").value,
    toleranceMin: Number($("toleranceMin").value || 30),
    maxAgeHours: Number($("maxAgeHours").value || 24),
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(db, "settings", "app"), data, { merge: true });
  state.settings = { ...state.settings, ...data };
  toast("Setting filter tersimpan.");
});

$("btnAddStore").addEventListener("click", async () => {
  const requestedId = $("storeIdInput").value.trim().toUpperCase().replace(/\s+/g, "-");
  const requestedName = $("storeNameInput").value.trim();
  if(!requestedId || !requestedName) return toast("Store ID dan Nama Store wajib diisi.");
  const canonical = canonicalStoreIdentity(requestedId, requestedName);
  const id = canonical.known ? canonical.id : requestedId;
  const name = canonical.known ? canonical.name : requestedName;
  if(state.stores.some(s => s.id === id)) return toast(`Store ${name} sudah terdaftar. Tidak perlu dibuat dua kali.`);
  await setDoc(doc(db, "stores", id), {
    name,
    area: $("storeAreaInput").value.trim(),
    active: true,
    activeFrom: $("storeActiveFromInput").value || toDateKey(new Date()),
    createdAt: serverTimestamp()
  });
  $("storeIdInput").value = "";
  $("storeNameInput").value = "";
  $("storeAreaInput").value = "";
  await loadMasters();
  refreshMasterTables();
  toast("Store ditambahkan.");
});

$("btnAddCrew").addEventListener("click", async () => {
  const id = $("crewIdInput").value.trim().toUpperCase().replace(/\s+/g, "-");
  const name = $("crewNameInput").value.trim();
  const storeId = $("crewStoreInput").value;
  if(!id || !name || !storeId) return toast("Crew ID, Nama Crew, dan Store wajib diisi.");
  await setDoc(doc(db, "crews", id), {
    name,
    storeId,
    active: true,
    createdAt: serverTimestamp()
  });
  $("crewIdInput").value = "";
  $("crewNameInput").value = "";
  await loadMasters();
  refreshMasterTables();
  toast("Crew ditambahkan.");
});

function refreshMasterTables(){
  $("storeMasterBody").innerHTML = state.stores
    .filter(s => s.active !== false)
    .map(s => `<tr><td>${safe(s.id)}</td><td>${safe(s.name)}</td><td>${safe(s.area || "-")}</td><td>${safe(s.activeFrom || "-")}</td></tr>`)
    .join("");

  $("crewMasterBody").innerHTML = state.crews
    .filter(c => c.active !== false)
    .map(c => {
      const st = state.stores.find(s => s.id === c.storeId);
      return `<tr><td>${safe(c.id)}</td><td>${safe(c.name)}</td><td>${safe(st?.name || c.storeId || "-")}</td></tr>`;
    })
    .join("");
}

function setOilChangeNow(){
  const now = new Date();
  if($("oilChangeDate")) $("oilChangeDate").value = toDateKey(now);
  if($("oilChangeTime")) $("oilChangeTime").value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

async function loadOilChangeHistory(){
  const body = $("oilChangeHistoryBody");
  if(!body) return;
  try{
    const q = query(collection(db, "oilChanges"), orderBy("changeEpochMs", "desc"), limit(30));
    const snap = await getDocs(q);
    const rows = snap.docs.map(d => normalizeRecordStore({id:d.id, ...d.data()}));
    body.innerHTML = rows.length ? rows.map(r => `
      <tr>
        <td>${safe(r.changeDate || "-")}</td>
        <td>${safe(r.changeTime || "-")}</td>
        <td>${safe(r.storeName || r.storeId || "-")}</td>
        <td>${safe(r.crewName || r.crewId || "-")}</td>
      </tr>
    `).join("") : `<tr><td colspan="4" class="hint">Belum ada data pergantian minyak.</td></tr>`;
  }catch(err){
    console.error(err);
    body.innerHTML = `<tr><td colspan="4" class="hint">Gagal memuat riwayat pergantian minyak.</td></tr>`;
  }
}

$("btnSaveOilChange")?.addEventListener("click", async () => {
  const storeId = $("oilChangeStore")?.value || "";
  const crewId = $("oilChangeCrew")?.value || "";
  const changeDate = $("oilChangeDate")?.value || "";
  const changeTime = $("oilChangeTime")?.value || "";
  if(!storeId || !crewId || !changeDate || !changeTime){
    return toast("Store, crew, tanggal, dan jam pergantian wajib diisi.");
  }
  const crew = state.crews.find(c => c.id === crewId);
  if(crew && crew.storeId && crew.storeId !== storeId){
    return toast("Crew yang dipilih tidak sesuai dengan store.");
  }
  const store = state.stores.find(s => s.id === storeId);
  const dt = new Date(`${changeDate}T${changeTime}:00`);
  if(isNaN(dt.getTime())) return toast("Tanggal atau jam pergantian tidak valid.");
  try{
    const ref = doc(collection(db, "oilChanges"));
    await setDoc(ref, {
      storeId,
      storeName: store?.name || storeId,
      crewId,
      crewName: crew?.name || crewId,
      changeDate,
      changeTime,
      changeEpochMs: dt.getTime(),
      createdAt: serverTimestamp()
    });
    toast("Pergantian minyak berhasil dicatat.");
    await loadOilChangeHistory();
    setOilChangeNow();
  }catch(err){
    console.error(err);
    toast("Gagal menyimpan pergantian minyak: " + err.message, 5000);
  }
});

$("btnRefreshOilChange")?.addEventListener("click", loadOilChangeHistory);

$("btnCamera").addEventListener("click", () => { $("cameraInput").value = ""; $("cameraInput").click(); });
$("btnUpload").addEventListener("click", () => { $("uploadInput").value = ""; $("uploadInput").click(); });
$("cameraInput").addEventListener("change", e => e.target.files[0] && handleEvidenceFile(e.target.files[0], "CAMERA"));
$("uploadInput").addEventListener("change", e => e.target.files[0] && handleEvidenceFile(e.target.files[0], "UPLOAD"));

const dz = $("dropZone");
["dragenter","dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave","drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", e => e.dataTransfer.files[0] && handleEvidenceFile(e.dataTransfer.files[0], "UPLOAD"));

async function sha256(file){
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function compressImage(file, maxW = 900, maxH = 900, quality = .68){
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      const scale = Math.min(1, maxW / w, maxH / h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      let q = quality, data = c.toDataURL("image/jpeg", q);
      while(data.length > 500000 && q > .35){
        q -= .08;
        data = c.toDataURL("image/jpeg", q);
      }
      if(data.length > 700000) reject(new Error("Evidence masih terlalu besar setelah kompresi."));
      else resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Format gambar tidak dapat dipreview. Gunakan JPG/PNG/WebP."));
    };
    img.src = url;
  });
}
async function getMetadataTime(file, mode){
  let exif = {};
  try {
    exif = await window.exifr.parse(file, ["DateTimeOriginal","CreateDate","ModifyDate","Make","Model"]);
  } catch(e){}
  let dt = null, source = "", trust = "";
  const exifDate = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate;
  if(exifDate instanceof Date && !isNaN(exifDate)){
    dt = exifDate; source = "EXIF DateTimeOriginal"; trust = "HIGH";
  } else if(mode === "CAMERA"){
    dt = new Date(); source = "Capture Session"; trust = "MEDIUM";
  } else if(file.lastModified){
    dt = new Date(file.lastModified); source = "File lastModified"; trust = "LOW";
  } else {
    dt = new Date(); source = "Upload Session"; trust = "LOW";
  }
  return {
    dt,
    source,
    trust,
    camera: [exif?.Make, exif?.Model].filter(Boolean).join(" ") || "-"
  };
}
function autoSlot(dt){
  const slots = [
    { id:"FILTER-1", label:"FILTER 1", time:state.settings.slot1 },
    { id:"FILTER-2", label:"FILTER 2", time:state.settings.slot2 },
    { id:"FILTER-3", label:"FILTER 3", time:state.settings.slot3 }
  ];
  const nowMin = dt.getHours() * 60 + dt.getMinutes();
  let best = slots[0], diff = Infinity, signed = 0;
  for(const s of slots){
    const delta = nowMin - minutesOf(s.time);
    if(Math.abs(delta) < diff){
      best = s;
      diff = Math.abs(delta);
      signed = delta;
    }
  }
  let status = "ON TIME";
  const tol = Number(state.settings.toleranceMin || 30);
  if(Math.abs(signed) > tol) status = signed < 0 ? "EARLY" : "LATE";
  return { ...best, deviationMin: signed, status };
}

async function handleEvidenceFile(file, mode){
  if(!$("storeSelect").value || !$("crewSelect").value) return toast("Pilih store dan crew terlebih dahulu.");
  if(!file.type.startsWith("image/")) return toast("Evidence harus berupa file gambar.");
  state.selectedFile = file;
  state.selectedMode = mode;
  setConnectionBadge("Reading metadata...", "warn");
  try{
    const [meta, dataUrl, hash] = await Promise.all([
      getMetadataTime(file, mode),
      compressImage(file),
      sha256(file)
    ]);
    const slot = autoSlot(meta.dt);
    const ageHours = (Date.now() - meta.dt.getTime()) / 3600000;
    let integrity = "VALID", integrityMsg = "";
    if(ageHours > Number(state.settings.maxAgeHours || 24)){
      integrity = "REVIEW";
      integrityMsg = `Evidence berumur ${ageHours.toFixed(1)} jam, melewati batas ${state.settings.maxAgeHours} jam.`;
    }
    if(ageHours < -.17){
      integrity = "REVIEW";
      integrityMsg = "Timestamp evidence berada di masa depan. Periksa jam perangkat / metadata foto.";
    }
    state.evidenceMeta = { ...meta, ...slot, ageHours, integrity, hash };
    state.evidenceDataUrl = dataUrl;

    $("previewImg").src = dataUrl;
    $("metaDay").textContent = fmtDay(meta.dt);
    $("metaDate").textContent = fmtDate(meta.dt);
    $("metaTime").textContent = toTime(meta.dt);
    $("metaSource").textContent = meta.source;
    $("metaSlot").textContent = slot.label;
    $("metaPlanned").textContent = slot.time;
    $("metaDeviation").textContent = `${slot.deviationMin >= 0 ? "+" : ""}${slot.deviationMin} menit`;
    $("metaStatus").textContent = integrity === "REVIEW" ? "REVIEW" : slot.status;
    $("metaCamera").textContent = meta.camera;
    $("metaHash").textContent = hash;
    $("trustBadge").textContent = `${meta.trust} TRUST`;
    $("trustBadge").className = `status-badge ${trustClass(meta.trust)}`;

    const alert = $("integrityAlert");
    if(integrityMsg){
      alert.textContent = integrityMsg;
      alert.className = "alert danger";
    } else {
      alert.textContent = `Timestamp dibaca dari ${meta.source}.`;
      alert.className = "alert info";
    }

    $("evidenceCard").classList.remove("hidden");
    setConnectionBadge("Ready", "good");
  } catch(err){
    console.error(err);
    toast(err.message);
    setConnectionBadge("Error", "bad", err.message);
  }
}
function resetEvidence(){
  state.selectedFile = null;
  state.selectedMode = null;
  state.evidenceMeta = null;
  state.evidenceDataUrl = null;
  $("evidenceCard").classList.add("hidden");
  $("noteInput").value = "";
}
$("btnResetEvidence").addEventListener("click", resetEvidence);

$("btnSubmitEvidence").addEventListener("click", async () => {
  if(!state.evidenceMeta || !state.evidenceDataUrl) return toast("Evidence belum dipilih.");

  const storeId = $("storeSelect").value;
  const crewId = $("crewSelect").value;
  const store = state.stores.find(s => s.id === storeId);
  const crew = state.crews.find(c => c.id === crewId);
  const m = state.evidenceMeta;
  const dateKey = toDateKey(m.dt);
  const recordId = `${dateKey}_${storeId}_${m.id}`.replace(/[^A-Za-z0-9_-]/g, "-");
  const ref = doc(db, "filterRecords", recordId);
  const sameDaySnap = await getDocs(query(collection(db, "filterRecords"), where("dateKey", "==", dateKey), limit(500)));
  const duplicateExists = sameDaySnap.docs.some(x => {
    const d = x.data();
    return d.dedupArchived !== true && d.storeId === storeId && d.slotId === m.id;
  });
  if(duplicateExists) return toast("Slot filter ini sudah memiliki evidence. Duplicate tidak diizinkan.");

  const finalStatus = m.integrity === "REVIEW" ? "REVIEW" : m.status;
  const score = finalStatus === "ON TIME" ? 1 : ((finalStatus === "EARLY" || finalStatus === "LATE") ? 0.5 : 0);

  try{
    await setDoc(ref, {
      recordId,
      dateKey,
      dayName: fmtDay(m.dt),
      evidenceLocalIso: `${dateKey}T${toTime(m.dt)}`,
      evidenceEpochMs: m.dt.getTime(),
      evidenceTimeSource: m.source,
      metadataTrust: m.trust,
      integrity: m.integrity,
      storeId,
      storeName: store?.name || storeId,
      crewId,
      crewName: crew?.name || crewId,
      slotId: m.id,
      slotLabel: m.label,
      plannedTime: m.time,
      deviationMin: m.deviationMin,
      status: finalStatus,
      complianceScore: score,
      note: $("noteInput").value.trim(),
      camera: m.camera,
      originalFileName: state.selectedFile.name,
      originalMime: state.selectedFile.type,
      originalBytes: state.selectedFile.size,
      originalSha256: m.hash,
      evidenceImage: state.evidenceDataUrl,
      submittedAt: serverTimestamp()
    });
    toast("Evidence berhasil disimpan.");
    resetEvidence();
    await loadRecent();
  } catch(err){
    console.error(err);
    toast("Gagal simpan: " + err.message, 5000);
  }
});

async function loadRecent(){
  const q = query(collection(db, "filterRecords"), orderBy("submittedAt", "desc"), limit(20));
  const snap = await getDocs(q);
  const rows = dedupeFilterRecords(snap.docs.map(d => d.data()))
    .sort((a,b)=>recordFreshness(b)-recordFreshness(a)).slice(0,5);
  $("recentList").innerHTML = rows.length ? rows.map(r => `
    <div class="recent-item">
      <img src="${r.evidenceImage}" alt="evidence">
      <div>
        <strong>${safe(r.storeName)} • ${safe(r.slotLabel)}</strong>
        <small>${safe(r.crewName)} • ${safe(r.dayName)}, ${safe(r.dateKey)} ${safe((r.evidenceLocalIso || "").slice(11))}</small>
      </div>
      <span class="status ${statusClass(r.status)}">${safe(r.status)}</span>
    </div>
  `).join("") : `<div class="hint">Belum ada evidence.</div>`;
}
$("btnRefreshRecent").addEventListener("click", loadRecent);

function drawComplianceBarChart(rows){
  const canvas = $("complianceBarChart");
  const wrap = $("complianceChartWrap");
  const tooltip = $("chartTooltip");
  if(!canvas || !wrap) return;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(wrap.clientWidth - 24, 320);
  const cssHeight = cssWidth < 700 ? 330 : 390;
  canvas.style.width = cssWidth + "px";
  canvas.style.height = cssHeight + "px";
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cssWidth,cssHeight);
  const margin = {top:24,right:24,bottom:cssWidth<700?62:54,left:cssWidth<700?48:56};
  const chartW = cssWidth-margin.left-margin.right;
  const chartH = cssHeight-margin.top-margin.bottom;
  const originX = margin.left;
  const originY = margin.top+chartH;
  const targetPct = .95;
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,cssWidth,cssHeight);
  window.__chartHitAreas=[];
  if(!rows || !rows.length){ctx.fillStyle="#6b7785";ctx.font="600 14px Inter, system-ui, sans-serif";ctx.textAlign="center";ctx.fillText("Belum ada data compliance untuk periode ini.",cssWidth/2,cssHeight/2);return;}
  ctx.strokeStyle="#e0e6ee";ctx.lineWidth=1;ctx.font="11px Inter, system-ui, sans-serif";ctx.fillStyle="#738194";ctx.textAlign="right";ctx.textBaseline="middle";
  for(let tick=0;tick<=5;tick++){const val=tick*20;const y=originY-(val/100)*chartH;ctx.beginPath();ctx.moveTo(originX,y);ctx.lineTo(originX+chartW,y);ctx.stroke();ctx.fillText(val+"%",originX-8,y);}
  const targetY=originY-targetPct*chartH;ctx.strokeStyle="#c88725";ctx.lineWidth=1.5;ctx.setLineDash([6,5]);ctx.beginPath();ctx.moveTo(originX,targetY);ctx.lineTo(originX+chartW,targetY);ctx.stroke();ctx.setLineDash([]);
  ctx.strokeStyle="#9aabba";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(originX,margin.top);ctx.lineTo(originX,originY);ctx.lineTo(originX+chartW,originY);ctx.stroke();
  const n=rows.length;const gap=Math.max(10,Math.min(18,chartW*.02));const barW=Math.max(28,Math.min(56,(chartW-gap*(n+1))/Math.max(n,1)));const totalUsed=n*barW+(n-1)*gap;const startX=originX+Math.max(0,(chartW-totalUsed)/2);
  rows.forEach((row,i)=>{const x=startX+i*(barW+gap);const compliancePct=Math.max(0,Math.min(1,row.compliance||0));const h=compliancePct*chartH;const y=originY-h;ctx.fillStyle="#1f7a4d";roundTopRect(ctx,x,y,barW,h,6);ctx.fill();ctx.fillStyle="#223142";ctx.font="700 10.5px Inter, system-ui, sans-serif";ctx.textAlign="center";ctx.textBaseline="bottom";ctx.fillText((compliancePct*100).toFixed(1)+"%",x+barW/2,y-5);ctx.save();ctx.translate(x+barW/2,originY+13);if(n>12||cssWidth<700)ctx.rotate(-Math.PI/6);ctx.fillStyle="#526274";ctx.textAlign=n>12||cssWidth<700?"right":"center";ctx.textBaseline="middle";ctx.font="11px Inter, system-ui, sans-serif";ctx.fillText(row.label||row.dateKey||"",0,0);ctx.restore();window.__chartHitAreas.push({x:x-4,y:margin.top,w:barW+8,h:chartH+40,row});});
  canvas.onmousemove=(ev)=>{if(!tooltip)return;const rect=canvas.getBoundingClientRect();const x=ev.clientX-rect.left,y=ev.clientY-rect.top;const hit=(window.__chartHitAreas||[]).find(a=>x>=a.x&&x<=a.x+a.w&&y>=a.y&&y<=a.y+a.h);if(!hit){tooltip.classList.add("hidden");return;}const r=hit.row;tooltip.innerHTML=`<strong>${safe(r.fullLabel||r.dateKey||r.label)}</strong><div class="tip-row"><span class="tip-swatch tip-target"></span>Target Compliance: 95.0%</div><div class="tip-row"><span class="tip-swatch tip-compliance"></span>Compliance Dilakukan: ${(r.compliance*100).toFixed(1)}%</div><div class="tip-row">Dilakukan: ${r.done}</div><div class="tip-row">Tidak dilakukan: ${r.missed}</div><div class="tip-row">Required: ${r.required}</div>`;tooltip.classList.remove("hidden");const wr=wrap.getBoundingClientRect();tooltip.style.left=Math.min(Math.max(ev.clientX-wr.left,120),wrap.clientWidth-120)+"px";tooltip.style.top=Math.max(ev.clientY-wr.top-8,80)+"px";};
  canvas.onmouseleave=()=>tooltip?.classList.add("hidden");
}
function roundTopRect(ctx, x, y, width, height, radius){
  const r = Math.min(radius, width/2, height/2);
  ctx.beginPath();
  ctx.moveTo(x, y + height);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height);
  ctx.closePath();
}
window.addEventListener("resize", () => {
  if(window.__lastDailyRowsForChart) drawComplianceBarChart(window.__lastDailyRowsForChart);
});

function renderStoreScoreRows(storeRows){
  $("storeScoreBody").innerHTML = storeRows.map(r => `
    <tr>
      <td>${safe(r.name)}</td>
      <td>${r.required}</td>
      <td>${r.onTime}</td>
      <td>${r.variance}</td>
      <td>${r.missed}</td>
      <td><strong>${(r.compliance * 100).toFixed(1)}%</strong></td>
    </tr>
  `).join("");
}

function renderIssueList(issues){
  $("issueList").innerHTML = issues.length ? issues.slice(0,20).map(i => `
    <div class="issue">
      <strong>${safe(i.store)} • ${safe(i.reason)}</strong>
      <small>${safe(i.date)} • ${safe(i.slot)}</small>
    </div>
  `).join("") : `<div class="hint">Tidak ada issue pada periode ini.</div>`;
}

function renderEvidenceLog(records){
  $("evidenceBody").innerHTML = records.map(r => `
    <tr>
      <td><img class="evidence-thumb" src="${r.evidenceImage}" onclick="window.open(this.src,'_blank')" alt="evidence"></td>
      <td>${safe(r.storeName)}</td>
      <td>${safe(r.crewName)}</td>
      <td>${safe(r.dayName)}<br><small>${safe(r.dateKey)}</small></td>
      <td>${safe((r.evidenceLocalIso || "").slice(11))}</td>
      <td>${safe(r.slotLabel)}</td>
      <td><span class="status ${statusClass(r.status)}">${safe(r.status)}</span></td>
      <td><span class="badge ${trustClass(r.metadataTrust)}">${safe(r.metadataTrust)}</span></td>
    </tr>
  `).join("");
}

function updateExecutiveInsight(storeRows, dailyRows, records, summary){
  const bestStore = [...storeRows].sort((a,b) => b.compliance - a.compliance)[0];
  $("bestStoreName").textContent = bestStore ? bestStore.name : "-";
  $("bestStoreValue").textContent = bestStore ? `${(bestStore.compliance * 100).toFixed(1)}% compliance dari ${bestStore.required} requirement.` : "Belum ada data.";

  const bestDay = [...dailyRows].sort((a,b) => b.compliance - a.compliance)[0];
  $("bestDayName").textContent = bestDay ? bestDay.label : "-";
  $("bestDayValue").textContent = bestDay ? `${(bestDay.compliance * 100).toFixed(1)}% compliance pada ${bestDay.required} requirement.` : "Belum ada data.";

  const lowTrustCount = records.filter(r => r.metadataTrust !== "HIGH").length;
  const reviewCount = records.filter(r => r.status === "REVIEW" || r.integrity === "REVIEW").length;
  $("dataGapCount").textContent = `${lowTrustCount + reviewCount} gap`;
  $("dataGapText").textContent = `${lowTrustCount} evidence trust belum tinggi dan ${reviewCount} evidence perlu review.`;

  $("avgComplianceChip").textContent = `${(summary.compliancePct).toFixed(1)}%`;
  $("avgMissedChip").textContent = `${(summary.missedPct).toFixed(1)}%`;

  const aboveTarget = storeRows.filter(r => r.required > 0 && r.compliance >= 0.95).length;
  $("storesAboveTarget").textContent = `${aboveTarget} store`;
  $("topComplianceValue").textContent = bestStore ? `${(bestStore.compliance * 100).toFixed(1)}%` : "0%";

  const impactScore = Math.round((summary.compliancePct * 0.60) + (summary.onTimePct * 0.20) + (summary.highTrustPct * 0.20));
  $("impactRing").style.setProperty("--score", impactScore);
  $("impactScoreValue").textContent = impactScore;

  let label = "Kritis";
  if(impactScore >= 85) label = "Sangat efektif";
  else if(impactScore >= 70) label = "Efektif";
  else if(impactScore >= 50) label = "Perlu perhatian";
  $("impactScoreLabel").textContent = label;
  $("impactScoreText").textContent =
    `Compliance dilakukan ${summary.compliancePct.toFixed(1)}%, missed ${summary.missedPct.toFixed(1)}%, dan high trust ${summary.highTrustPct.toFixed(1)}%.`;
}

async function loadDashboard(){
  const from = $("dashFrom").value;
  const to = $("dashTo").value;
  const storeFilter = $("dashStore").value || "ALL";
  if(!from || !to) return;
  if(from > to) return toast("Tanggal awal tidak boleh setelah tanggal akhir.");

  const q = query(
    collection(db, "filterRecords"),
    where("dateKey", ">=", from),
    where("dateKey", "<=", to),
    orderBy("dateKey", "desc"),
    limit(1000)
  );
  const snap = await getDocs(q);
  let records = dedupeFilterRecords(snap.docs.map(d => d.data()));
  if(storeFilter !== "ALL") records = records.filter(r => r.storeId === storeFilter);

  const stores = state.stores.filter(s => s.active !== false && (storeFilter === "ALL" || s.id === storeFilter));
  const keys = dateRangeKeys(from, to);
  const slots = ["FILTER-1","FILTER-2","FILTER-3"];
  const recordMap = new Map(records.map(r => [`${r.dateKey}|${r.storeId}|${r.slotId}`, r]));

  let required = 0, onTime = 0, variance = 0, missed = 0, done = 0, high = 0;
  const storeRows = [];
  const dailyRows = [];
  const issues = [];

  for(const s of stores){
    let sr = 0, so = 0, sv = 0, sm = 0, sdone = 0;
    for(const dk of keys){
      if(s.activeFrom && dk < s.activeFrom) continue;
      for(const slot of slots){
        required++; sr++;
        const r = recordMap.get(`${dk}|${s.id}|${slot}`);
        if(!r){
          missed++; sm++;
          issues.push({ store:s.name, date:dk, slot, reason:"MISSED" });
          continue;
        }
        done++; sdone++;
        if(r.metadataTrust === "HIGH") high++;
        if(r.status === "ON TIME"){
          onTime++; so++;
        } else if(r.status === "EARLY" || r.status === "LATE"){
          variance++; sv++;
          issues.push({ store:s.name, date:dk, slot:r.slotLabel, reason:r.status });
        } else {
          issues.push({ store:s.name, date:dk, slot:r.slotLabel, reason:r.status || "REVIEW" });
        }
      }
    }
    storeRows.push({
      name:s.name,
      required:sr,
      done:sdone,
      onTime:so,
      variance:sv,
      missed:sm,
      compliance:sr ? sdone / sr : 0
    });
  }

  for(const dk of keys){
    let dr = 0, ddone = 0, dOnTime = 0;
    for(const s of stores){
      if(s.activeFrom && dk < s.activeFrom) continue;
      for(const slot of slots){
        dr++;
        const r = recordMap.get(`${dk}|${s.id}|${slot}`);
        if(!r) continue;
        ddone++;
        if(r.status === "ON TIME") dOnTime++;
      }
    }
    if(dr > 0){
      const dt = new Date(dk + "T00:00:00");
      dailyRows.push({
        dateKey:dk,
        label:formatDateShort(dk),
        fullLabel:new Intl.DateTimeFormat("id-ID",{day:"2-digit",month:"short",year:"numeric"}).format(dt),
        required:dr,
        done:ddone,
        missed:dr-ddone,
        onTimePct:dr ? dOnTime / dr : 0,
        compliance:dr ? ddone / dr : 0
      });
    }
  }

  const compliancePct = required ? (done / required * 100) : 0;
  const onTimePct = required ? (onTime / required * 100) : 0;
  const missedPct = required ? (missed / required * 100) : 0;
  const highTrustPct = done ? (high / done * 100) : 0;

  $("kpiRequired").textContent = required;
  $("kpiOnTime").textContent = onTime;
  $("kpiVariance").textContent = variance;
  $("kpiMissed").textContent = missed;
  $("kpiCompliance").textContent = `${compliancePct.toFixed(1)}%`;
  $("kpiHighTrust").textContent = `${highTrustPct.toFixed(1)}%`;

  storeRows.sort((a,b) => b.compliance - a.compliance);
  renderStoreScoreRows(storeRows);
  renderIssueList(issues);

  records.sort((a,b) => (b.evidenceEpochMs || 0) - (a.evidenceEpochMs || 0));
  renderEvidenceLog(records);

  window.__lastDailyRowsForChart = dailyRows;
  drawComplianceBarChart(dailyRows);
  updateExecutiveInsight(storeRows, dailyRows, records, { compliancePct, onTimePct, missedPct, highTrustPct });
}

$("btnLoadDashboard").addEventListener("click", loadDashboard);

async function boot(){
  const now = new Date();
  const today = toDateKey(now);
  if($("todayDisplay")) $("todayDisplay").textContent = new Intl.DateTimeFormat("id-ID", {weekday:"short", day:"2-digit", month:"short"}).format(now);
  const seven = new Date();
  seven.setDate(seven.getDate() - 6);
  $("dashFrom").value = toDateKey(seven);
  $("dashTo").value = today;
  $("storeActiveFromInput").value = today;
  setOilChangeNow();

  setConnectionBadge("Loading...", "warn");
  await ensureSettings();

  // Penting: isi Store/Crew lebih dulu agar dropdown langsung bisa dipakai.
  await loadMasters();
  refreshMasterTables();
  await Promise.allSettled([loadRecent(), loadOilChangeHistory()]);
  setConnectionBadge("Connected", "good");

  // Seed crew dilakukan setelah UI sudah usable.
  try{
    setConnectionBadge("Syncing crew...", "warn");
    const seedResult = await seedTrialCrewV20();
    if(seedResult.changed){
      await loadMasters();
      refreshMasterTables();
    }
    setConnectionBadge("Connected", "good");
    console.info(seedResult.message);
  }catch(seedErr){
    console.error("Seed crew gagal:", seedErr);
    // Aplikasi tetap usable memakai master data yang sudah ada.
    setConnectionBadge("Connected", "good");
    toast("Aplikasi aktif, tetapi sinkronisasi crew belum selesai: " + seedErr.message, 7000);
  }
}
boot().catch(err => {
  console.error(err);
  setConnectionBadge("Connection Error", "bad", err.message);
  toast("Connection Error: " + err.message, 8000);
});
