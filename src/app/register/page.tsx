'use client';

import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Input, Label } from '@/components/ui';
import { apiFetch } from '@/lib/api-client';
import { firebaseAuth } from '@/lib/firebase/client';
import { LogoMark } from '@/components/brand/Logo';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return setError('Password minimal 6 karakter.');
    setBusy(true);
    setError(null);
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth(), email.trim(), password);
      await updateProfile(cred.user, { displayName: name.trim() });
      await cred.user.getIdToken(true);
      await apiFetch('/api/me'); // buat profil
      await apiFetch('/api/me', { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
      router.replace('/profile?onboarding=1');
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      setError(code.includes('email-already-in-use') ? 'Email sudah terdaftar. Silakan login.' : err instanceof Error ? err.message : 'Pendaftaran gagal.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-8">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6 shadow-sm">
        <div className="mb-3 flex items-center gap-3">
          <LogoMark size={44} />
          <h1 className="text-xl font-bold text-ink">Daftar Akun Crew</h1>
        </div>
        <p className="mb-5 text-sm text-muted">Setelah daftar, pilih store Anda. Role manager/admin diatur oleh admin.</p>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div>
            <Label htmlFor="name">Nama lengkap</Label>
            <Input id="name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="password">Password (min. 6 karakter)</Label>
            <Input id="password" type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Daftar
          </Button>
          <p className="text-center text-sm text-muted">
            Sudah punya akun?{' '}
            <Link href="/login" className="font-semibold text-brand underline">
              Masuk
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
