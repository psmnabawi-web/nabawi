'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { SuperAdminGuard } from '@/components/SuperAdminGuard';
import { Alert, Button, Card, Input, Label, PageHeader, Select } from '@/components/ui';
import { apiFetch } from '@/lib/api-client';
import { useProductAudits, useStores } from '@/lib/hooks';
import { PRODUCTS, type ProductId } from '@/lib/productChecklists';
import { isSuperAdmin, type ProductAudit } from '@/lib/types';
import { todayISO } from '@/lib/utils';

export default function NewProductAuditPage() {
  const { profile } = useAuth();
  const { stores } = useStores();
  const { audits } = useProductAudits(isSuperAdmin(profile));
  const router = useRouter();
  const [storeId, setStoreId] = useState('');
  const [productId, setProductId] = useState<ProductId>('kebuli');
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const product = PRODUCTS.find((p) => p.id === productId)!;
  const month = date.slice(0, 7);
  const doneThisMonth = audits.filter((a) => a.storeId === storeId && a.productId === productId && a.month === month).length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { audit } = await apiFetch<{ audit: ProductAudit }>('/api/product-audits', { method: 'POST', body: JSON.stringify({ storeId, productId, date }) });
      router.push(`/product-audit/${audit.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat audit produk.');
      setBusy(false);
    }
  }

  return (
    <SuperAdminGuard>
      <PageHeader title="Mulai Audit Kualitas Produk" subtitle={`${product.items.length} item checklist (${product.items.filter((i) => i.gate === 'CRITICAL').length} CRITICAL, ${product.items.filter((i) => i.gate === 'MAJOR').length} MAJOR, ${product.items.filter((i) => i.gate === 'CONTROL').length} CONTROL).`} />
      <Card className="max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div>
            <Label htmlFor="store">Store</Label>
            <Select id="store" required value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">— Pilih store —</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Produk</Label>
            <div className="grid grid-cols-3 gap-2">
              {PRODUCTS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProductId(p.id)}
                  className={`rounded-xl border px-3 py-3 text-sm font-semibold ${productId === p.id ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-white text-ink hover:bg-surface'}`}
                >
                  {p.short}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="date">Tanggal Pemeriksaan</Label>
            <Input id="date" type="date" required value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </div>
          <Alert kind="info">
            Inspector: <b>{profile?.name}</b>.{' '}
            {storeId ? (
              <>
                Ini akan menjadi pemeriksaan ke-<b>{doneThisMonth + 1}</b> untuk {product.short} bulan ini (target 4 kali per bulan).
              </>
            ) : (
              'Setelah dibuat: foto produk, isi pengukuran suhu/berat/waktu, catat pengamatan, lalu AI menilai Ya/Tidak per item.'
            )}
          </Alert>
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!storeId}>
            Buat Audit Produk
          </Button>
        </form>
      </Card>
    </SuperAdminGuard>
  );
}
