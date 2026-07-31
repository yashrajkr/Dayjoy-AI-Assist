import { motion, AnimatePresence } from "framer-motion";
import { Search, FileText, Shield, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * KnowledgeSearchViz — animated "searching knowledge" indicator.
 *
 * Cycles through 4 phases while the AI is retrieving context:
 *   1. "Searching knowledge…" (search icon)
 *   2. "Checking approved documents…" (file icon)
 *   3. "Finding related products…" (shield icon)
 *   4. "Verifying company policy…" (check icon)
 *
 * Each phase lasts ~1.4s and crossfades to the next. When `active`
 * becomes false, the component fades out.
 */
const PHASES = [
  { icon: Search, label: "Searching knowledge…" },
  { icon: FileText, label: "Checking approved documents…" },
  { icon: Shield, label: "Finding related products…" },
  { icon: CheckCircle2, label: "Verifying company policy…" },
] as const;

export function KnowledgeSearchViz({ active }: { active: boolean }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) return;
    setPhase(0);
    const timer = setInterval(() => {
      setPhase((p) => (p + 1) % PHASES.length);
    }, 1400);
    return () => clearInterval(timer);
  }, [active]);

  return (
    <AnimatePresence>
      {active ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3 }}
          className="flex items-center gap-3 px-4 py-2.5 rounded-xl glass"
          role="status"
          aria-live="polite"
        >
          <div className="relative w-5 h-5">
            <motion.span
              className="absolute inset-0 rounded-full border-2 border-primary/20"
              style={{ borderTopColor: "var(--primary)" }}
              animate={{ rotate: 360 }}
              transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
              aria-hidden="true"
            />
            <AnimatePresence mode="wait">
              <motion.div
                key={phase}
                initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
                animate={{ rotate: 0, opacity: 1, scale: 1 }}
                exit={{ rotate: 90, opacity: 0, scale: 0.5 }}
                transition={{ duration: 0.25 }}
                className="absolute inset-0 flex items-center justify-center text-primary"
              >
                {(() => {
                  const Icon = PHASES[phase].icon;
                  return <Icon className="w-5 h-5" aria-hidden="true" />;
                })()}
              </motion.div>
            </AnimatePresence>
          </div>
          <AnimatePresence mode="wait">
            <motion.span
              key={phase}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.25 }}
              className="text-sm text-muted-foreground"
            >
              {PHASES[phase].label}
            </motion.span>
          </AnimatePresence>
          <div className="flex gap-1 ml-1">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="w-1 h-1 rounded-full bg-primary"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{
                  duration: 1,
                  repeat: Infinity,
                  delay: i * 0.2,
                }}
              />
            ))}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
