/* The worker caches the app shell only. Clinical data is never placed in Cache Storage: encrypted
 * payloads live in the client-only IndexedDB store managed by src/lib/offline/cache.ts. */
const CACHE = "a2g-shell-v1"
// `/` redirects authenticated users, so do not precache it: Cache.addAll rejects redirects and would
// prevent worker activation. Signed-in MSL routes are added network-first below after their first visit.
const SHELL_ROUTES = ["/login"]

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL_ROUTES)).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_OFFLINE") event.waitUntil(caches.delete(CACHE))
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== "GET" || url.origin !== self.location.origin) return

  if (request.mode === "navigate" && (url.pathname === "/msl" || url.pathname === "/msl/briefs")) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        if (response.ok) {
          const cache = await caches.open(CACHE)
          await cache.put(request, response.clone())
        }
        return response
      } catch {
        return (await caches.match(request, { ignoreSearch: true })) || (await caches.match("/msl/briefs"))
      }
    })())
    return
  }

  // Next's static JS/CSS is code, never a response from AppSync. Cache it as users visit routes.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) void caches.open(CACHE).then((cache) => cache.put(request, response.clone()))
      return response
    })))
  }
})
