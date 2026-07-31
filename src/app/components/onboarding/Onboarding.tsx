import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronRight, ChevronLeft, Check } from "lucide-react";
import { BRAND } from "../../lib/brand";

/**
 * Onboarding — interactive first-time user walkthrough.
 *
 * Highlights the 7 key areas of the app in sequence:
 *   1. Sidebar
 *   2. Chat
 *   3. Products
 *   4. Support
 *   5. Knowledge
 *   6. Profile
 *   7. Settings
 *
 * Completion status is persisted in localStorage under `dayjoy_onboarding_v1`.
 * The user can skip at any time; the walkthrough won't show again unless
 * they reset it from UserSettings.
 *
 * Implementation note: this is a lightweight overlay walkthrough (not a
 * full joyride with element highlighting). Highlighting specific DOM
 * elements is fragile across responsive layouts; instead we show a
 * centered modal with an illustration + description for each step.
 */

const STORAGE_KEY = "dayjoy_onboarding_v1";

const STEPS = [
  {
    title: `Welcome to ${BRAND.name}`,
    description: `${BRAND.name} is your enterprise AI assistant for Dayjoy. Let's take a 60-second tour.`,
    icon: "👋",
  },
  {
    title: "AI Chat",
    description:
      "Ask questions about products, policies, training, and more. The AI answers only from approved Dayjoy knowledge — never hallucinates.",
    icon: "💬",
  },
  {
    title: "Product Discovery",
    description: "Browse the approved product catalog, compare up to 3 products side-by-side, and view detailed benefits and safety notes.",
    icon: "🌿",
  },
  {
    title: "Distributor Assistant",
    description: "Generate ethical sales replies, follow-ups, social posts, and daily plans — all compliant with Dayjoy safety rules.",
    icon: "🚀",
  },
  {
    title: "Training",
    description: "Complete training modules, track your progress, earn certificates, and climb the leaderboard.",
    icon: "🎓",
  },
  {
    title: "Human Support",
    description: "Can't find what you need? Raise a support ticket and a Dayjoy team member will respond.",
    icon: "🎧",
  },
  {
    title: "Settings & Theme",
    description: "Customize your language, toggle dark mode, and manage notifications from Settings.",
    icon: "⚙️",
  },
] as const;

export function Onboarding() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Check on mount whether onboarding has been completed
  useEffect(() => {
    try {
      const done = window.localStorage.getItem(STORAGE_KEY);
      if (!done) setOpen(true);
    } catch {
      // localStorage unavailable — skip onboarding
    }
  }, []);

  const complete = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      // ignore
    }
    setOpen(false);
  }, []);

  const skip = useCallback(() => {
    complete();
  }, [complete]);

  const next = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      complete();
    }
  }, [step, complete]);

  const prev = useCallback(() => {
    if (step > 0) setStep((s) => s - 1);
  }, [step]);

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dj-onboarding-title"
      >
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 16 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
          className="w-full max-w-md glass-strong rounded-3xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex gap-1.5">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setStep(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === step
                      ? "w-6 bg-primary"
                      : i < step
                        ? "w-1.5 bg-primary/60"
                        : "w-1.5 bg-muted"
                  }`}
                  aria-label={`Go to step ${i + 1}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={skip}
              className="p-1.5 rounded-lg hover:bg-accent/60 text-muted-foreground"
              aria-label="Skip onboarding"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* Content */}
          <div className="p-8 text-center">
            <motion.div
              key={step}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              className="text-5xl mb-4"
              aria-hidden="true"
            >
              {current.icon}
            </motion.div>
            <h2 id="dj-onboarding-title" className="text-xl font-semibold mb-2">
              {current.title}
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {current.description}
            </p>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between p-4 border-t border-border">
            <button
              type="button"
              onClick={skip}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Skip tour
            </button>
            <div className="flex items-center gap-2">
              {step > 0 ? (
                <button
                  type="button"
                  onClick={prev}
                  className="p-2 rounded-lg hover:bg-accent/60 text-muted-foreground"
                  aria-label="Previous step"
                >
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={next}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
              >
                {isLast ? (
                  <>
                    <Check className="w-4 h-4" aria-hidden="true" /> Got it
                  </>
                ) : (
                  <>
                    Next
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/** Utility to reset onboarding from UserSettings. */
export function resetOnboarding() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
