// Stoop service worker: makes the app installable and opens instantly.
// The app shell is cached; listings always come from the network.
const CACHE = "stoop-v2";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./manifest.webmanifest", "./icon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // Supabase, photos, fonts: straight to network
  // network first, fall back to cache when offline
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./"))),
  );
});

// ---------- alerts ----------
self.addEventListener("push", (e) => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch { msg = { title: "Stoop", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(msg.title || "Stoop", {
    body: msg.body || "",
    icon: "icon-192.png",
    badge: "badge.png",
    image: msg.image,
    tag: msg.tag,
    renotify: !!msg.tag,
    data: { url: msg.url || self.registration.scope },
  }));
});

// tapping an alert: use the open app if there is one, otherwise open it
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (open) { await open.focus(); return open.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
