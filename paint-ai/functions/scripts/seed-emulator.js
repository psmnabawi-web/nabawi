/**
 * Seeds the LOCAL EMULATORS with demo users + demo data.
 * Usage (emulators running):  npm run emulators:seed   (from the paint-ai folder)
 * Refuses to run against production.
 */
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= '127.0.0.1:9199';
process.env.GCLOUD_PROJECT ??= 'demo-paint-ai';

if (!process.env.GCLOUD_PROJECT.startsWith('demo-')) {
  console.error('Refusing to seed: GCLOUD_PROJECT must be a demo-* emulator project.');
  process.exit(1);
}

const { auth, db, serverTimestamp } = await import('../src/lib/firebase.js');
const { seedDemoData, DEMO_STORE_ID } = await import('../src/seed/demoData.js');
const { recomputeStats } = await import('../src/performance/calculatePerformance.js');

const PASSWORD = 'Demo12345!';
const USERS = [
  { email: 'admin@demo.test', name: 'Demo Super Admin', role: 'super_admin', storeId: null },
  { email: 'marketing@demo.test', name: 'Demo Marketing Manager', role: 'marketing_manager', storeId: null },
  { email: 'store@demo.test', name: 'Demo Store Manager', role: 'store_manager', storeId: DEMO_STORE_ID },
];

for (const u of USERS) {
  let record;
  try {
    record = await auth.getUserByEmail(u.email);
  } catch {
    record = await auth.createUser({ email: u.email, password: PASSWORD, displayName: u.name, emailVerified: true });
  }
  await db.doc(`users/${record.uid}`).set(
    { uid: record.uid, name: u.name, email: u.email, role: u.role, storeId: u.storeId, active: true, photoURL: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
    { merge: true },
  );
  console.log(`user ${u.email} (${u.role}) → ${record.uid}`);
}

await db.doc('settings/app').set({ textProvider: 'mock', videoProvider: 'mock', contentLanguage: 'id', brandContext: '', heygenAvatarId: '', heygenVoiceId: '', updatedAt: serverTimestamp(), updatedBy: 'seed' });
const res = await seedDemoData('seed');
await recomputeStats();
console.log(`demo data: ${res.written} documents. Password for all demo users: ${PASSWORD}`);
process.exit(0);
