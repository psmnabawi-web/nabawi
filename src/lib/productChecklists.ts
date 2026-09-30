// Sumber: Cheklist Audit Kwalitas V3.1 (Excel). Gate: CRITICAL/MAJOR/CONTROL. Jawaban: Ya/Tidak/N/A.

export type Gate = 'CRITICAL' | 'MAJOR' | 'CONTROL';
/** Cara pembuktian: visual (foto), measure (angka pengukuran), sensory (rasa/aroma oleh inspector), document (label/log), observe (proses). */
export type EvidenceType = 'visual' | 'measure' | 'sensory' | 'document' | 'observe';

export interface ChecklistItem {
  no: number;
  gate: Gate;
  stage: string;
  parameter: string;
  standard: string;
  evidence: EvidenceType;
}

export interface ProductDef {
  id: ProductId;
  name: string;
  short: string;
  profile: string;
  items: ChecklistItem[];
}

export type ProductId = 'kebuli' | 'saudi' | 'ori';

export const PRODUCTS: ProductDef[] = [
  {
    id: 'kebuli',
    name: "Nasi Kebuli",
    short: "Nasi Kebuli",
    profile: "Warna luar krem/cokelat muda dengan aksen merah-kuning; butir memanjang, utuh, terpisah, pulen; gurih-rempah dan asap seimbang; basmati; konsisten atas-tengah-dasar.",
    items: [
      { no: 1, gate: 'CRITICAL', stage: "Traceability", parameter: "Identitas batch dan bahan", standard: "Batch, waktu masak, bahan/lot, penanggung jawab, dan riwayat penanganan dapat ditelusuri.", evidence: 'document' },
      { no: 2, gate: 'CRITICAL', stage: "Higiene", parameter: "Kebersihan alat, wadah, dan area", standard: "Seluruh food-contact surface bersih, kering, halal, bebas najis, residu kimia, dan kontaminasi silang.", evidence: 'visual' },
      { no: 3, gate: 'CRITICAL', stage: "Keamanan", parameter: "Benda asing", standard: "Tidak ditemukan rambut, plastik, logam, kaca, serangga, kotoran, abu, serpihan kayu, atau benda asing lain.", evidence: 'visual' },
      { no: 4, gate: 'CRITICAL', stage: "Keamanan", parameter: "Tanda kerusakan produk", standard: "Tidak berlendir, berjamur, fermentasi, warna abnormal, atau berbau asam, busuk, tengik, apek, maupun kimia.", evidence: 'visual' },
      { no: 5, gate: 'CRITICAL', stage: "Bahan baku", parameter: "Kelayakan beras dan bumbu", standard: "Kemasan utuh, label jelas, belum kedaluwarsa; tidak lembap, berjamur, berkutu, berbau asing, atau tercemar.", evidence: 'visual' },
      { no: 6, gate: 'MAJOR', stage: "Persiapan", parameter: "Beras basmati dicuci dan ditiriskan", standard: "Beras basmati dicuci 4 kali, lalu ditiriskan hingga air berlebih turun sebelum dimasak.", evidence: 'observe' },
      { no: 7, gate: 'MAJOR', stage: "Pemasakan", parameter: "Takaran air", standard: "Air 1.400 ml untuk setiap 1 liter beras basmati sesuai WI aktif Versi 3.0.", evidence: 'observe' },
      { no: 8, gate: 'MAJOR', stage: "Pemasakan", parameter: "Kapasitas alat", standard: "Maksimal 5 liter beras untuk rice cooker gas atau 3 liter untuk rice cooker elektrik per proses.", evidence: 'observe' },
      { no: 9, gate: 'MAJOR', stage: "Penumisan", parameter: "Urutan dan waktu penumisan bumbu", standard: "Kayu manis, bawang bombai dipototong 2 kali melintang mengikut serat (menjadi 4 bagian dari 1 butir bombay), dan rempah utuh ditumis; bawang putih masuk setelah 2 menit; total penumisan sekitar 4 menit; tidak gosong.", evidence: 'observe' },
      { no: 10, gate: 'MAJOR', stage: "Pasca-masak", parameter: "Resting nasi", standard: "Nasi diistirahatkan 12 menit setelah matang sebelum proses warna/pengasapan.", evidence: 'visual' },
      { no: 11, gate: 'MAJOR', stage: "Pasca-masak", parameter: "Rempah kasar", standard: "Rempah kayu manis,daun salam dan bawang bombay telah disisihkan; tidak ada bagian keras yang mengganggu keamanan dan pengalaman makan.", evidence: 'visual' },
      { no: 12, gate: 'MAJOR', stage: "Pewarnaan", parameter: "Takaran dan sebaran safron", standard: "Safron merah dilarutkan dengan 5 ml air panas dan kuning dengan 30 ml; warna tersebar sebagai aksen, tidak menggumpal.", evidence: 'visual' },
      { no: 13, gate: 'MAJOR', stage: "Pengasapan", parameter: "Waktu dan kondisi pengasapan", standard: "Dimulai maksimal 30 menit setelah nasi matang; diasap 15 menit dalam wadah tertutup; kain satin utuh; kayu sekali pakai 70–80 g.", evidence: 'observe' },
      { no: 14, gate: 'MAJOR', stage: "Visual", parameter: "Bentuk butir nasi", standard: "Butir basmati memanjang, utuh, terpisah, dan tidak membentuk gumpalan padat.", evidence: 'visual' },
      { no: 15, gate: 'MAJOR', stage: "Visual", parameter: "Warna khas Nasi Kebuli", standard: "Warna dasar krem/cokelat muda dengan aksen merah dan kuning tersebar; tidak pucat, terlalu gelap, belang ekstrem, atau menggumpal.", evidence: 'visual' },
      { no: 16, gate: 'MAJOR', stage: "Tekstur", parameter: "Kelembutan dan kepulenan", standard: "Lembut/pulen namun butir tetap terpisah; tidak keras, mentah, lembek, berair, atau sangat lengket.", evidence: 'visual' },
      { no: 17, gate: 'MAJOR', stage: "Aroma", parameter: "Aroma khas", standard: "Aroma nasi, rempah, dan asap bersih serta seimbang; tidak terlalu lemah atau didominasi satu rempah/gosong.", evidence: 'sensory' },
      { no: 18, gate: 'MAJOR', stage: "Rasa", parameter: "Keseimbangan rasa", standard: "Gurih-rempah seimbang dan konsisten; tidak hambar, terlalu asin, pahit, atau rasa gosong.", evidence: 'sensory' },
      { no: 19, gate: 'MAJOR', stage: "Konsistensi", parameter: "Keseragaman atas–tengah–dasar", standard: "Warna, aroma, rasa, dan tekstur relatif seragam di bagian atas, tengah, dan dasar wadah.", evidence: 'visual' },
      { no: 20, gate: 'MAJOR', stage: "Visual", parameter: "Minyak dan kerak", standard: "Tidak ada genangan minyak, kerak gosong dominan, atau residu yang mengganggu tampilan/rasa.", evidence: 'visual' },
      { no: 21, gate: 'CRITICAL', stage: "Hot holding", parameter: "Suhu bagian atas", standard: "Suhu produk di bagian atas lebih dari 60°C pada saat pemeriksaan.", evidence: 'measure' },
      { no: 22, gate: 'CRITICAL', stage: "Hot holding", parameter: "Suhu bagian tengah", standard: "Suhu produk di bagian tengah lebih dari 60°C pada saat pemeriksaan.", evidence: 'measure' },
      { no: 23, gate: 'CRITICAL', stage: "Hot holding", parameter: "Suhu bagian dasar", standard: "Suhu produk di bagian dasar lebih dari 60°C pada saat pemeriksaan.", evidence: 'measure' },
      { no: 24, gate: 'CRITICAL', stage: "Shelf life", parameter: "Label waktu dan umur produk", standard: "Label lengkap; umur produk maksimal 12 jam, pada hari yang sama, tidak untuk hari berikutnya; riwayat holding jelas.", evidence: 'measure' },
      { no: 25, gate: 'MAJOR', stage: "Porsi", parameter: "Berat porsi", standard: "Porsi normal 180 g dengan toleransi 175–185 g; setengah porsi 90 g; dikoreksi sebelum disajikan.", evidence: 'measure' },
      { no: 26, gate: 'MAJOR', stage: "Penyajian", parameter: "Penanganan dan kemasan", standard: "Tidak diprestok terbungkus di display warmer; alat saji bersih; kemasan utuh; untuk takeaway ayam tidak diletakkan langsung di atas nasi.", evidence: 'visual' },
    ],
  },
  {
    id: 'saudi',
    name: "Ayam Saudi",
    short: "Ayam Saudi",
    profile: "Warna luar golden-orange merata; matang sampai dekat tulang; karakter bumbu Saudi tersebar; rempah Saudi bercita rasa spicy; memakai ayam/bumbu Saudi dan proses marinasi/inject sesuai standar.",
    items: [
      { no: 1, gate: 'CRITICAL', stage: "Traceability", parameter: "Identitas batch dan holding", standard: "SKU, batch/waktu goreng, operator, fryer, serta awal dan akhir holding dapat ditelusuri.", evidence: 'document' },
      { no: 2, gate: 'CRITICAL', stage: "Bahan baku", parameter: "Kondisi ayam sebelum breading", standard: "Ayam sesuai label/shelf life; thawing terkendali; tidak beku di bagian dalam, berlendir, rusak, berbau busuk/kimia, atau tercemar.", evidence: 'visual' },
      { no: 3, gate: 'CRITICAL', stage: "Higiene", parameter: "Pemisahan alat mentah dan matang", standard: "Zoning, tray, talenan, pisau, tong, dan permukaan raw/cooked terpisah, bersih, dan tersanitasi.", evidence: 'visual' },
      { no: 4, gate: 'CRITICAL', stage: "Keamanan", parameter: "Benda asing dan bahaya fisik", standard: "Tidak ada rambut, plastik, logam, kaca, serangga, bulu, kotoran, atau tulang tajam yang membahayakan.", evidence: 'visual' },
      { no: 5, gate: 'CRITICAL', stage: "Bahan", parameter: "Bahan khusus Ayam Saudi", standard: "Ayam berbumbu pedas Saudi dan tepung Saudi yang benar; bahan dikenal, berlabel, dan tidak kedaluwarsa.", evidence: 'visual' },
      { no: 6, gate: 'MAJOR', stage: "Persiapan", parameter: "Kerapian kulit dan potongan", standard: "Kulit rapi, tidak robek berlebihan, tidak ada bulu; potongan sesuai SKU dan tidak rusak.", evidence: 'visual' },
      { no: 7, gate: 'MAJOR', stage: "Breading", parameter: "Breading tahap pertama", standard: "Diproses 4–8 potong per siklus; 5 kali fold/scoop, 1 kali press, lalu tap 1 kali.", evidence: 'observe' },
      { no: 8, gate: 'MAJOR', stage: "Pencelupan", parameter: "Air celup", standard: "Air layak minum bersuhu 1–4°C; diganti setelah 108 potong/4 basket besar/12 pack dan setiap waktu istirahat.", evidence: 'measure' },
      { no: 9, gate: 'MAJOR', stage: "Pencelupan", parameter: "Perendaman dan penirisan", standard: "Ayam terendam penuh, kemudian ditiriskan 10 detik sebelum breading kedua.", evidence: 'observe' },
      { no: 10, gate: 'MAJOR', stage: "Breading", parameter: "Breading tahap kedua", standard: "10 kali fold/scoop, 1 kali press, tap 2 kali; tepung diayak setiap selesai breading.", evidence: 'observe' },
      { no: 11, gate: 'MAJOR', stage: "Penggorengan", parameter: "Fryer yang digunakan", standard: "Menggunakan fryer yang ditetapkan untuk Ayam Saudi dan kondisi minyak layak.", evidence: 'observe' },
      { no: 12, gate: 'MAJOR', stage: "Penggorengan", parameter: "Waktu dan suhu fryer", standard: "Digoreng 12 menit pada 150°C sesuai WI; timer dan suhu tercatat.", evidence: 'measure' },
      { no: 13, gate: 'CONTROL', stage: "Penggorengan", parameter: "Shake basket", standard: "Pada menit ke-7 basket di-shake 3 kali untuk membantu kematangan dan coating merata.", evidence: 'visual' },
      { no: 14, gate: 'CONTROL', stage: "Pasca-goreng", parameter: "Penirisan dari fryer", standard: "Produk ditiriskan 10 detik setelah diangkat dari fryer.", evidence: 'observe' },
      { no: 15, gate: 'MAJOR', stage: "Minyak", parameter: "Filtering dan kondisi minyak", standard: "Filtering dilakukan maksimal setelah 5 basket besar atau 80 potong per fryer; minyak tidak berbau tengik, berbusa abnormal, atau mengandung banyak remah/benda asing.", evidence: 'visual' },
      { no: 16, gate: 'MAJOR', stage: "Bentuk SKU", parameter: "Bentuk potongan sesuai SKU", standard: "Sayap utuh dan proporsional. Paha Atas utuh, berisi, kulit rapi, serta sambungan dipatahkan tanpa merusak potongan. Paha Bawah utuh/memanjang dan pangkal berisi. Dada utuh dan proporsional. Semua SKU bebas tulang tajam.", evidence: 'visual' },
      { no: 17, gate: 'MAJOR', stage: "Produk matang", parameter: "Kondisi coating", standard: "Coating merata, melekat, renyah, tidak botak, tidak bergumpal, dan tidak terlalu tebal.", evidence: 'visual' },
      { no: 18, gate: 'MAJOR', stage: "Produk matang", parameter: "Warna", standard: "Warna golden–orange merata; tidak pucat, terlalu gelap, atau gosong.", evidence: 'visual' },
      { no: 19, gate: 'CRITICAL', stage: "Kematangan", parameter: "Suhu inti", standard: "Suhu bagian paling tebal minimal 74°C selama 10 detik.", evidence: 'measure' },
      { no: 20, gate: 'CRITICAL', stage: "Kematangan", parameter: "Kondisi bagian dalam", standard: "Daging matang hingga dekat tulang/sendi; tidak ada jaringan mentah atau cairan mentah.", evidence: 'visual' },
      { no: 21, gate: 'MAJOR', stage: "Tekstur", parameter: "Keempukan dan kelembapan", standard: "Daging empuk dan moist; tidak kering, keras, berair abnormal, atau sangat berminyak.", evidence: 'visual' },
      { no: 22, gate: 'MAJOR', stage: "Rasa", parameter: "Rasa khas Saudi", standard: "Bumbu terasa hingga bawah kulit, bagian tengah, dan dekat tulang/sendi; tidak hambar atau terkumpul pada satu titik.", evidence: 'sensory' },
      { no: 23, gate: 'CRITICAL', stage: "Aroma", parameter: "Aroma produk matang", standard: "Aroma ayam dan bumbu bersih; tidak ada bau tepung mentah kuat, minyak tua/tengik, busuk, atau kimia.", evidence: 'sensory' },
      { no: 24, gate: 'CONTROL', stage: "Holding", parameter: "Resting sebelum penyajian", standard: "Setelah goreng, rest minimal 5 menit untuk display warmer atau 10 menit untuk holding cabinet sebelum disajikan.", evidence: 'visual' },
      { no: 25, gate: 'CRITICAL', stage: "Holding", parameter: "Suhu dan batas waktu holding", standard: "Display warmer 65–70°C maksimal 90 menit (cek kualitas setelah 60 menit) atau holding cabinet 75–80°C maksimal 60 menit; bukti waktu lengkap.", evidence: 'measure' },
      { no: 26, gate: 'MAJOR', stage: "Holding", parameter: "Penataan dan identitas batch", standard: "Produk tidak dicampur antarbatch; ditata bone-down; label waktu terbaca dan produk lama tidak ditutup dengan batch baru.", evidence: 'measure' },
      { no: 27, gate: 'MAJOR', stage: "Penyajian", parameter: "Plating dan kemasan", standard: "Alat/kemasan bersih dan utuh; dine-in disajikan sesuai standar; takeaway ayam ditempatkan terpisah dari Nasi Kebuli.", evidence: 'visual' },
    ],
  },
  {
    id: 'ori',
    name: "Ayam ORI/Crispy",
    short: "Ayam ORI",
    profile: "Warna luar kuning keemasan sampai cokelat keemasan alami, bukan oranye; bagian dalam putih-krem alami tanpa warna oranye atau karakter cairan inject; asin-gurih, tidak pedas, hangat lembut dari black pepper; memakai Chicken Crispy dan tepung ORI; tanpa inject.",
    items: [
      { no: 1, gate: 'CRITICAL', stage: "Traceability", parameter: "Identitas batch dan holding", standard: "SKU, batch/waktu goreng, operator, fryer, serta awal dan akhir holding dapat ditelusuri.", evidence: 'document' },
      { no: 2, gate: 'CRITICAL', stage: "Bahan baku", parameter: "Kondisi ayam sebelum breading", standard: "Ayam sesuai label dan shelf life; thawing terkendali; tidak beku di bagian dalam, berlendir, rusak, berbau busuk/kimia, atau tercemar.", evidence: 'visual' },
      { no: 3, gate: 'CRITICAL', stage: "Higiene", parameter: "Pemisahan alat mentah dan matang", standard: "Zoning, tray, talenan, pisau, tong, dan permukaan raw/cooked terpisah, bersih, dan tersanitasi.", evidence: 'visual' },
      { no: 4, gate: 'CRITICAL', stage: "Keamanan", parameter: "Benda asing dan bahaya fisik", standard: "Tidak ada rambut, plastik, logam, kaca, serangga, bulu, kotoran, atau tulang tajam yang membahayakan.", evidence: 'visual' },
      { no: 5, gate: 'CRITICAL', stage: "Bahan", parameter: "Bahan khusus Ayam ORI/Crispy", standard: "Menggunakan Chicken Crispy/ORI dan tepung ORI yang benar. Ayam ORI tidak melalui proses inject dan tidak tertukar dengan ayam atau tepung Saudi. Bahan dikenal, berlabel, dan belum kedaluwarsa.", evidence: 'visual' },
      { no: 6, gate: 'MAJOR', stage: "Persiapan", parameter: "Kerapian kulit dan potongan", standard: "Kulit rapi, tidak robek berlebihan, tidak ada bulu; potongan sesuai SKU dan tidak rusak.", evidence: 'visual' },
      { no: 7, gate: 'MAJOR', stage: "Breading", parameter: "Breading tahap pertama", standard: "Diproses 4-8 potong per siklus; 5 kali serok-lipat, 1 kali press, lalu tap 1 kali.", evidence: 'observe' },
      { no: 8, gate: 'MAJOR', stage: "Pencelupan", parameter: "Air celup", standard: "Air layak minum bersuhu 1-4°C; diganti setelah 108 potong/4 basket besar/12 pack dan setiap ada jeda breading.", evidence: 'measure' },
      { no: 9, gate: 'MAJOR', stage: "Pencelupan", parameter: "Perendaman dan penirisan", standard: "Seluruh bagian ayam terendam, kemudian ditiriskan 10 detik tanpa digoyang sebelum breading kedua.", evidence: 'observe' },
      { no: 10, gate: 'MAJOR', stage: "Breading", parameter: "Breading tahap kedua", standard: "10 kali serok-lipat, 1 kali press, tap 2 kali; tepung diayak setiap selesai breading.", evidence: 'observe' },
      { no: 11, gate: 'MAJOR', stage: "Penggorengan", parameter: "Fryer yang digunakan", standard: "Menggunakan fryer yang ditetapkan untuk Ayam ORI/Crispy dan kondisi minyak layak.", evidence: 'observe' },
      { no: 12, gate: 'MAJOR', stage: "Penggorengan", parameter: "Waktu dan suhu fryer", standard: "Digoreng 12 menit pada 150°C sesuai WI; timer dan suhu tercatat.", evidence: 'measure' },
      { no: 13, gate: 'CONTROL', stage: "Penggorengan", parameter: "Shake basket", standard: "Pada menit ke-7 basket digoyang 3 kali ke arah depan-belakang untuk membantu kematangan dan coating merata.", evidence: 'visual' },
      { no: 14, gate: 'CONTROL', stage: "Pasca-goreng", parameter: "Penirisan dari fryer", standard: "Produk ditiriskan 10 detik setelah diangkat dari fryer.", evidence: 'observe' },
      { no: 15, gate: 'MAJOR', stage: "Minyak", parameter: "Filtering dan kondisi minyak", standard: "Filtering dilakukan maksimal setelah 5 basket besar atau 80 potong per fryer; minyak tidak berbau tengik, berbusa abnormal, atau mengandung banyak remah/benda asing.", evidence: 'visual' },
      { no: 16, gate: 'MAJOR', stage: "Bentuk SKU", parameter: "Bentuk potongan sesuai SKU", standard: "Sayap utuh dan proporsional. Paha Atas utuh, berisi, kulit rapi, serta sambungan dipatahkan tanpa merusak potongan. Paha Bawah utuh/memanjang dan pangkal berisi. Dada utuh dan proporsional. Semua SKU bebas tulang tajam.", evidence: 'visual' },
      { no: 17, gate: 'MAJOR', stage: "Produk matang", parameter: "Kondisi coating", standard: "Coating merata, melekat, renyah, bertekstur keriting, tidak botak, tidak menggumpal, dan tidak terlalu tebal.", evidence: 'visual' },
      { no: 18, gate: 'MAJOR', stage: "Produk matang", parameter: "Warna luar", standard: "Warna kuning keemasan sampai cokelat keemasan alami dan merata; bukan oranye seperti Ayam Saudi; tidak pucat, terlalu gelap, atau gosong.", evidence: 'visual' },
      { no: 19, gate: 'CRITICAL', stage: "Kematangan", parameter: "Suhu inti", standard: "Suhu bagian paling tebal minimal 74°C selama 10 detik.", evidence: 'measure' },
      { no: 20, gate: 'CRITICAL', stage: "Kematangan", parameter: "Kondisi bagian dalam", standard: "Daging matang sampai dekat tulang/sendi; warna daging putih-krem alami, tidak oranye, tidak merah muda/mentah, tidak ada cairan mentah, dan tidak menunjukkan kantong atau bekas cairan inject.", evidence: 'visual' },
      { no: 21, gate: 'MAJOR', stage: "Tekstur", parameter: "Keempukan dan kelembapan", standard: "Daging empuk dan juicy/moist; tidak kering, keras, berair abnormal, atau sangat berminyak. Coating tetap renyah saat disajikan.", evidence: 'visual' },
      { no: 22, gate: 'MAJOR', stage: "Rasa", parameter: "Rasa khas Ayam ORI/Crispy", standard: "Rasa asin-gurih seimbang, tidak pedas, dengan sensasi hangat lembut dari black pepper; tidak hambar, terlalu asin, pahit, atau menyerupai profil bumbu Saudi.", evidence: 'sensory' },
      { no: 23, gate: 'CRITICAL', stage: "Aroma", parameter: "Aroma produk matang", standard: "Aroma ayam goreng, tepung, dan black pepper bersih; tidak ada bau tepung mentah kuat, minyak tua/tengik, busuk, apek, atau kimia.", evidence: 'sensory' },
      { no: 24, gate: 'CONTROL', stage: "Holding", parameter: "Resting sebelum penyajian", standard: "Setelah goreng, rest minimal 5 menit untuk display warmer atau 10 menit untuk holding cabinet sebelum disajikan.", evidence: 'visual' },
      { no: 25, gate: 'CRITICAL', stage: "Holding", parameter: "Suhu dan batas waktu holding", standard: "Display warmer 65-70°C maksimal 90 menit dengan cek kualitas setelah 60 menit, atau holding cabinet 75-80°C maksimal 60 menit; bukti waktu lengkap.", evidence: 'measure' },
      { no: 26, gate: 'MAJOR', stage: "Holding", parameter: "Penataan dan identitas batch", standard: "Produk tidak dicampur antarbatch; ditata bone-down; label waktu terbaca dan produk lama tidak ditutup dengan batch baru.", evidence: 'measure' },
      { no: 27, gate: 'MAJOR', stage: "Penyajian", parameter: "Plating dan kemasan", standard: "Alat dan kemasan bersih serta utuh; penyajian sesuai jumlah pesanan; untuk takeaway dengan Nasi Kebuli, ayam ditempatkan terpisah dari nasi.", evidence: 'visual' },
    ],
  },
];

export function productById(id: string): ProductDef | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

/** Field pengukuran yang diminta ke inspector (angka), dipakai AI untuk item bertipe measure. */
export interface MeasureField {
  key: string;
  label: string;
  unit: string;
  hint: string;
  /** Nomor item checklist yang dibuktikan field ini. */
  items: number[];
}

export const MEASURE_FIELDS: Record<ProductId, MeasureField[]> = {
  kebuli: [
    { key: 'tempTop', label: 'Suhu bagian atas', unit: '°C', hint: 'standar > 60', items: [21] },
    { key: 'tempMid', label: 'Suhu bagian tengah', unit: '°C', hint: 'standar > 60', items: [22] },
    { key: 'tempBase', label: 'Suhu bagian dasar', unit: '°C', hint: 'standar > 60', items: [23] },
    { key: 'ageHours', label: 'Umur produk sejak matang', unit: 'jam', hint: 'maks 12 jam, hari yang sama', items: [24] },
    { key: 'portionWeight', label: 'Berat porsi normal', unit: 'g', hint: '175-185 g (setengah 90 g)', items: [25] },
    { key: 'restMinutes', label: 'Resting setelah matang', unit: 'menit', hint: 'standar 12 menit', items: [10] },
    { key: 'smokeStartMinutes', label: 'Pengasapan dimulai setelah matang', unit: 'menit', hint: 'maks 30 menit', items: [13] },
    { key: 'smokeMinutes', label: 'Lama pengasapan', unit: 'menit', hint: 'standar 15 menit', items: [13] },
    { key: 'waterMlPerLiter', label: 'Air per 1 liter beras', unit: 'ml', hint: 'standar 1.400 ml', items: [7] },
    { key: 'riceLiters', label: 'Beras per proses', unit: 'liter', hint: 'maks 5 (gas) / 3 (elektrik)', items: [8] },
  ],
  saudi: [
    { key: 'coreTemp', label: 'Suhu inti bagian paling tebal', unit: '°C', hint: 'min 74 selama 10 detik', items: [19] },
    { key: 'coreHoldSec', label: 'Durasi suhu inti bertahan', unit: 'detik', hint: 'min 10 detik', items: [19] },
    { key: 'fryMinutes', label: 'Lama goreng', unit: 'menit', hint: 'standar 12', items: [12] },
    { key: 'fryTemp', label: 'Suhu fryer', unit: '°C', hint: 'standar 150', items: [12] },
    { key: 'holdingTemp', label: 'Suhu holding', unit: '°C', hint: 'warmer 65-70 / cabinet 75-80', items: [25] },
    { key: 'holdingMinutes', label: 'Lama holding saat dicek', unit: 'menit', hint: 'warmer maks 90 / cabinet maks 60', items: [25] },
    { key: 'restMinutes', label: 'Resting setelah goreng', unit: 'menit', hint: 'min 5 (warmer) / 10 (cabinet)', items: [24] },
    { key: 'dipWaterTemp', label: 'Suhu air celup', unit: '°C', hint: '1-4', items: [8] },
    { key: 'filteringAfterBaskets', label: 'Filtering setelah', unit: 'basket besar', hint: 'maks 5 basket / 80 potong', items: [15] },
  ],
  ori: [
    { key: 'coreTemp', label: 'Suhu inti bagian paling tebal', unit: '°C', hint: 'min 74 selama 10 detik', items: [19] },
    { key: 'coreHoldSec', label: 'Durasi suhu inti bertahan', unit: 'detik', hint: 'min 10 detik', items: [19] },
    { key: 'fryMinutes', label: 'Lama goreng', unit: 'menit', hint: 'standar 12', items: [12] },
    { key: 'fryTemp', label: 'Suhu fryer', unit: '°C', hint: 'standar 150', items: [12] },
    { key: 'holdingTemp', label: 'Suhu holding', unit: '°C', hint: 'warmer 65-70 / cabinet 75-80', items: [25] },
    { key: 'holdingMinutes', label: 'Lama holding saat dicek', unit: 'menit', hint: 'warmer maks 90 / cabinet maks 60', items: [25] },
    { key: 'restMinutes', label: 'Resting setelah goreng', unit: 'menit', hint: 'min 5 (warmer) / 10 (cabinet)', items: [24] },
    { key: 'dipWaterTemp', label: 'Suhu air celup', unit: '°C', hint: '1-4', items: [8] },
    { key: 'filteringAfterBaskets', label: 'Filtering setelah', unit: 'basket besar', hint: 'maks 5 basket / 80 potong', items: [15] },
  ],
};

/** Saran foto per produk (label slot). */
export const PHOTO_SLOTS: Record<ProductId, string[]> = {
  kebuli: ['Porsi/plating dari atas', 'Close-up butir & warna', 'Bagian tengah/dasar wadah', 'Label waktu & holding', 'Alat/wadah & area', 'Termometer/timbangan'],
  saudi: ['Potongan utuh (coating & warna)', 'Potongan dibelah (bagian dalam)', 'Display/holding & label', 'Fryer & minyak', 'Area breading/zoning', 'Termometer inti'],
  ori: ['Potongan utuh (coating & warna)', 'Potongan dibelah (bagian dalam)', 'Display/holding & label', 'Fryer & minyak', 'Area breading/zoning', 'Termometer inti'],
};

export type Verdict = 'ya' | 'tidak' | 'na';

export interface CheckSummary {
  ya: number;
  tidak: number;
  na: number;
  unanswered: number;
  score: number | null; // persen
  criticalNg: number;
  majorNg: number;
  controlNg: number;
  decision: CheckDecision;
}

export type CheckDecision = 'BELUM DINILAI' | 'HOLD - TIDAK AMAN' | 'JANGAN DISAJIKAN' | 'BELUM LENGKAP' | 'TIDAK ADA ITEM DIAUDIT' | 'BOLEH DISAJIKAN - CATAT DEVIASI' | 'BOLEH DISAJIKAN';

/** Logika persis mengikuti formula Excel baris Keputusan (F14). */
export function summarizeCheck(items: { gate: Gate; final: Verdict | null }[]): CheckSummary {
  const answered = items.filter((i) => i.final !== null);
  const ya = answered.filter((i) => i.final === 'ya').length;
  const tidak = answered.filter((i) => i.final === 'tidak').length;
  const na = answered.filter((i) => i.final === 'na').length;
  const criticalNg = items.filter((i) => i.gate === 'CRITICAL' && i.final === 'tidak').length;
  const majorNg = items.filter((i) => i.gate === 'MAJOR' && i.final === 'tidak').length;
  const controlNg = items.filter((i) => i.gate === 'CONTROL' && i.final === 'tidak').length;
  const complete = answered.length === items.length;
  const score = complete && ya + tidak > 0 ? Math.round((ya / (ya + tidak)) * 1000) / 10 : null;
  let decision: CheckDecision;
  if (answered.length === 0) decision = 'BELUM DINILAI';
  else if (criticalNg > 0) decision = 'HOLD - TIDAK AMAN';
  else if (majorNg > 0) decision = 'JANGAN DISAJIKAN';
  else if (!complete) decision = 'BELUM LENGKAP';
  else if (ya + tidak === 0) decision = 'TIDAK ADA ITEM DIAUDIT';
  else if (controlNg > 0) decision = 'BOLEH DISAJIKAN - CATAT DEVIASI';
  else decision = 'BOLEH DISAJIKAN';
  return { ya, tidak, na, unanswered: items.length - answered.length, score, criticalNg, majorNg, controlNg, decision };
}

export type MonthlyStatus = 'BELUM DINILAI' | 'ADA KEGAGALAN CRITICAL' | 'ADA KEGAGALAN MAJOR' | 'BELUM 4 KALI' | 'TIDAK ADA ITEM DIAUDIT' | 'MEMENUHI DENGAN CATATAN' | 'MEMENUHI';

/** Status bulanan per produk (formula K12): berdasarkan sampai 4 pemeriksaan submitted di bulan itu. */
export function monthlyStatus(checks: CheckSummary[]): { status: MonthlyStatus; avg: number | null; done: number; totalTidak: number; totalNa: number; criticalNg: number; majorNg: number } {
  const slots = [...checks.slice(0, 4)];
  while (slots.length < 4) slots.push({ ya: 0, tidak: 0, na: 0, unanswered: 0, score: null, criticalNg: 0, majorNg: 0, controlNg: 0, decision: 'BELUM DINILAI' });
  const belum = slots.filter((s) => s.decision === 'BELUM DINILAI').length;
  const lengkap = slots.filter((s) => s.decision === 'BELUM LENGKAP').length;
  const criticalNg = slots.reduce((s, c) => s + c.criticalNg, 0);
  const majorNg = slots.reduce((s, c) => s + c.majorNg, 0);
  const scored = slots.filter((s) => s.score !== null);
  const avg = scored.length ? Math.round((scored.reduce((s, c) => s + (c.score ?? 0), 0) / scored.length) * 10) / 10 : null;
  let status: MonthlyStatus;
  if (belum === 4) status = 'BELUM DINILAI';
  else if (criticalNg > 0) status = 'ADA KEGAGALAN CRITICAL';
  else if (majorNg > 0) status = 'ADA KEGAGALAN MAJOR';
  else if (belum > 0 || lengkap > 0) status = 'BELUM 4 KALI';
  else if (slots.filter((s) => s.decision === 'TIDAK ADA ITEM DIAUDIT').length === 4) status = 'TIDAK ADA ITEM DIAUDIT';
  else if (slots.some((s) => s.decision === 'BOLEH DISAJIKAN - CATAT DEVIASI')) status = 'MEMENUHI DENGAN CATATAN';
  else status = 'MEMENUHI';
  return { status, avg, done: 4 - belum - lengkap, totalTidak: slots.reduce((s, c) => s + c.tidak, 0), totalNa: slots.reduce((s, c) => s + c.na, 0), criticalNg, majorNg };
}

export const DECISION_COLOR: Record<string, string> = {
  'BOLEH DISAJIKAN': '#008300',
  MEMENUHI: '#008300',
  'BOLEH DISAJIKAN - CATAT DEVIASI': '#2a78d6',
  'MEMENUHI DENGAN CATATAN': '#2a78d6',
  'JANGAN DISAJIKAN': '#eda100',
  'ADA KEGAGALAN MAJOR': '#eda100',
  'HOLD - TIDAK AMAN': '#e34948',
  'ADA KEGAGALAN CRITICAL': '#e34948',
  'BELUM LENGKAP': '#9a9994',
  'BELUM 4 KALI': '#9a9994',
  'BELUM DINILAI': '#9a9994',
  'TIDAK ADA ITEM DIAUDIT': '#9a9994',
};
