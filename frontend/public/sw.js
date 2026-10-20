/* Recartly service worker — офлайн-оболочка для установленного PWA.
   Стратегии:
   - навигация: network-first с фолбэком на кэшированный index.html (офлайн-режим);
   - статика (JS/CSS/шрифты/картинки): stale-while-revalidate;
   - запросы к API (localhost:8000 и /api): только сеть, кэш не используем. */

const CACHE_VERSION = 'recartly-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

const SHELL_URLS = ['/', '/index.html', '/manifest.json', '/offline.html'];

const API_ORIGINS = ['http://localhost:8000', 'http://127.0.0.1:8000'];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(SHELL_CACHE)
            .then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => !key.startsWith(CACHE_VERSION))
                        .map((key) => caches.delete(key))
                )
            )
            .then(() => self.clients.claim())
    );
});

const isApiRequest = (url) =>
    API_ORIGINS.some((origin) => url.startsWith(origin)) || url.includes('/api/');

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = request.url;

    // API и загрузки пользователей — всегда сеть.
    if (isApiRequest(url) || url.includes('/uploads/')) return;

    // Навигация: сеть, при офлайне — кэшированная оболочка.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
                    return response;
                })
                .catch(async () => {
                    const cached = await caches.match('/index.html');
                    return cached || caches.match('/offline.html');
                })
        );
        return;
    }

    // Статика: отдаём из кэша, параллельно обновляем.
    event.respondWith(
        caches.match(request).then((cached) => {
            const network = fetch(request)
                .then((response) => {
                    if (response && response.status === 200 && response.type === 'basic') {
                        const copy = response.clone();
                        caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});
