import { logger } from 'firebase-functions';
import { ALL_STORES } from '../config.js';
import { db, serverTimestamp, toDate } from '../lib/firebase.js';

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const round = (v, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Engagement rate (%) = (likes + comments + shares) / views × 100. 0 when there are no views. */
export function engagementRate({ views, likes, comments, shares }) {
  const v = num(views);
  if (!v) return 0;
  return round(((num(likes) + num(comments) + num(shares)) / v) * 100);
}

/** 'YYYY-MM' in Asia/Jakarta. */
export function monthKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  return `${y}-${m}`;
}

export function lastMonths(count, now = new Date()) {
  const keys = [];
  const [y, m] = monthKey(now).split('-').map(Number);
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 15));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

/**
 * Pure aggregation used for every scope (global and per store). Exported for unit tests.
 * @param {{videos: any[], ideas: any[], scripts: any[], trends: any[], performance: any[]}} data
 */
export function aggregate(data, now = new Date()) {
  const months = lastMonths(6, now);
  const growth = Object.fromEntries(months.map((k) => [k, { month: k, ideas: 0, scripts: 0, videos: 0 }]));
  const bump = (items, field) => {
    for (const item of items) {
      const d = toDate(item.createdAt);
      if (!d) continue;
      const key = monthKey(d);
      if (growth[key]) growth[key][field] += 1;
    }
  };
  bump(data.ideas, 'ideas');
  bump(data.scripts, 'scripts');
  bump(data.videos, 'videos');

  const statusBreakdown = { Draft: 0, Processing: 0, Completed: 0, Published: 0, Failed: 0 };
  for (const v of data.videos) if (statusBreakdown[v.status] !== undefined) statusBreakdown[v.status] += 1;

  const videoById = new Map(data.videos.map((v) => [v.id, v]));
  const platforms = new Map();
  const totals = { views: 0, likes: 0, comments: 0, shares: 0, leads: 0, salesImpact: 0 };
  const content = [];
  for (const p of data.performance) {
    const row = { views: num(p.views), likes: num(p.likes), comments: num(p.comments), shares: num(p.shares), leads: num(p.leads), salesImpact: num(p.salesImpact) };
    for (const k of Object.keys(totals)) totals[k] += row[k];
    const platform = p.platform || 'Unknown';
    const agg = platforms.get(platform) ?? { platform, posts: 0, views: 0, likes: 0, comments: 0, shares: 0, leads: 0 };
    agg.posts += 1;
    agg.views += row.views;
    agg.likes += row.likes;
    agg.comments += row.comments;
    agg.shares += row.shares;
    agg.leads += row.leads;
    platforms.set(platform, agg);
    const video = videoById.get(p.videoId);
    content.push({
      videoId: p.videoId,
      title: p.title || video?.title || 'Untitled',
      platform,
      thumbnail: video?.thumbnail ?? null,
      views: row.views,
      engagementRate: engagementRate(row),
      leads: row.leads,
      salesImpact: row.salesImpact,
    });
  }

  const recentTrends = [...data.trends].sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  const fourteenDaysAgo = now.getTime() - 14 * 24 * 3600 * 1000;
  const pool = recentTrends.filter((t) => (toDate(t.createdAt)?.getTime() ?? 0) >= fourteenDaysAgo);
  const topTrendSrc = [...(pool.length ? pool : recentTrends.slice(0, 20))].sort((a, b) => num(b.trendScore) - num(a.trendScore))[0];

  return {
    totals: {
      videos: data.videos.length,
      completedVideos: statusBreakdown.Completed + statusBreakdown.Published,
      publishedVideos: statusBreakdown.Published,
      ideas: data.ideas.length,
      scripts: data.scripts.length,
      trends: data.trends.length,
      trackedContent: data.performance.length,
      ...totals,
    },
    avgEngagementRate: engagementRate(totals),
    statusBreakdown,
    contentGrowth: months.map((k) => growth[k]),
    platformPerformance: [...platforms.values()]
      .map((p) => ({ ...p, engagementRate: engagementRate(p) }))
      .sort((a, b) => b.views - a.views),
    topContent: content.sort((a, b) => b.views - a.views || b.engagementRate - a.engagementRate).slice(0, 5),
    topTrend: topTrendSrc
      ? {
          id: topTrendSrc.id,
          trendName: topTrendSrc.trendName ?? '',
          trendScore: num(topTrendSrc.trendScore),
          growthLevel: topTrendSrc.growthLevel ?? '',
          recommendation: topTrendSrc.recommendation ?? '',
          platform: topTrendSrc.platform ?? '',
        }
      : null,
  };
}

const rows = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

/** Recomputes stats/global and stats/store_{storeId} for every store. */
export async function recomputeStats() {
  const [videos, ideas, scripts, trends, performance, stores] = await Promise.all([
    db.collection('generated_videos').select('status', 'storeId', 'createdAt', 'title', 'thumbnail').get().then(rows),
    db.collection('content_ideas').select('storeId', 'createdAt').get().then(rows),
    db.collection('video_scripts').select('storeId', 'createdAt').get().then(rows),
    db.collection('trend_analysis').select('storeId', 'createdAt', 'trendName', 'trendScore', 'growthLevel', 'recommendation', 'platform').get().then(rows),
    db.collection('performance').get().then(rows),
    db.collection('stores').select('storeName').get().then(rows),
  ]);
  const all = { videos, ideas, scripts, trends, performance };
  const now = new Date();
  const writes = [{ id: 'global', scope: 'global', data: aggregate(all, now) }];
  for (const store of stores) {
    const inScope = (item) => item.storeId === store.id || item.storeId === ALL_STORES;
    writes.push({
      id: `store_${store.id}`,
      scope: store.id,
      data: aggregate(
        {
          videos: videos.filter(inScope),
          ideas: ideas.filter(inScope),
          scripts: scripts.filter(inScope),
          trends: trends.filter(inScope),
          performance: performance.filter(inScope),
        },
        now,
      ),
    });
  }
  const batch = db.batch();
  for (const w of writes) batch.set(db.doc(`stats/${w.id}`), { scope: w.scope, ...w.data, updatedAt: serverTimestamp() });
  await batch.commit();
  logger.info('stats recomputed', { scopes: writes.length, videos: videos.length, performance: performance.length });
  return { scopes: writes.length };
}

/**
 * Firestore trigger on performance/{videoId}: keeps engagementRate consistent and denormalizes
 * the video title/platform. Only writes when something changed (prevents trigger loops).
 */
export async function syncPerformanceDoc(change) {
  if (!change.after.exists) return;
  const data = change.after.data();
  const updates = {};
  const rate = engagementRate(data);
  if (data.engagementRate !== rate) updates.engagementRate = rate;
  if (!data.title && data.videoId) {
    const video = await db.doc(`generated_videos/${data.videoId}`).get();
    if (video.exists && video.get('title')) updates.title = video.get('title');
  }
  if (Object.keys(updates).length) await change.after.ref.update(updates);
}
