/**
 * Uji firestore.rules Kontrol Energi Store terhadap Firestore emulator.
 *
 * Tujuan: membuktikan alur produksi benar-benar lolos rules, bukan sekadar
 * rules-nya ter-compile. Yang diuji:
 *   1. Master terkunci tidak dapat ditulis aplikasi.
 *   2. Pembelian token + transisi state atomik diterima.
 *   3. Pembacaan harian prabayar menyerap saldo pending dan menutup state.
 *   4. Pembacaan pascabayar menolak angka meter turun.
 *   5. Manipulasi nilai (usage, saldo, revisi, referensi ganda) ditolak.
 *
 * Cara menjalankan (perlu Java 11+ dan koneksi internet sekali untuk emulator):
 *   npm install @firebase/rules-unit-testing firebase
 *   npx firebase emulators:exec --only firestore --project demo-kes \
 *     "node tests/rules.test.mjs"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const MASTER = JSON.parse(readFileSync(join(ROOT, "public/master-electric.json"), "utf8"));
const MASTER_VERSION = MASTER.masterVersion;
const MASTER_HASH = "hash-uji-rules";
const APP_VERSION = readFileSync(join(ROOT, "VERSION.txt"), "utf8")
  .split("\n").find((line) => line.startsWith("Version:")).split(":")[1].trim();

const PREPAID_STORE = MASTER.stores.find((store) => store.electricityModel === "prepaid");
const PREPAID_METER = MASTER.meters.find((meter) => meter.storeId === PREPAID_STORE.id);
const POSTPAID_STORE = MASTER.stores.find((store) => store.electricityModel === "postpaid");
const POSTPAID_METER = MASTER.meters.find((meter) => meter.storeId === POSTPAID_STORE.id);

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  FAIL  ${name}\n        ${error.message.split("\n")[0]}`);
  }
}

const env = await initializeTestEnvironment({
  projectId: "demo-kes",
  firestore: {
    rules: readFileSync(join(ROOT, "firestore.rules"), "utf8"),
    host: "127.0.0.1",
    port: Number(process.env.FIRESTORE_EMULATOR_PORT || 8080),
  },
});

/** Menanam master terkunci persis seperti hasil scripts/seed-master.sh. */
async function seedMaster(tokenStateOverrides = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore();
    for (const store of MASTER.stores) {
      await setDoc(doc(db, "stores", store.id), {
        code: store.code,
        name: store.name,
        area: store.area,
        electricityModel: store.electricityModel,
        latitude: store.latitude,
        longitude: store.longitude,
        coordinateText: store.coordinateText,
        tariffPerKwh: store.tariffPerKwh,
        active: true,
        locked: true,
        managedBy: "master-electric",
        masterVersion: MASTER_VERSION,
        masterHash: MASTER_HASH,
        syncedAt: new Date(),
      });
    }
    for (const meter of MASTER.meters) {
      await setDoc(doc(db, "meters", meter.id), {
        storeId: meter.storeId,
        name: meter.name,
        serialNumber: meter.serialNumber,
        meterPower: meter.meterPower,
        displayDigits: null,
        decimalPlaces: null,
        multiplier: meter.multiplier,
        maxDailyKwh: null,
        active: true,
        locked: true,
        managedBy: "master-electric",
        masterVersion: MASTER_VERSION,
        masterHash: MASTER_HASH,
        syncedAt: new Date(),
      });
    }
    await setDoc(doc(db, "masterRegistry", "electric"), {
      source: "Master Electric.xlsx",
      masterVersion: MASTER_VERSION,
      masterHash: MASTER_HASH,
      storeCount: 11,
      meterCount: 11,
      prepaidCount: 9,
      postpaidCount: 2,
      storeIds: MASTER.stores.map((store) => store.id),
      meterIds: MASTER.meters.map((meter) => meter.id),
      locked: true,
      syncedAt: new Date(),
    });
    for (const store of MASTER.stores.filter((row) => row.electricityModel === "prepaid")) {
      const meter = MASTER.meters.find((row) => row.storeId === store.id);
      await setDoc(doc(db, "tokenStates", meter.id), {
        meterId: meter.id,
        storeId: store.id,
        storeCode: store.code,
        storeName: store.name,
        meterSerial: meter.serialNumber,
        electricityModel: "prepaid",
        revision: 0,
        pendingFromRevision: null,
        pendingPurchaseCount: 0,
        pendingTokenKwhCenti: 0,
        pendingAmountRp: 0,
        lastPurchaseId: "",
        lastConsumedRevision: 0,
        lastAcceptedReadingId: "",
        lastAcceptedReadingDate: "",
        lastAcceptedReadingKwhCenti: null,
        lastAcceptedCapturedAt: null,
        lastEventType: "seed",
        lastEventId: "seed-test",
        updatedAt: new Date(),
        masterVersion: MASTER_VERSION,
        ...(tokenStateOverrides[meter.id] || {}),
      });
    }
  });
}

const iso = (value) => new Date(value).toISOString().replace(/\.\d{3}Z$/, ".000Z");

function readingPayload(overrides = {}) {
  const store = overrides.__store || PREPAID_STORE;
  const meter = overrides.__meter || PREPAID_METER;
  delete overrides.__store;
  delete overrides.__meter;
  return {
    meterId: meter.id,
    storeId: store.id,
    storeCode: store.code,
    storeName: store.name,
    meterSerial: meter.serialNumber,
    meterPower: meter.meterPower,
    tariffPerKwh: store.tariffPerKwh,
    readingDate: "2026-09-16",
    capturedAt: iso("2026-09-16T01:00:00Z"),
    serverRecordedAt: serverTimestamp(),
    readingKwh: 100,
    previousReadingKwh: null,
    usageKwh: null,
    intervalHours: null,
    normalized24hKwh: null,
    estimatedCost: null,
    inputMode: "manual",
    status: "valid",
    anomalyFlags: ["baseline_only"],
    electricityModel: store.electricityModel,
    readingBasis: store.electricityModel === "prepaid" ? "remaining_balance" : "cumulative_consumption",
    tokenAddedKwh: 0,
    tokenLinkSchemaVersion: 1,
    tokenLinkDisposition: store.electricityModel === "prepaid" ? "consumed" : "none",
    tokenPurchaseCount: 0,
    tokenPurchaseTotalKwh: 0,
    tokenPurchaseTotalKwhCenti: 0,
    tokenPurchaseTotalAmountRp: 0,
    tokenRevisionStart: null,
    tokenRevisionEnd: null,
    reason: "",
    recordedBy: "Crew Uji",
    createdByUid: "crew-uid",
    appVersion: APP_VERSION,
    masterVersion: MASTER_VERSION,
    ...overrides,
  };
}

function purchasePayload(overrides = {}) {
  return {
    meterId: PREPAID_METER.id,
    storeId: PREPAID_STORE.id,
    storeCode: PREPAID_STORE.code,
    storeName: PREPAID_STORE.name,
    meterSerial: PREPAID_METER.serialNumber,
    purchaseDate: "2026-09-16",
    purchasedAt: iso("2026-09-16T03:00:00Z"),
    serverRecordedAt: serverTimestamp(),
    revision: 1,
    tokenKwh: 50,
    tokenKwhCenti: 5000,
    purchaseAmountRp: 100000,
    receiptReference: "TRX-001",
    referenceKey: "TRX001",
    status: "recorded",
    recordedBy: "Crew Uji",
    createdByUid: "crew-uid",
    appVersion: APP_VERSION,
    masterVersion: MASTER_VERSION,
    ...overrides,
  };
}

function stateAfterPurchase(overrides = {}) {
  return {
    meterId: PREPAID_METER.id,
    storeId: PREPAID_STORE.id,
    storeCode: PREPAID_STORE.code,
    storeName: PREPAID_STORE.name,
    meterSerial: PREPAID_METER.serialNumber,
    electricityModel: "prepaid",
    revision: 1,
    pendingFromRevision: 1,
    pendingPurchaseCount: 1,
    pendingTokenKwhCenti: 5000,
    pendingAmountRp: 100000,
    lastPurchaseId: `${PREPAID_METER.id}_TRX001`,
    lastConsumedRevision: 0,
    lastAcceptedReadingId: "",
    lastAcceptedReadingDate: "",
    lastAcceptedReadingKwhCenti: null,
    lastAcceptedCapturedAt: null,
    lastEventType: "purchase",
    lastEventId: `${PREPAID_METER.id}_TRX001`,
    updatedAt: serverTimestamp(),
    masterVersion: MASTER_VERSION,
    ...overrides,
  };
}

const crewDb = () => env.authenticatedContext("crew-uid").firestore();

async function commitPurchase(db, purchase, state) {
  const batch = writeBatch(db);
  batch.set(doc(db, "tokenPurchases", `${purchase.meterId}_${purchase.referenceKey}`), purchase);
  batch.set(doc(db, "tokenStates", purchase.meterId), state);
  return batch.commit();
}

console.log("\nUji firestore.rules Kontrol Energi Store\n");

await test("master store tidak dapat ditulis aplikasi", async () => {
  await seedMaster();
  const db = crewDb();
  await assertFails(setDoc(doc(db, "stores", PREPAID_STORE.id), { code: "#999" }, { merge: true }));
  await assertFails(setDoc(doc(db, "meters", PREPAID_METER.id), { meterPower: 1 }, { merge: true }));
});

await test("master registry dapat dibaca aplikasi login", async () => {
  await seedMaster();
  await assertSucceeds(getDoc(doc(crewDb(), "masterRegistry", "electric")));
});

await test("koleksi tak dikenal tertutup penuh", async () => {
  await seedMaster();
  await assertFails(setDoc(doc(crewDb(), "koleksiLain", "x"), { a: 1 }));
});

await test("user anonim tanpa login ditolak", async () => {
  await seedMaster();
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anon, "stores", PREPAID_STORE.id)));
});

await test("baseline prabayar pertama diterima dan menutup state", async () => {
  await seedMaster();
  const db = crewDb();
  const readingId = `${PREPAID_METER.id}_2026-09-16`;
  const batch = writeBatch(db);
  batch.set(doc(db, "readings", readingId), readingPayload());
  batch.set(doc(db, "tokenStates", PREPAID_METER.id), {
    meterId: PREPAID_METER.id,
    storeId: PREPAID_STORE.id,
    storeCode: PREPAID_STORE.code,
    storeName: PREPAID_STORE.name,
    meterSerial: PREPAID_METER.serialNumber,
    electricityModel: "prepaid",
    revision: 0,
    pendingFromRevision: null,
    pendingPurchaseCount: 0,
    pendingTokenKwhCenti: 0,
    pendingAmountRp: 0,
    lastPurchaseId: "",
    lastConsumedRevision: 0,
    lastAcceptedReadingId: readingId,
    lastAcceptedReadingDate: "2026-09-16",
    lastAcceptedReadingKwhCenti: 10000,
    lastAcceptedCapturedAt: iso("2026-09-16T01:00:00Z"),
    lastEventType: "reading",
    lastEventId: readingId,
    updatedAt: serverTimestamp(),
    masterVersion: MASTER_VERSION,
  });
  await assertSucceeds(batch.commit());
});

await test("pembelian token + state atomik diterima", async () => {
  await seedMaster();
  await assertSucceeds(commitPurchase(crewDb(), purchasePayload(), stateAfterPurchase()));
});

await test("pembelian token tanpa update state ditolak", async () => {
  await seedMaster();
  const db = crewDb();
  const purchase = purchasePayload();
  await assertFails(setDoc(doc(db, "tokenPurchases", `${purchase.meterId}_TRX001`), purchase));
});

await test("saldo pending dinaikkan melebihi struk ditolak", async () => {
  await seedMaster();
  await assertFails(commitPurchase(
    crewDb(),
    purchasePayload(),
    stateAfterPurchase({ pendingTokenKwhCenti: 999999 }),
  ));
});

await test("referensi kode token PLN 20 digit ditolak", async () => {
  await seedMaster();
  const key = "12345678901234567890";
  await assertFails(commitPurchase(
    crewDb(),
    purchasePayload({ receiptReference: key, referenceKey: key }),
    stateAfterPurchase({ lastPurchaseId: `${PREPAID_METER.id}_${key}`, lastEventId: `${PREPAID_METER.id}_${key}` }),
  ));
});

await test("pembacaan harian prabayar menyerap token pending", async () => {
  const readingId = `${PREPAID_METER.id}_2026-09-17`;
  await seedMaster({
    [PREPAID_METER.id]: {
      revision: 1,
      pendingFromRevision: 1,
      pendingPurchaseCount: 1,
      pendingTokenKwhCenti: 5000,
      pendingAmountRp: 100000,
      lastPurchaseId: `${PREPAID_METER.id}_TRX001`,
      lastConsumedRevision: 0,
      lastAcceptedReadingId: `${PREPAID_METER.id}_2026-09-16`,
      lastAcceptedReadingDate: "2026-09-16",
      lastAcceptedReadingKwhCenti: 10000,
      lastAcceptedCapturedAt: iso("2026-09-16T01:00:00Z"),
      lastEventType: "purchase",
      lastEventId: `${PREPAID_METER.id}_TRX001`,
    },
  });
  const db = crewDb();
  // sisa 100 + token 50 - sisa 138 = 12 kWh dalam 24 jam
  const usage = 12;
  const batch = writeBatch(db);
  batch.set(doc(db, "readings", readingId), readingPayload({
    readingDate: "2026-09-17",
    capturedAt: iso("2026-09-17T01:00:00Z"),
    readingKwh: 138,
    previousReadingKwh: 100,
    usageKwh: usage,
    intervalHours: 24,
    normalized24hKwh: usage,
    estimatedCost: Math.round(usage * PREPAID_STORE.tariffPerKwh * 100) / 100,
    anomalyFlags: [],
    tokenAddedKwh: 50,
    tokenLinkDisposition: "consumed",
    tokenPurchaseCount: 1,
    tokenPurchaseTotalKwh: 50,
    tokenPurchaseTotalKwhCenti: 5000,
    tokenPurchaseTotalAmountRp: 100000,
    tokenRevisionStart: 1,
    tokenRevisionEnd: 1,
  }));
  batch.set(doc(db, "tokenStates", PREPAID_METER.id), {
    meterId: PREPAID_METER.id,
    storeId: PREPAID_STORE.id,
    storeCode: PREPAID_STORE.code,
    storeName: PREPAID_STORE.name,
    meterSerial: PREPAID_METER.serialNumber,
    electricityModel: "prepaid",
    revision: 1,
    pendingFromRevision: null,
    pendingPurchaseCount: 0,
    pendingTokenKwhCenti: 0,
    pendingAmountRp: 0,
    lastPurchaseId: `${PREPAID_METER.id}_TRX001`,
    lastConsumedRevision: 1,
    lastAcceptedReadingId: readingId,
    lastAcceptedReadingDate: "2026-09-17",
    lastAcceptedReadingKwhCenti: 13800,
    lastAcceptedCapturedAt: iso("2026-09-17T01:00:00Z"),
    lastEventType: "reading",
    lastEventId: readingId,
    updatedAt: serverTimestamp(),
    masterVersion: MASTER_VERSION,
  });
  await assertSucceeds(batch.commit());
});

await test("pemakaian prabayar dimanipulasi lebih kecil ditolak", async () => {
  await seedMaster({
    [PREPAID_METER.id]: {
      lastAcceptedReadingId: `${PREPAID_METER.id}_2026-09-16`,
      lastAcceptedReadingDate: "2026-09-16",
      lastAcceptedReadingKwhCenti: 10000,
      lastAcceptedCapturedAt: iso("2026-09-16T01:00:00Z"),
      lastEventType: "reading",
      lastEventId: `${PREPAID_METER.id}_2026-09-16`,
    },
  });
  const db = crewDb();
  const readingId = `${PREPAID_METER.id}_2026-09-17`;
  const batch = writeBatch(db);
  batch.set(doc(db, "readings", readingId), readingPayload({
    readingDate: "2026-09-17",
    capturedAt: iso("2026-09-17T01:00:00Z"),
    readingKwh: 88,
    previousReadingKwh: 100,
    usageKwh: 2, // seharusnya 12
    intervalHours: 24,
    normalized24hKwh: 2,
    estimatedCost: Math.round(2 * PREPAID_STORE.tariffPerKwh * 100) / 100,
    anomalyFlags: [],
    tokenAddedKwh: 0,
    tokenLinkDisposition: "consumed",
  }));
  batch.set(doc(db, "tokenStates", PREPAID_METER.id), {
    meterId: PREPAID_METER.id,
    storeId: PREPAID_STORE.id,
    storeCode: PREPAID_STORE.code,
    storeName: PREPAID_STORE.name,
    meterSerial: PREPAID_METER.serialNumber,
    electricityModel: "prepaid",
    revision: 0,
    pendingFromRevision: null,
    pendingPurchaseCount: 0,
    pendingTokenKwhCenti: 0,
    pendingAmountRp: 0,
    lastPurchaseId: "",
    lastConsumedRevision: 0,
    lastAcceptedReadingId: readingId,
    lastAcceptedReadingDate: "2026-09-17",
    lastAcceptedReadingKwhCenti: 8800,
    lastAcceptedCapturedAt: iso("2026-09-17T01:00:00Z"),
    lastEventType: "reading",
    lastEventId: readingId,
    updatedAt: serverTimestamp(),
    masterVersion: MASTER_VERSION,
  });
  await assertFails(batch.commit());
});

await test("pascabayar menolak angka meter turun", async () => {
  await seedMaster();
  const db = crewDb();
  await assertFails(setDoc(doc(db, "readings", `${POSTPAID_METER.id}_2026-09-17`), readingPayload({
    __store: POSTPAID_STORE,
    __meter: POSTPAID_METER,
    readingDate: "2026-09-17",
    capturedAt: iso("2026-09-17T01:00:00Z"),
    readingKwh: 90,
    previousReadingKwh: 100,
    usageKwh: 10,
    intervalHours: 24,
    normalized24hKwh: 10,
    estimatedCost: 10 * POSTPAID_STORE.tariffPerKwh,
    anomalyFlags: [],
  })));
});

await test("baseline pascabayar diterima tanpa tokenState", async () => {
  await seedMaster();
  await assertSucceeds(setDoc(
    doc(crewDb(), "readings", `${POSTPAID_METER.id}_2026-09-16`),
    readingPayload({ __store: POSTPAID_STORE, __meter: POSTPAID_METER }),
  ));
});

await test("pembacaan dengan field foto ditolak", async () => {
  await seedMaster();
  await assertFails(setDoc(
    doc(crewDb(), "readings", `${POSTPAID_METER.id}_2026-09-16`),
    readingPayload({ __store: POSTPAID_STORE, __meter: POSTPAID_METER, photoUrl: "https://x/y.jpg" }),
  ));
});

await test("reading tidak dapat diubah atau dihapus", async () => {
  await seedMaster();
  const db = crewDb();
  const id = `${POSTPAID_METER.id}_2026-09-16`;
  await assertSucceeds(setDoc(doc(db, "readings", id), readingPayload({ __store: POSTPAID_STORE, __meter: POSTPAID_METER })));
  await assertFails(setDoc(doc(db, "readings", id), { recordedBy: "diganti" }, { merge: true }));
});

// =====================================================================
// Uji anti-penyalahgunaan. Sejak v1.1.4 validasi transisi saldo berpindah ke
// rule update tokenStates agar muat dalam batas 1.000 ekspresi Firestore.
// Blok di bawah membuktikan pemisahan itu tidak membuka celah baru.
// =====================================================================

/** State prabayar dengan baseline 100 kWh dan saldo pending 50 kWh / Rp100.000. */
const PENDING_STATE = {
  revision: 1,
  pendingFromRevision: 1,
  pendingPurchaseCount: 1,
  pendingTokenKwhCenti: 5000,
  pendingAmountRp: 100000,
  lastPurchaseId: `${PREPAID_METER.id}_TRX001`,
  lastConsumedRevision: 0,
  lastAcceptedReadingId: `${PREPAID_METER.id}_2026-09-16`,
  lastAcceptedReadingDate: "2026-09-16",
  lastAcceptedReadingKwhCenti: 10000,
  lastAcceptedCapturedAt: iso("2026-09-16T01:00:00Z"),
  lastEventType: "purchase",
  lastEventId: `${PREPAID_METER.id}_TRX001`,
};

const NEXT_ID = `${PREPAID_METER.id}_2026-09-17`;

/** Dokumen pembacaan harian prabayar yang benar terhadap PENDING_STATE. */
function dailyPrepaidReading(overrides = {}) {
  const usage = 12;
  return readingPayload({
    readingDate: "2026-09-17",
    capturedAt: iso("2026-09-17T01:00:00Z"),
    readingKwh: 138,
    previousReadingKwh: 100,
    usageKwh: usage,
    intervalHours: 24,
    normalized24hKwh: usage,
    estimatedCost: Math.round(usage * PREPAID_STORE.tariffPerKwh * 100) / 100,
    anomalyFlags: [],
    tokenAddedKwh: 50,
    tokenLinkDisposition: "consumed",
    tokenPurchaseCount: 1,
    tokenPurchaseTotalKwh: 50,
    tokenPurchaseTotalKwhCenti: 5000,
    tokenPurchaseTotalAmountRp: 100000,
    tokenRevisionStart: 1,
    tokenRevisionEnd: 1,
    ...overrides,
  });
}

/** State sesudah pembacaan harian diterima. */
function stateAfterDailyReading(overrides = {}) {
  return {
    meterId: PREPAID_METER.id,
    storeId: PREPAID_STORE.id,
    storeCode: PREPAID_STORE.code,
    storeName: PREPAID_STORE.name,
    meterSerial: PREPAID_METER.serialNumber,
    electricityModel: "prepaid",
    revision: 1,
    pendingFromRevision: null,
    pendingPurchaseCount: 0,
    pendingTokenKwhCenti: 0,
    pendingAmountRp: 0,
    lastPurchaseId: `${PREPAID_METER.id}_TRX001`,
    lastConsumedRevision: 1,
    lastAcceptedReadingId: NEXT_ID,
    lastAcceptedReadingDate: "2026-09-17",
    lastAcceptedReadingKwhCenti: 13800,
    lastAcceptedCapturedAt: iso("2026-09-17T01:00:00Z"),
    lastEventType: "reading",
    lastEventId: NEXT_ID,
    updatedAt: serverTimestamp(),
    masterVersion: MASTER_VERSION,
    ...overrides,
  };
}

async function seedPending() {
  await seedMaster({ [PREPAID_METER.id]: PENDING_STATE });
}

function commitDaily(db, readingOverrides = {}, stateOverrides = {}) {
  const batch = writeBatch(db);
  batch.set(doc(db, "readings", NEXT_ID), dailyPrepaidReading(readingOverrides));
  batch.set(doc(db, "tokenStates", PREPAID_METER.id), stateAfterDailyReading(stateOverrides));
  return batch.commit();
}

await test("pembacaan prabayar valid tanpa menutup saldo ditolak", async () => {
  await seedPending();
  const db = crewDb();
  await assertFails(setDoc(doc(db, "readings", NEXT_ID), dailyPrepaidReading()));
});

await test("saldo pending dinyatakan habis tanpa pembacaan companion ditolak", async () => {
  await seedPending();
  const db = crewDb();
  await assertFails(setDoc(doc(db, "tokenStates", PREPAID_METER.id), stateAfterDailyReading()));
});

await test("saldo pending disisakan sebagian saat pembacaan ditolak", async () => {
  await seedPending();
  await assertFails(commitDaily(crewDb(), {}, {
    pendingPurchaseCount: 1,
    pendingFromRevision: 1,
    pendingTokenKwhCenti: 5000,
    pendingAmountRp: 100000,
    lastConsumedRevision: 0,
  }));
});

await test("baseline pada state dipalsukan lebih tinggi ditolak", async () => {
  await seedPending();
  await assertFails(commitDaily(crewDb(), {}, { lastAcceptedReadingKwhCenti: 99900 }));
});

await test("previousReadingKwh tidak sama dengan baseline server ditolak", async () => {
  await seedPending();
  await assertFails(commitDaily(crewDb(), {
    previousReadingKwh: 200,
    readingKwh: 238,
  }));
});

await test("revisi token dinaikkan tanpa struk ditolak", async () => {
  await seedPending();
  await assertFails(commitDaily(crewDb(), {}, { revision: 5, lastConsumedRevision: 5 }));
});

await test("tanggal mundur dari pembacaan terakhir ditolak", async () => {
  await seedPending();
  const db = crewDb();
  const oldId = `${PREPAID_METER.id}_2026-09-15`;
  const batch = writeBatch(db);
  batch.set(doc(db, "readings", oldId), dailyPrepaidReading({
    readingDate: "2026-09-15",
    capturedAt: iso("2026-09-15T01:00:00Z"),
  }));
  batch.set(doc(db, "tokenStates", PREPAID_METER.id), stateAfterDailyReading({
    lastAcceptedReadingId: oldId,
    lastAcceptedReadingDate: "2026-09-15",
    lastAcceptedCapturedAt: iso("2026-09-15T01:00:00Z"),
    lastEventId: oldId,
  }));
  await assertFails(batch.commit());
});

await test("id dokumen tidak sesuai meter dan tanggal ditolak", async () => {
  await seedPending();
  const db = crewDb();
  const batch = writeBatch(db);
  batch.set(doc(db, "readings", `${PREPAID_METER.id}_2026-09-18`), dailyPrepaidReading());
  batch.set(doc(db, "tokenStates", PREPAID_METER.id), stateAfterDailyReading());
  await assertFails(batch.commit());
});

await test("createdByUid milik user lain ditolak", async () => {
  await seedPending();
  await assertFails(commitDaily(crewDb(), { createdByUid: "uid-lain" }));
});

await test("status needs_review wajib memindahkan saldo ke provisional", async () => {
  await seedPending();
  const db = crewDb();
  // Pemakaian nol wajib alasan, status needs_review, dan saldo tidak bergerak.
  await assertSucceeds(setDoc(doc(db, "readings", NEXT_ID), dailyPrepaidReading({
    readingKwh: 150,
    usageKwh: 0,
    normalized24hKwh: 0,
    estimatedCost: 0,
    status: "needs_review",
    anomalyFlags: ["zero_usage"],
    reason: "Store tutup renovasi",
    tokenLinkDisposition: "provisional",
  })));
});

await test("needs_review yang ikut menutup saldo ditolak", async () => {
  await seedPending();
  await assertFails(commitDaily(crewDb(), {
    readingKwh: 150,
    usageKwh: 0,
    normalized24hKwh: 0,
    estimatedCost: 0,
    status: "needs_review",
    anomalyFlags: ["zero_usage"],
    reason: "Store tutup renovasi",
    tokenLinkDisposition: "provisional",
  }));
});

await test("pemakaian nol tanpa alasan ditolak", async () => {
  await seedPending();
  await assertFails(setDoc(doc(crewDb(), "readings", NEXT_ID), dailyPrepaidReading({
    readingKwh: 150,
    usageKwh: 0,
    normalized24hKwh: 0,
    estimatedCost: 0,
    status: "needs_review",
    anomalyFlags: ["zero_usage"],
    reason: "",
    tokenLinkDisposition: "provisional",
  })));
});

await test("pemakaian di atas kapasitas meter wajib needs_review", async () => {
  await seedPending();
  const db = crewDb();
  // Meter 3500 VA -> batas 84 kWh per 24 jam. Pemakaian 90 kWh harus ditinjau.
  await assertFails(commitDaily(db, {
    readingKwh: 60,
    usageKwh: 90,
    normalized24hKwh: 90,
    estimatedCost: Math.round(90 * PREPAID_STORE.tariffPerKwh * 100) / 100,
    status: "valid",
    anomalyFlags: [],
  }));
});

await test("estimasi biaya dimanipulasi ditolak", async () => {
  await seedPending();
  await assertFails(commitDaily(crewDb(), { estimatedCost: 1 }));
});

await test("tarif berbeda dari master ditolak", async () => {
  await seedPending();
  await assertFails(commitDaily(crewDb(), { tariffPerKwh: 1 }));
});

await test("nama store dipalsukan ditolak", async () => {
  await seedPending();
  await assertFails(commitDaily(crewDb(), { storeName: "STORE PALSU" }));
});

await test("referensi struk yang sama dua kali ditolak", async () => {
  await seedMaster();
  const db = crewDb();
  await assertSucceeds(commitPurchase(db, purchasePayload(), stateAfterPurchase()));
  // Percobaan kedua dengan referensi sama: dokumen sudah ada, create ditolak.
  await assertFails(commitPurchase(db, purchasePayload({ revision: 2 }), stateAfterPurchase({
    revision: 2,
    pendingPurchaseCount: 2,
    pendingTokenKwhCenti: 10000,
    pendingAmountRp: 200000,
  })));
});

await test("saldo prabayar tidak dapat digerakkan oleh pembacaan pascabayar", async () => {
  await seedPending();
  const db = crewDb();
  const postpaidId = `${POSTPAID_METER.id}_2026-09-17`;
  const batch = writeBatch(db);
  batch.set(doc(db, "readings", postpaidId), readingPayload({
    __store: POSTPAID_STORE,
    __meter: POSTPAID_METER,
    readingDate: "2026-09-17",
    capturedAt: iso("2026-09-17T01:00:00Z"),
  }));
  batch.set(doc(db, "tokenStates", PREPAID_METER.id), stateAfterDailyReading({
    lastAcceptedReadingId: postpaidId,
    lastEventId: postpaidId,
  }));
  await assertFails(batch.commit());
});

await test("field tambahan pada state token ditolak", async () => {
  await seedPending();
  await assertFails(commitDaily(crewDb(), {}, { catatanTambahan: "x" }));
});

await test("state token tidak dapat dihapus", async () => {
  await seedPending();
  const { deleteDoc } = await import("firebase/firestore");
  await assertFails(deleteDoc(doc(crewDb(), "tokenStates", PREPAID_METER.id)));
});

await env.cleanup();

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} uji lolos.`);
if (failed.length) {
  for (const row of failed) console.log(`\n--- ${row.name} ---\n${row.error.stack}`);
  process.exit(1);
}
