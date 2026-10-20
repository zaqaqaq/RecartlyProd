/**
 * Адрес API.
 *
 * Если приложение открыто по локальному IP (телефон в той же сети — например
 * http://192.168.31.28:3000), то `localhost` в браузере телефона указывал бы на сам
 * телефон, и запросы падали бы с «Failed to fetch». Поэтому при открытии не с
 * localhost адрес API собирается из хоста страницы: тот же IP, порт бэкенда 8000.
 */
const ENV_API_URL = process.env.REACT_APP_API_URL;

const isLoopback = (value) => !value || /(^|\/\/)(localhost|127\.0\.0\.1)/i.test(value);

const browserHost =
    typeof window !== 'undefined' && window.location ? window.location.hostname : 'localhost';

const API_URL = isLoopback(ENV_API_URL)
    ? `${typeof window !== 'undefined' ? window.location.protocol : 'http:'}//${browserHost}:8000`
    : ENV_API_URL;

export { API_URL };

/**
 * Превращает путь к файлу с backend (/uploads/xxx.jpg) в абсолютный URL.
 * Значения вида 'emoji:😀:bg-primary-100:text-primary-600', пустые значения
 * и уже абсолютные ссылки (http://, https://, data:) возвращаются без изменений.
 */
export function mediaUrl(path) {
    if (!path) return null;
    if (/^(https?:|data:|blob:)/i.test(path)) return path;
    if (path.startsWith('emoji:')) return path;
    return `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}
