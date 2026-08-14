import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, X } from "lucide-react";
import { useInstallPrompt } from "../../lib/useInstallPrompt";

/**
 * Floating "Download app" button — appears once the browser signals the
 * page is installable (`beforeinstallprompt`), and disappears permanently
 * once installed or dismissed for this browser. Same underlying state is
 * used by the "Install Dayjoy AI" entry in Settings, via useInstallPrompt().
 */
export function InstallAppPrompt() {
  const { canInstall, promptInstall, markDismissed, wasDismissed } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(wasDismissed);

  const handleInstall = useCallback(async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      setDismissed(true);
      markDismissed();
    }
  }, [promptInstall, markDismissed]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    markDismissed();
  }, [markDismissed]);

  const visible = canInstall && !dismissed;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          // Desktop only — on mobile this floating pill is one more loose
          // control competing with the chat composer; mobile users install
          // via Settings → App or the profile menu instead.
          className="hidden lg:flex fixed left-4 bottom-4 z-40 items-center gap-2 rounded-2xl border border-border bg-card/95 backdrop-blur-md shadow-xl pl-4 pr-2 py-2.5"
          role="dialog"
          aria-label="Install Dayjoy AI Assist"
        >
          <button
            type="button"
            onClick={handleInstall}
            className="flex items-center gap-2 text-sm font-medium text-foreground hover:opacity-80 transition-opacity"
          >
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground shrink-0">
              <Download className="w-4 h-4" />
            </span>
            Download app
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss install prompt"
            className="p-1.5 rounded-full text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
