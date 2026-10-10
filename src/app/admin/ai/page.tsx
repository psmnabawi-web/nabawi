'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { SuperAdminGuard } from '@/components/SuperAdminGuard';
import { Alert, Badge, Button, Card, CardHeader, Input, Label, PageHeader, Select } from '@/components/ui';
import { apiFetch } from '@/lib/api-client';
import { isSuperAdmin, type AiProvider, type AiSettings, type AiTestReport } from '@/lib/types';
import { fmtDateTime } from '@/lib/utils';

interface Resp {
  settings: AiSettings;
  hasKey: boolean;
  tests?: AiTestReport[];
}

const PRESETS: { label: string; provider: AiProvider; baseUrl: string; model: string }[] = [
  { label: 'Qwen / DashScope Internasional (Singapura)', provider: 'openai', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'qwen3-vl-plus' },
  { label: 'Qwen / DashScope China (Beijing)', provider: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-vl-plus' },
  { label: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemma-4-31b-it:free' },
  { label: 'Groq', provider: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'qwen/qwen3.8-27b' },
  { label: 'Gemini API (AI Studio)', provider: 'google', baseUrl: '', model: 'gemini-3.5-flash-lite' },
  { label: 'Vertex AI (ADC)', provider: 'google', baseUrl: '', model: 'gemini-3.5-flash-lite' },
];

export default function AiSettingsPage() {
  const { profile } = useAuth();
  const [data, setData] = useState<Resp | null>(null);
  const [form, setForm] = useState<Omit<AiSettings, 'updatedAt' | 'updatedByName'>>({ provider: 'google', model: '', apiKey: '', baseUrl: '', useVertex: false, thinkingLevel: '', mediaResolution: '', maxConcurrent: 2, jsonMode: 'auto' });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [n, setN] = useState(6);

  function applyResp(r: Resp) {
    setData(r);
    setForm({ provider: r.settings.provider, model: r.settings.model, apiKey: '', baseUrl: r.settings.baseUrl, useVertex: r.settings.useVertex, thinkingLevel: r.settings.thinkingLevel ?? '', mediaResolution: r.settings.mediaResolution ?? '', maxConcurrent: r.settings.maxConcurrent ?? 2, jsonMode: r.settings.jsonMode ?? 'auto' });
  }
  async function load() {
    applyResp(await apiFetch<Resp>('/api/admin/ai'));
  }
  useEffect(() => {
    if (!isSuperAdmin(profile)) return;
    let alive = true;
    apiFetch<Resp>('/api/admin/ai')
      .then((r) => alive && applyResp(r))
      .catch((e) => alive && setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Gagal memuat.' }));
    return () => {
      alive = false;
    };
  }, [profile]);

  async function save() {
    setBusy('save');
    setMsg(null);
    try {
      await apiFetch('/api/admin/ai', { method: 'PUT', body: JSON.stringify({ ...form, apiKey: form.apiKey || undefined }) });
      await load();
      setMsg({ kind: 'success', text: 'Pengaturan AI tersimpan. Berlaku untuk analisa berikutnya (maks 20 detik).' });
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Gagal menyimpan.' });
    } finally {
      setBusy(null);
    }
  }

  async function test(useForm: boolean) {
    setBusy('test');
    setMsg({ kind: 'info', text: `Menguji ${n} foto audit terbaru. Biasanya 1 sampai 3 menit, jangan tutup halaman.` });
    try {
      const body = useForm ? { n, settings: { ...form, apiKey: form.apiKey || undefined }, label: 'uji konfigurasi form' } : { n, label: 'uji konfigurasi tersimpan' };
      const r = await apiFetch<{ report: AiTestReport }>('/api/cron/ai-selftest', { method: 'POST', body: JSON.stringify(body) });
      await load();
      setMsg({ kind: r.report.failed === 0 ? 'success' : 'error', text: `Selesai: ${r.report.ok}/${r.report.n} berhasil, lolos/gagal sama ${r.report.passAgree}/${r.report.ok}, rata-rata ${(r.report.avgMs / 1000).toFixed(1)} detik.` });
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Uji gagal.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <SuperAdminGuard>
      <PageHeader title="Pengaturan AI" subtitle="Provider dan model untuk analisa foto. Bisa diganti tanpa deploy; uji dulu dengan foto audit nyata sebelum disimpan." />
      {msg && (
        <Alert kind={msg.kind} className="mb-4">
          {msg.text}
        </Alert>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Provider" desc="API key hanya disimpan di server dan tidak ditampilkan kembali." right={data ? <Badge color={data.hasKey || data.settings.useVertex ? '#008300' : '#e34948'}>{data.hasKey || data.settings.useVertex ? 'Terkonfigurasi' : 'Key kosong'}</Badge> : null} />
          <div className="space-y-4">
            <div>
              <Label>Preset</Label>
              <Select value="" onChange={(e) => { const p = PRESETS[Number(e.target.value)]; if (p) setForm((f) => ({ ...f, provider: p.provider, baseUrl: p.baseUrl, model: p.model, useVertex: p.label.startsWith('Vertex') })); }}>
                <option value="">— Pilih preset (opsional) —</option>
                {PRESETS.map((p, i) => (
                  <option key={p.label} value={i}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="prov">Provider</Label>
                <Select id="prov" value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as AiProvider }))}>
                  <option value="openai">OpenAI-compatible (Qwen, OpenRouter, Groq)</option>
                  <option value="google">Google (Gemini / Gemma / Vertex)</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="model">Model</Label>
                <Input id="model" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} placeholder="qwen3-vl-plus" />
              </div>
            </div>
            {form.provider === 'openai' && (
              <div>
                <Label htmlFor="base">Base URL (tanpa /chat/completions)</Label>
                <Input id="base" value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder="https://dashscope-intl.aliyuncs.com/compatible-mode/v1" />
              </div>
            )}
            <div>
              <Label htmlFor="key">API key</Label>
              <Input id="key" type="password" autoComplete="off" value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} placeholder={data?.hasKey ? `Tersimpan: ${data.settings.apiKey} (kosongkan jika tidak diubah)` : 'Tempel key'} />
            </div>
            {form.provider === 'google' && (
              <div className="grid grid-cols-3 gap-3">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" className="h-4 w-4 accent-brand" checked={form.useVertex} onChange={(e) => setForm((f) => ({ ...f, useVertex: e.target.checked }))} /> Vertex AI
                </label>
                <div>
                  <Label>Thinking</Label>
                  <Select value={form.thinkingLevel} onChange={(e) => setForm((f) => ({ ...f, thinkingLevel: e.target.value as AiSettings['thinkingLevel'] }))}>
                    <option value="">default</option>
                    <option value="minimal">minimal</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </Select>
                </div>
                <div>
                  <Label>Resolusi gambar</Label>
                  <Select value={form.mediaResolution} onChange={(e) => setForm((f) => ({ ...f, mediaResolution: e.target.value as AiSettings['mediaResolution'] }))}>
                    <option value="">default</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </Select>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Maks panggilan bersamaan</Label>
                <Input type="number" min={1} max={8} value={form.maxConcurrent} onChange={(e) => setForm((f) => ({ ...f, maxConcurrent: Number(e.target.value) || 2 }))} />
              </div>
              {form.provider === 'openai' && (
                <div>
                  <Label>Mode JSON</Label>
                  <Select value={form.jsonMode} onChange={(e) => setForm((f) => ({ ...f, jsonMode: e.target.value as AiSettings['jsonMode'] }))}>
                    <option value="auto">auto (response_format lalu prompt)</option>
                    <option value="prompt">hanya prompt</option>
                  </Select>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button loading={busy === 'save'} onClick={save}>
                Simpan
              </Button>
              <Input type="number" min={1} max={20} value={n} onChange={(e) => setN(Number(e.target.value) || 6)} className="!w-20" />
              <Button variant="secondary" loading={busy === 'test'} onClick={() => test(true)}>
                Uji konfigurasi di form
              </Button>
              <Button variant="secondary" loading={busy === 'test'} onClick={() => test(false)}>
                Uji konfigurasi tersimpan
              </Button>
            </div>
            {data?.settings.updatedAt ? <p className="text-xs text-muted">Diubah {fmtDateTime(data.settings.updatedAt)} oleh {data.settings.updatedByName}</p> : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="Hasil Uji Terakhir" desc="Skor baru dibandingkan skor asli (Gemini 3.6 Flash). Lolos/gagal sama = kedua skor di sisi yang sama dari batas 4." />
          {!data?.tests?.length ? (
            <p className="text-sm text-muted">Belum ada uji.</p>
          ) : (
            <div className="space-y-4">
              {data.tests.map((t) => (
                <div key={t.id} className="rounded-xl border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge color={t.failed === 0 ? '#008300' : t.ok === 0 ? '#e34948' : '#eda100'}>
                      {t.ok}/{t.n} berhasil
                    </Badge>
                    <span className="font-semibold text-ink">{t.provider} · {t.model}</span>
                    <span className="text-xs text-muted">{fmtDateTime(t.at)} · {t.by}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {t.baseUrl} · skor sama {t.exactAgree}/{t.ok} · lolos/gagal sama {t.passAgree}/{t.ok} · {(t.avgMs / 1000).toFixed(1)} dtk · token {t.avgPromptTokens} masuk / {t.avgOutputTokens} keluar
                  </div>
                  <ul className="mt-2 space-y-1">
                    {t.items.map((it, i) => (
                      <li key={i} className="flex flex-wrap gap-x-2 text-xs">
                        <span className="font-semibold text-ink">{it.area}</span>
                        <span className="text-muted">{it.store}</span>
                        {it.error ? <span className="text-danger">{it.error}</span> : <span>asli {it.orig} → baru {it.score ?? 'x'} · {(it.ms / 1000).toFixed(1)} dtk{it.findings ? ` · ${it.findings.slice(0, 90)}` : ''}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </SuperAdminGuard>
  );
}
