import { useCallback, useEffect, useState } from "react";

/** Fired by Chromium browsers when the current page is installable as a PWA. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own standalone flag (non-standard, but the only signal it exposes)
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Shared "install this app" logic — listens for the browser's
 * `beforeinstallprompt` signal and exposes a single `promptInstall()` call.
 * Used by the persistent sidebar download button so install stays a single
 * user-initiated action instead of a floating banner that reappears.
 */
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());

  useEffect(() => {
    if (isStandalone()) return;

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setDeferredPrompt(null);
      setInstalled(true);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === "accepted") setInstalled(true);
  }, [deferredPrompt]);

  return {
    /** True once the browser has signaled the app can be installed. */
    installable: Boolean(deferredPrompt) && !installed,
    installed,
    promptInstall,
  };
}
