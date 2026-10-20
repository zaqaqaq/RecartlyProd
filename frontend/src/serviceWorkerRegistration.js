/* Регистрация service worker для PWA-режима.
   В development не регистрируем, чтобы не мешать hot-reload. */

const isLocalhost = Boolean(
    window.location.hostname === 'localhost' ||
        window.location.hostname === '[::1]' ||
        window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/)
);

export function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production' && !isLocalhost) return;
    if (process.env.NODE_ENV !== 'production') return;

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('/sw.js')
            .catch((error) => console.warn('SW registration failed:', error));
    });
}

export function unregisterServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready
        .then((registration) => registration.unregister())
        .catch((error) => console.warn('SW unregister failed:', error));
}
