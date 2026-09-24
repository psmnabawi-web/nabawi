/**
 * Deterministic offline provider for local development, emulator demos and automated tests.
 * Enabled only when AI_PROVIDER=mock or an admin selects "mock" in Settings. Output is clearly
 * labelled as demo content.
 */

const pick = (arr, i) => arr[i % arr.length];

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function mockTrend(ctx) {
  const key = `${ctx.source?.keyword ?? ''}${ctx.source?.url ?? ''}`;
  const h = hash(key);
  const names = ['Before After Rumah Minimalis', 'Minimalist Beige House Color', 'Cat Anti Bocor Musim Hujan', 'Warna Earth Tone Ruang Tamu', 'DIY Cat Kamar Aesthetic'];
  const trendName = pick(names, h);
  return {
    trendName,
    trendScore: 70 + (h % 26),
    growthLevel: pick(['Viral', 'Rising', 'Rising', 'Stable'], h),
    viralPattern: '[DEMO] Format transformasi: kondisi awal kusam → proses mengecat cepat (time-lapse) → reveal hasil akhir dengan musik naik.',
    audienceEmotion: '[DEMO] Puas (satisfying), aspiratif (rumah terlihat lebih mahal), rasa ingin mencoba sendiri.',
    contentPattern: '[DEMO] Hook masalah 0-3 detik → proses 3 langkah → reveal → ajakan konsultasi warna.',
    hookAnalysis: '[DEMO] Visual rumah kusam + teks "Rumah 10 tahun jadi kayak baru?" menghentikan scroll karena kontras sebelum-sesudah.',
    visualStyle: '[DEMO] Vertikal 9:16, time-lapse roller, close-up tekstur cat, color grading hangat, musik trending.',
    marketingOpportunity: '[DEMO] Toko cat dapat membuat seri transformasi rumah pelanggan dengan rekomendasi kombinasi warna dan layanan tinting.',
    recommendation: 'Create before-after transformation video',
    suggestedFormats: ['Short video', 'Carousel before-after', 'Story polling warna'],
    keywords: ['#catrumah', '#rumahminimalis', '#beforeafter', '#renovasirumah', '#inspirasiwarna'],
    confidence: 'low',
    rationale: `[DEMO] Hasil mock provider untuk "${trendName}". Hubungkan Gemini/OpenAI/Claude untuk analisa nyata.`,
  };
}

function mockIdeas(ctx) {
  const count = ctx.input?.count ?? 20;
  const product = ctx.input?.product ?? 'Interior paint';
  const audience = ctx.input?.audience ?? 'Home owner';
  const seeds = [
    ['5 Warna Cat Membuat Rumah Lebih Mahal', 'Rumah kamu kelihatan murah? Mungkin salah warna.', 'Tampilkan 5 kombinasi warna fasad dan interior yang memberi kesan premium, masing-masing dengan contoh before-after.'],
    ['Before After Rumah Minimalis 1 Hari', 'Cuma 1 hari, rumah ini berubah total.', 'Time-lapse pengecatan fasad rumah minimalis dari kusam ke beige hangat.'],
    ['Kesalahan Fatal Saat Mengecat Tembok', 'Jangan cat tembok sebelum nonton ini!', 'Tiga kesalahan umum: tanpa primer, dinding lembap, salah takaran pengenceran.'],
    ['Tembok Bocor? Ini Solusinya', 'Musim hujan, tembok rembes lagi?', 'Tunjukkan titik rembes, aplikasi waterproof 2 lapis, dan uji siram air.'],
    ['Pilih Warna Kamar Sesuai Mood', 'Warna kamar bisa bikin kamu susah tidur.', 'Rekomendasi warna untuk tidur, kerja, dan kamar anak.'],
  ];
  const ideas = [];
  for (let i = 0; i < count; i += 1) {
    const [title, hook, storyline] = pick(seeds, i);
    ideas.push({
      title: i < seeds.length ? title : `${title} #${Math.floor(i / seeds.length) + 1}`,
      hook,
      storyline: `[DEMO] ${storyline}`,
      cta: 'Konsultasi warna gratis via WhatsApp atau datang ke toko terdekat.',
      expectedImpact: '[DEMO] Format edukasi + transformasi mendorong save & share, meningkatkan pertanyaan warna via DM.',
      impactLevel: pick(['High', 'Medium', 'High', 'Low'], i),
      targetAudience: audience,
      format: pick(['Short video', 'Carousel', 'Short video', 'Story'], i),
      objective: ctx.input?.objective ?? 'Engagement',
      productFocus: product,
    });
  }
  return { ideas };
}

function mockScript(ctx) {
  const d = ctx.input?.duration ?? 30;
  const idea = ctx.idea ?? {};
  const ctaStart = Math.max(d - 5, 3);
  const mid = Math.round((3 + ctaStart) / 2);
  return {
    title: idea.title ?? 'Demo Script',
    hook: { timeRange: '0-3s', visual: 'Close-up tembok kusam dan mengelupas.', voice: idea.hook ?? 'Rumah kamu kelihatan kusam?', onScreenText: 'Rumah kusam?' },
    scenes: [
      { sceneNumber: 1, timeRange: `3-${mid}s`, visual: 'Tukang mengamplas dan mengaplikasikan primer.', voice: 'Rahasianya: selalu mulai dengan primer.', onScreenText: 'Step 1: Primer' },
      { sceneNumber: 2, timeRange: `${mid}-${ctaStart}s`, visual: 'Time-lapse roller cat warna beige hangat.', voice: 'Lalu dua lapis cat dengan warna yang tepat.', onScreenText: 'Step 2: 2 lapis cat' },
    ],
    cta: { timeRange: `${ctaStart}-${d}s`, visual: 'Reveal rumah baru, pemilik tersenyum di depan rumah.', voice: 'Mau rekomendasi warna? Chat kami sekarang!', onScreenText: 'Konsultasi gratis' },
    voiceOver: `${idea.hook ?? 'Rumah kamu kelihatan kusam?'} Rahasianya: selalu mulai dengan primer. Lalu dua lapis cat dengan warna yang tepat. Mau rekomendasi warna? Chat kami sekarang!`,
    caption: '[DEMO] Rumah lama jadi kayak baru ✨ Simpan video ini sebelum renovasi!',
    hashtags: ['#catrumah', '#beforeafter', '#rumahminimalis', '#tipsrenovasi', '#inspirasiwarna'],
    musicSuggestion: 'Upbeat trending sound, build-up at reveal.',
  };
}

function mockPlan(ctx) {
  const n = ctx.segmentDurations?.length ?? 1;
  const beats = [
    'Wide shot of a faded Indonesian minimalist house facade in morning light, slow push-in.',
    'Painter rolling warm beige paint on an exterior wall, close-up of the roller texture, smooth gimbal move.',
    'Time-lapse of the facade being repainted, clouds moving, camera static on tripod.',
    'Final reveal of the freshly painted house at golden hour, family smiling at the gate, slow dolly out.',
    'Interior living room with earth-tone walls, sunlight through windows, slow pan.',
    'Paint store counter with color tinting machine mixing paint, shallow depth of field.',
  ];
  const captions = ['Dinding kusam & mengelupas', 'Kerok, plamir, lalu cat dasar', 'Dua lapis warna pilihan', 'Hasilnya bikin betah di rumah', 'Warna hangat bikin adem', 'Tinting sesuai kode warna'];
  return {
    segments: Array.from({ length: n }, (_, i) => ({ prompt: pick(beats, i), onScreenText: `[DEMO] ${pick(captions, i)}` })),
    hookText: ctx.script?.hook?.onScreenText || '[DEMO] Rumah kusam jadi kayak baru!',
    voiceOverText: ctx.script?.voiceOver ?? '[DEMO] Rumah lama jadi kayak baru. Konsultasi warna gratis di toko kami.',
  };
}

function mockSocialCaptions(ctx) {
  const title = ctx.video?.title ?? 'Video cat';
  const tags = ['#IntiWarna', '#CatRumah', '#RumahMinimalis', '#InspirasiWarna', '#RenovasiRumah', '#CatTembok', '#TipsCat', '#DekorasiRumah'];
  const cta = ctx.cta ?? 'Konsultasikan warna rumahmu di toko kami';
  return {
    instagram: `[DEMO] ${title} ✨\n\nDinding kusam bikin rumah terasa sempit. Pilih warna yang tepat dan lihat bedanya!\n\n${cta}.\n\n${tags.join(' ')}`,
    tiktok: `[DEMO] ${title} 🎨 ${cta}! ${tags.slice(0, 4).join(' ')}`,
    facebook: `[DEMO] ${title}\n\nRumah jadi lebih segar dengan warna yang tepat. ${cta}. ${tags.slice(0, 3).join(' ')}`,
    youtubeTitle: `[DEMO] ${title} #Shorts`.slice(0, 100),
    youtubeDescription: `[DEMO] ${title}. ${cta}. ${tags.slice(0, 4).join(' ')}`,
    hashtags: tags,
  };
}

const builders = {
  trend_analysis: mockTrend,
  content_ideas: mockIdeas,
  video_script: mockScript,
  video_plan: mockPlan,
  social_captions: mockSocialCaptions,
};

export const mock = {
  id: 'mock',
  label: 'Demo (offline mock)',
  isConfigured: () => true,
  model: () => 'mock-1',
  async generate({ schemaName, mockContext }) {
    const build = builders[schemaName];
    if (!build) throw new Error(`No mock builder for ${schemaName}`);
    return { data: build(mockContext ?? {}), model: 'mock-1', usage: { inputTokens: 0, outputTokens: 0 } };
  },
};
