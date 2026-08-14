import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, X } from "lucide-react";
import { useInstallPrompt, isInstallDismissed, dismissInstallPrompt } from "../../lib/useInstallPrompt";

/**
 * Floating "Download app" button — appears once the browser signals the
 * page is installable (`beforeinstallprompt`), and disappears permanently
 * once installed or dismissed for this browser.
 */
export function InstallAppPrompt() {
  const { installable, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => isInstallDismissed());

  const handleInstall = useCallback(async () => {
    await promptInstall();
  }, [promptInstall]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    dismissInstallPrompt();
  }, []);

  const visible = installable && !dismissed;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="fixed left-4 bottom-4 z-40 flex items-center gap-2 rounded-2xl border border-border bg-card/95 backdrop-blur-md shadow-xl pl-4 pr-2 py-2.5"
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
