'use strict';
// Mesin AI untuk scoring foto (dipakai scoreEvidence). Tanpa dependensi Firebase supaya bisa diuji lokal.
//
// Env (set saat deploy):
//   CLEANLINESS_AI_PROVIDER        openai = endpoint OpenAI-compatible (chat/completions, mis. relay Qwen) dengan OPENAI_API_KEY
//                                  gemini (default) = Gemini API free tier dengan GEMINI_API_KEY | vertex = Vertex AI (ADC project)
//   CLEANLINESS_AI_MODEL           default qwen-vl-max (openai) / gemma-4-31b-it (gemini) / gemini-2.5-flash (vertex)
//   OPENAI_BASE_URL                default https://bandelbanget.xyz/v1 (tanpa /chat/completions)
//   OPENAI_API_KEY                 secret untuk provider openai
//   GEMINI_API_KEY                 secret dari Google AI Studio (wajib untuk provider gemini)
//   CLEANLINESS_AI_TIMEOUT_MS      batas waktu satu panggilan provider openai, default 75000
//   CLEANLINESS_AI_FALLBACK        vertex (default) | gemini | openai | none → dipakai bila provider utama kena rate limit, gangguan
//                                  server, key belum diisi / ditolak, model tidak ada, atau output tetap tidak valid setelah 2 percobaan
//   CLEANLINESS_AI_FALLBACK_MODEL  default mengikuti provider cadangan
//   CLEANLINESS_AI_LOCATION        lokasi Vertex, default global
//   CLEANLINESS_AI_RETRY_WAIT_MS   jeda sebelum mencoba ulang saat rate limit, default 6000
//
// Structured output (responseJsonSchema / response_format json_object) dicoba lebih dulu. Bila model menolaknya (HTTP 400),
// permintaan diulang tanpa itu dan model ditandai agar permintaan berikutnya langsung tanpa schema; format JSON tetap dipaksa
// lewat prompt + parser.

const DEFAULTS = {
  openai: { model: 'qwen-vl-max', baseUrl: 'https://bandelbanget.xyz/v1' },
  gemini: { model: 'gemma-4-31b-it' },
  vertex: { model: 'gemini-2.5-flash', location: 'global' },
};
const PROVIDERS = ['openai', 'gemini', 'vertex'];
const normProvider = (v, dflt) => { v = String(v || '').toLowerCase().trim(); if (v === 'qwen') v = 'openai'; return PROVIDERS.includes(v) ? v : dflt; };
const RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    validPhoto: { type: 'boolean' }, score: { type: 'integer', minimum: 0, maximum: 100 }, confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string' }, issues: { type: 'array', items: { type: 'string' }, maxItems: 3 },
  },
  required: ['validPhoto', 'score', 'confidence', 'reason', 'issues'], propertyOrdering: ['validPhoto', 'score', 'confidence', 'reason', 'issues'],
};
const FIX_TEXT = '\n\nPERBAIKAN OUTPUT: Respons harus berupa SATU object JSON valid sesuai format. Jangan tulis markdown, penjelasan, atau teks di luar JSON.';
const unsupportedStructured = new Set(); // "provider:model" yang menolak structured output

function clamp(n, min, max) { n = Number(n); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min; }
function safeShort(s, max = 160) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max - 1) + '…' : s; }
function visualStatus(valid, score) { if (!valid) return 'INVALID'; if (score >= 90) return 'CLEAN'; if (score >= 70) return 'NEED_CLEANING'; return 'DIRTY'; }

function extractResponseText(response) {
  if (!response) return '';
  try {
    if (typeof response.text === 'string' && response.text.trim()) return response.text;
    if (typeof response.text === 'function') { const t = response.text(); if (typeof t === 'string' && t.trim()) return t; }
  } catch { /* abaikan */ }
  if (typeof response.output_text === 'string' && response.output_text.trim()) return response.output_text;
  const chunks = [];
  for (const c of (response.candidates || [])) for (const part of (c?.content?.parts || [])) if (typeof part?.text === 'string' && !part.thought) chunks.push(part.text);
  return chunks.join('\n').trim();
}
function parseModelJson(input = '') {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input;
  const cleaned = String(input || '').replace(/^﻿/, '').replace(/```(?:json)?/gi, '').trim();
  if (!cleaned) throw new Error('AI tidak mengembalikan teks hasil.');
  const attempts = [cleaned];
  const first = cleaned.indexOf('{'), last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) attempts.push(cleaned.slice(first, last + 1));
  for (const x of attempts) { try { return JSON.parse(x); } catch { /* coba berikutnya */ } }
  const score = cleaned.match(/(?:"?score"?\s*[:=]\s*)(\d{1,3}(?:\.\d+)?)/i);
  const valid = cleaned.match(/(?:"?validPhoto"?\s*[:=]\s*)(true|false)/i);
  const confidence = cleaned.match(/(?:"?confidence"?\s*[:=]\s*)(0(?:\.\d+)?|1(?:\.0+)?)/i);
  if (score && valid) {
    const reason = cleaned.match(/(?:"?reason"?\s*[:=]\s*)["']?([^\n\r,"'}]{4,220})/i);
    return { validPhoto: valid[1].toLowerCase() === 'true', score: Number(score[1]), confidence: confidence ? Number(confidence[1]) : 0.5, reason: reason ? reason[1].trim() : 'Kondisi dinilai dari evidence foto.', issues: [] };
  }
  throw new Error('Model tidak mengembalikan JSON yang dapat dibaca.');
}
function responseDiagnostics(response, text = '') {
  const c = response?.candidates?.[0] || {};
  return safeShort(`finish=${c.finishReason || '-'} text=${String(text || '').replace(/\s+/g, ' ').trim() || '[empty]'}`, 260);
}

function resolveConfig(env = process.env) {
  const prov = normProvider(env.CLEANLINESS_AI_PROVIDER, 'gemini');
  const fbProv = normProvider(env.CLEANLINESS_AI_FALLBACK || 'vertex', null);
  return {
    primary: { provider: prov, model: (env.CLEANLINESS_AI_MODEL || '').trim() || DEFAULTS[prov].model },
    fallback: fbProv && fbProv !== prov ? { provider: fbProv, model: (env.CLEANLINESS_AI_FALLBACK_MODEL || '').trim() || DEFAULTS[fbProv].model } : null,
    openai: {
      baseUrl: String(env.OPENAI_BASE_URL || DEFAULTS.openai.baseUrl).trim().replace(/\/+$/, ''),
      apiKey: (env.OPENAI_API_KEY || '').trim(),
      timeoutMs: Number(env.CLEANLINESS_AI_TIMEOUT_MS) > 0 ? Number(env.CLEANLINESS_AI_TIMEOUT_MS) : 75000,
    },
    project: env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || '',
    location: env.CLEANLINESS_AI_LOCATION || DEFAULTS.vertex.location,
    apiKey: (env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '').trim(),
    retryWaitMs: Number(env.CLEANLINESS_AI_RETRY_WAIT_MS) > 0 ? Number(env.CLEANLINESS_AI_RETRY_WAIT_MS) : 6000,
  };
}
function clientOptions(provider, cfg) {
  if (provider === 'openai') {
    if (!cfg.openai.apiKey) throw Object.assign(new Error('OPENAI_API_KEY belum diisi (secret endpoint OpenAI-compatible).'), { code: 'AI_CONFIG' });
    return { openai: true, baseUrl: cfg.openai.baseUrl, apiKey: cfg.openai.apiKey, timeoutMs: cfg.openai.timeoutMs };
  }
  if (provider === 'gemini') {
    if (!cfg.apiKey) throw Object.assign(new Error('GEMINI_API_KEY belum diisi (secret Gemini API).'), { code: 'AI_CONFIG' });
    return { apiKey: cfg.apiKey };
  }
  if (!cfg.project) throw Object.assign(new Error('Project ID runtime tidak ditemukan untuk Vertex AI.'), { code: 'AI_CONFIG' });
  return { vertexai: true, project: cfg.project, location: cfg.location };
}
function classifyError(err) {
  const status = Number(err?.status || err?.error?.code || (typeof err?.code === 'number' ? err.code : 0)) || 0;
  const message = String(err?.message || err || '');
  const quota = status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit|too many requests/i.test(message);
  const server = [500, 502, 503, 504].includes(status) || /UNAVAILABLE|overloaded|deadline exceeded|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i.test(message);
  const auth = status === 401 || status === 403;
  const schemaUnsupported = status === 400 && /schema|mime|json|structured|not supported|unsupported|invalid argument|response_format/i.test(message);
  return { status, quota, server, auth, schemaUnsupported, message };
}

function buildPrompt(point, session) {
  return `Anda adalah auditor kebersihan restoran yang ketat dan konsisten. Nilai HANYA kondisi yang benar-benar terlihat pada foto.

TITIK KONTROL: ${point.id} - ${point.title}
AREA: ${point.area}
FOTO YANG DIHARAPKAN: ${point.photoGuide}
KRITERIA BERSIH:
${point.passCriteria.map((x, i) => `${i + 1}. ${x}`).join('\n')}

ATURAN PENILAIAN:
- Jangan mengasumsikan area tersembunyi bersih jika tidak terlihat.
- Jika objek utama salah, terlalu blur/gelap, terlalu jauh, tertutup, atau tidak cukup terlihat untuk dinilai: validPhoto=false dan score=0.
- Jangan menghukum hal yang memang tidak dapat disimpulkan secara visual, kecuali ada bukti visual yang bertentangan.
- Score 95-100: sangat bersih/rapi, tidak ada kotoran relevan yang terlihat.
- Score 85-94: bersih, hanya ada cacat sangat minor.
- Score 70-84: perlu cleaning, ada noda/remah/grease/ketidakteraturan yang terlihat.
- Score 40-69: kotor, beberapa masalah jelas terlihat.
- Score 0-39: sangat kotor/tidak layak, atau objek tidak valid untuk dinilai.
- Berikan reason singkat dalam Bahasa Indonesia, maksimal 160 karakter.
- issues maksimal 3 item, hanya masalah yang terlihat.
- confidence 0 sampai 1.

Konteks sesi: ${session.storeName || '-'} · ${session.slot || '-'} · ${session.operationalDate || '-'}.

FORMAT OUTPUT: satu object JSON persis seperti ini, tanpa markdown dan tanpa teks lain:
{"validPhoto": true, "score": 0, "confidence": 0.0, "reason": "teks singkat", "issues": ["masalah yang terlihat"]}
score bilangan bulat 0-100, confidence angka 0-1, issues array maksimal 3 string (boleh kosong).`;
}

// Klien endpoint OpenAI-compatible (POST {baseUrl}/chat/completions) dengan antarmuka yang sama seperti GoogleGenAI:
// client.models.generateContent({model, contents, config}) → {text, modelVersion, candidates}.
function openAiClient({ baseUrl, apiKey, timeoutMs = 75000 }, fetchImpl = globalThis.fetch) {
  return { models: { generateContent: async ({ model, contents, config = {} }) => {
    const parts = contents?.[0]?.parts || [];
    const content = parts.map((p) => (p.text != null
      ? { type: 'text', text: p.text }
      : { type: 'image_url', image_url: { url: `data:${p.inlineData?.mimeType || 'image/jpeg'};base64,${p.inlineData?.data || ''}` } }));
    const body = { model, messages: [{ role: 'user', content }], temperature: config.temperature ?? 0, max_tokens: config.maxOutputTokens || 1024 };
    if (config.responseJsonSchema || config.responseMimeType === 'application/json') body.response_format = { type: 'json_object' };
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res, raw;
    try {
      res = await fetchImpl(`${baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal: ctrl.signal });
      raw = await res.text();
    } catch (e) {
      const timedOut = e?.name === 'AbortError';
      throw Object.assign(new Error(timedOut ? `Endpoint AI tidak menjawab dalam ${timeoutMs} ms` : `fetch failed: ${e?.message || e}`), { status: 503 });
    } finally { clearTimeout(timer); }
    let json = null; try { json = JSON.parse(raw); } catch { /* bukan JSON */ }
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} ${json?.error?.message || json?.message || String(raw || '').slice(0, 300)}`), { status: res.status });
    const choice = json?.choices?.[0] || {};
    let out = choice?.message?.content;
    if (Array.isArray(out)) out = out.map((x) => (typeof x === 'string' ? x : x?.text || '')).join('\n');
    return { text: typeof out === 'string' ? out : '', modelVersion: json?.model || model, candidates: [{ finishReason: choice?.finish_reason || '-' }] };
  } } };
}

function defaultCreateClient(opts, fetchImpl) {
  if (opts?.openai) return openAiClient(opts, fetchImpl || globalThis.fetch);
  const { GoogleGenAI } = require('@google/genai');
  return new GoogleGenAI(opts);
}

async function generate(client, model, parts, structured, maxOutputTokens) {
  const config = { temperature: 0, candidateCount: 1, maxOutputTokens };
  if (structured) { config.responseMimeType = 'application/json'; config.responseJsonSchema = RESPONSE_SCHEMA; }
  const response = await client.models.generateContent({ model, contents: [{ role: 'user', parts }], config });
  return { text: extractResponseText(response), response };
}

// Jalankan satu provider: structured → tanpa schema bila ditolak; rate limit → tunggu sekali; output rusak → ulang sekali dengan teks perbaikan.
async function runProvider(target, cfg, parts, deps) {
  const client = deps.createClient(clientOptions(target.provider, cfg));
  const key = `${target.provider}:${target.model}`;
  let structured = !unsupportedStructured.has(key), quotaRetried = false, outputAttempts = 0;
  const prompt = parts[0].text;
  for (let guard = 0; guard < 6; guard++) {
    const sendParts = [{ text: prompt + (outputAttempts ? FIX_TEXT : '') }, ...parts.slice(1)];
    let response = null;
    try {
      const out = await generate(client, target.model, sendParts, structured, 2048);
      response = out.response;
      if (!out.text) throw new Error('AI tidak mengembalikan teks. ' + responseDiagnostics(response, out.text));
      const data = parseModelJson(out.text);
      if (!data || typeof data !== 'object') throw new Error('Hasil AI bukan object JSON.');
      return { data, model: response?.modelVersion || target.model, structured };
    } catch (err) {
      const c = classifyError(err);
      if (c.schemaUnsupported && structured) {
        structured = false; unsupportedStructured.add(key);
        deps.logger.warn('AI structured output ditolak model, ulang tanpa schema', { target, error: safeShort(c.message, 200) });
        continue;
      }
      if (c.quota && !quotaRetried) { quotaRetried = true; deps.logger.warn('AI rate limit, tunggu lalu coba lagi', { target, waitMs: cfg.retryWaitMs }); await deps.sleep(cfg.retryWaitMs); continue; }
      if (c.quota) throw Object.assign(new Error(c.message), { code: 'AI_QUOTA', cause: err });
      if (c.server) throw Object.assign(new Error(c.message), { code: 'AI_SERVER', cause: err });
      if (c.auth) throw Object.assign(new Error(c.message), { code: 'AI_AUTH', cause: err });
      if (c.status && c.status !== 400) throw Object.assign(new Error(c.message), { code: 'AI_ERROR', cause: err });
      outputAttempts++;
      if (outputAttempts >= 2) throw Object.assign(new Error('Output AI tidak valid setelah 2 percobaan: ' + safeShort(c.message, 180)), { code: 'AI_OUTPUT', cause: err });
      deps.logger.warn('AI output retry', { target, attempt: outputAttempts, error: safeShort(c.message, 300) });
    }
  }
  throw Object.assign(new Error('AI tidak memberi hasil setelah beberapa percobaan.'), { code: 'AI_OUTPUT' });
}

function finalizeResult({ data, model, structured }, target, fallbackReason) {
  const valid = data.validPhoto === true || String(data.validPhoto).toLowerCase() === 'true';
  const score = valid ? Math.round(clamp(data.score, 0, 100)) : 0;
  return {
    validPhoto: valid, score, status: visualStatus(valid, score), confidence: +clamp(data.confidence, 0, 1).toFixed(2),
    reason: safeShort(data.reason || (valid ? 'Kondisi dinilai dari evidence foto.' : 'Objek pada foto tidak cukup valid untuk dinilai.'), 160),
    issues: Array.isArray(data.issues) ? data.issues.slice(0, 3).map((x) => safeShort(x, 90)).filter(Boolean) : [],
    provider: target.provider, model, structuredOutput: structured, fallbackReason: fallbackReason || '',
  };
}

async function analyzeImages(point, buffers, mimeTypes, session, deps = {}) {
  const d = { logger: console, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), env: process.env, fetch: globalThis.fetch, ...deps };
  if (!d.createClient) d.createClient = (opts) => defaultCreateClient(opts, d.fetch);
  const cfg = resolveConfig(d.env);
  const parts = [{ text: buildPrompt(point, session) }];
  for (let i = 0; i < buffers.length; i++) parts.push({ inlineData: { data: buffers[i].toString('base64'), mimeType: mimeTypes[i] || 'image/jpeg' } });
  const targets = cfg.fallback ? [cfg.primary, cfg.fallback] : [cfg.primary];
  let lastErr = null, fallbackReason = '';
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    try {
      const out = await runProvider(t, cfg, parts, d);
      return finalizeResult(out, t, fallbackReason);
    } catch (err) {
      lastErr = err;
      if (i < targets.length - 1) {
        fallbackReason = `${t.provider}/${t.model}: ${err.code || 'AI_ERROR'} ${safeShort(err.message, 120)}`;
        d.logger.warn('AI fallback ke provider cadangan', { from: t, to: targets[i + 1], reason: fallbackReason });
      }
    }
  }
  const code = lastErr?.code || 'AI_ERROR';
  const friendly = code === 'AI_QUOTA' ? 'Kuota AI sedang penuh. Tunggu sekitar 1 menit lalu ambil foto lagi.'
    : code === 'AI_SERVER' ? 'Layanan AI sedang gangguan. Coba lagi sebentar.'
    : code === 'AI_AUTH' ? 'Kredensial AI ditolak penyedia (API key salah atau kedaluwarsa). Hubungi admin.'
    : code === 'AI_CONFIG' ? 'Konfigurasi AI belum lengkap: ' + safeShort(lastErr.message, 160)
    : 'Output AI tidak valid: ' + safeShort(lastErr?.message || 'unknown', 160);
  throw Object.assign(new Error(friendly), { code, cause: lastErr });
}

module.exports = { analyzeImages, openAiClient, resolveConfig, classifyError, parseModelJson, extractResponseText, buildPrompt, clamp, safeShort, visualStatus, RESPONSE_SCHEMA, DEFAULTS, _resetStructuredCache: () => unsupportedStructured.clear() };
