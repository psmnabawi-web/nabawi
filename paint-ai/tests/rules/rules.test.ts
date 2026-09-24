/**
 * Security rules tests (Firestore + Storage) against the local emulators.
 * Run: npm run test:rules   (starts emulators via `firebase emulators:exec`)
 */
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getBytes, ref, uploadString } from 'firebase/storage';
import { afterAll, beforeAll, describe, it } from 'vitest';

let env: RulesTestEnvironment;
const ts = Timestamp.fromDate(new Date('2026-09-01T00:00:00Z'));

const users = {
  admin: { role: 'super_admin', storeId: null, active: true },
  mkt: { role: 'marketing_manager', storeId: null, active: true },
  sm1: { role: 'store_manager', storeId: 's1', active: true },
  sm2: { role: 'store_manager', storeId: 's2', active: true },
  smNone: { role: 'store_manager', storeId: null, active: true },
  inactive: { role: 'marketing_manager', storeId: null, active: false },
} as const;

const db = (uid: keyof typeof users | null) => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore());
const storage = (uid: keyof typeof users) => env.authenticatedContext(uid).storage();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-paint-ai',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    for (const [uid, u] of Object.entries(users)) await setDoc(doc(f, 'users', uid), { uid, name: uid, email: `${uid}@x.test`, ...u, createdAt: ts });
    for (const s of ['s1', 's2']) await setDoc(doc(f, 'stores', s), { storeId: s, storeName: `Store ${s}`, address: '', city: 'Jakarta', status: 'active', createdAt: ts, updatedAt: ts });
    for (const [id, storeId] of [['t1', 's1'], ['t2', 's2'], ['tAll', 'ALL']]) {
      await setDoc(doc(f, 'trend_analysis', id), { storeId, trendName: id, trendScore: 90, createdAt: ts });
      await setDoc(doc(f, 'content_ideas', `i-${id}`), { storeId, title: 'Idea', hook: 'h', storyline: 's', cta: 'c', favorite: false, status: 'idea', provider: 'mock', createdAt: ts });
      await setDoc(doc(f, 'generated_videos', `v-${id}`), { storeId, title: 'Video', status: 'Completed', videoUrl: 'https://x', createdAt: ts });
    }
    await setDoc(doc(f, 'generated_videos', 'v-draft'), { storeId: 's1', title: 'Draft', status: 'Draft', createdAt: ts });
    await setDoc(doc(f, 'generated_videos', 'v-proc'), { storeId: 's1', title: 'Proc', status: 'Processing', createdAt: ts });
    await setDoc(doc(f, 'stats', 'global'), { totals: {} });
    await setDoc(doc(f, 'stats', 'store_s1'), { totals: {} });
    await setDoc(doc(f, 'stats', 'store_s2'), { totals: {} });
    await setDoc(doc(f, 'audit_logs', 'a1'), { action: 'x', createdAt: ts });
    await setDoc(doc(f, 'usage', 'sm1_2026-09-01'), { uid: 'sm1', ai: 1 });
    const st = ctx.storage();
    await uploadString(ref(st, 'videos/v-t1/final.mp4'), 'video-bytes');
  });
});

afterAll(async () => {
  await env?.cleanup();
});

describe('authentication & profile', () => {
  it('denies unauthenticated reads', async () => {
    await assertFails(getDoc(doc(db(null), 'trend_analysis', 't1')));
  });
  it('users read their own profile, admin reads all, others cannot', async () => {
    await assertSucceeds(getDoc(doc(db('sm1'), 'users', 'sm1')));
    await assertSucceeds(getDoc(doc(db('admin'), 'users', 'sm1')));
    await assertFails(getDoc(doc(db('mkt'), 'users', 'sm1')));
  });
  it('self-service may only change name', async () => {
    await assertSucceeds(updateDoc(doc(db('sm1'), 'users', 'sm1'), { name: 'Budi', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db('sm1'), 'users', 'sm1'), { role: 'super_admin', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db('sm1'), 'users', 'sm1'), { storeId: 's2', updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db('sm1'), 'users', 'newbie'), { role: 'super_admin' }));
  });
  it('inactive users are locked out', async () => {
    await assertFails(getDoc(doc(db('inactive'), 'trend_analysis', 't1')));
  });
});

describe('store scoping', () => {
  it('store manager reads own store + brand-wide docs only', async () => {
    await assertSucceeds(getDoc(doc(db('sm1'), 'trend_analysis', 't1')));
    await assertSucceeds(getDoc(doc(db('sm1'), 'trend_analysis', 'tAll')));
    await assertFails(getDoc(doc(db('sm1'), 'trend_analysis', 't2')));
    await assertFails(getDoc(doc(db('smNone'), 'trend_analysis', 'tAll')));
  });
  it('store manager list queries must be constrained to their store', async () => {
    await assertSucceeds(getDocs(query(collection(db('sm1'), 'trend_analysis'), where('storeId', 'in', ['s1', 'ALL']), orderBy('createdAt', 'desc'))));
    await assertSucceeds(getDocs(query(collection(db('sm1'), 'generated_videos'), where('storeId', '==', 's1'))));
    await assertFails(getDocs(query(collection(db('sm1'), 'trend_analysis'))));
    await assertFails(getDocs(query(collection(db('sm1'), 'trend_analysis'), where('storeId', 'in', ['s1', 's2']))));
  });
  it('marketing and admin can query everything', async () => {
    await assertSucceeds(getDocs(query(collection(db('mkt'), 'trend_analysis'), orderBy('createdAt', 'desc'))));
    await assertSucceeds(getDocs(query(collection(db('admin'), 'content_ideas'))));
  });
  it('stores: store manager sees only the assigned store', async () => {
    await assertSucceeds(getDoc(doc(db('sm1'), 'stores', 's1')));
    await assertFails(getDoc(doc(db('sm1'), 'stores', 's2')));
    await assertFails(getDocs(collection(db('sm1'), 'stores')));
    await assertSucceeds(getDocs(collection(db('mkt'), 'stores')));
  });
  it('stats: scoped per store', async () => {
    await assertSucceeds(getDoc(doc(db('sm1'), 'stats', 'store_s1')));
    await assertFails(getDoc(doc(db('sm1'), 'stats', 'store_s2')));
    await assertFails(getDoc(doc(db('sm1'), 'stats', 'global')));
    await assertSucceeds(getDoc(doc(db('mkt'), 'stats', 'global')));
  });
});

describe('stores (admin only)', () => {
  const store = () => ({ storeId: 'cat-bekasi', storeName: 'Cat Baru', address: 'Jl. A', city: 'Bekasi', status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  it('marketing cannot create stores', async () => {
    await assertFails(setDoc(doc(db('mkt'), 'stores', 'cat-bekasi'), store()));
  });
  it('admin creates with a valid slug id, rejects mismatched storeId', async () => {
    await assertSucceeds(setDoc(doc(db('admin'), 'stores', 'cat-bekasi'), store()));
    await assertFails(setDoc(doc(db('admin'), 'stores', 'cat-depok'), store()));
    await assertFails(setDoc(doc(db('admin'), 'stores', 'x1'), { ...store(), storeId: 'x1' }));
    await assertFails(setDoc(doc(db('admin'), 'stores', 'ALL'), { ...store(), storeId: 'ALL' }));
  });
  it('admin updates allowed fields only', async () => {
    await assertSucceeds(updateDoc(doc(db('admin'), 'stores', 'cat-bekasi'), { city: 'Depok', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertFails(updateDoc(doc(db('admin'), 'stores', 'cat-bekasi'), { storeId: 'zzz', updatedAt: serverTimestamp() }));
  });
});

describe('social_sources', () => {
  const valid = (uid: string) => ({
    platform: 'TikTok',
    sourceType: 'account',
    url: 'https://tiktok.com/@brand',
    keyword: '#catrumah',
    category: 'paint',
    competitor: '',
    location: 'Jakarta',
    contentSample: '',
    storeId: 's1',
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  it('marketing creates a valid source', async () => {
    await assertSucceeds(setDoc(doc(db('mkt'), 'social_sources', 'src1'), valid('mkt')));
    await assertSucceeds(setDoc(doc(db('mkt'), 'social_sources', 'src2'), { ...valid('mkt'), sourceType: 'hashtag', url: '', storeId: 'ALL' }));
  });
  it('rejects invalid input and server-owned fields', async () => {
    await assertFails(setDoc(doc(db('mkt'), 'social_sources', 'x1'), { ...valid('mkt'), platform: 'Friendster' }));
    await assertFails(setDoc(doc(db('mkt'), 'social_sources', 'x2'), { ...valid('mkt'), url: 'http://tiktok.com/@a' }));
    await assertFails(setDoc(doc(db('mkt'), 'social_sources', 'x3'), { ...valid('mkt'), lastTrendScore: 99 }));
    await assertFails(setDoc(doc(db('mkt'), 'social_sources', 'x4'), { ...valid('admin') }));
    await assertFails(setDoc(doc(db('mkt'), 'social_sources', 'x5'), { ...valid('mkt'), storeId: 'nope' }));
    await assertFails(setDoc(doc(db('mkt'), 'social_sources', 'x6'), { ...valid('mkt'), sourceType: 'hashtag', url: '', keyword: '' }));
  });
  it('store manager cannot create', async () => {
    await assertFails(setDoc(doc(db('sm1'), 'social_sources', 'x7'), valid('sm1')));
  });
  it('marketing edits but cannot touch analysis fields', async () => {
    await assertSucceeds(updateDoc(doc(db('mkt'), 'social_sources', 'src1'), { keyword: '#catrumahminimalis', updatedAt: serverTimestamp(), updatedBy: 'mkt' }));
    await assertFails(updateDoc(doc(db('mkt'), 'social_sources', 'src1'), { lastTrendScore: 100, updatedAt: serverTimestamp(), updatedBy: 'mkt' }));
  });
});

describe('AI outputs are server-written', () => {
  it('nobody can create trend/idea/script/video docs from the client', async () => {
    await assertFails(setDoc(doc(db('admin'), 'trend_analysis', 'fake'), { storeId: 's1', trendName: 'x' }));
    await assertFails(setDoc(doc(db('mkt'), 'content_ideas', 'fake'), { storeId: 's1', title: 'x' }));
    await assertFails(setDoc(doc(db('mkt'), 'video_scripts', 'fake'), { storeId: 's1', title: 'x' }));
    await assertFails(setDoc(doc(db('mkt'), 'generated_videos', 'fake'), { storeId: 's1', status: 'Completed' }));
  });
  it('content ideas: editable fields only', async () => {
    await assertSucceeds(updateDoc(doc(db('mkt'), 'content_ideas', 'i-t1'), { favorite: true, status: 'approved', updatedAt: serverTimestamp(), updatedBy: 'mkt' }));
    await assertFails(updateDoc(doc(db('mkt'), 'content_ideas', 'i-t1'), { provider: 'x', updatedAt: serverTimestamp(), updatedBy: 'mkt' }));
    await assertFails(updateDoc(doc(db('sm1'), 'content_ideas', 'i-t1'), { favorite: true, updatedAt: serverTimestamp(), updatedBy: 'sm1' }));
  });
  it('videos: only Completed ⇄ Published transitions, platform required to publish', async () => {
    await assertSucceeds(updateDoc(doc(db('mkt'), 'generated_videos', 'v-t1'), { status: 'Published', platform: 'TikTok', publishedUrl: 'https://tiktok.com/@a/video/1', publishedAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: 'mkt' }));
    await assertFails(updateDoc(doc(db('mkt'), 'generated_videos', 'v-t2'), { status: 'Published', updatedAt: serverTimestamp(), updatedBy: 'mkt' }));
    await assertFails(updateDoc(doc(db('mkt'), 'generated_videos', 'v-draft'), { status: 'Published', platform: 'TikTok', updatedAt: serverTimestamp(), updatedBy: 'mkt' }));
    await assertFails(updateDoc(doc(db('mkt'), 'generated_videos', 'v-t2'), { videoUrl: 'https://evil', updatedAt: serverTimestamp(), updatedBy: 'mkt' }));
  });
  it('videos: cannot delete while processing', async () => {
    await assertFails(deleteDoc(doc(db('mkt'), 'generated_videos', 'v-proc')));
    await assertSucceeds(deleteDoc(doc(db('mkt'), 'generated_videos', 'v-draft')));
  });
});

describe('performance', () => {
  const perf = (over: Record<string, unknown> = {}) => ({
    videoId: 'v-t1',
    title: 'Video',
    platform: 'TikTok',
    storeId: 's1',
    views: 1000,
    likes: 100,
    comments: 10,
    shares: 5,
    leads: 3,
    salesImpact: 1500000,
    engagementRate: 11.5,
    publishedUrl: '',
    updatedBy: 'mkt',
    updatedAt: serverTimestamp(),
    ...over,
  });
  it('marketing records metrics with the video storeId', async () => {
    await assertSucceeds(setDoc(doc(db('mkt'), 'performance', 'v-t1'), perf()));
  });
  it('rejects wrong store, negative or fractional counts, mismatched id', async () => {
    await assertFails(setDoc(doc(db('mkt'), 'performance', 'v-t1'), perf({ storeId: 's2' })));
    await assertFails(setDoc(doc(db('mkt'), 'performance', 'v-t1'), perf({ views: -1 })));
    await assertFails(setDoc(doc(db('mkt'), 'performance', 'v-t1'), perf({ views: 10.5 })));
    await assertFails(setDoc(doc(db('mkt'), 'performance', 'v-t2'), perf()));
    await assertFails(setDoc(doc(db('mkt'), 'performance', 'v-missing'), perf({ videoId: 'v-missing' })));
  });
  it('content managers can probe a missing performance doc, store managers cannot', async () => {
    await assertSucceeds(getDoc(doc(db('mkt'), 'performance', 'v-t2')))
    await assertFails(getDoc(doc(db('sm2'), 'performance', 'v-t2')))
  })
  it('store manager reads own performance but cannot write', async () => {
    await assertSucceeds(getDoc(doc(db('sm1'), 'performance', 'v-t1')));
    await assertFails(getDoc(doc(db('sm2'), 'performance', 'v-t1')));
    await assertFails(setDoc(doc(db('sm1'), 'performance', 'v-t1'), perf({ updatedBy: 'sm1' })));
  });
});

describe('campaign calendar', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    title: 'Posting video',
    date: '2026-10-01',
    platform: 'Instagram',
    status: 'Planned',
    contentId: null,
    videoId: null,
    notes: '',
    storeId: 's1',
    createdBy: 'mkt',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...over,
  });
  it('marketing creates, validates date format', async () => {
    await assertSucceeds(setDoc(doc(db('mkt'), 'campaign_calendar', 'c1'), entry()));
    await assertFails(setDoc(doc(db('mkt'), 'campaign_calendar', 'c2'), entry({ date: '01/10/2026' })));
    await assertFails(setDoc(doc(db('sm1'), 'campaign_calendar', 'c3'), entry({ createdBy: 'sm1' })));
  });
  it('store manager range query on own store works', async () => {
    await assertSucceeds(
      getDocs(query(collection(db('sm1'), 'campaign_calendar'), where('storeId', 'in', ['s1', 'ALL']), where('date', '>=', '2026-10-01'), where('date', '<=', '2026-10-31'), orderBy('date'))),
    );
  });
});

describe('settings, usage & audit log', () => {
  const settings = { textProvider: 'gemini', videoProvider: 'runway', contentLanguage: 'id', brandContext: 'Toko cat', heygenAvatarId: '', heygenVoiceId: '', updatedAt: serverTimestamp(), updatedBy: 'admin' };
  it('only super admin writes valid settings', async () => {
    await assertSucceeds(setDoc(doc(db('admin'), 'settings', 'app'), settings));
    await assertSucceeds(setDoc(doc(db('admin'), 'settings', 'app'), { ...settings, videoProvider: 'veo' }));
    const kit = { enabled: true, captions: true, endCard: false, instagram: '@intiwarna_', whatsapp: '0812', website: '', hours: '07.30 - 17.30', ctaText: 'Datang ke toko' };
    await assertSucceeds(setDoc(doc(db('admin'), 'settings', 'app'), { brandKit: kit, updatedAt: serverTimestamp(), updatedBy: 'admin' }, { merge: true }));
    await assertFails(setDoc(doc(db('admin'), 'settings', 'app'), { brandKit: { ...kit, enabled: 'yes' }, updatedAt: serverTimestamp(), updatedBy: 'admin' }, { merge: true }));
    await assertFails(setDoc(doc(db('admin'), 'settings', 'app'), { brandKit: { ...kit, logoUrl: 'https://evil.test' }, updatedAt: serverTimestamp(), updatedBy: 'admin' }, { merge: true }));
    await assertFails(setDoc(doc(db('admin'), 'settings', 'app'), { brandKit: { ...kit, ctaText: 'x'.repeat(81) }, updatedAt: serverTimestamp(), updatedBy: 'admin' }, { merge: true }));
    await assertFails(setDoc(doc(db('mkt'), 'settings', 'app'), { brandKit: kit, updatedAt: serverTimestamp(), updatedBy: 'mkt' }, { merge: true }));
    await assertFails(setDoc(doc(db('admin'), 'settings', 'app'), { ...settings, textProvider: 'skynet' }));
    await assertFails(setDoc(doc(db('mkt'), 'settings', 'app'), { ...settings, updatedBy: 'mkt' }));
    await assertSucceeds(getDoc(doc(db('sm1'), 'settings', 'app')));
  });
  it('audit log is admin-only and read-only', async () => {
    await assertSucceeds(getDoc(doc(db('admin'), 'audit_logs', 'a1')));
    await assertFails(getDoc(doc(db('mkt'), 'audit_logs', 'a1')));
    await assertFails(setDoc(doc(db('admin'), 'audit_logs', 'a2'), { action: 'forged' }));
  });
  it('usage is readable by its owner only', async () => {
    await assertSucceeds(getDoc(doc(db('sm1'), 'usage', 'sm1_2026-09-01')));
    await assertFails(getDoc(doc(db('sm2'), 'usage', 'sm1_2026-09-01')));
  });
});

describe('storage', () => {
  it('video files follow the Firestore store scope', async () => {
    await assertSucceeds(getBytes(ref(storage('sm1'), 'videos/v-t1/final.mp4')));
    await assertSucceeds(getBytes(ref(storage('mkt'), 'videos/v-t1/final.mp4')));
    await assertFails(getBytes(ref(storage('sm2'), 'videos/v-t1/final.mp4')));
  });
  it('clients cannot upload anything', async () => {
    await assertFails(uploadString(ref(storage('admin'), 'videos/v-t1/evil.mp4'), 'x'));
    await assertFails(uploadString(ref(storage('admin'), 'anything/else.txt'), 'x'));
  });
});
