'use client';

import { firebaseAuth } from './firebase/client';

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/** fetch ke API internal dengan Firebase ID token. */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const user = firebaseAuth().currentUser;
  if (!user) throw new ApiError(401, 'Belum login.');
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `Request gagal (${res.status})`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}
