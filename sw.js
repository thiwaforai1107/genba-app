// オフラインでも開けるように、アプリの部品をキャッシュする（電波の弱い現場向け）
const CACHE = 'genba-v1';
const CORE = ['./', 'index.html', 'assets/css/app.css', 'assets/js/app.js', 'assets/js/store.js', 'assets/js/data.js', 'assets/js/ui.js', 'assets/js/icons.js', 'assets/js/field.js', 'assets/js/camera.js', 'assets/js/office.js', 'assets/js/customer.js', 'assets/vendor/qrcode.js', 'manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // 写真は一度見たら端末に残す。アプリの部品は新しいものを優先し、つながらなければ保存分を使う。
  if (u.pathname.includes('/assets/demo/')) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return res; })));
    return;
  }
  e.respondWith(fetch(e.request).then((res) => { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return res; }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
