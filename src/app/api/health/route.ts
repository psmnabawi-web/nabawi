import { NextResponse } from 'next/server';
import { loadAiSettings } from '@/lib/server/aiSettings';

export const runtime = 'nodejs';

/** GET /api/health -> status konfigurasi (tanpa membocorkan secret). Dipakai untuk cek deploy. */
export async function GET() {
  const s = await loadAiSettings();
  const aiReady = s.provider === 'google' ? (s.useVertex ? !!(process.env.GOOGLE_CLOUD_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) : !!s.apiKey) : !!s.apiKey && (s.provider !== 'openai' || !!s.baseUrl);
  return NextResponse.json({
    ok: true,
    ai: { provider: s.provider, mode: s.provider === 'google' ? (s.useVertex ? 'vertex-ai' : 'gemini-api') : s.provider, model: s.model, baseUrl: s.provider === 'openai' ? s.baseUrl : null, configured: aiReady },
    firebase: {
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? null,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? null,
      webConfigured: !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      adminCredential: process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? 'service-account-json' : process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'credentials-file' : 'application-default',
    },
    adminEmailsConfigured: !!process.env.ADMIN_EMAILS,
    cronConfigured: !!process.env.CRON_SECRET,
    time: new Date().toISOString(),
  });
}
