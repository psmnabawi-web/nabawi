// Tes logika kepatuhan (public/kepatuhan.js). Jalankan: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, slotsFromSettings, statusOf, actualTime, photoSource, dateRange, ymdWib, supersededIds } from "../public/kepatuhan.js";
import { val } from "../public/core.js";

const settings = { slot1: "09:00", slot2: "16:00", slot3: "23:30", toleranceMin: 30, maxAgeHours: 24 };
const stores = [
  { id: "A", name: "Store A", area: "BANTEN", active: true, activeFrom: "2026-10-01" },
  { id: "B", name: "Store B", area: "DKI JAKARTA", active: true, activeFrom: "2026-10-03" },
  { id: "C", name: "Store C", area: "BANTEN", active: false, activeFrom: "2026-10-01" },
];
const rec = (storeId, dateKey, slotId, status, extra = {}) => ({ storeId, dateKey, slotId, status, complianceScore: status === "ON TIME" ? 1 : 0.5, ...extra });
// "sekarang" = Senin 05/10/2026 16.45 WIB → slot 09:00 dan 16:00 hari ini sudah jatuh tempo, 23:30 belum
const NOW = Date.parse("2026-10-05T09:45:00Z");

test("slot dari settings app, urut slot1..slotN", () => {
  assert.deepEqual(slotsFromSettings(settings).map((s) => `${s.id}@${s.time}`), ["FILTER-1@09:00", "FILTER-2@16:00", "FILTER-3@23:30"]);
  assert.equal(slotsFromSettings({}).length, 3, "fallback 3 slot bila settings kosong");
  assert.deepEqual(slotsFromSettings({ slot2: "8.5", slot1: "07.00" }).map((s) => s.time), ["07:00"]);
});

test("status: pakai status app, atau hitung dari selisih menit dan toleransi", () => {
  assert.equal(statusOf({ status: "ON TIME" }).key, "ONTIME");
  assert.equal(statusOf({ status: "early" }).key, "EARLY");
  assert.equal(statusOf({ status: "LATE" }).key, "LATE");
  assert.equal(statusOf({ deviationMin: 30 }, 30).key, "ONTIME");
  assert.equal(statusOf({ deviationMin: -31 }, 30).key, "EARLY");
  assert.equal(statusOf({ deviationMin: 45 }, 30).key, "LATE");
});

test("jam aktual & sumber foto", () => {
  assert.equal(actualTime({ evidenceLocalIso: "2026-10-05T11:24:13" }, "2026-10-05"), "11:24");
  assert.equal(actualTime({ evidenceLocalIso: "2026-10-06T00:12:00" }, "2026-10-05"), "06/10 00:12");
  assert.equal(actualTime({ submittedAt: "2026-10-05T04:24:29.697Z" }, "2026-10-05"), "11:24");
  assert.equal(photoSource({ evidenceTimeSource: "Capture Session", metadataTrust: "MEDIUM" }), "Kamera app");
  assert.equal(photoSource({ evidenceTimeSource: "File lastModified", metadataTrust: "LOW" }), "Dari galeri");
});

test("laporan: slot wajib mulai activeFrom, store nonaktif keluar, slot hari ini yang belum jatuh tempo tidak dihitung", () => {
  const records = [
    rec("A", "2026-10-04", "FILTER-1", "ON TIME", { evidenceTimeSource: "File lastModified", metadataTrust: "LOW" }),
    rec("A", "2026-10-04", "FILTER-2", "EARLY"),
    rec("A", "2026-10-04", "FILTER-3", "LATE"),
    rec("A", "2026-10-05", "FILTER-1", "ON TIME"),
    rec("A", "2026-10-05", "FILTER-3", "ON TIME"), // slot 23:30 hari ini sudah dikerjakan lebih awal → tetap dihitung
    rec("B", "2026-10-05", "FILTER-1", "LATE"),
    rec("C", "2026-10-05", "FILTER-1", "ON TIME"), // store nonaktif
    rec("A", "2026-09-30", "FILTER-1", "ON TIME"), // sebelum periode
    rec("A", "2026-10-04", "FILTER-1", "LATE", { dedupArchived: true }), // duplikat diarsip
  ];
  const r = buildReport({ stores, records, settings, start: "2026-10-04", end: "2026-10-06", nowMs: NOW, target: 0.9 });
  assert.equal(r.end, "2026-10-05", "akhir periode dipotong ke hari ini");
  assert.deepEqual(r.days, ["2026-10-04", "2026-10-05"]);
  const A = r.stores.find((s) => s.id === "A");
  const B = r.stores.find((s) => s.id === "B");
  assert.equal(r.stores.find((s) => s.id === "C"), undefined);
  // A: 04/10 → 3 slot (1 + 0.5 + 0.5); 05/10 → slot1 (1), slot2 tidak dikerjakan (0), slot3 dikerjakan (1)
  assert.deepEqual([A.expected, A.ONTIME, A.EARLY, A.LATE, A.MISSED], [6, 3, 1, 1, 1]);
  assert.equal(A.score, 4 / 6);
  assert.equal(A.gallery, 1);
  assert.equal(A.compliant, false);
  // B: aktif mulai 03/10 → 04/10 tiga slot tidak dikerjakan, 05/10 slot1 terlambat, slot2 tidak dikerjakan, slot3 belum jatuh tempo
  assert.deepEqual([B.expected, B.LATE, B.MISSED], [5, 1, 4]);
  assert.equal(r.pending, 1);
  assert.equal(r.stores[0].id, "B", "urut dari skor terendah");
  assert.equal(r.total.expected, 11);
  assert.equal(r.total.done, 6);
  assert.equal(r.nonCompliant, 2);
  assert.deepEqual(r.areas, ["BANTEN", "DKI JAKARTA"]);
  // harian
  assert.equal(A.daily["2026-10-04"].score, 2 / 3);
  assert.equal(A.daily["2026-10-05"].done, 2);
});

test("filter area & target", () => {
  const records = [rec("A", "2026-10-04", "FILTER-1", "ON TIME"), rec("A", "2026-10-04", "FILTER-2", "ON TIME"), rec("A", "2026-10-04", "FILTER-3", "ON TIME")];
  const r = buildReport({ stores, records, settings, start: "2026-10-04", end: "2026-10-04", nowMs: NOW, area: "BANTEN", target: 1 });
  assert.deepEqual(r.stores.map((s) => s.id), ["A"]);
  assert.equal(r.stores[0].compliant, true);
  assert.equal(r.nonCompliant, 0);
});

test("dua catatan untuk slot yang sama: ambil status terbaik", () => {
  const records = [rec("A", "2026-10-04", "FILTER-1", "LATE", { submittedAt: "2026-10-04T03:00:00Z" }), rec("A", "2026-10-04", "FILTER-1", "ON TIME", { submittedAt: "2026-10-04T02:10:00Z" })];
  const r = buildReport({ stores, records, settings, start: "2026-10-04", end: "2026-10-04", nowMs: NOW });
  const row = r.rows.find((x) => x.storeId === "A" && x.slotId === "FILTER-1");
  assert.equal(row.status, "ONTIME");
});

test("koreksi slot: record asal yang sudah punya salinan (slotCorrection.fromRecordId) tidak dihitung", () => {
  const stores = [{ id: "J", name: "Jagakarsa", active: true }];
  const settings = { slot1: "09:00", slot2: "16:00", slot3: "23:30", toleranceMin: 30 };
  const orig = { id: "2026-10-11_J_FILTER-1", storeId: "J", dateKey: "2026-10-11", slotId: "FILTER-1", status: "EARLY", deviationMin: -500, evidenceLocalIso: "2026-10-11T00:40:59" };
  const copy = { ...orig, id: "2026-10-10_J_FILTER-3", dateKey: "2026-10-10", slotId: "FILTER-3", status: "LATE", deviationMin: 70,
    slotCorrection: { fromRecordId: orig.id, fromDateKey: "2026-10-11", fromSlotId: "FILTER-1" } };
  assert.deepEqual([...supersededIds([orig, copy])], [orig.id]);
  const r = buildReport({ stores, records: [orig, copy], settings, start: "2026-10-10", end: "2026-10-11", nowMs: Date.parse("2026-10-11T05:00:00Z") }); // 12.00 WIB
  const at = (d, s) => r.rows.find((x) => x.date === d && x.slotId === s);
  assert.equal(at("2026-10-10", "FILTER-3").status, "LATE");
  assert.equal(at("2026-10-10", "FILTER-3").actual, "11/10 00:40");
  assert.equal(at("2026-10-11", "FILTER-1").status, "MISSED"); // asal tidak lagi mengisi Filter 1 11/10
  assert.equal(r.total.expected - r.total.MISSED, 1);            // foto yang sama tidak terhitung dua kali
  // tanpa salinan, record asal tetap dihitung seperti biasa
  const r2 = buildReport({ stores, records: [orig], settings, start: "2026-10-11", end: "2026-10-11", nowMs: Date.parse("2026-10-11T05:00:00Z") });
  assert.equal(r2.rows.find((x) => x.slotId === "FILTER-1").status, "EARLY");
});

test("val(): mapValue Firestore jadi objek biasa", () => {
  assert.deepEqual(val({ mapValue: { fields: { fromRecordId: { stringValue: "x" }, n: { integerValue: "3" } } } }), { fromRecordId: "x", n: 3 });
});

test("utilitas tanggal WIB", () => {
  assert.equal(ymdWib(Date.parse("2026-10-04T17:30:00Z")), "2026-10-05"); // 00.30 WIB
  assert.equal(dateRange("2026-09-29", "2026-10-02").length, 4);
  assert.deepEqual(dateRange("2026-10-02", "2026-10-01"), []);
});
