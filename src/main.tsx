import { createRoot } from "react-dom/client";
import App from "./app/App";
import { ErrorBoundary } from "./app/components/common/ErrorBoundary";
import "./styles/index.css";

// Safety net: if Supabase's OAuth redirect lands somewhere other than
// /auth/callback — e.g. because the exact callback URL isn't in the
// project's Redirect URL allowlist, so Supabase falls back to the Site
// URL instead — forward the auth params there before React ever mounts.
// Without this, a `?code=...` or `#access_token=...` landing on "/" is
// silently ignored (detectSessionInUrl is off) and the user bounces back
// to /login looking "stuck."
function isStrayOAuthRedirect(): boolean {
  if (window.location.pathname === "/auth/callback") return false;
  const hasCode = new URLSearchParams(window.location.search).has("code");
  const hasHashToken = /access_token=/.test(window.location.hash);
  return hasCode || hasHashToken;
}

if (isStrayOAuthRedirect()) {
  window.location.replace("/auth/callback" + window.location.search + window.location.hash);
} else {
  const rootEl = document.getElementById("root");
  if (!rootEl) {
    throw new Error("Root element #root not found in index.html");
  }

  createRoot(rootEl).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}

// Hide the boot splash once React has mounted.
// (index.html shows a branded loader until this fires.)
window.requestAnimationFrame(() => {
  const splash = document.getElementById("dj-boot-splash");
  if (splash) {
    splash.classList.add("is-hidden");
    setTimeout(() => {
      if (splash.parentNode) splash.parentNode.removeChild(splash);
    }, 300);
  }
});

// Register PWA service worker (production only — skip in dev to avoid caching stale assets)
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      console.warn("[pwa] service worker registration failed", e);
    });
  });
}
