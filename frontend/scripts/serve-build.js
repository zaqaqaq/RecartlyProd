/* Мини-сервер для локального предпросмотра production-сборки (папка build).
   Нужен, чтобы проверить PWA-режим и мобильную вёрстку без Docker.
   Запуск: npm run build && node scripts/serve-build.js  (PORT=5055 по умолчанию)
   Особенности: SPA-fallback на index.html, no-cache для sw.js/manifest.json. */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'build');
const PORT = Number(process.env.PORT) || 5055;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
};

const NO_CACHE = new Set(['/sw.js', '/manifest.json', '/index.html', '/offline.html']);

if (!fs.existsSync(ROOT)) {
    console.error('Папка build не найдена. Сначала выполните: npm run build');
    process.exit(1);
}

const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    let filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);

    // Защита от выхода за пределы build/
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stat) => {
        // SPA-роутинг: неизвестный путь отдаёт index.html
        if (err || stat.isDirectory()) {
            filePath = path.join(ROOT, 'index.html');
        }

        fs.readFile(filePath, (readErr, data) => {
            if (readErr) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Not found');
                return;
            }

            const headers = { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' };
            if (NO_CACHE.has(urlPath)) headers['Cache-Control'] = 'no-cache';

            res.writeHead(200, headers);
            res.end(data);
        });
    });
});

server.listen(PORT, () => {
    console.log(`Recartly (production build) → http://localhost:${PORT}`);
    console.log('Для проверки с телефона откройте этот адрес по IP компьютера.');
});
