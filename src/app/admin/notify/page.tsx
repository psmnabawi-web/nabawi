'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { SuperAdminGuard } from '@/components/SuperAdminGuard';
import { Alert, Badge, Button, Card, CardHeader, Input, Label, PageHeader, Select } from '@/components/ui';
import { apiFetch } from '@/lib/api-client';
import { isSuperAdmin, type NotifyProvider, type NotifySettings } from '@/lib/types';
import { fmtDateTime } from '@/lib/utils';

interface Resp {
  settings: NotifySettings;
  configured: boolean;
  cronConfigured?: boolean;
}
interface Report {
  text: string;
  pctStarted: number;
  started: number;
  totalStores: number;
  date: string;
}

const PROVIDERS: { value: NotifyProvider; label: string; tokenLabel: string; targetLabel: string; help: string[] }[] = [
  {
    value: 'fonnte',
    label: 'Fonnte (WhatsApp)',
    tokenLabel: 'Token perangkat Fonnte',
    targetLabel: 'ID grup WhatsApp (contoh 1203630000000000@g.us)',
    help: [
      'Daftar di fonnte.com, tambah Device, klik Connect, scan QR dari WhatsApp nomor KHUSUS bot (bukan nomor pribadi) lewat menu Perangkat Tertaut.',
      'Masukkan nomor bot itu ke grup WhatsApp tujuan.',
      'Di Fonnte: menu Device → Groups (atau API fetch-group / get-whatsapp-group) → salin ID grup yang berakhiran @g.us.',
      'Salin Token dari halaman Device, tempel di bawah, lalu tekan "Kirim tes".',
    ],
  },
  {
    value: 'wablas',
    label: 'Wablas (WhatsApp)',
    tokenLabel: 'Token.SecretKey Wablas',
    targetLabel: 'ID grup WhatsApp',
    help: ['Daftar di wablas.com, tambah device, scan QR dengan nomor khusus bot.', 'Aktifkan "Get Incoming Message", kirim pesan dari HP ke grup, buka Inbox dan salin Group ID.', 'Isi server device (contoh https://bdg.wablas.com) di kolom Base URL.'],
  },
  {
    value: 'telegram',
    label: 'Telegram Bot (gratis, resmi)',
    tokenLabel: 'Token bot dari @BotFather',
    targetLabel: 'chat_id grup (angka negatif, contoh -1001234567890)',
    help: ['Chat @BotFather → /newbot → salin token.', 'Masukkan bot ke grup Telegram dan jadikan admin.', 'Kirim satu pesan di grup, buka https://api.telegram.org/bot<TOKEN>/getUpdates, salin chat.id.'],
  },
];

export default function NotifySettingsPage() {
  const { profile } = useAuth();
  const [data, setData] = useState<Resp | null>(null);
  const [form, setForm] = useState({ enabled: false, provider: 'fonnte' as NotifyProvider, token: '', target: '', baseUrl: '' });
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);

  useEffect(() => {
    if (!isSuperAdmin(profile)) return;
    let alive = true;
    apiFetch<Resp>('/api/admin/notify')
      .then((r) => {
        if (!alive) return;
        setData(r);
        setForm({ enabled: r.settings.enabled, provider: r.settings.provider, token: '', target: r.settings.target, baseUrl: r.settings.baseUrl });
      })
      .catch((e) => alive && setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Gagal memuat.' }));
    return () => {
      alive = false;
    };
  }, [profile]);

  const prov = PROVIDERS.find((p) => p.value === form.provider)!;

  async function save() {
    setBusy('save');
    setMsg(null);
    try {
      const r = await apiFetch<Resp>('/api/admin/notify', { method: 'PUT', body: JSON.stringify({ ...form, token: form.token || undefined }) });
      setData((d) => ({ ...(d ?? { configured: false }), ...r }));
      setForm((f) => ({ ...f, token: '' }));
      setMsg({ kind: 'success', text: 'Pengaturan tersimpan.' });
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Gagal menyimpan.' });
    } finally {
      setBusy(null);
    }
  }

  async function preview() {
    setBusy('preview');
    setMsg(null);
    try {
      const r = await apiFetch<{ report: Report }>('/api/cron/scoring-report?dry=1');
      setReport(r.report);
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Gagal membuat pratinjau.' });
    } finally {
      setBusy(null);
    }
  }

  async function sendNow() {
    if (!confirm('Kirim laporan scoring hari ini ke grup sekarang?')) return;
    setBusy('send');
    setMsg(null);
    try {
      const r = await apiFetch<{ sent: boolean; reason?: string; report: Report }>('/api/cron/scoring-report', { method: 'POST' });
      setReport(r.report);
      setMsg(r.sent ? { kind: 'success', text: 'Laporan terkirim ke grup.' } : { kind: 'error', text: r.reason ?? 'Tidak terkirim.' });
      const fresh = await apiFetch<Resp>('/api/admin/notify');
      setData(fresh);
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Gagal mengirim.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <SuperAdminGuard>
      <PageHeader title="Notifikasi WhatsApp" subtitle="Laporan otomatis persentase store yang sudah/belum scoring, dikirim ke grup setiap hari jam 09.00 dan 14.00 WIB." />
      {msg && (
        <Alert kind={msg.kind} className="mb-4">
          {msg.text}
        </Alert>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Pengaturan Pengirim"
            desc="Token hanya disimpan di server dan tidak ditampilkan kembali."
            right={data ? <Badge color={data.configured ? (data.settings.enabled ? '#008300' : '#eda100') : '#e34948'}>{data.configured ? (data.settings.enabled ? 'Aktif' : 'Terkonfigurasi, nonaktif') : 'Belum dikonfigurasi'}</Badge> : null}
          />
          <div className="space-y-4">
            <div>
              <Label htmlFor="prov">Penyedia</Label>
              <Select id="prov" value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as NotifyProvider }))}>
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="token">{prov.tokenLabel}</Label>
              <Input id="token" type="password" autoComplete="off" value={form.token} onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))} placeholder={data?.settings.token ? `Tersimpan: ${data.settings.token} (kosongkan jika tidak diubah)` : 'Tempel token di sini'} />
            </div>
            <div>
              <Label htmlFor="target">{prov.targetLabel}</Label>
              <Input id="target" value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))} />
            </div>
            {form.provider === 'wablas' && (
              <div>
                <Label htmlFor="base">Base URL server Wablas</Label>
                <Input id="base" value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder="https://bdg.wablas.com" />
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} className="h-4 w-4 accent-brand" />
              Aktifkan pengiriman otomatis jam 09.00 & 14.00 WIB
            </label>
            <div className="flex flex-wrap gap-2">
              <Button loading={busy === 'save'} onClick={save} disabled={!form.target}>
                Simpan
              </Button>
              <Button variant="secondary" loading={busy === 'send'} onClick={sendNow} disabled={!data?.configured}>
                Kirim tes sekarang
              </Button>
            </div>
            {data?.settings.lastSentAt && (
              <p className="text-xs text-muted">
                Pengiriman terakhir {fmtDateTime(data.settings.lastSentAt)}: {data.settings.lastResult}
              </p>
            )}
            {data && !data.cronConfigured && <Alert kind="warning">CRON_SECRET belum terpasang di server; jadwal otomatis belum bisa memanggil endpoint.</Alert>}
          </div>
          <div className="mt-5 rounded-xl bg-surface p-3 text-xs text-ink">
            <div className="mb-1 font-bold">Cara mendapatkan token & ID grup ({prov.label})</div>
            <ol className="list-decimal space-y-1 pl-4">
              {prov.help.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ol>
            {form.provider !== 'telegram' && <p className="mt-2 text-amber-800">Gunakan nomor WhatsApp khusus untuk bot. Gateway tidak resmi berisiko nomor diblokir WhatsApp; volume 2 pesan/hari tergolong aman tetapi tidak ada jaminan.</p>}
          </div>
        </Card>

        <Card>
          <CardHeader title="Pratinjau Pesan" desc="Teks persis yang akan dikirim, dihitung dari data hari ini." right={<Button size="sm" variant="secondary" loading={busy === 'preview'} onClick={preview}>Buat pratinjau</Button>} />
          {report ? (
            <>
              <div className="mb-3 flex flex-wrap gap-2 text-sm">
                <Badge color="#008300">Sudah {report.started}/{report.totalStores} ({report.pctStarted}%)</Badge>
                <Badge color="#e34948">Belum {report.totalStores - report.started}</Badge>
              </div>
              <pre className="whitespace-pre-wrap rounded-xl border border-line bg-[#e7f6e4] p-4 text-sm leading-relaxed text-ink">{report.text}</pre>
            </>
          ) : (
            <p className="text-sm text-muted">Tekan &quot;Buat pratinjau&quot; untuk melihat isi laporan hari ini.</p>
          )}
        </Card>
      </div>
    </SuperAdminGuard>
  );
}
