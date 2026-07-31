import { createRoot } from "react-dom/client";
import App from "./app/App";
import { ErrorBoundary } from "./app/components/common/ErrorBoundary";
import "./styles/index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(rootEl).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

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
