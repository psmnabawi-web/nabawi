const CONTROL_POINTS = [
  {
    "id": "PEST-01",
    "area": "Pest & Preventive",
    "title": "Sudut, bawah equipment & area tersembunyi",
    "weight": 50,
    "sourceClause": "II.A.1",
    "photoGuide": "Foto sudut kitchen dan bawah equipment yang paling rawan menjadi tempat hama.",
    "passCriteria": [
      "Tidak ada sisa makanan/grease menumpuk",
      "Tidak ada jejak/kotoran hama",
      "Area kering, bersih, dan tidak menjadi sarang"
    ]
  },
  {
    "id": "PEST-02",
    "area": "Pest & Preventive",
    "title": "Floor drain, gutter & area sekitar tempat sampah",
    "weight": 50,
    "sourceClause": "II.A.1",
    "photoGuide": "Foto floor drain/gutter dan area sekitar tempat sampah yang paling berisiko mengundang hama.",
    "passCriteria": [
      "Drain/gutter bersih dari sisa makanan",
      "Tidak ada genangan",
      "Area sekitar sampah bersih dan tidak berbau"
    ]
  },
  {
    "id": "PEST-03",
    "area": "Pest & Preventive",
    "title": "Fly catcher & glue pad",
    "weight": 50,
    "sourceClause": "II.A.2",
    "photoGuide": "Foto fly catcher dalam kondisi menyala dan glue pad terlihat jelas.",
    "passCriteria": [
      "Fly catcher menyala dan bersih",
      "Glue pad belum penuh",
      "Unit terpasang rapi dan tidak tertutup barang"
    ]
  },
  {
    "id": "CHEM-01",
    "area": "Chemical",
    "title": "Rak chemical: terpisah, tertutup & tersedia",
    "weight": 100,
    "sourceClause": "II.B.2",
    "photoGuide": "Foto keseluruhan rak/area penyimpanan chemical sehingga posisi dan pemisahannya terlihat.",
    "passCriteria": [
      "Terpisah dari bahan baku, kemasan dan utensil",
      "Chemical tertutup rapat",
      "Chemical utama tersedia",
      "Rak bersih dan rapi"
    ]
  },
  {
    "id": "CHEM-02",
    "area": "Chemical",
    "title": "Chemical sesuai standar operasional",
    "weight": 100,
    "sourceClause": "II.B.1",
    "photoGuide": "Foto produk chemical yang digunakan dengan kemasan/brand terlihat jelas.",
    "passCriteria": [
      "Chemical yang digunakan sesuai daftar/standar QA",
      "Kemasan asli/aman",
      "Tidak ada chemical tidak dikenal atau campuran tanpa identitas"
    ]
  },
  {
    "id": "CHEM-03",
    "area": "Chemical",
    "title": "Botol spray & chemical berlabel jelas",
    "weight": 50,
    "sourceClause": "II.B.3",
    "photoGuide": "Foto semua botol spray/chemical sekunder dalam satu frame bila memungkinkan.",
    "passCriteria": [
      "Semua botol memiliki label",
      "Nama pada label sesuai isi",
      "Label terbaca dan tidak rusak"
    ]
  },
  {
    "id": "FRONT-01",
    "area": "Front & Dining",
    "title": "Panel, kaca jendela & pintu",
    "weight": 100,
    "sourceClause": "II.C.1",
    "photoGuide": "Foto area entrance yang memperlihatkan panel, kaca dan pintu.",
    "passCriteria": [
      "Bebas sidik jari",
      "Bebas debu dan tumpahan",
      "Tidak ada noda mencolok pada area yang terlihat customer"
    ]
  },
  {
    "id": "FRONT-02",
    "area": "Front & Dining",
    "title": "Lantai, dinding, plafon, lampu, AC & signage area dining",
    "weight": 50,
    "sourceClause": "II.C.2",
    "photoGuide": "Ambil foto sudut lebar area dining yang paling mewakili kondisi lantai hingga plafon.",
    "passCriteria": [
      "Lantai bersih dan tidak lengket",
      "Dinding/plafon bebas debu/jamur",
      "Lampu dan AC/kipas bersih",
      "Signage/dekorasi bersih dan rapi"
    ]
  },
  {
    "id": "FRONT-03",
    "area": "Front & Dining",
    "title": "Toilet & handwash area",
    "weight": 50,
    "sourceClause": "II.C.2",
    "photoGuide": "Foto toilet dan area wastafel/handwash setelah cleaning.",
    "passCriteria": [
      "Lantai dan closet bersih",
      "Wastafel dan kran bersih",
      "Tidak ada bau menyengat",
      "Area kering dan tertata"
    ]
  },
  {
    "id": "FRONT-04",
    "area": "Front & Dining",
    "title": "Meja & kursi dining",
    "weight": 50,
    "sourceClause": "II.C.3",
    "photoGuide": "Foto beberapa meja dan kursi dalam kondisi siap digunakan customer.",
    "passCriteria": [
      "Permukaan meja bebas sisa makanan/noda",
      "Kursi bersih",
      "Susunan rapi dan siap digunakan"
    ]
  },
  {
    "id": "STORE-01",
    "area": "Storage",
    "title": "Gudang, rak & bahan kemasan",
    "weight": 50,
    "sourceClause": "II.C.3",
    "photoGuide": "Foto sudut lebar gudang/rak penyimpanan dan kemasan.",
    "passCriteria": [
      "Barang tersusun rapi",
      "Rak dan lantai bersih",
      "Tidak ada kardus menumpuk sembarangan",
      "Bahan kemasan tidak menyentuh lantai bila standar mensyaratkan"
    ]
  },
  {
    "id": "FRONT-05",
    "area": "Front & Dining",
    "title": "Menu & material promo",
    "weight": 50,
    "sourceClause": "II.C.4",
    "photoGuide": "Foto buku menu, tent card, poster atau material promo yang sedang digunakan.",
    "passCriteria": [
      "Bersih dan tidak kusam",
      "Tertata rapi",
      "Materi yang dipasang masih relevan/terupdate"
    ]
  },
  {
    "id": "WASTE-01",
    "area": "Waste",
    "title": "Tempat sampah",
    "weight": 100,
    "sourceClause": "II.C.5",
    "photoGuide": "Foto tempat sampah utama dalam kondisi operasional.",
    "passCriteria": [
      "Menggunakan trash bag",
      "Tutup berfungsi dan tertutup",
      "Tidak penuh/overflow",
      "Body dan area sekitarnya bersih"
    ]
  },
  {
    "id": "KIT-01",
    "area": "Kitchen Equipment",
    "title": "Kompor, griddle & deep fryer",
    "weight": 30,
    "sourceClause": "II.C.6",
    "photoGuide": "Foto area cooking utama dari depan/atas sehingga permukaan equipment terlihat.",
    "passCriteria": [
      "Bebas kerak/grease berlebih",
      "Tidak ada sisa makanan menempel",
      "Area bawah/sekeliling tidak menggunakan kardus kotor"
    ]
  },
  {
    "id": "KIT-02",
    "area": "Kitchen Equipment",
    "title": "Hood, exhaust & kipas kitchen",
    "weight": 25,
    "sourceClause": "II.C.6",
    "photoGuide": "Foto hood/exhaust/filter dan kipas kitchen.",
    "passCriteria": [
      "Filter/permukaan tidak penuh grease",
      "Tidak ada debu tebal",
      "Area sekitar bersih"
    ]
  },
  {
    "id": "KIT-03",
    "area": "Kitchen Equipment",
    "title": "Sink, grease trap & gutter",
    "weight": 25,
    "sourceClause": "II.C.6",
    "photoGuide": "Foto sink dan grease trap/gutter setelah proses cleaning.",
    "passCriteria": [
      "Sink bebas sisa makanan",
      "Grease trap/gutter tidak penuh residu",
      "Tidak ada genangan atau bau kuat"
    ]
  },
  {
    "id": "KIT-04",
    "area": "Kitchen Equipment",
    "title": "Meja prepare, bain marie & warmer",
    "weight": 25,
    "sourceClause": "II.C.6",
    "photoGuide": "Foto area preparation dan hot holding equipment.",
    "passCriteria": [
      "Permukaan food contact bersih",
      "Tidak ada remah/sisa produk",
      "Barang tersusun rapi dan tidak bercampur dengan alat cleaning"
    ]
  },
  {
    "id": "KIT-05",
    "area": "Kitchen Equipment",
    "title": "Chiller & freezer",
    "weight": 25,
    "sourceClause": "II.C.6",
    "photoGuide": "Foto bagian luar, bagian atas dan isi chiller/freezer yang paling mewakili.",
    "passCriteria": [
      "Handle/body bersih",
      "Interior tidak ada tumpahan/residu",
      "Bagian atas tidak menjadi tempat barang operasional sembarangan",
      "Produk tersusun rapi"
    ]
  },
  {
    "id": "KIT-06",
    "area": "Kitchen Equipment",
    "title": "Rice cooker & small equipment",
    "weight": 20,
    "sourceClause": "II.C.6",
    "photoGuide": "Foto rice cooker dan equipment kecil yang paling sering digunakan.",
    "passCriteria": [
      "Body dan area sekitar bersih",
      "Tidak ada kerak/sisa produk",
      "Kabel dan area penempatan rapi"
    ]
  },
  {
    "id": "UTL-01",
    "area": "Utensil",
    "title": "Chopping board, pisau, scraper & capitan",
    "weight": 75,
    "sourceClause": "II.C.7",
    "photoGuide": "Foto utensils utama setelah dicuci dan disimpan.",
    "passCriteria": [
      "Bersih dari grease/sisa makanan",
      "Kering",
      "Tersusun pada tempatnya",
      "Tidak bercampur dengan barang kotor"
    ]
  },
  {
    "id": "UTL-02",
    "area": "Utensil",
    "title": "Container & utensils lainnya",
    "weight": 75,
    "sourceClause": "II.C.7",
    "photoGuide": "Foto container, tray, dispenser, saringan dan utensils lainnya pada area penyimpanan.",
    "passCriteria": [
      "Container bersih dan kering",
      "Tersusun rapi",
      "Tidak ada utensil kotor tersimpan bersama utensil bersih"
    ]
  },
  {
    "id": "SAFE-01",
    "area": "Safety",
    "title": "APAR",
    "weight": 100,
    "sourceClause": "II.C.8",
    "photoGuide": "Foto APAR utuh dengan gauge/pressure dan tag inspeksi terlihat bila memungkinkan.",
    "passCriteria": [
      "Body APAR bersih",
      "Posisi mudah diakses",
      "Gauge berada pada area normal",
      "Tag/form inspeksi tersedia"
    ]
  },
  {
    "id": "CLN-01",
    "area": "Cleaning Tools",
    "title": "Janitor & peralatan kebersihan",
    "weight": 100,
    "sourceClause": "II.C.9",
    "photoGuide": "Foto area penyimpanan sapu, mop, brush, wiper dan alat cleaning lainnya.",
    "passCriteria": [
      "Alat bersih setelah digunakan",
      "Tersimpan rapi pada tempatnya",
      "Tidak terlihat customer bila area janitor terpisah",
      "Tidak menghalangi mobilisasi"
    ]
  },
  {
    "id": "ENV-01",
    "area": "Kitchen Environment",
    "title": "Lantai kitchen",
    "weight": 50,
    "sourceClause": "II.C.10",
    "photoGuide": "Foto lantai kitchen termasuk bawah meja/equipment yang terlihat.",
    "passCriteria": [
      "Bebas sisa makanan",
      "Tidak berminyak/licin",
      "Tidak ada genangan",
      "Sudut dan bawah equipment tidak menumpuk kotoran"
    ]
  },
  {
    "id": "ENV-02",
    "area": "Kitchen Environment",
    "title": "Dinding, plafon & lampu kitchen",
    "weight": 50,
    "sourceClause": "II.C.10",
    "photoGuide": "Foto sudut lebar dinding hingga plafon dan lampu kitchen.",
    "passCriteria": [
      "Bebas debu/grease",
      "Tidak ada sarang laba-laba",
      "Lampu dan cover bersih",
      "Tidak ada noda berat pada dinding/plafon"
    ]
  },
  {
    "id": "ENV-03",
    "area": "Kitchen Environment",
    "title": "Panel listrik, saklar, kabel & stop kontak",
    "weight": 50,
    "sourceClause": "II.C.10",
    "photoGuide": "Foto panel listrik dan beberapa titik saklar/stop kontak yang paling representatif.",
    "passCriteria": [
      "Permukaan bebas debu/grease",
      "Kabel tertata",
      "Tidak ada barang menempel/menutupi panel",
      "Area sekitar kering dan bersih"
    ]
  }
];
module.exports = { CONTROL_POINTS };
