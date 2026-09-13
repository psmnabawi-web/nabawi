'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Spinner } from '@/components/ui';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading) router.replace(user ? '/dashboard' : '/login');
  }, [loading, user, router]);
  return (
    <div className="flex min-h-screen items-center justify-center text-brand">
      <Spinner className="h-8 w-8" />
    </div>
  );
}
