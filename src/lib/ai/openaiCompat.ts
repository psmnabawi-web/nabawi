import 'server-only';
import type { AiSettings } from '../types';
import { HttpError } from '../utils';
import { acquire, jsonFormatInstruction, parseJson, sleep, type AiUsage, type JsonRequest, type JsonResult } from './shared';

/**
 * Provider OpenAI-compatible (Qwen/DashScope, OpenRouter, Groq, dsb.): POST {baseUrl}/chat/completions dengan gambar base64.
 * JSON diminta lewat response_format json_object (jika didukung) dan selalu juga lewat prompt.
 */
const RETRY_DELAYS_MS = [8_000, 16_000, 30_000];
const TIMEOUT_MS = 150_000;

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
  model?: string;
  error?: { message?: string; code?: string | number; type?: string };
}

async function callOnce(s: AiSettings, body: Record<string, unknown>): Promise<{ status: number; json: ChatResponse; text: string }> {
  const base = s.baseUrl.replace(/\/+$/, '');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: ChatResponse = {};
    try {
      json = JSON.parse(text) as ChatResponse;
    } catch {
      /* bukan JSON */
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

export async function generateJsonWithOpenAI(req: JsonRequest, s: AiSettings): Promise<JsonResult> {
  if (!s.baseUrl) throw new HttpError(500, 'Base URL provider AI belum diisi (menu Pengaturan AI).');
  if (!s.apiKey) throw new HttpError(500, 'API key provider AI belum diisi (menu Pengaturan AI).');
  if (!s.model) throw new HttpError(500, 'Nama model AI belum diisi (menu Pengaturan AI).');
  const content: Array<Record<string, unknown>> = [];
  for (const img of req.images) {
    content.push({ type: 'text', text: img.label });
    content.push({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.base64}` } });
  }
  content.push({ type: 'text', text: req.text });
  const system = `${req.systemInstruction}\n\n${jsonFormatInstruction(req.schema)}`;
  const baseBody: Record<string, unknown> = {
    model: s.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content },
    ],
    temperature: 0,
    max_tokens: Math.min(req.maxOutputTokens ?? 4096, 8192),
    stream: false,
  };
  let useJsonMode = s.jsonMode !== 'prompt';

  let lastErr: unknown = null;
  const release = await acquire();
  try {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const body = useJsonMode ? { ...baseBody, response_format: { type: 'json_object' } } : baseBody;
      const r = await callOnce(s, body);
      if (r.status >= 200 && r.status < 300) {
        const choice = r.json.choices?.[0];
        const raw = choice?.message?.content;
        const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((p) => p.text ?? '').join('') : '';
        if (!text) throw new HttpError(502, 'AI tidak mengembalikan hasil. Coba analisa ulang.');
        const u = r.json.usage;
        const usage: AiUsage = { promptTokens: u?.prompt_tokens ?? 0, outputTokens: u?.completion_tokens ?? 0, thoughtTokens: u?.completion_tokens_details?.reasoning_tokens ?? 0, totalTokens: u?.total_tokens ?? 0 };
        try {
          return { data: parseJson(text), model: r.json.model ?? s.model, usage };
        } catch (e) {
          console.error('[ai/openai] output bukan JSON', JSON.stringify({ finish: choice?.finish_reason, head: text.slice(0, 400) }));
          if (choice?.finish_reason === 'length') throw new HttpError(502, 'Output AI terpotong (batas token). Coba analisa ulang.');
          throw e;
        }
      }
      const msg = r.json.error?.message ?? r.text.slice(0, 300);
      // Provider tidak mendukung response_format -> ulangi tanpa json mode
      if (r.status === 400 && useJsonMode && /response_format|json_object|json mode/i.test(msg)) {
        useJsonMode = false;
        continue;
      }
      if (r.status === 429 && attempt < RETRY_DELAYS_MS.length) {
        lastErr = new Error(msg);
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      if (r.status === 429) throw new HttpError(429, `AI sedang penuh (batas provider). Tunggu 1 menit lalu coba lagi. Pesan: ${msg.slice(0, 160)}`);
      if (r.status === 401 || r.status === 403) throw new HttpError(500, `API key provider AI ditolak (${r.status}): ${msg.slice(0, 200)}`);
      if (r.status === 402) throw new HttpError(402, `Saldo/kuota provider AI habis: ${msg.slice(0, 200)}`);
      if (r.status === 404) throw new HttpError(500, `Model atau endpoint tidak ditemukan (${r.status}): ${msg.slice(0, 200)}`);
      if (r.status === 400) throw new HttpError(400, `Provider AI menolak permintaan: ${msg.slice(0, 300)}`);
      throw new HttpError(502, `Layanan AI error (${r.status}): ${msg.slice(0, 300)}`);
    }
    console.warn('[ai/openai] rate limit setelah retry', lastErr instanceof Error ? lastErr.message.slice(0, 200) : lastErr);
    throw new HttpError(429, 'AI sedang penuh (batas per menit). Tunggu 1 menit lalu coba lagi.');
  } finally {
    release();
  }
}
