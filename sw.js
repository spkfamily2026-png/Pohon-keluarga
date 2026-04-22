// ============================================================
//  SERVICE WORKER — Pohon Keluarga PWA
//  Strategi: Cache-first untuk aset, Network-first untuk API
// ============================================================

const APP_VERSION   = 'v1.0.0';
const CACHE_STATIC  = `pohon-keluarga-static-${APP_VERSION}`;
const CACHE_IMAGES  = `pohon-keluarga-images-${APP_VERSION}`;

// File yang dicache saat install
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=DM+Sans:wght@300;400;500&display=swap'
];

// ── INSTALL ───────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing...', APP_VERSION);
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Cache install error:', err))
  );
});

// ── ACTIVATE ──────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating...', APP_VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_STATIC && key !== CACHE_IMAGES)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Google Apps Script API → selalu network (tidak dicache)
  if (url.hostname === 'script.google.com') {
    event.respondWith(networkOnly(request));
    return;
  }

  // 2. Google Drive thumbnail foto → cache images
  if (url.hostname === 'drive.google.com' && url.pathname.includes('thumbnail')) {
    event.respondWith(cacheFirst(request, CACHE_IMAGES));
    return;
  }

  // 3. Google Fonts → cache static
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  // 4. Aset app (HTML, JS, CSS, manifest) → cache first, fallback network
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  // 5. Lainnya → network
  event.respondWith(networkOnly(request));
});

// ── STRATEGIES ────────────────────────────────────────────────

/** Cache-first: ambil dari cache, kalau tidak ada fetch dan simpan */
async function cacheFirst(request, cacheName) {
  const cache    = await caches.open(cacheName);
  const cached   = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone()); // simpan di background
    }
    return response;
  } catch {
    // Offline fallback untuk halaman HTML
    if (request.destination === 'document') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline - koneksi tidak tersedia', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/** Network only: langsung fetch, tidak pernah cache */
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(JSON.stringify({ error: 'Offline', offline: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── BACKGROUND SYNC (antrian offline) ────────────────────────
// Jika browser support Background Sync, operasi gagal karena offline
// akan diulang otomatis saat koneksi kembali
self.addEventListener('sync', event => {
  if (event.tag === 'sync-persons') {
    console.log('[SW] Background sync triggered: sync-persons');
    event.waitUntil(syncPendingOperations());
  }
});

async function syncPendingOperations() {
  // Baca antrian dari IndexedDB (dihandle di app)
  // Kirim pesan ke client agar app tahu sync berjalan
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_TRIGGERED' });
  });
}

// ── MESSAGE HANDLER ───────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_IMAGE_CACHE') {
    caches.delete(CACHE_IMAGES).then(() => {
      event.source?.postMessage({ type: 'IMAGE_CACHE_CLEARED' });
    });
  }
});
