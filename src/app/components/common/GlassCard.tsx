import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { clsx } from "clsx";

/**
 * GlassCard — glassmorphism surface.
 *
 * Uses backdrop-blur + semi-transparent background + subtle border.
 * Two strengths: `default` (72% opacity) and `strong` (88% opacity).
 *
 * When `hover` is set, the card lifts slightly, gains a soft shadow, and a
 * faint diagonal sheen sweeps across it — the same micro-interaction used
 * on every interactive card across the app.
 */
export function GlassCard({
  children,
  className,
  strong = false,
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  strong?: boolean;
  hover?: boolean;
}) {
  if (!hover) {
    return (
      <div className={clsx(strong ? "glass-strong" : "glass", "rounded-2xl", className)}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      className={clsx(strong ? "glass-strong" : "glass", "rounded-2xl sheen-hover", className)}
      whileHover={{ y: -3, boxShadow: "0 12px 32px -8px rgba(0,0,0,0.14)" }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export default GlassCard;
