// Service worker: aplikacja działa offline po pierwszym otwarciu. Wersję podbijaj przy każdym wydaniu
// (workflow Pages podstawia tu skrót commita).
const VERSION = 'dev';
const CACHE = 'inwentaryzacja-' + VERSION;
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'src/app.js', 'src/model.js', 'src/mapping.js', 'src/session.js', 'src/tableio.js', 'src/storage.js'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    try { await c.add('vendor/exceljs.min.js'); } catch { /* opcjonalne: dociągnie się przy pierwszym użyciu */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('inwentaryzacja-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    } catch {
      if (req.mode === 'navigate') return (await c.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
