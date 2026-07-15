/* Offline support is deliberately limited to public safety pages and immutable
   assets. Authenticated/admin/API/RSC responses must never enter Cache Storage. */
const CACHE = "migraaid-v4";
const LOCALES = ["en", "bn", "ta", "tl", "zh", "id", "th", "my"];
const PUBLIC_DOCUMENTS = new Set([
  "/",
  ...LOCALES.flatMap((locale) => [`/${locale}`, `/${locale}/emergency`]),
]);
const PRECACHE = [
  ...PUBLIC_DOCUMENTS,
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function fetchWithTimeout(request, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function cacheIfSafe(event, request, response) {
  if (!response.ok || response.type !== "basic") return response;
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (/no-store|private/i.test(cacheControl)) return response;
  event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, response.clone())));
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isDocument = request.mode === "navigate" || request.destination === "document";
  const isPublicDocument = isDocument && PUBLIC_DOCUMENTS.has(url.pathname) && !url.search;
  const isEmergency = isPublicDocument && url.pathname.endsWith("/emergency");
  const isImmutableAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/icon-192.png" ||
    url.pathname === "/icon-512.png";

  // Everything else—including /api, /admin and RSC payloads—uses the browser's
  // normal network path and is never cached by this worker.
  if (!isPublicDocument && !isImmutableAsset) return;

  // Emergency contacts should be current whenever the network is usable, with
  // the verified cached page as a fast fallback on a weak or absent connection.
  if (isEmergency) {
    event.respondWith(
      fetchWithTimeout(request)
        .then((response) => cacheIfSafe(event, request, response))
        .catch(async () => {
          const cached = await caches.match(request);
          return (
            cached ??
            new Response("Emergency contacts are unavailable offline.", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            })
          );
        }),
    );
    return;
  }

  if (isImmutableAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          event.waitUntil(
            fetchWithTimeout(request)
              .then((response) => cacheIfSafe(event, request, response))
              .catch(() => undefined),
          );
          return cached;
        }
        return fetchWithTimeout(request).then((response) =>
          cacheIfSafe(event, request, response),
        );
      }),
    );
    return;
  }

  event.respondWith(
    fetchWithTimeout(request)
      .then((response) => cacheIfSafe(event, request, response))
      .catch(() => caches.match(request)),
  );
});
