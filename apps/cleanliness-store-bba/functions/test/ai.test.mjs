// Uji ai.js dengan klien GoogleGenAI tiruan: pemilihan provider, structured→tanpa schema, rate limit→cadangan, parser.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const ai = createRequire(import.meta.url)("../ai.js");

const point = { id: "PEST-01", area: "Pest & Preventive", title: "Sudut & bawah equipment", photoGuide: "Foto sudut kitchen.", passCriteria: ["Tidak ada sisa makanan", "Area kering"] };
const session = { storeName: "JAKAL UII", slot: "SHIFT_1", operationalDate: "2026-10-10" };
const img = [Buffer.from("foto")], mimes = ["image/jpeg"];
const okJson = '{"validPhoto":true,"score":88,"confidence":0.9,"reason":"Bersih, sedikit debu.","issues":["Debu tipis"]}';
const err = (status, message) => Object.assign(new Error(message), { status });

// Klien tiruan: `script` = daftar respons per panggilan (string = teks balasan, Error = dilempar). Mencatat setiap panggilan.
function fakeFactory(script) {
  const calls = [];
  const createClient = (opts) => ({ models: { generateContent: async (req) => {
    const i = calls.length; calls.push({ opts, model: req.model, structured: !!req.config.responseJsonSchema, prompt: req.contents[0].parts[0].text, parts: req.contents[0].parts.length });
    const r = script[Math.min(i, script.length - 1)];
    if (r instanceof Error) throw r;
    return { text: r, modelVersion: req.model + "-001" };
  } } });
  return { createClient, calls };
}
const deps = (f, env) => ({ createClient: f.createClient, logger: { warn() {}, info() {} }, sleep: async () => {}, env: { GCLOUD_PROJECT: "cleanliness-store-bba", GEMINI_API_KEY: "key", ...env } });

beforeEach(() => ai._resetStructuredCache());

test("default: Gemma 4 31B lewat Gemini API, structured output, 2 part (teks + gambar)", async () => {
  const f = fakeFactory([okJson]);
  const r = await ai.analyzeImages(point, img, mimes, session, deps(f, {}));
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].opts, { apiKey: "key" });
  assert.equal(f.calls[0].model, "gemma-4-31b-it"); assert.equal(f.calls[0].structured, true); assert.equal(f.calls[0].parts, 2);
  assert.match(f.calls[0].prompt, /FORMAT OUTPUT/);
  assert.equal(r.provider, "gemini"); assert.equal(r.model, "gemma-4-31b-it-001"); assert.equal(r.score, 88); assert.equal(r.status, "NEED_CLEANING");
  assert.equal(r.structuredOutput, true); assert.equal(r.fallbackReason, "");
});

test("model menolak schema (400) → diulang tanpa schema, dan panggilan berikutnya langsung tanpa schema", async () => {
  const f = fakeFactory([err(400, "response_json_schema is not supported for this model"), okJson, okJson]);
  const r1 = await ai.analyzeImages(point, img, mimes, session, deps(f, {}));
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0].structured, true); assert.equal(f.calls[1].structured, false);
  assert.equal(r1.structuredOutput, false); assert.equal(r1.provider, "gemini");
  await ai.analyzeImages(point, img, mimes, session, deps(f, {}));
  assert.equal(f.calls.length, 3); assert.equal(f.calls[2].structured, false, "model yang menolak schema diingat");
});

test("rate limit 429 dua kali → tunggu sekali lalu cadangan Vertex gemini-2.5-flash", async () => {
  const f = fakeFactory([err(429, "RESOURCE_EXHAUSTED: quota"), err(429, "RESOURCE_EXHAUSTED: quota"), okJson]);
  const r = await ai.analyzeImages(point, img, mimes, session, deps(f, {}));
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls[2].opts, { vertexai: true, project: "cleanliness-store-bba", location: "global" });
  assert.equal(f.calls[2].model, "gemini-2.5-flash");
  assert.equal(r.provider, "vertex"); assert.match(r.fallbackReason, /gemini\/gemma-4-31b-it: AI_QUOTA/);
});

test("FALLBACK=none dan kuota habis → error resource-exhausted dengan pesan ramah", async () => {
  const f = fakeFactory([err(429, "quota exceeded")]);
  await assert.rejects(ai.analyzeImages(point, img, mimes, session, deps(f, { CLEANLINESS_AI_FALLBACK: "none" })), (e) => e.code === "AI_QUOTA" && /Kuota AI sedang penuh/.test(e.message));
  assert.equal(f.calls.length, 2, "429 dicoba ulang sekali sebelum menyerah");
});

test("GEMINI_API_KEY belum diisi → langsung cadangan Vertex, tidak ada panggilan Gemini", async () => {
  const f = fakeFactory([okJson]);
  const r = await ai.analyzeImages(point, img, mimes, session, deps(f, { GEMINI_API_KEY: "" }));
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].opts.vertexai, true);
  assert.equal(r.provider, "vertex"); assert.match(r.fallbackReason, /AI_CONFIG/);
});

test("provider vertex eksplisit dengan model & lokasi custom, cadangan gemini", async () => {
  const f = fakeFactory([err(503, "UNAVAILABLE overloaded"), okJson]);
  const r = await ai.analyzeImages(point, img, mimes, session, deps(f, { CLEANLINESS_AI_PROVIDER: "vertex", CLEANLINESS_AI_MODEL: "gemini-2.5-pro", CLEANLINESS_AI_LOCATION: "asia-southeast1", CLEANLINESS_AI_FALLBACK: "gemini" }));
  assert.deepEqual(f.calls[0].opts, { vertexai: true, project: "cleanliness-store-bba", location: "asia-southeast1" }); assert.equal(f.calls[0].model, "gemini-2.5-pro");
  assert.equal(f.calls[1].model, "gemma-4-31b-it"); assert.equal(r.provider, "gemini"); assert.match(r.fallbackReason, /AI_SERVER/);
});

test("output berpagar ```json dan teks pembuka tetap terbaca; output rusak 2x → cadangan", async () => {
  const f1 = fakeFactory(["Berikut hasilnya:\n```json\n" + okJson + "\n```"]);
  const r1 = await ai.analyzeImages(point, img, mimes, session, deps(f1, {}));
  assert.equal(r1.score, 88);
  const f2 = fakeFactory(["maaf saya tidak bisa", "tetap bukan json", okJson]);
  const r2 = await ai.analyzeImages(point, img, mimes, session, deps(f2, {}));
  assert.equal(f2.calls.length, 3); assert.match(f2.calls[1].prompt, /PERBAIKAN OUTPUT/); assert.equal(r2.provider, "vertex"); assert.match(r2.fallbackReason, /AI_OUTPUT/);
});

test("foto tidak valid → INVALID, score 0; nilai di luar batas dipangkas; issues maksimal 3", async () => {
  const f = fakeFactory(['{"validPhoto":false,"score":77,"confidence":1.7,"reason":"","issues":["a","b","c","d"]}']);
  const r = await ai.analyzeImages(point, img, mimes, session, deps(f, {}));
  assert.equal(r.validPhoto, false); assert.equal(r.score, 0); assert.equal(r.status, "INVALID"); assert.equal(r.confidence, 1); assert.equal(r.issues.length, 3);
  assert.match(r.reason, /tidak cukup valid/);
});

test("resolveConfig: default dan override", () => {
  const c = ai.resolveConfig({ GCLOUD_PROJECT: "p" });
  assert.deepEqual(c.primary, { provider: "gemini", model: "gemma-4-31b-it" }); assert.deepEqual(c.fallback, { provider: "vertex", model: "gemini-2.5-flash" });
  const d = ai.resolveConfig({ CLEANLINESS_AI_PROVIDER: "gemini", CLEANLINESS_AI_MODEL: "gemma-4-26b-a4b-it", CLEANLINESS_AI_FALLBACK: "none" });
  assert.equal(d.primary.model, "gemma-4-26b-a4b-it"); assert.equal(d.fallback, null);
});
