import { NextResponse } from 'next/server';
import { aiModel, aiProvider } from '@/lib/ai/analyze';

export const runtime = 'nodejs';

/** GET /api/health -> status konfigurasi (tanpa membocorkan secret). Dipakai untuk cek deploy. */
export async function GET() {
  const provider = aiProvider();
  const useVertex = (process.env.GOOGLE_GENAI_USE_VERTEXAI ?? '').toLowerCase() === 'true';
  const aiReady =
    provider === 'anthropic'
      ? !!process.env.ANTHROPIC_API_KEY
      : useVertex
        ? !!(process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)
        : !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  return NextResponse.json({
    ok: true,
    ai: { provider, mode: provider === 'google' ? (useVertex ? 'vertex-ai' : 'gemini-api') : 'anthropic', model: aiModel(), configured: aiReady },
    firebase: {
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? null,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? null,
      webConfigured: !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      adminCredential: process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? 'service-account-json' : process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'credentials-file' : 'application-default',
    },
    adminEmailsConfigured: !!process.env.ADMIN_EMAILS,
    time: new Date().toISOString(),
  });
}
