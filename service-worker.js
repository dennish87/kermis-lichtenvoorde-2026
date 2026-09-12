const CACHE = "kermis-lichtenvoorde-2026-v2-3";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./data.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./bomers-vip.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

async function networkFirst(request, allowIndexFallback=false){
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, {cache:"no-store"});
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (allowIndexFallback) return (await cache.match("./index.html")) || Response.error();
    return Response.error();
  }
}

async function cacheFirstRefresh(request){
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const refreshPromise = fetch(request).then(response => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  if (cached) { refreshPromise.catch(() => {}); return cached; }
  const fresh = await refreshPromise;
  return fresh || Response.error();
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isHtml = event.request.mode === "navigate" || url.pathname.endsWith("/index.html");
  const isProgramData = url.pathname.endsWith("/data.js");

  if (isHtml || isProgramData) {
    event.respondWith(networkFirst(event.request, isHtml));
  } else {
    event.respondWith(cacheFirstRefresh(event.request));
  }
});
