import 'server-only';
import { HttpError } from '../utils';
import type { RawAiOutput } from './prompt';

export interface AiUsage {
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
}

export interface JsonImage {
  base64: string;
  mediaType: string;
  /** Label yang ditampilkan sebelum gambar (mis. "Foto 1 dari 3"). */
  label: string;
}

/** Permintaan generik "gambar + teks -> JSON" untuk semua provider. */
export interface JsonRequest {
  systemInstruction: string;
  images: JsonImage[];
  text: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
}

export interface JsonResult {
  data: Record<string, unknown>;
  model: string;
  usage: AiUsage;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Gerbang konkurensi per instance: provider gratis dibatasi per menit, jadi panggilan dari banyak store diantrekan, bukan ditolak. */
const QUEUE_TIMEOUT_MS = 90_000;
let running = 0;
let limit = 2;
const waiters: Array<() => void> = [];
export function setMaxConcurrent(n: number) {
  limit = Math.max(1, Math.min(8, Math.floor(n) || 2));
}
export async function acquire(): Promise<() => void> {
  if (running < limit) {
    running += 1;
  } else {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        const i = waiters.indexOf(resolve);
        if (i >= 0) waiters.splice(i, 1);
        reject(new HttpError(429, 'Antrean analisa AI penuh. Tunggu 1 menit lalu coba lagi.'));
      }, QUEUE_TIMEOUT_MS);
      waiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
    running += 1;
  }
  return () => {
    running -= 1;
    const next = waiters.shift();
    if (next) next();
  };
}

/** Ringkasan skema JSON yang hemat token untuk model tanpa structured output. */
export function schemaGuide(schema: Record<string, unknown>, indent = ''): string {
  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const lines: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    const type = v.type === 'array' ? `array<${((v.items as Record<string, unknown>)?.type as string) ?? 'string'}>` : String(v.type);
    const en = Array.isArray(v.enum) ? ` salah satu: ${(v.enum as string[]).join('|')}` : '';
    const desc = typeof v.description === 'string' ? ` — ${v.description}` : '';
    lines.push(`${indent}- ${k} (${type})${en}${desc}`);
    const items = v.items as Record<string, unknown> | undefined;
    if (items && items.type === 'object') lines.push(schemaGuide(items, indent + '  '));
  }
  return lines.join('\n');
}

export function jsonFormatInstruction(schema: Record<string, unknown>): string {
  return `FORMAT JAWABAN: hanya satu objek JSON valid (tanpa teks lain, tanpa code fence, tanpa komentar) dengan field berikut, semua wajib diisi:\n${schemaGuide(schema)}`;
}

export function parseJson(raw: string): Record<string, unknown> {
  const text = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as Record<string, unknown>;
      } catch {
        /* fallthrough */
      }
    }
    throw new HttpError(502, 'Output AI bukan JSON valid. Coba analisa ulang.');
  }
}

/** Normalisasi output mentah analisa kebersihan (semua provider) ke RawAiOutput. */
export function normalizeCleanliness(o: Record<string, unknown>, model: string): RawAiOutput {
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : []);
  const scoreRaw = typeof o.score === 'number' ? Math.round(o.score) : Number(o.score);
  const score = Number.isFinite(scoreRaw) && scoreRaw >= 1 && scoreRaw <= 5 ? scoreRaw : null;
  const photoValid = o.photoValid === true && score !== null;
  const conf = o.confidence === 'high' || o.confidence === 'medium' || o.confidence === 'low' ? o.confidence : 'medium';
  const plan = Array.isArray(o.actionPlan)
    ? o.actionPlan
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map((x) => ({
          step: typeof x.step === 'string' ? x.step.trim() : '',
          detail: typeof x.detail === 'string' ? x.detail.trim() : '',
          tool: typeof x.tool === 'string' ? x.tool.trim() : '',
          check: typeof x.check === 'string' ? x.check.trim() : '',
        }))
        .filter((x) => x.step || x.detail)
    : [];
  const minutes = typeof o.estimatedMinutes === 'number' && Number.isFinite(o.estimatedMinutes) ? Math.max(0, Math.round(o.estimatedMinutes)) : null;
  return {
    photoValid,
    photoIssue: photoValid ? null : (typeof o.photoIssue === 'string' && o.photoIssue.trim()) || 'Foto tidak dapat dinilai.',
    score: photoValid ? score : null,
    findings: typeof o.findings === 'string' ? o.findings.trim() : '',
    issues: strArr(o.issues),
    metCriteria: strArr(o.metCriteria),
    recommendation: typeof o.recommendation === 'string' ? o.recommendation.trim() : '',
    coverage: o.coverage === 'full' || o.coverage === 'partial' || o.coverage === 'unclear' ? o.coverage : 'unclear',
    hiddenZones: strArr(o.hiddenZones),
    actionPlan: plan,
    passChecklist: strArr(o.passChecklist),
    estimatedMinutes: minutes,
    confidence: conf,
    model,
  };
}
