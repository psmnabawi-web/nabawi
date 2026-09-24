import { ALL_STORES } from '../config.js';
import { commitInChunks, db, Timestamp } from '../lib/firebase.js';

/**
 * Demo data (spec §11). Every document carries demo=true so it can be removed in one click
 * (Settings > Demo data). Metric values are illustrative sample numbers, not real results.
 */
export const DEMO_STORE_ID = 'cat-xyz-jakarta';
const DEMO_COLLECTIONS = ['stores', 'social_sources', 'trend_analysis', 'content_ideas', 'video_scripts', 'generated_videos', 'performance', 'campaign_calendar'];

const daysAgo = (n) => Timestamp.fromDate(new Date(Date.now() - n * 24 * 3600 * 1000));

export function buildDemoDocuments(actorUid = 'system') {
  const docs = [];
  const add = (collection, id, data) => docs.push({ collection, id, data: { id, ...data, demo: true } });

  add('stores', DEMO_STORE_ID, {
    storeId: DEMO_STORE_ID,
    storeName: 'Cat XYZ Jakarta',
    address: '',
    city: 'Jakarta',
    status: 'active',
    createdAt: daysAgo(170),
    updatedAt: daysAgo(170),
  });

  add('social_sources', 'demo-source-tiktok', {
    platform: 'TikTok',
    sourceType: 'account',
    url: 'https://tiktok.com/@brand',
    keyword: '#catrumah',
    category: 'paint',
    competitor: '',
    location: 'Jakarta',
    contentSample: 'Video before-after rumah minimalis: fasad kusam dicat ulang warna beige hangat, time-lapse roller, reveal di sore hari.',
    storeId: DEMO_STORE_ID,
    createdBy: actorUid,
    createdAt: daysAgo(30),
    updatedAt: daysAgo(30),
    lastAnalyzedAt: daysAgo(2),
    lastTrendId: 'demo-trend-beige',
    lastTrendName: 'Minimalist Beige House Color',
    lastTrendScore: 94,
    analysisCount: 2,
  });

  const trendBase = {
    sourceId: 'demo-source-tiktok',
    storeId: DEMO_STORE_ID,
    platform: 'TikTok',
    keyword: '#catrumah',
    category: 'paint',
    sourceUrl: 'https://tiktok.com/@brand',
    sourceMeta: null,
    provider: 'demo',
    model: 'demo',
    confidence: 'medium',
    createdBy: actorUid,
  };
  add('trend_analysis', 'demo-trend-before-after', {
    ...trendBase,
    trendName: 'Before After Rumah Minimalis',
    trendScore: 92,
    growthLevel: 'Rising',
    viralPattern: 'Transformasi kontras: rumah kusam → proses cepat → reveal hasil akhir.',
    audienceEmotion: 'Puas (satisfying), aspiratif, penasaran dengan warna yang dipakai.',
    contentPattern: 'Hook kondisi awal (0-3 detik) → time-lapse pengecatan → reveal → sebut kode warna → CTA konsultasi.',
    hookAnalysis: 'Frame pertama menampilkan tembok mengelupas dengan teks "Rumah 10 tahun?" sehingga penonton ingin melihat hasil akhirnya.',
    visualStyle: 'Vertikal 9:16, time-lapse, close-up roller, color grading hangat, musik build-up.',
    marketingOpportunity: 'Seri transformasi rumah pelanggan dengan rekomendasi warna dari toko.',
    recommendation: 'Create transformation video',
    suggestedFormats: ['Short video', 'Carousel before-after'],
    keywords: ['#catrumah', '#beforeafter', '#rumahminimalis'],
    rationale: 'Contoh data demo.',
    createdAt: daysAgo(9),
  });
  add('trend_analysis', 'demo-trend-beige', {
    ...trendBase,
    trendName: 'Minimalist Beige House Color',
    trendScore: 94,
    growthLevel: 'Viral',
    viralPattern: 'Palet netral hangat (beige, greige, off-white) dipamerkan pada fasad rumah minimalis.',
    audienceEmotion: 'Aspiratif: rumah terlihat lebih mahal dan bersih.',
    contentPattern: 'Pilihan 3 warna → contoh di fasad → before-after → rekomendasi kombinasi.',
    hookAnalysis: '"Warna ini bikin rumah kelihatan 2x lebih mahal" memicu rasa ingin tahu.',
    visualStyle: 'Golden hour, gimbal slow motion, swatch warna di tangan.',
    marketingOpportunity: 'Paket rekomendasi warna beige + layanan tinting di toko.',
    recommendation: 'Create before-after transformation video',
    suggestedFormats: ['Short video', 'Carousel palet warna'],
    keywords: ['#warnacatrumah', '#rumahminimalis', '#beige'],
    rationale: 'Contoh data demo.',
    createdAt: daysAgo(2),
  });

  add('content_ideas', 'demo-idea-5-warna', {
    batchId: 'demo-batch',
    rank: 1,
    trendId: 'demo-trend-beige',
    trendName: 'Minimalist Beige House Color',
    title: '5 Warna Cat Membuat Rumah Lebih Mahal',
    hook: 'Rumah kamu kelihatan murah? Bisa jadi karena salah warna.',
    storyline: 'Tampilkan 5 warna (beige hangat, greige, off-white, sage, abu hangat) di fasad yang sama dengan before-after singkat untuk tiap warna, lalu tips kombinasi dengan kusen.',
    cta: 'Komentar "WARNA" untuk rekomendasi kombinasi gratis, atau datang ke Cat XYZ Jakarta.',
    expectedImpact: 'Format list + before-after mendorong save & share dan pertanyaan warna via komentar/DM.',
    impactLevel: 'High',
    targetAudience: 'Home owner rumah minimalis',
    format: 'Short video',
    objective: 'Engagement',
    product: 'Exterior paint',
    audience: 'Home owner',
    platform: 'TikTok',
    storeId: DEMO_STORE_ID,
    status: 'scripted',
    favorite: true,
    scriptCount: 1,
    lastScriptId: 'demo-script-5-warna',
    provider: 'demo',
    model: 'demo',
    createdBy: actorUid,
    createdAt: daysAgo(2),
  });

  add('video_scripts', 'demo-script-5-warna', {
    contentId: 'demo-idea-5-warna',
    trendId: 'demo-trend-beige',
    title: '5 Warna Cat Membuat Rumah Lebih Mahal',
    duration: 30,
    tone: 'Friendly',
    platform: 'TikTok',
    hook: { timeRange: '0-3s', visual: 'Fasad rumah kusam, zoom cepat ke cat mengelupas.', voice: 'Rumah kamu kelihatan murah? Bisa jadi karena warnanya.', onScreenText: 'Salah warna = rumah murah?' },
    scenes: [
      { sceneNumber: 1, timeRange: '3-10s', visual: 'Swatch beige hangat dan greige di depan fasad.', voice: 'Warna netral hangat seperti beige dan greige bikin rumah terlihat bersih dan mewah.', onScreenText: '1. Beige · 2. Greige' },
      { sceneNumber: 2, timeRange: '10-18s', visual: 'Before-after fasad dengan off-white dan sage.', voice: 'Off-white cocok untuk rumah kecil, sage memberi kesan natural.', onScreenText: '3. Off-white · 4. Sage' },
      { sceneNumber: 3, timeRange: '18-25s', visual: 'Abu hangat dipadukan kusen kayu, reveal golden hour.', voice: 'Abu hangat plus kusen kayu? Langsung naik kelas.', onScreenText: '5. Abu hangat' },
    ],
    cta: { timeRange: '25-30s', visual: 'Staf toko menunjukkan mesin tinting.', voice: 'Mau kombinasi yang pas? Komentar WARNA atau mampir ke toko kami.', onScreenText: 'Konsultasi warna gratis' },
    voiceOver: 'Rumah kamu kelihatan murah? Bisa jadi karena warnanya. Warna netral hangat seperti beige dan greige bikin rumah terlihat bersih dan mewah. Off-white cocok untuk rumah kecil, sage memberi kesan natural. Abu hangat plus kusen kayu? Langsung naik kelas. Mau kombinasi yang pas? Komentar WARNA atau mampir ke toko kami.',
    caption: '5 warna cat yang bikin rumah kelihatan lebih mahal ✨ Simpan dulu sebelum renovasi!',
    hashtags: ['#catrumah', '#warnacatrumah', '#rumahminimalis', '#beforeafter', '#inspirasirumah'],
    musicSuggestion: 'Trending upbeat, build-up saat reveal.',
    storeId: DEMO_STORE_ID,
    provider: 'demo',
    model: 'demo',
    createdBy: actorUid,
    createdAt: daysAgo(1),
  });

  const video = (id, title, template, status, platform, createdDays, extra = {}) =>
    add('generated_videos', id, {
      scriptId: id === 'demo-video-draft' ? 'demo-script-5-warna' : null,
      contentId: id === 'demo-video-draft' ? 'demo-idea-5-warna' : null,
      title,
      template,
      templateLabel: template === 'before_after' ? 'Before After House Transformation' : template === 'color_inspiration' ? 'Color Inspiration' : 'Product Education',
      duration: 30,
      ratio: '9:16',
      style: 'Realistic',
      provider: 'mock',
      brief: '',
      storeId: DEMO_STORE_ID,
      status,
      videoUrl: null,
      thumbnail: null,
      segments: [],
      progress: { done: 0, total: 0 },
      attempts: 0,
      error: null,
      platform: platform ?? null,
      publishedAt: status === 'Published' ? daysAgo(createdDays - 1) : null,
      createdBy: actorUid,
      createdAt: daysAgo(createdDays),
      updatedAt: daysAgo(createdDays),
      ...extra,
    });
  video('demo-video-draft', '5 Warna Cat Membuat Rumah Lebih Mahal', 'color_inspiration', 'Draft', null, 1);
  video('demo-video-1', '[DEMO] Before After Rumah Minimalis', 'before_after', 'Published', 'TikTok', 40);
  video('demo-video-2', '[DEMO] Cara Cat Tembok Anti Bocor', 'product_education', 'Published', 'Instagram', 75);
  video('demo-video-3', '[DEMO] Inspirasi Warna Beige', 'color_inspiration', 'Published', 'YouTube', 110);

  const perf = (videoId, title, platform, views, likes, comments, shares, leads, salesImpact) =>
    add('performance', videoId, {
      videoId,
      title,
      platform,
      storeId: DEMO_STORE_ID,
      views,
      likes,
      comments,
      shares,
      leads,
      salesImpact,
      engagementRate: views ? Math.round(((likes + comments + shares) / views) * 10000) / 100 : 0,
      publishedUrl: '',
      updatedBy: actorUid,
      updatedAt: daysAgo(1),
    });
  perf('demo-video-1', '[DEMO] Before After Rumah Minimalis', 'TikTok', 48000, 3900, 410, 620, 35, 12500000);
  perf('demo-video-2', '[DEMO] Cara Cat Tembok Anti Bocor', 'Instagram', 12500, 980, 140, 210, 18, 6800000);
  perf('demo-video-3', '[DEMO] Inspirasi Warna Beige', 'YouTube', 7600, 450, 60, 85, 6, 2100000);

  const inDays = (n) => {
    const d = new Date(Date.now() + n * 24 * 3600 * 1000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  };
  add('campaign_calendar', 'demo-cal-1', {
    title: 'Posting: 5 Warna Cat Membuat Rumah Lebih Mahal',
    date: inDays(2),
    platform: 'TikTok',
    status: 'Planned',
    contentId: 'demo-idea-5-warna',
    videoId: 'demo-video-draft',
    notes: 'Posting jam 19.00 WIB.',
    storeId: DEMO_STORE_ID,
    createdBy: actorUid,
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  });
  add('campaign_calendar', 'demo-cal-2', {
    title: 'Live: Konsultasi warna musim hujan',
    date: inDays(6),
    platform: 'Instagram',
    status: 'Scheduled',
    contentId: null,
    videoId: null,
    notes: '',
    storeId: ALL_STORES,
    createdBy: actorUid,
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  });

  // A few extra ideas spread over previous months so the growth chart has history.
  for (let i = 1; i <= 5; i += 1) {
    add('content_ideas', `demo-idea-history-${i}`, {
      batchId: `demo-batch-${i}`,
      rank: 1,
      trendId: null,
      trendName: null,
      title: `[DEMO] Ide konten bulan ke-${i}`,
      hook: 'Contoh hook demo.',
      storyline: 'Contoh storyline demo.',
      cta: 'Kunjungi toko.',
      expectedImpact: 'Contoh demo.',
      impactLevel: 'Medium',
      targetAudience: 'Home owner',
      format: 'Short video',
      objective: 'Awareness',
      product: 'Interior paint',
      audience: 'Home owner',
      platform: 'Instagram',
      storeId: DEMO_STORE_ID,
      status: 'idea',
      favorite: false,
      scriptCount: 0,
      provider: 'demo',
      model: 'demo',
      createdBy: actorUid,
      createdAt: daysAgo(i * 30),
    });
  }
  return docs;
}

export async function seedDemoData(actorUid) {
  const docs = buildDemoDocuments(actorUid);
  await commitInChunks(docs.map((d) => (batch) => batch.set(db.doc(`${d.collection}/${d.id}`), d.data, { merge: true })));
  return { written: docs.length };
}

export async function removeDemoData() {
  let removed = 0;
  for (const collection of DEMO_COLLECTIONS) {
    const snap = await db.collection(collection).where('demo', '==', true).get();
    removed += snap.size;
    await commitInChunks(snap.docs.map((doc) => (batch) => batch.delete(doc.ref)));
  }
  return { removed };
}
