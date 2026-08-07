/* ============================================================
   sw.js · Service Worker：network-first 防缓存旧版
   ============================================================ */
'use strict';

const VERSION = '1.15.10';
const CACHE = 'maoshi-wb-' + VERSION;
const CORE = [
  './',
  './index.html',
  './css/style.css',
  './js/data.js',
  './js/audio.js',
  './js/player.js',
  './js/catalog.js',
  './js/app.js',
  './data/poems.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim()).then(() => {
      /* 通知所有页面：SW 已更新到新版本，页面若仍是旧 JS 则自动刷新（根治「改了看不到」） */
      return self.clients.matchAll({ includeUncontrolled: true }).then(cls =>
        cls.forEach(c => { try { c.postMessage({ type: 'sw-updated', version: VERSION }); } catch (e) {} })
      );
    })
  );
});

/* network-first：优先网络，失败回退缓存 */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const pathname = new URL(req.url).pathname;

  /* 媒体 / 字体：直接走网络，绝不缓存。
     根因修复：SW 缓存音频会因 Range/seek 分片导致 <audio> 元素加载失败（完全无声），
     且 SW 缓存优先级高于 HTTP 缓存（Ctrl+Shift+R 清不掉），正是此前「改了还不行」的真凶。
     字体由 index.html 的 <link rel=preload> 处理，无需 SW 缓存。 */
  if (/\.(mp3|wav|ogg|m4a|webm|mp4)$/i.test(pathname) ||
      /\.(ttf|otf|woff2?)$/i.test(pathname)) {
    e.respondWith(fetch(req));
    return;
  }

  /* 其余（html/js/css/json + 图片）：network-first，失败回退缓存 */
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(req, clone));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
