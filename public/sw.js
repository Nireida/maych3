/* eslint-disable no-restricted-globals */
// Простейший SW для оффлайн-режима PWA:
// - предкэшируем оболочку при install
// - на fetch: cache-first, при miss идём в сеть и кладём ответ в кэш
// - для навигационных запросов при оффлайне отдаём кэшированный index.html

const CACHE = 'maych3-v1';
const PRECACHE = ['./', './index.html', './manifest.json', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Кэшируем только успешные same-origin ответы.
          if (res.ok && new URL(req.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // Оффлайн-фолбэк для навигаций.
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
    }),
  );
});
