import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { AI_MODES, AI_MODE_ACCENT_CLASSES, type AiMode, type AiModeStatusKey } from "../../lib/aiModes";

/**
 * Mode-aware "working on your answer" card — replaces the old
 * KnowledgeSearchViz, which cycled a FIXED set of phases on a timer
 * regardless of what the backend was actually doing. This card instead
 * tracks the real SSE `status` events the backend emits (see
 * streamChatWithBackend's onStatus callback) and only marks a step
 * complete once its matching event has actually arrived — no fake
 * percentages, no invented steps.
 */
export function ModeProcessingCard({
  active,
  mode,
  receivedStatuses,
}: {
  active: boolean;
  mode: AiMode;
  /** Real backend status event names received so far, in arrival order. */
  receivedStatuses: AiModeStatusKey[];
}) {
  const config = AI_MODES[mode];
  const accent = AI_MODE_ACCENT_CLASSES[config.accent];
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (!active) return;
    startRef.current = Date.now();
    setElapsedMs(0);
    const timer = setInterval(() => setElapsedMs(Date.now() - startRef.current), 100);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) return null;

  const receivedSet = new Set(receivedStatuses);
  // A step is "current" (pulsing) once its own event or a later one has
  // arrived but the NEXT step's event hasn't — i.e. it's the most recent
  // real signal, not a guess about what's about to happen.
  let currentIdx = -1;
  config.processingSteps.forEach((step, i) => {
    if (receivedSet.has(step.key)) currentIdx = i;
  });

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3 }}
        className="rounded-2xl border border-border bg-card px-4 py-3.5 max-w-sm"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <div className="flex items-center gap-2">
            <config.icon className={`w-4 h-4 ${accent.text}`} aria-hidden="true" />
            <span className="text-sm font-medium text-foreground">{config.headline}</span>
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {(elapsedMs / 1000).toFixed(1)}s
          </span>
        </div>
        <div className="space-y-1.5">
          {config.processingSteps.map((step, i) => {
            const done = i < currentIdx || (i === currentIdx && i === config.processingSteps.length - 1);
            const isCurrent = i === currentIdx && !done;
            const upcoming = i > currentIdx;
            return (
              <div key={step.key} className="flex items-start gap-2">
                <div
                  className={`mt-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 ${
                    done ? accent.bg : upcoming ? "bg-accent" : accent.bg
                  }`}
                >
                  {done ? (
                    <Check className={`w-2.5 h-2.5 ${accent.text}`} aria-hidden="true" />
                  ) : isCurrent ? (
                    <motion.span
                      className={`w-1.5 h-1.5 rounded-full ${accent.dot}`}
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1.1, repeat: Infinity }}
                    />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className={`text-xs leading-tight ${upcoming ? "text-muted-foreground/60" : "text-foreground"}`}>
                    {step.label}
                  </p>
                  {isCurrent || done ? (
                    <p className="text-[10px] text-muted-foreground leading-tight">{step.detail}</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
