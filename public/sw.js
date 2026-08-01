// ============================================================================
// Dayjoy AI Assist — Service Worker (PWA offline caching + push notifications)
// ----------------------------------------------------------------------------
// Strategy:
//   - Precache: app shell (index.html, manifest, logo)
//   - Runtime cache: JS/CSS assets (stale-while-revalidate)
//   - Network-first for API calls (Supabase, backend)
//   - Cache-first for static assets (images, fonts)
//   - Push event handler: shows a notification via showNotification()
//   - Notification click handler: focuses the app window + forwards route
//
// This SW supports both PWA installability AND client-side push notifications
// (Browser Notification API + Service Worker showNotification path). For
// server-driven FCM push, a future iteration can extend `push` event handler
// to read the payload and call showNotification with dynamic content.
// ============================================================================

const CACHE_VERSION = "dayjoy-ai-v3";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
];

// Default notification icon (Dayjoy mark as inline SVG data URL)
const DEFAULT_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23234F1E'/%3E%3Cpath d='M32 14c-9.4 0-17 7.4-17 16.6 0 5.2 2.4 9.8 6.2 12.9V48l5.4-3c1.7.4 3.5.6 5.4.6 9.4 0 17-7.4 17-16.6S41.4 14 32 14z' fill='%23FFFFFF'/%3E%3C/svg%3E";

// Install — precache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

// Activate — clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

// Fetch — routing strategy
self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Skip non-GET requests
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Network-first for API calls (Supabase, backend)
  if (url.hostname.includes("supabase.co") || url.hostname.includes("localhost:8000")) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req)),
    );
    return;
  }

  // Network-first for the HTML shell and JS/CSS (same-origin). Vite content-
  // hashes chunk filenames per build, but index.html's URL never changes —
  // cache-first here meant a browser that cached index.html once would keep
  // serving it (and its now-deleted chunk references) forever, even after
  // new deploys, causing "Failed to fetch dynamically imported module".
  // Network-first always prefers the current deploy when online, and still
  // falls back to cache offline.
  const isAppShellOrScript =
    req.mode === "navigate" || url.pathname.endsWith(".js") || url.pathname.endsWith(".css");
  if (url.origin === self.location.origin && isAppShellOrScript) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  // Cache-first for other static assets (same-origin: images, fonts, etc.)
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          // Cache successful responses
          if (res.ok && res.type === "basic") {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
          }
          return res;
        });
      }),
    );
    return;
  }

  // Stale-while-revalidate for cross-origin (CDN assets)
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
        }
        return res;
      });
      return cached || fetchPromise;
    }),
  );
});

// ============================================================================
// PUSH NOTIFICATIONS
// ============================================================================
// The `push` event fires when a push message arrives (server-sent via FCM,
// or self-sent via reg.showNotification() from the client). We support both
// paths: if the event has a payload, we parse it as JSON; otherwise we use
// a default title/body so client-initiated notifications still work.
// ============================================================================

self.addEventListener("push", (event) => {
  let payload = {
    title: "Dayjoy AI Assist",
    body: "You have a new update.",
    route: "/",
    tag: "dayjoy-push",
  };

  try {
    if (event.data) {
      const data = event.data.json();
      payload = { ...payload, ...data };
    }
  } catch {
    // data.text() fallback
    try {
      const text = event.data ? event.data.text() : "";
      if (text) payload.body = text;
    } catch {
      // ignore
    }
  }

  const options = {
    body: payload.body,
    icon: DEFAULT_ICON,
    badge: DEFAULT_ICON,
    tag: payload.tag,
    data: {
      route: payload.route,
      timestamp: Date.now(),
    },
    vibrate: [80, 40, 80],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options),
  );
});

// ============================================================================
// NOTIFICATION CLICK
// ============================================================================
// When the user clicks a notification, focus an existing app window if one
// is open, or open a new one. Then forward the route to the client so the
// React app can navigate.
// ============================================================================

self.addEventListener("notificationclick", (event) => {
  const route = (event.notification.data && event.notification.data.route) || "/";
  event.notification.close();

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // If a window is already open, focus it and post the route
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.postMessage({ type: "NOTIFICATION_CLICK", route });
          if ("focus" in client) {
            try {
              await client.focus();
            } catch {
              // ignore
            }
          }
          return;
        }
      }

      // Otherwise open a new window
      if (self.clients.openWindow) {
        try {
          await self.clients.openWindow(route);
        } catch {
          // ignore
        }
      }
    })(),
  );
});

// ============================================================================
// MESSAGE BRIDGE (client → SW)
// ============================================================================
// Allows the client to ask the SW to send a notification (useful when the
// tab is hidden but the SW is still alive). The client could call
// reg.showNotification directly, but routing through here gives us a
// single chokepoint for logging / future analytics.
// ============================================================================

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SEND_NOTIFICATION") {
    event.waitUntil(
      self.registration.showNotification(data.title || "Dayjoy AI Assist", {
        body: data.body || "",
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
        tag: data.tag || "dayjoy-msg",
        data: {
          route: data.route || "/",
          timestamp: Date.now(),
        },
      }),
    );
  }
});
