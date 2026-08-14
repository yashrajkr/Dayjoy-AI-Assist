import { useCallback, useEffect, useState } from "react";

/** Fired by Chromium browsers when the current page is installable as a PWA. */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "dj-install-prompt-dismissed";

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own standalone flag (non-standard, but the only signal it exposes)
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Shared PWA install-prompt state — captures the deferred `beforeinstallprompt`
 * event once and lets any UI (floating banner, Settings > App) trigger it.
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
      window.localStorage.setItem(DISMISSED_KEY, "1");
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return "unavailable" as const;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === "accepted") {
      window.localStorage.setItem(DISMISSED_KEY, "1");
      setInstalled(true);
    }
    return outcome;
  }, [deferredPrompt]);

  return {
    installed,
    installable: Boolean(deferredPrompt),
    promptInstall,
  };
}

export function isInstallDismissed(): boolean {
  return window.localStorage.getItem(DISMISSED_KEY) === "1";
}

export function dismissInstallPrompt(): void {
  window.localStorage.setItem(DISMISSED_KEY, "1");
}
