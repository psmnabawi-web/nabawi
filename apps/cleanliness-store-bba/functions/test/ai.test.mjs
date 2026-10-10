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

// ---------- Provider OpenAI-compatible (fetch tiruan) ----------
function fakeFetchFactory(script) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const i = calls.length; calls.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) });
    const r = script[Math.min(i, script.length - 1)];
    if (r instanceof Error) throw r;
    const { status = 200, json } = r;
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(json) };
  };
  return { fetchImpl, calls };
}
const chat = (content, model = "qwen-vl-max-2026") => ({ json: { model, choices: [{ message: { content }, finish_reason: "stop" }] } });
const depsOpenAI = (ff, env = {}, google = null) => ({
  fetch: ff.fetchImpl, logger: { warn() {}, info() {} }, sleep: async () => {},
  createClient: (o) => (o.openai ? ai.openAiClient(o, ff.fetchImpl) : google ? google.createClient(o) : (() => { throw new Error("klien Google tidak diharapkan"); })()),
  env: { GCLOUD_PROJECT: "cleanliness-store-bba", CLEANLINESS_AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-test", OPENAI_BASE_URL: "https://relay.example/v1/", CLEANLINESS_AI_MODEL: "qwen-vl-max", ...env },
});

test("openai: POST chat/completions dengan teks + gambar data URL, response_format json_object, Bearer key", async () => {
  const ff = fakeFetchFactory([chat(okJson)]);
  const r = await ai.analyzeImages(point, img, mimes, session, depsOpenAI(ff));
  assert.equal(ff.calls.length, 1);
  assert.equal(ff.calls[0].url, "https://relay.example/v1/chat/completions");
  assert.equal(ff.calls[0].auth, "Bearer sk-test");
  const b = ff.calls[0].body;
  assert.equal(b.model, "qwen-vl-max"); assert.deepEqual(b.response_format, { type: "json_object" }); assert.equal(b.temperature, 0);
  assert.equal(b.messages[0].content[0].type, "text"); assert.match(b.messages[0].content[0].text, /FORMAT OUTPUT/);
  assert.equal(b.messages[0].content[1].type, "image_url");
  assert.equal(b.messages[0].content[1].image_url.url, "data:image/jpeg;base64," + Buffer.from("foto").toString("base64"));
  assert.equal(r.provider, "openai"); assert.equal(r.model, "qwen-vl-max-2026"); assert.equal(r.score, 88); assert.equal(r.structuredOutput, true); assert.equal(r.fallbackReason, "");
});

test("openai: response_format ditolak (400) → ulang tanpa response_format; konten berbentuk array juga terbaca", async () => {
  const ff = fakeFetchFactory([{ status: 400, json: { error: { message: "Invalid parameter: response_format is not supported" } } }, chat([{ type: "text", text: okJson }])]);
  const r = await ai.analyzeImages(point, img, mimes, session, depsOpenAI(ff));
  assert.equal(ff.calls.length, 2); assert.equal(ff.calls[1].body.response_format, undefined); assert.equal(r.structuredOutput, false); assert.equal(r.score, 88);
});

test("openai: 429 dua kali → cadangan Vertex; 401 → langsung cadangan dengan alasan AI_AUTH", async () => {
  const g = fakeFactory([okJson]);
  const ff = fakeFetchFactory([{ status: 429, json: { error: { message: "rate limit exceeded" } } }]);
  const r = await ai.analyzeImages(point, img, mimes, session, depsOpenAI(ff, {}, g));
  assert.equal(ff.calls.length, 2); assert.equal(g.calls.length, 1); assert.equal(g.calls[0].model, "gemini-2.5-flash");
  assert.equal(r.provider, "vertex"); assert.match(r.fallbackReason, /openai\/qwen-vl-max: AI_QUOTA/);
  const g2 = fakeFactory([okJson]); const ff2 = fakeFetchFactory([{ status: 401, json: { error: { message: "invalid api key" } } }]);
  const r2 = await ai.analyzeImages(point, img, mimes, session, depsOpenAI(ff2, {}, g2));
  assert.equal(ff2.calls.length, 1); assert.equal(r2.provider, "vertex"); assert.match(r2.fallbackReason, /AI_AUTH/);
});

test("openai: jaringan putus → AI_SERVER → cadangan; 503 dengan FALLBACK=none → pesan ramah; model tidak ada (404) → cadangan", async () => {
  const g = fakeFactory([okJson]); const ff = fakeFetchFactory([new Error("socket hang up")]);
  const r = await ai.analyzeImages(point, img, mimes, session, depsOpenAI(ff, {}, g));
  assert.equal(r.provider, "vertex"); assert.match(r.fallbackReason, /AI_SERVER/);
  const ff2 = fakeFetchFactory([{ status: 503, json: { error: { message: "upstream unavailable" } } }]);
  await assert.rejects(ai.analyzeImages(point, img, mimes, session, depsOpenAI(ff2, { CLEANLINESS_AI_FALLBACK: "none" })), (e) => e.code === "AI_SERVER" && /gangguan/.test(e.message));
  const g3 = fakeFactory([okJson]); const ff3 = fakeFetchFactory([{ status: 404, json: { error: { message: "model not found" } } }]);
  const r3 = await ai.analyzeImages(point, img, mimes, session, depsOpenAI(ff3, {}, g3));
  assert.equal(ff3.calls.length, 1); assert.equal(r3.provider, "vertex"); assert.match(r3.fallbackReason, /AI_ERROR HTTP 404/);
});

test("resolveConfig openai: alias qwen, base URL tanpa slash akhir, cadangan openai untuk provider gemini", () => {
  const c = ai.resolveConfig({ CLEANLINESS_AI_PROVIDER: "qwen", OPENAI_BASE_URL: "https://relay.example/v1///", OPENAI_API_KEY: "k" });
  assert.equal(c.primary.provider, "openai"); assert.equal(c.primary.model, "qwen-vl-max"); assert.equal(c.openai.baseUrl, "https://relay.example/v1");
  assert.deepEqual(c.fallback, { provider: "vertex", model: "gemini-2.5-flash" });
  const d = ai.resolveConfig({ CLEANLINESS_AI_PROVIDER: "gemini", CLEANLINESS_AI_FALLBACK: "openai", CLEANLINESS_AI_FALLBACK_MODEL: "qwen2.5-vl-72b-instruct" });
  assert.deepEqual(d.fallback, { provider: "openai", model: "qwen2.5-vl-72b-instruct" });
});
