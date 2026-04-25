// Atta'M GeoTrace — Service Worker mínimo (cache-first do shell estático).
//
// Estratégia:
//   • Pre-cache do shell (index.html, manifest, ícones) na install.
//   • Para navegação (HTML): tenta rede, fallback para cache (offline-first parcial).
//   • Para libs CDN (Leaflet, Supabase, sql.js, JSZip): cache stale-while-revalidate.
//   • API/Auth (supabase.co): SEMPRE rede — nunca cachear (dados privados).
//
// O escopo PRECISA ser servido pelo mesmo path/host do index.html. Ao subir
// nova versão da aplicação, incremente CACHE_VERSION para invalidar caches antigos.

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `geotrace-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `geotrace-runtime-${CACHE_VERSION}`;

const SHELL_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nunca cachear chamadas Supabase (dados de usuário, autenticação, realtime)
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) {
    return;
  }

  // Tiles do mapa: deixa rede direto (CartoDB tem CDN próprio com cache HTTP)
  if (url.hostname.endsWith('cartocdn.com') || url.hostname.endsWith('openstreetmap.org')) {
    return;
  }

  // Navegação HTML: rede primeiro com fallback de cache (para abrir offline)
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch (_) {
        const cached = await caches.match('./index.html');
        return cached || Response.error();
      }
    })());
    return;
  }

  // Demais GETs (libs CDN, ícones): stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    const fetchPromise = fetch(req).then(resp => {
      // Só cacheia respostas básicas/cors com status OK
      if (resp && resp.status === 200 && (resp.type === 'basic' || resp.type === 'cors')) {
        cache.put(req, resp.clone()).catch(() => {});
      }
      return resp;
    }).catch(() => null);
    return cached || (await fetchPromise) || Response.error();
  })());
});
