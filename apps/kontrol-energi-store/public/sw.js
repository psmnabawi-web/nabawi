/**
 * Service worker Kontrol Energi Store.
 *
 * Prinsip keamanan data:
 * - Hanya shell statis milik origin sendiri yang disimpan (HTML, CSS, JS, ikon, master).
 * - Strategi selalu network-first sehingga perangkat online TIDAK PERNAH memakai
 *   kode atau master versi lama setelah deploy baru.
 * - Permintaan ke Firestore, Firebase Auth, dan Google API dilewati sepenuhnya agar
 *   tidak ada data transaksi yang tersimpan di cache perangkat.
 * - Cache dikunci ke nomor versi; versi lama dihapus saat aktivasi.
 */
const APP_VERSION = "1.1.4";
const CACHE_NAME = `kontrol-energi-shell-v${APP_VERSION}`;
const OFFLINE_URL = "/index.html";

const PRECACHE_URLS = [
  "/",
  "/index.html",
  `/app.css?v=${APP_VERSION}`,
  `/app.js?v=${APP_VERSION}`,
  `/firebase-config.js?v=${APP_VERSION}`,
  `/master-electric.json?v=${APP_VERSION}`,
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

// Host yang tidak boleh disentuh service worker sama sekali.
const BYPASS_HOST_PATTERN = /(^|\.)(googleapis\.com|gstatic\.com|firebaseio\.com|firebaseapp\.com|google\.com|cloudfunctions\.net)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Satu aset gagal tidak boleh menggagalkan instalasi seluruh shell.
    await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: "reload" }))));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith("kontrol-energi-shell-") && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable().catch(() => {});
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function shouldBypass(request) {
  if (request.method !== "GET") return true;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return true;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  if (url.origin !== self.location.origin) return true;
  if (BYPASS_HOST_PATTERN.test(url.hostname)) return true;
  // Channel realtime Firestore lewat Hosting rewrite tidak pernah di-cache.
  if (url.pathname.startsWith("/__/")) return true;
  return false;
}

async function networkFirst(event) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const preloaded = event.preloadResponse ? await event.preloadResponse : null;
    const response = preloaded || await fetch(event.request);
    if (response && response.ok && response.type === "basic") {
      cache.put(event.request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await cache.match(event.request, { ignoreSearch: false })
      || await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    if (event.request.mode === "navigate") {
      const shell = await cache.match(OFFLINE_URL);
      if (shell) return shell;
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  if (shouldBypass(event.request)) return;
  event.respondWith(networkFirst(event));
});
