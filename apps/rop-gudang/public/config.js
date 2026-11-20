// ============================================================
// KONFIGURASI ROP GUDANG
// Link Google Sheet parameter TIDAK disimpan di repo (repo publik).
// Isi lewat salah satu cara:
//   1) deploy.sh menulis public/config.local.json  → berlaku untuk semua pengguna situs
//   2) menu Pengaturan di aplikasi                 → hanya browser itu
// ============================================================
window.ROP_CONFIG = {
  APP_NAME: "ROP Gudang",

  // Gudang yang otomatis dicentang & DIJUMLAH stoknya (nama gudang di file Zahir). Persediaan SCM = gudang + produksi.
  // Gudang lain di file (mis. "Sales") tetap bisa dicentang manual di aplikasi.
  DEFAULT_GUDANGS: ["SCM PKU", "Produksi PKU"],
  DEFAULT_GUDANG: "SCM PKU", // cadangan untuk versi lama

  // Master parameter ROP. Default: tab "PKU" di spreadsheet "Perhitungan Kebutuhan /ROP WH Pekanbaru".
  // Kolom dibaca berdasarkan nama header: Kode Barang, Nama, Satuan, Kategori, Penjualan 1 Hari, Buffer Stock (Hari),
  // Lead Time (Hari), Minimum Order Versi Purchasing, Harga. Opsional: Target DSI (Hari), Kelipatan Order, Supplier.
  MASTER: {
    SHEET_URL: "",      // link spreadsheet atau ID-nya
    GID: "0",           // gid tab parameter (tab PKU = 0)
    TAB: "PKU",         // nama tab (dipakai bila jalur export CSV gagal)
    LOCALE: "id",       // format angka di sheet: id = 1.234,5
  },

  // Nilai awal pengaturan (bisa diubah di menu Pengaturan; tersimpan per browser).
  DEFAULTS: {
    orderBasis: "master", // dasar Kebutuhan: "master" = pemakaian × (buffer + lead time) − SOH (sesuai master) · "target" = dari Target DSI
    targetDsi: 3,        // target DSI (hari) untuk KPI & status "Di atas target"; menentukan qty order hanya bila orderBasis = "target"
    moqTolDays: 2,       // MOQ diikuti bila menambah ≤ sekian hari pemakaian; lebih dari itu PR = kebutuhan ("MOQ ditahan"). 0 = abaikan MOQ, 999 = selalu ikut MOQ
    overstockDays: 30,   // DSI di atas ini = Overstock
    roundGramMl: false,  // true = Final PR satuan Gram/Ml dibulatkan ke atas ke kelipatan roundStep (bila Kelipatan di master kosong)
    roundStep: 1000,
    priceSource: "master", // master = harga terakhir di sheet (cadangan harga Zahir) · zahir = HPP Zahir
    dsiMin: 3.5,         // band DSI sheet lama: < 3,5 = "Min ≤3 hari"
    dsiSafety: 6.5,      // < 6,5 = "Safety 4–6 hari", selebihnya "Max ≥7 hari"
  },

  // Dipakai HANYA bila file Zahir berupa .xls biner lama (BIFF). Format export Zahir saat ini (teks) tidak memerlukannya.
  SHEETJS_URL: "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
};
