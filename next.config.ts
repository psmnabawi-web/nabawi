import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['firebase-admin'],
  images: { remotePatterns: [{ protocol: 'https', hostname: 'firebasestorage.googleapis.com' }] },
};

export default nextConfig;
