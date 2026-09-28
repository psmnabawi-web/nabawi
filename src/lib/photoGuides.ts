/**
 * Panduan foto per indikator: apa yang harus masuk frame agar AI bisa menilai seluruh area.
 * Kunci = indicator id (IND-xx). Area yang mirip memakai template yang sama.
 */
export interface PhotoGuide {
  /** Persiapan sebelum memotret (singkirkan barang, pasang kembali unit, nyalakan lampu). */
  prep: string;
  /** Posisi & jarak kamera. */
  position: string;
  /** Bagian yang WAJIB terlihat. Foto 1 = keseluruhan; foto 2-3 = detail. */
  must: string[];
  /** Kesalahan yang paling sering membuat skor turun. */
  avoid: string[];
}

const T = {
  hood: {
    prep: 'Matikan kompor. Lap sekali lagi bagian tepi dan sambungan hood 5 menit sebelum foto agar tidak ada kilap minyak baru.',
    position: 'Foto 1: berdiri 1,5 m di depan hood, kamera setinggi dada, seluruh hood dari ujung ke ujung masuk frame. Foto 2: dekat 30-40 cm ke sambungan/sudut dan tepi bawah. Foto 3: filter/flame guard dari bawah.',
    must: ['Seluruh permukaan depan hood', 'Sambungan panel dan sudut', 'Tepi bawah hood tempat lemak menggantung', 'Filter/kisi dari bawah'],
    avoid: ['Foto dari samping sehingga sebagian hood tidak terlihat', 'Lampu hood mati sehingga lemak tampak seperti bayangan', 'Zoom ke bagian tengah yang bersih saja'],
  },
  fan: {
    prep: 'Matikan kipas agar baling-baling diam dan tidak blur. Nyalakan lampu ruangan.',
    position: 'Foto 1: 1 m dari depan kipas, seluruh kipas termasuk cover dan tiang. Foto 2: dekat 30 cm ke kisi/cover depan dan baling-baling.',
    must: ['Cover/kisi depan', 'Baling-baling', 'Bagian belakang motor', 'Tiang/kaki dan kabel'],
    avoid: ['Kipas masih berputar (blur)', 'Foto dari jauh sehingga debu di kisi tidak terlihat'],
  },
  wall: {
    prep: 'Singkirkan barang yang menempel/menutupi dinding. Lepas bekas selotip/double tape. Nyalakan semua lampu.',
    position: 'Foto 1: 1,5-2 m dari dinding, tegak lurus, dari lantai sampai plafon. Foto 2: dekat 40 cm ke bagian yang sering kena cipratan (belakang alat, dekat sink, sudut).',
    must: ['Dinding dari bawah sampai atas', 'Sudut pertemuan dinding', 'Area belakang peralatan', 'Nat keramik bila keramik'],
    avoid: ['Foto miring sehingga sebagian dinding terpotong', 'Barang menutupi dinding', 'Cahaya dari belakang (backlight) membuat dinding gelap'],
  },
  greaseTrap: {
    prep: 'Bersihkan unit, pasang kembali di posisi operasional, pasang penutup, dan keringkan/pel lantai sekitar. Jangan foto unit di lantai dalam kondisi terlepas.',
    position: 'Foto 1: unit terpasang di bawah sink beserta lantai sekitarnya, jarak 1 m. Foto 2: penutup dibuka, bagian dalam trap dari atas dengan senter/flash. Foto 3: sambungan pipa masuk dan keluar.',
    must: ['Unit terpasang dan tertutup', 'Bagian dalam trap (tutup dibuka)', 'Sambungan pipa inlet/outlet', 'Lantai di sekitar unit kering dan bersih'],
    avoid: ['Unit dilepas dan diletakkan di lantai basah', 'Genangan air sabun di sekitar', 'Foto gelap tanpa flash untuk bagian dalam'],
  },
  equipment: {
    prep: 'Matikan alat dan tunggu dingin. Lap permukaan, handle, dan kabel. Singkirkan barang di atas/sekitar alat.',
    position: 'Foto 1: 1 m dari depan, seluruh alat termasuk kaki/roda. Foto 2: dekat ke area kontak makanan/rak/pintu dibuka. Foto 3: samping dan bawah alat.',
    must: ['Seluruh sisi depan alat', 'Bagian dalam/rak dengan pintu dibuka', 'Handle, engsel, tombol', 'Kaki/roda dan lantai di bawah alat'],
    avoid: ['Pintu tertutup sehingga bagian dalam tidak terlihat', 'Barang menutupi alat', 'Hanya foto bagian atas'],
  },
  legs: {
    prep: 'Geser barang di lantai agar kaki meja dan roda terlihat. Pel lantai di bawahnya dulu.',
    position: 'Jongkok, kamera setinggi lutut, jarak 60-80 cm. Foto 1: deretan kaki/roda satu meja. Foto 2: dekat ke satu roda beserta sela-selanya.',
    must: ['Semua kaki/roda dalam satu sisi', 'Sela roda dan poros', 'Lantai di bawah roda', 'Bagian bawah rangka meja'],
    avoid: ['Foto dari atas (berdiri) sehingga roda tidak terlihat', 'Barang menutupi kaki meja'],
  },
  fryer: {
    prep: 'Matikan api/listrik, tunggu dingin. Lap body, sela panel, dan dinding belakang. Tarik alat sedikit jika bisa untuk memotret belakang.',
    position: 'Foto 1: 1 m dari depan, seluruh alat termasuk lantai di bawah. Foto 2: dekat ke sela antar alat dan sisi samping. Foto 3: kolong/bawah dan belakang.',
    must: ['Body depan dan panel kontrol', 'Sela antar alat', 'Kolong dan lantai di bawah', 'Dinding belakang alat'],
    avoid: ['Alat masih panas dan berminyak baru dipakai', 'Hanya foto tampak depan tanpa sela/kolong'],
  },
  poster: {
    prep: 'Lap akrilik/kaca dengan lap kering microfiber. Pastikan poster lurus.',
    position: 'Foto tegak lurus dari 1 m, tanpa pantulan lampu. Miringkan sedikit posisi berdiri jika ada pantulan. Foto 2: dekat ke sudut dan bingkai.',
    must: ['Seluruh poster dan bingkainya', 'Sudut dan tepi akrilik', 'Permukaan tanpa pantulan yang menutupi'],
    avoid: ['Pantulan lampu atau bayangan HP di akrilik', 'Foto miring sehingga terlihat kusam'],
  },
  menuBoard: {
    prep: 'Nyalakan lampu menu board. Lap permukaan dan tepi.',
    position: 'Foto 1: dari kasir menghadap board, 2 m, seluruh panel masuk frame. Foto 2: dekat ke tepi/bingkai dan sudut.',
    must: ['Seluruh panel menu', 'Lampu menyala merata', 'Tepi dan bingkai', 'Sudut atas yang sering berdebu'],
    avoid: ['Lampu board mati', 'Foto terlalu jauh sehingga debu tidak terlihat'],
  },
  floor: {
    prep: 'Sapu dan pel dulu, tunggu kering. Geser kursi/barang agar lantai terlihat termasuk sudut dan bawah furniture.',
    position: 'Foto 1: berdiri, kamera 45° ke bawah, jarak 2 m, area lantai selebar mungkin. Foto 2: jongkok, dekat 50 cm ke nat, sudut, dan bawah furniture.',
    must: ['Permukaan lantai luas', 'Nat/celah keramik', 'Sudut dan tepi dinding', 'Bawah kursi/meja/equipment'],
    avoid: ['Lantai masih basah/genangan', 'Hanya foto bagian tengah yang bersih', 'Bayangan orang di lantai'],
  },
  shelf: {
    prep: 'Rapikan barang, singkirkan yang tidak perlu. Lap permukaan rak dan tepi.',
    position: 'Foto 1: 1 m dari depan rak, seluruh rak dari atas ke bawah. Foto 2: dekat ke satu tingkat rak, permukaan dan sudut belakang.',
    must: ['Seluruh tingkat rak', 'Permukaan rak yang kosong terlihat', 'Sudut belakang rak', 'Barang tersusun rapi tidak berlebihan'],
    avoid: ['Rak penuh sehingga permukaan tidak terlihat', 'Foto miring dari samping'],
  },
  baseboard: {
    prep: 'Geser barang yang menempel dinding. Lap baseboard sepanjang area.',
    position: 'Jongkok, kamera setinggi baseboard, jarak 60 cm, arah menyusur dinding agar 2-3 m baseboard terlihat. Foto 2: dekat ke sudut ruangan.',
    must: ['Baseboard sepanjang minimal 2 m', 'Sudut ruangan', 'Pertemuan baseboard dengan lantai', 'Area di belakang barang'],
    avoid: ['Foto dari atas sehingga baseboard hanya garis tipis', 'Barang menutupi baseboard'],
  },
  glass: {
    prep: 'Lap kaca dua sisi dengan lap kering, lepas stiker/residu lem. Foto saat matahari tidak langsung menyilaukan.',
    position: 'Foto 1: 2 m dari kaca, agak miring 20° agar noda dan sidik jari terlihat, satu panel penuh dari frame ke frame. Foto 2: dekat ke frame bawah dan sudut.',
    must: ['Satu panel kaca penuh', 'Frame dan sudut', 'Bagian bawah kaca dekat lantai', 'Tidak ada stiker/residu'],
    avoid: ['Foto tegak lurus dengan backlight kuat sehingga noda tidak terlihat', 'Hanya foto sebagian panel'],
  },
  sign: {
    prep: 'Nyalakan lampu sign. Foto saat mulai gelap agar lampu terlihat, atau siang untuk debu.',
    position: 'Foto 1: dari depan, 3-5 m, seluruh huruf/logo masuk frame. Foto 2: dekat (jika bisa) ke bagian bawah huruf dan bracket.',
    must: ['Seluruh huruf/logo', 'Semua lampu menyala', 'Bagian bawah dan bracket', 'Tidak ada retak/lepas'],
    avoid: ['Lampu mati saat foto', 'Foto terlalu jauh sehingga debu tidak terlihat'],
  },
  toilet: {
    prep: 'Bersihkan closet, wastafel, lantai, keringkan lantai. Isi sabun dan tisu. Buka pintu agar cahaya masuk.',
    position: 'Foto 1: dari pintu, seluruh ruang (closet, lantai, dinding). Foto 2: dekat ke closet dalam dan dudukan. Foto 3: wastafel, keran, floor drain, sabun/tisu.',
    must: ['Closet bagian dalam dan luar', 'Lantai dan floor drain kering', 'Wastafel dan keran', 'Sabun dan tisu tersedia', 'Dinding dan pintu'],
    avoid: ['Foto hanya closet dari jauh', 'Lantai basah', 'Tisu/sabun tidak terlihat'],
  },
  airCurtain: {
    prep: 'Lap setiap lembar curtain dua sisi. Rapikan agar tidak terlipat.',
    position: 'Foto 1: 1,5 m dari depan pintu, seluruh lembaran curtain dari atas sampai bawah. Foto 2: dekat ke bagian bawah lembaran dan rel atas.',
    must: ['Seluruh lembaran', 'Bagian bawah lembaran (paling kotor)', 'Rel/dudukan atas', 'Tidak ada yang sobek'],
    avoid: ['Backlight dari luar pintu membuat curtain gelap', 'Hanya foto bagian atas'],
  },
  ac: {
    prep: 'Matikan AC. Lap cover dan kisi. Buka tutup filter jika memungkinkan.',
    position: 'Foto 1: dari bawah depan, 1,5 m, seluruh unit indoor. Foto 2: dekat ke kisi/louvre dan filter (tutup dibuka).',
    must: ['Cover depan', 'Kisi/louvre keluar udara', 'Filter (jika bisa dibuka)', 'Dinding di sekitar unit'],
    avoid: ['Foto dari jauh sehingga debu kisi tidak terlihat', 'AC menyala dan louvre bergerak'],
  },
  dustbin: {
    prep: 'Kosongkan, cuci dalam dan luar, pasang kantong baru, keringkan.',
    position: 'Foto 1: 1 m, seluruh dustbin dan lantai sekitar. Foto 2: dari atas ke dalam dengan tutup dibuka. Foto 3: bagian luar bawah dan roda.',
    must: ['Bagian luar semua sisi', 'Bagian dalam (tutup dibuka)', 'Tutup dan engsel', 'Lantai di bawah/sekitar'],
    avoid: ['Tutup tertutup sehingga bagian dalam tidak terlihat', 'Masih ada sampah di dalam'],
  },
  chair: {
    prep: 'Lap dudukan, sandaran, sela, dan kaki. Geser meja agar kaki terlihat.',
    position: 'Foto 1: 1 m, satu set meja-kursi termasuk kaki. Foto 2: jongkok, dekat ke kaki dan sela dudukan-sandaran.',
    must: ['Dudukan dan sandaran', 'Sela antara dudukan dan sandaran', 'Kaki kursi dan meja', 'Bawah meja'],
    avoid: ['Foto dari atas sehingga kaki tidak terlihat', 'Kursi masih tertumpuk'],
  },
  carpet: {
    prep: 'Vacuum/sapu seluruh karpet, angkat mainan.',
    position: 'Foto 1: dari sudut ruang, seluruh karpet, 45° ke bawah. Foto 2: dekat 40 cm ke serat karpet dan tepi/sambungan.',
    must: ['Seluruh karpet', 'Tepi dan sambungan', 'Serat karpet dari dekat', 'Tidak ada bagian robek'],
    avoid: ['Mainan menutupi karpet', 'Hanya foto dari jauh'],
  },
  pole: {
    prep: 'Lap tiang dari atas sampai alas. Lepas bekas selotip balon.',
    position: 'Foto 1: 1 m, seluruh tiang dari alas sampai ujung. Foto 2: dekat ke alas dan sambungan.',
    must: ['Seluruh tiang', 'Alas/kaki tiang', 'Sambungan', 'Tidak ada bekas lem'],
    avoid: ['Hanya foto bagian atas'],
  },
  sofa: {
    prep: 'Angkat bantal, vacuum sela, lap sandaran dan kaki. Geser meja agar kaki sofa terlihat.',
    position: 'Foto 1: 1,5 m, seluruh sofa termasuk kaki. Foto 2: dekat ke sela dudukan-sandaran dan tepi bawah.',
    must: ['Dudukan dan sandaran', 'Sela dudukan', 'Tepi bawah dan kaki', 'Lantai di bawah sofa'],
    avoid: ['Bantal/barang menutupi dudukan', 'Foto dari jauh saja'],
  },
  trim: {
    prep: 'Lap lis tembok sepanjang area. Lepas bekas selotip.',
    position: 'Kamera setinggi lis, jarak 60 cm, menyusur dinding agar 2-3 m lis terlihat. Foto 2: dekat ke sudut.',
    must: ['Lis sepanjang minimal 2 m', 'Sudut', 'Bagian atas lis tempat debu menumpuk'],
    avoid: ['Foto dari jauh sehingga debu tidak terlihat'],
  },
  terrace: {
    prep: 'Sikat/scrub dan bilas lantai teras, keringkan, singkirkan barang.',
    position: 'Foto 1: dari tepi teras, 45° ke bawah, seluruh teras. Foto 2: jongkok dekat ke nat, sudut, dan bawah furniture.',
    must: ['Seluruh teras', 'Nat dan sudut', 'Bawah furniture/equipment', 'Tidak ada genangan'],
    avoid: ['Lantai basah/genangan', 'Hanya foto sebagian'],
  },
  babyChair: {
    prep: 'Cuci/lap dudukan, tray, sela, dan kaki. Lap traffic cone.',
    position: 'Foto 1: 1 m, semua baby chair dan cone berjajar. Foto 2: dekat ke dudukan, tray, dan sela.',
    must: ['Dudukan dan tray', 'Sela dan sabuk', 'Kaki', 'Traffic cone seluruh sisi'],
    avoid: ['Baby chair tertumpuk/terlipat', 'Foto dari jauh'],
  },
  mushola: {
    prep: 'Sapu/pel area, rapikan sajadah dan mukena, bersihkan keran dan drain, keringkan lantai wudhu.',
    position: 'Foto 1: dari pintu, seluruh ruang salat. Foto 2: rak/sajadah dan mukena dari dekat. Foto 3: area wudhu: keran, dinding, drain, lantai.',
    must: ['Lantai/sajadah', 'Rak dan perlengkapan', 'Keran dan drain wudhu', 'Lantai wudhu kering'],
    avoid: ['Lantai wudhu basah/genangan', 'Hanya foto ruang salat tanpa area wudhu'],
  },
  sink: {
    prep: 'Sikat wastafel, keran, dan area sekitar. Isi sabun dan tisu. Keringkan.',
    position: 'Foto 1: 1 m, wastafel beserta dinding, cermin, dispenser sabun dan tisu. Foto 2: dekat ke keran, drain, dan celah wastafel-dinding.',
    must: ['Mangkuk wastafel dan drain', 'Keran dan pangkalnya', 'Sabun dan tisu terisi', 'Dinding/cermin sekitar', 'Kolong wastafel'],
    avoid: ['Sabun/tisu tidak terlihat', 'Hanya foto mangkuk'],
  },
  chillerFilter: {
    prep: 'Lepas filter/kisi, cuci, keringkan, pasang kembali.',
    position: 'Foto 1: kisi terpasang dari 50 cm. Foto 2: filter dilepas, difoto di tangan/di atas lap bersih dengan cahaya cukup.',
    must: ['Kisi/filter terpasang', 'Filter dari dekat (dilepas) dua sisi', 'Dudukan filter'],
    avoid: ['Foto filter dari jauh', 'Filter belum dipasang kembali di foto 1'],
  },
  chiller: {
    prep: 'Rapikan produk, lap rak, dinding dalam, gasket, dan handle. Buang tumpahan.',
    position: 'Foto 1: pintu dibuka, 1 m, seluruh isi rak dari atas ke bawah. Foto 2: dekat ke gasket pintu dan handle. Foto 3: dinding dalam dan dasar chiller.',
    must: ['Rak dan produk tersusun', 'Gasket pintu (seluruh keliling)', 'Handle dan pintu luar', 'Dinding dalam dan dasar', 'Tidak ada tumpahan/bunga es'],
    avoid: ['Pintu tertutup', 'Hanya foto rak tanpa gasket', 'Foto gelap di dalam'],
  },
  basket: {
    prep: 'Cuci keranjang, bilas, tiriskan sampai tidak ada darah/lendir. Susun kembali.',
    position: 'Foto 1: keranjang tersusun di chiller, 1 m. Foto 2: dekat ke dasar keranjang dan sela anyaman.',
    must: ['Semua keranjang', 'Dasar keranjang (tidak ada darah menggenang)', 'Sela anyaman', 'Tidak ada retak'],
    avoid: ['Keranjang masih terisi penuh sehingga dasar tidak terlihat'],
  },
  dryStock: {
    prep: 'Rapikan barang, angkat dari lantai, sapu/pel lantai dan kolong rak, pastikan label menghadap depan.',
    position: 'Foto 1: dari pintu, seluruh area termasuk lantai. Foto 2: jongkok, kolong rak dan sudut lantai. Foto 3: satu rak dari dekat dengan label.',
    must: ['Lantai dan kolong rak', 'Sudut ruangan', 'Barang tidak menyentuh lantai', 'Rak dan label', 'Tidak ada tanda hama'],
    avoid: ['Hanya foto rak tanpa lantai/kolong', 'Barang menutupi sudut'],
  },
  freezer: {
    prep: 'Defrost jika ada bunga es tebal, keluarkan produk sebentar, lap dinding dalam, gasket, dan pintu.',
    position: 'Foto 1: pintu dibuka lebar, 1 m, seluruh bagian dalam. Foto 2: dekat ke dinding dalam dan dasar. Foto 3: gasket pintu keliling dan handle luar.',
    must: ['Dinding dalam dan dasar tanpa bunga es tebal', 'Gasket pintu seluruh keliling', 'Pintu dan handle luar', 'Rak/keranjang dalam'],
    avoid: ['Produk memenuhi frame sehingga dinding tidak terlihat', 'Pintu tertutup', 'Foto gelap'],
  },
  outdoorAc: {
    prep: 'Sikat kisi outdoor dengan lembut, lap cover, bersihkan sekitar unit.',
    position: 'Foto 1: 1,5 m, seluruh unit outdoor beserta bracket. Foto 2: dekat ke kisi belakang/samping dan bawah unit.',
    must: ['Cover dan kisi', 'Bracket/dudukan', 'Bagian bawah unit', 'Area sekitar bebas sampah/daun'],
    avoid: ['Foto dari jauh saja', 'Kisi belakang tidak terlihat'],
  },
  tps: {
    prep: 'Keluarkan sampah, sapu/pel lantai, susun barang berlabel di rak, tidak ada barang di lantai.',
    position: 'Foto 1: dari pintu, seluruh area termasuk lantai dan dinding. Foto 2: jongkok ke sudut lantai dan kolong.',
    must: ['Lantai bersih tanpa barang', 'Sudut', 'Barang berlabel di rak', 'Tidak ada tanda hama'],
    avoid: ['Foto sebagian saja'],
  },
  dumpster: {
    prep: 'Buang sampah, cuci bin dan lantai, keringkan, tutup bin.',
    position: 'Foto 1: 2 m, seluruh area dumpster: bin, lantai, dinding, saluran. Foto 2: dekat ke lantai dan sekitar roda bin. Foto 3: bagian dalam bin dengan tutup dibuka.',
    must: ['Semua bin tertutup', 'Lantai kering tanpa ceceran', 'Sekitar roda/bawah bin', 'Saluran air di area'],
    avoid: ['Genangan', 'Sampah tercecer', 'Foto dari jauh sekali'],
  },
  gasRoom: {
    prep: 'Sapu lantai, singkirkan barang mudah terbakar, pastikan akses tidak terhalang.',
    position: 'Foto 1: dari pintu, seluruh ruang termasuk tabung dan lantai. Foto 2: sudut lantai dan bawah tabung.',
    must: ['Lantai termasuk sudut dan bawah tabung', 'Tabung dan regulator', 'Ventilasi', 'Akses tidak terhalang'],
    avoid: ['Barang menutupi lantai', 'Hanya foto tabung'],
  },
  janitor: {
    prep: 'Cuci dan gantung mop/alat, keringkan lantai, susun chemical berlabel.',
    position: 'Foto 1: dari pintu, seluruh area: gantungan alat, rak chemical, lantai. Foto 2: dekat ke lantai dan drain.',
    must: ['Alat tergantung', 'Mop tidak di lantai', 'Chemical berlabel di rak', 'Lantai kering dan drain bersih'],
    avoid: ['Mop basah di lantai', 'Genangan'],
  },
  grating: {
    prep: 'Angkat grating, bersihkan saluran, pasang kembali.',
    position: 'Foto 1: dari atas, grating terpasang beserta lantai sekitar, 1 m. Foto 2: grating diangkat, saluran di bawahnya dengan flash. Foto 3: grating bagian bawah.',
    must: ['Grating terpasang', 'Saluran di bawah grating (dibuka)', 'Bagian bawah grating', 'Aliran tidak tersumbat'],
    avoid: ['Hanya foto grating dari atas tanpa membuka', 'Foto gelap'],
  },
  managerDesk: {
    prep: 'Rapikan kabel, angkat barang dari lantai kolong, sapu/pel kolong.',
    position: 'Jongkok, kamera setinggi lutut, 80 cm, seluruh kolong meja dari sisi depan. Foto 2: sudut kolong dan kabel.',
    must: ['Lantai kolong', 'Kabel tertata', 'Sudut kolong', 'Tidak ada barang/sampah'],
    avoid: ['Foto dari atas meja', 'Kursi menutupi kolong'],
  },
  access: {
    prep: 'Sapu area akses, singkirkan barang/kendaraan yang menghalangi, lap rambu.',
    position: 'Foto 1: dari jalan, 5 m, rambu masuk/keluar dan area akses. Foto 2: dekat ke rambu dan permukaan jalan akses.',
    must: ['Rambu masuk dan keluar', 'Area akses tanpa halangan', 'Permukaan jalan bebas sampah'],
    avoid: ['Kendaraan menghalangi', 'Foto terlalu jauh'],
  },
  parking: {
    prep: 'Sapu area parkir, buang sampah, bersihkan genangan, lap rambu.',
    position: 'Foto 1: dari sudut area, 5-8 m, seluruh area parkir termasuk marka dan rambu. Foto 2: dekat ke rambu dan permukaan yang rusak/berlubang jika ada.',
    must: ['Seluruh area parkir', 'Marka parkir', 'Rambu', 'Permukaan tanpa lubang/genangan/sampah'],
    avoid: ['Kendaraan menutupi marka', 'Foto sebagian'],
  },
} satisfies Record<string, PhotoGuide>;

const MAP: Record<string, PhotoGuide> = {
  'IND-01': T.hood, 'IND-02': T.fan, 'IND-03': T.wall, 'IND-04': T.greaseTrap, 'IND-05': T.equipment, 'IND-06': T.equipment, 'IND-07': T.legs, 'IND-08': T.fryer, 'IND-09': T.wall, 'IND-10': T.hood, 'IND-11': T.equipment,
  'IND-12': T.poster, 'IND-13': T.menuBoard, 'IND-14': T.wall, 'IND-15': T.floor, 'IND-16': T.shelf, 'IND-17': T.baseboard,
  'IND-18': T.glass, 'IND-19': T.fan, 'IND-20': T.sign, 'IND-21': T.toilet, 'IND-22': T.airCurtain, 'IND-23': T.ac, 'IND-24': T.dustbin, 'IND-25': T.glass, 'IND-26': T.chair, 'IND-27': T.carpet, 'IND-28': T.pole, 'IND-29': T.baseboard, 'IND-30': T.baseboard, 'IND-31': T.sofa, 'IND-32': T.poster, 'IND-33': T.trim, 'IND-34': T.terrace, 'IND-35': T.babyChair, 'IND-36': T.floor, 'IND-37': T.mushola, 'IND-38': T.sink,
  'IND-39': T.chillerFilter, 'IND-40': T.chiller, 'IND-41': T.basket, 'IND-42': T.dryStock, 'IND-43': T.dryStock, 'IND-44': T.chiller, 'IND-45': T.freezer,
  'IND-46': T.outdoorAc, 'IND-47': T.tps, 'IND-48': T.dumpster, 'IND-49': T.gasRoom, 'IND-50': T.janitor, 'IND-51': T.grating, 'IND-52': T.greaseTrap, 'IND-53': T.managerDesk,
  'IND-54': T.sign, 'IND-55': T.access, 'IND-56': T.parking, 'IND-57': T.parking,
};

export const GENERIC_GUIDE: PhotoGuide = {
  prep: 'Bersihkan dulu, singkirkan barang yang menutupi, nyalakan lampu.',
  position: 'Foto 1: seluruh area dari 1-2 m. Foto 2: detail sudut/sambungan dari 30-50 cm.',
  must: ['Seluruh area dalam satu frame', 'Sudut, sambungan, dan bagian bawah', 'Bagian yang disebut AI sebagai tersembunyi'],
  avoid: ['Buram, gelap, backlight', 'Zoom ke bagian bersih saja'],
};

export function photoGuideFor(indicatorId: string): PhotoGuide {
  return MAP[indicatorId] ?? GENERIC_GUIDE;
}

/** Ringkasan bagian wajib untuk dikirim ke AI sebagai konteks penilaian cakupan. */
export function mustSeeText(indicatorId: string): string {
  return photoGuideFor(indicatorId).must.join('; ');
}
