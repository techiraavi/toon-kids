/* Toon Kids service worker — network-first so every deploy reaches users
   immediately when online; cached shell keeps the app opening offline. */
const CACHE = "toonkids-shell-v3"; // bumped for the GUI redesign + font caching
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // brand font: cache-first so it renders offline after the first load
  if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") {
    e.respondWith(
      caches.match(e.request).then((m) => m || fetch(e.request).then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return r;
      }))
    );
    return;
  }

  if (url.origin !== location.origin) return; // never touch YouTube/API traffic

  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return r;
      })
      .catch(() =>
        caches.match(e.request, { ignoreSearch: true })
          .then((m) => m || caches.match("./index.html"))
      )
  );
});
