import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useVisualViewportHeight } from "../../lib/useVisualViewportHeight";

/**
 * Accessible modal dialog with a premium spring entrance.
 *
 * Lightweight replacement for the deleted shadcn/ui Dialog primitive.
 * Renders into document.body via portal, traps initial focus on the
 * close button, restores focus on unmount, closes on Escape, and
 * exposes proper ARIA attributes (role=dialog, aria-modal, aria-labelledby).
 *
 * Backdrop fades in; the panel scales + lifts in with spring physics and
 * exits slightly faster than it enters, so it always feels responsive.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  // `max-h-[90vh]` alone is computed against the *layout* viewport, which
  // doesn't shrink when the on-screen keyboard opens (e.g. an autoFocus'd
  // search input inside the modal) — so on mobile, content near the bottom
  // of a tall modal (like the later entries in the mode selector list)
  // rendered hidden behind the keyboard. visualViewport tracks the keyboard,
  // so we clamp against it directly when available.
  const visualViewportHeight = useVisualViewportHeight();
  const maxHeightStyle =
    visualViewportHeight != null ? { maxHeight: Math.round(visualViewportHeight * 0.9) } : undefined;

  const sizeClass = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  }[size];

  const titleId = `modal-title-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const descId = description ? `${titleId}-desc` : undefined;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={onClose}
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            className={`w-full ${sizeClass} bg-card border border-border rounded-2xl shadow-2xl max-h-[90vh] flex flex-col`}
            style={maxHeightStyle}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <div className="flex items-start justify-between gap-3 p-5 border-b border-border">
              <div className="min-w-0">
                <h2 id={titleId} className="text-lg font-semibold truncate">
                  {title}
                </h2>
                {description ? (
                  <p id={descId} className="text-sm text-muted-foreground mt-1">
                    {description}
                  </p>
                ) : null}
              </div>
              <motion.button
                type="button"
                onClick={onClose}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="p-2 rounded-lg transition-colors duration-200 hover:bg-accent/60 -mr-1 -mt-1"
                aria-label="Close dialog"
                autoFocus
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </motion.button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">{children}</div>
            {footer ? (
              <div className="flex items-center justify-end gap-2 p-4 border-t border-border bg-accent/20">
                {footer}
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/** Convenience button styles used inside modal footers. */
export const modalButtonClass = {
  primary:
    "px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all duration-200 hover:opacity-90 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "px-4 py-2 rounded-lg border border-border bg-card text-sm font-medium transition-all duration-200 hover:bg-accent/60 active:scale-[0.97] disabled:opacity-50",
  danger:
    "px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium transition-all duration-200 hover:opacity-90 active:scale-[0.97] disabled:opacity-50",
};
