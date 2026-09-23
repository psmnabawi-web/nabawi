// ============================================================
// KONFIGURASI DASHBOARD SSSG — INTI WARNA
// Hanya file ini yang perlu diubah bila ada penyesuaian.
// ============================================================
window.SSSG_CONFIG = {
  // ID Google Sheet "(2026) TOTAL OMSET PERHARI ALL OUTLET" — spreadsheet tahun berjalan (dipakai untuk sheet REKAP & BASELINE)
  SHEET_ID: "1soyZLSwNUzFaRy1fH4XtmFdYbQqrGHfDlTZx5wYxKBY",

  // Spreadsheet omset per TAHUN (format sama: tab JANUARI..DESEMBER, baris harian per toko). Tahun terbaru di atas.
  // Dashboard bisa menampilkan tahun mana pun di daftar ini; SSSG YoY selalu dibandingkan ke tahun sebelumnya di daftar.
  SHEETS: [
    { year: 2026, id: "1soyZLSwNUzFaRy1fH4XtmFdYbQqrGHfDlTZx5wYxKBY" },
    { year: 2025, id: "1nBUOVfVOa9cPKPj_kSZa-xlC_1JEjMtSDRRP9fXluBk" },
    { year: 2024, id: "1UnYT3RwIDCMptxUPNUcgFpE-3MpTXTskaDbM0hAJFhs" },
  ],

  // Nama yang disapa di header dashboard ("Selamat pagi, …") dan nama organisasi di sidebar
  OWNER: { name: "Nabawi", org: "Inti Warna" },

  // Tahun berjalan (sheet per bulan) dan tahun pembanding (baseline)
  YEAR: 2026,
  BASE_YEAR: 2025,

  // Nama sheet per bulan (urut Jan–Des). Spasi di akhir nama sheet ditangani otomatis.
  MONTH_SHEETS: ["JANUARI","FEBRUARI","MARET","APRIL","MEI","JUNI","JULI","AGUSTUS","SEPTEMBER","OKTOBER","NOVEMBER","DESEMBER"],

  // Sheet REKAP (tabel BULAN | 2026 | 2025 di level perusahaan)
  REKAP_SHEET: "REKAP",

  // FALLBACK: sheet baseline omset 2025 PER TOKO (total bulanan) di spreadsheet utama, dipakai bila bulan 2025 di atas tidak terbaca.
  // Format: baris 1 header: TOKO | JANUARI | FEBRUARI | ... | DESEMBER ; baris berikutnya 1 toko per baris.
  BASELINE_SHEET: "BASELINE 2025",

  // OPSIONAL: bila spreadsheet TIDAK dibagikan "Siapa saja yang memiliki link", deploy apps-script/Code.gs
  // sebagai Web App lalu tempel URL-nya di sini. Bila kosong, dashboard membaca langsung dari Google Sheet.
  APPS_SCRIPT_URL: "",

  // Mapping toko -> nama kolom header di sheet bulanan (baris "TGL | HARI | TOTAL | ...").
  // "aliases" dipakai juga untuk mencocokkan nama toko di sheet BASELINE 2025.
  STORES: [
    { key: "ARIFIN",   label: "IW Arifin Ahmad", short: "ARIFIN", aliases: ["AKTUAL IW","IW","IW ARIFIN","IW ARIFIN AHMAD","INTI WARNA ARIFIN AHMAD","ARIFIN AHMAD","ARIFIN","INTI WARNA"] },
    { key: "TJ",       label: "Tunas Jaya",      short: "TJ",     aliases: ["TJ","AKTUAL TJ","TUNAS JAYA"] },
    { key: "AF",       label: "Al Fatih",        short: "AF",     aliases: ["AF","AKTUAL AF","AL FATIH","AL - FATIH","ALFATIH"] },
    { key: "BW",       label: "Butik Warna",     short: "BW",     aliases: ["BW","AKTUAL BW","BUTIK WARNA"] },
    { key: "PSP",      label: "IW Pasir",        short: "PSP",    aliases: ["IWP","AKTUAL IWP","IW PASIR","INTI WARNA PASIR","IW PSP","PASIR"] },
    { key: "UBA",      label: "IW Ujung Batu",   short: "UBA",    aliases: ["IWU","AKTUAL IWU","IW UBA","IW UJUNG BATU","INTI WARNA UJUNG BATU","INTI WARNA UJUNGBATU","UJUNG BATU"] },
    { key: "PYK",      label: "IW Payakumbuh",   short: "PYK",    aliases: ["IW PYK","AKTUAL IW PYK","IW PAYAKUMBUH","INTI WARNA PAYAKUMBUH","PAYAKUMBUH"] },
    { key: "HR",       label: "IW Harapan Raya", short: "HR",     aliases: ["IW HR","AKTUAL IW HR","IW HARAPAN","IW HARAPAN RAYA","INTI WARNA HARAPAN","INTI WARNA HARAPAN RAYA","HARAPAN RAYA","HARAPAN"] },
    { key: "KTP",      label: "IW Kertapati",    short: "KTP",    aliases: ["IW KERTAPATI","IW KTP","INTI WARNA KERTAPATI","KERTAPATI"] },
    { key: "PLAJU",    label: "IW Plaju",        short: "PLAJU",  aliases: ["IW PLAJU","INTI WARNA PLAJU","PLAJU"] },
    // Toko yang hanya ada di data 2024 (Jan–Jul), tutup pertengahan 2024. Nama lengkap belum dikonfirmasi.
    { key: "IWB",      label: "IWB (tutup 2024)", short: "IWB",   aliases: ["IWB","AKTUAL IWB","IW B"] },
    { key: "GDG",      label: "Gudang",          short: "GDG",    aliases: ["GDG","GUDANG"], excludeFromSSSG: true }
  ],

  // Blok "ABSEN KUNJUNGAN PER HARI" di tab bulanan: per toko kolom DATANG | BELANJA | GAGAL [| RO | BARU]. Dibaca otomatis bila ada.
  VISIT_COLS: ["DATANG","BELANJA","GAGAL","RO","BARU"],

  // Aturan "same store": toko dihitung SSSG hanya bila aktif (omset > 0) di KEDUA periode yang dibandingkan
  // dan sudah beroperasi minimal sekian hari pada bulan tersebut.
  MIN_ACTIVE_DAYS: 15,

  // Ambang warna status SSSG (%)
  THRESHOLD: { good: 5, warn: 0 },  // >= good hijau, >= warn kuning, < warn merah
  // Narasi AI bersama tim: URL Web App Apps Script (lihat apps-script/AiProxy.gs) yang menyimpan token API di sisi server.
  // Bila diisi, halaman AI Insight memakai proxy ini dan tidak meminta token per pengguna. Kosongkan ("") untuk mode token per browser.
  AI_PROXY_URL: "https://script.google.com/macros/s/AKfycbx44oKB4nRl3dxmWGEMHw3MR4RiRjtGQdGIxibwDmgzlQbxWmAUNjGs8H7XpW1FNc64/exec",

  // Peringatan otomatis: ambang dalam % (growth like-for-like) / % pencapaian target / bulan
  ALERTS: {
    declineWarn: -10, declineCrit: -25,   // penurunan omset MoM atau YoY (outlet & perusahaan)
    trendMonths: 3,                       // tren negatif = MoM negatif sekian bulan berturut-turut
    achWarn: 80, achCrit: 60,             // pencapaian target di bawah ini
    newOutletMonths: 12                   // outlet dianggap "baru" bila buka ≤ sekian bulan sebelum periode terpilih
  },

  // Ambang warna konversi kunjungan (%): belanja ÷ datang
  THRESHOLD_KONVERSI: { good: 80, warn: 60 },

  // Pencapaian SALES: spreadsheet "Pencapaian sales" (satu baris per sales: Nama | Target <bulan> | ... | Total Price | Month to Date | omset per tanggal).
  // SHEET_NAME kosong = tab pertama. Spreadsheet harus dibagikan "Siapa saja yang memiliki link — Viewer".
  SALES: { SHEET_ID: "1ehWqWy-5mx8HcvbzAXPOfxExLxgsyFyy6OruhzGtpsQ", SHEET_NAME: "", TITLE: "Pencapaian Sales" },
};
