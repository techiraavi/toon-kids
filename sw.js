/* Toon Kids service worker — network-first so every deploy reaches users
   immediately when online; cached shell keeps the app opening offline. */
const CACHE = "toonkids-shell-v5"; // v5: games bundle (games.js) cached for offline play
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE)
    // straight from the server: the browser's own HTTP cache may still hold the previous deploy
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
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

  // A launch must see a new deploy at once, so the page is revalidated with the server instead of
  // trusting the browser's HTTP cache (hosts send max-age). The request is built once and fetched
  // once (a second attempt would only delay the cached app on a dying connection); an engine that
  // refuses the option throws in the constructor and gets the plain request.
  const fromNet = () => {
    if (e.request.mode !== "navigate") return fetch(e.request);
    let req = e.request;
    try { req = new Request(e.request, { cache: "no-cache" }); } catch (err) {}
    return fetch(req);
  };

  const netFirst = () =>
    fromNet()
      .then((r) => {
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then(async (c) => {
            await c.put(e.request, copy);
            // one games bundle per device: a new deploy's games.js?v= replaces the older copies
            if (url.pathname.endsWith("/games.js")) {
              for (const k of await c.keys()) {
                if (k.url !== e.request.url && new URL(k.url).pathname === url.pathname) c.delete(k);
              }
            }
          }).catch(() => {});
        }
        return r;
      })
      .catch(() =>
        // exact copy first, so an older games.js?v= never wins over the current one
        caches.match(e.request)
          .then((m) => m || caches.match(e.request, { ignoreSearch: true }))
          .then((m) => m || (e.request.mode === "navigate" ? caches.match("./index.html") : Response.error()))
      );

  // games.js?v=<content hash>: an exact cached copy IS the current bundle, so never wait on the
  // network for it (a connection that hangs would otherwise keep the games from opening)
  if (url.pathname.endsWith("/games.js") && /^[0-9a-f]{10}$/.test(url.searchParams.get("v") || "")) {
    e.respondWith(caches.match(e.request).then((m) => m || netFirst()));
    return;
  }
  e.respondWith(netFirst());
});
