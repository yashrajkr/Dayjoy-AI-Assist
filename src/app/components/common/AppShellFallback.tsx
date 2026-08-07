import { DayjoyLogo } from "../brand/DayjoyLogo";
import { motion } from "framer-motion";

/**
 * Lightweight loading skeleton shown while a lazy-loaded route chunk is
 * being fetched, or while auth state is being resolved.
 *
 * Branded (logo + animated pulse + spinner) so the user sees the Dayjoy
 * identity instead of a bare "Loading…" string.
 */
export function AppShellFallback() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 py-16 px-4 min-h-[60vh]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <motion.div
        animate={{
          scale: [1, 1.06, 1],
          opacity: [0.8, 1, 0.8],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <DayjoyLogo variant="mark" size={48} />
      </motion.div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="inline-block w-3 h-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        Loading…
      </div>
    </div>
  );
}
