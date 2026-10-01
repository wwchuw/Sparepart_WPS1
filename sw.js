// เปลี่ยน VERSION ทุกครั้งที่แก้ไฟล์ในแอป มือถือจะโหลดของใหม่
const VERSION = "sp-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "config.js", "vendor/jsQR.js", "manifest.webmanifest", "icons/icon-192.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // API และรูปไม่ผ่าน cache นี้
  e.respondWith(
    fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
