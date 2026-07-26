/* Offline support is deliberately limited to public safety pages and immutable
   assets. Authenticated/admin/API/RSC responses must never enter Cache Storage. */
const CACHE = "migraaid-v5";
const LOCALES = ["en", "bn", "ta", "tl", "zh", "id", "th", "my"];
const OFFLINE_EMERGENCY = {
  en: "Emergency contacts are unavailable offline.",
  bn: "অফলাইনে জরুরি যোগাযোগ পাওয়া যাচ্ছে না।",
  ta: "இணையமின்றி அவசரத் தொடர்புகள் கிடைக்கவில்லை.",
  tl: "Hindi available offline ang mga emergency contact.",
  zh: "离线时无法获取紧急联系方式。",
  id: "Kontak darurat tidak tersedia saat offline.",
  th: "ไม่สามารถดูรายชื่อติดต่อฉุกเฉินขณะออฟไลน์ได้",
  my: "အော့ဖ်လိုင်းတွင် အရေးပေါ်ဆက်သွယ်ရန်များကို မရနိုင်ပါ။",
};
const LOCALE_HOMES = new Set(LOCALES.map((locale) => `/${locale}`));
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

/* The app renders its pages dynamically (`no-store` headers), and a fetch for
   "/" follows the locale redirect. Neither response is servable back to a
   navigation as stored: browsers reject redirected cache entries for
   navigations (which would break offline launch of the PWA's start_url "/").
   Rebuild a plain 200 copy so the stored entry always serves. */
async function cacheableCopy(response) {
  const body = await response.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function extractStaticAssetPaths(html) {
  return [...new Set(html.match(/\/_next\/static\/[^"'\s<>\\]+/g) ?? [])];
}

/* Cache the hashed CSS/JS a precached document references, so the very first
   visit already yields a styled offline page — lazy runtime caching only helps
   after the worker controls a page. */
async function precacheDocumentAssets(cache, html) {
  await Promise.allSettled(
    extractStaticAssetPaths(html).map(async (path) => {
      if (await cache.match(path)) return;
      const response = await fetch(path);
      if (response.ok && response.type === "basic") {
        await cache.put(path, response);
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  /* Best-effort per URL: one failing fetch must not wipe offline support for
     everything else (cache.addAll is all-or-nothing). Fail the install only if
     no document could be stored at all, so a working installed worker is never
     replaced by one with an empty cache. */
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      const results = await Promise.allSettled(
        PRECACHE.map(async (path) => {
          const response = await fetch(path);
          if (!response.ok) throw new Error(`precache failed: ${path}`);
          if (PUBLIC_DOCUMENTS.has(path)) {
            await precacheDocumentAssets(cache, await response.clone().text());
          }
          await cache.put(path, await cacheableCopy(response));
          return path;
        }),
      );
      const cachedDocuments = results.filter(
        (result, index) =>
          result.status === "fulfilled" && PUBLIC_DOCUMENTS.has(PRECACHE[index]),
      );
      if (cachedDocuments.length === 0) {
        throw new Error("precache failed for every document");
      }
      await self.skipWaiting();
    }),
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

/* Allow-listed public safety documents are cached despite their `no-store`
   header — they ARE the offline emergency surface, and refusing them froze the
   offline copy at install time (stale helpline numbers and dead asset URLs
   after every redeploy). A refreshed locale home page also refreshes "/" (the
   PWA start_url), keeping offline launch aligned with the locale in use. */
function cacheDocument(event, request, response) {
  if (!response.ok || response.type !== "basic") return response;
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      const copy = await cacheableCopy(response.clone());
      const path = new URL(request.url).pathname;
      if (LOCALE_HOMES.has(path)) {
        await cache.put("/", copy.clone());
      }
      await cache.put(request, copy);
    }),
  );
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isDocument = request.mode === "navigate" || request.destination === "document";
  const isKnownPath = isDocument && PUBLIC_DOCUMENTS.has(url.pathname);
  const isEmergency = isKnownPath && url.pathname.endsWith("/emergency");
  // A shared emergency link commonly carries a query string (UTM/tracking
  // params); match that route on pathname alone so it still hits the cached
  // offline fallback below. Other public documents keep the no-query
  // requirement — they are cached under their exact "/" or "/<locale>"
  // request, matching the PWA start_url.
  const isPublicDocument = isKnownPath && (isEmergency || !url.search);
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
        .then((response) => cacheDocument(event, request, response))
        .catch(async () => {
          // ignoreSearch: the canonical page (precached without a query
          // string) must still answer a request carrying one — otherwise a
          // shared link with UTM/tracking params would find no exact-URL
          // cache match and fall straight to the plaintext apology below
          // even though the real cached page is available.
          const cached = await caches.match(request, { ignoreSearch: true });
          return (
            cached ??
            new Response(OFFLINE_EMERGENCY[url.pathname.split("/")[1]] ?? OFFLINE_EMERGENCY.en, {
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
      .then((response) => cacheDocument(event, request, response))
      .catch(() => caches.match(request)),
  );
});
