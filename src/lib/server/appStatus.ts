import 'server-only';
import { adminDb } from '../firebase/admin';

export const APP_DOC = 'settings/app';

export interface AppStatus {
  maintenance: boolean;
  message: string;
  updatedAt: number;
  updatedByName: string | null;
}

export const DEFAULT_MESSAGE = 'Aplikasi sedang dinonaktifkan sementara oleh manajemen. Silakan hubungi admin untuk informasi lebih lanjut.';
const DEFAULT: AppStatus = { maintenance: false, message: DEFAULT_MESSAGE, updatedAt: 0, updatedByName: null };

let cache: { at: number; value: AppStatus } | null = null;
const TTL_MS = 15_000;

/** Status aplikasi (mode nonaktif sementara). Cache 15 detik per instance. */
export async function loadAppStatus(force = false): Promise<AppStatus> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  let value = DEFAULT;
  try {
    const snap = await adminDb().doc(APP_DOC).get();
    if (snap.exists) value = { ...DEFAULT, ...(snap.data() as Partial<AppStatus>) };
  } catch (e) {
    console.error('[appStatus] gagal membaca settings/app', e);
  }
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateAppStatus() {
  cache = null;
}
