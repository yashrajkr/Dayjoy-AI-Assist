import { useEffect, useRef, useState } from "react";
import type { Variants } from "framer-motion";

/**
 * Shared motion tokens + small hooks used across Dayjoy AI Assist for
 * consistent, premium micro-interactions. Centralizing these keeps every
 * page's animation feel (timing, easing, spring stiffness) identical.
 */

export const EASE_OUT_SOFT: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const EASE_SPRING = { type: "spring", stiffness: 300, damping: 20 } as const;
export const EASE_SPRING_SOFT = { type: "spring", stiffness: 320, damping: 32 } as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT_SOFT } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3, ease: EASE_OUT_SOFT } },
};

export const userBubbleIn: Variants = {
  hidden: { opacity: 0, x: 20, scale: 0.96 },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { duration: 0.3, ease: EASE_OUT_SOFT },
  },
};

export const aiBubbleIn: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: EASE_OUT_SOFT },
  },
};

export const avatarSpring: Variants = {
  hidden: { scale: 0.5, opacity: 0 },
  visible: { scale: 1, opacity: 1, transition: EASE_SPRING },
};

export const drawerBackdrop: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3 } },
  exit: { opacity: 0, transition: { duration: 0.25 } },
};

export const drawerPanel: Variants = {
  hidden: { x: "100%", opacity: 0, scale: 0.95 },
  visible: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: EASE_SPRING_SOFT,
  },
  exit: {
    x: "100%",
    opacity: 0,
    scale: 0.97,
    transition: { duration: 0.25, ease: EASE_OUT_SOFT },
  },
};

export const staggerContainer = (stagger = 0.08, delayChildren = 0): Variants => ({
  hidden: {},
  visible: {
    transition: { staggerChildren: stagger, delayChildren },
  },
});

export const pageTransition: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_OUT_SOFT } },
  exit: { opacity: 0, y: 8, transition: { duration: 0.2, ease: EASE_OUT_SOFT } },
};

/** Detects prefers-reduced-motion and updates live if the user changes it. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/**
 * useTypewriter — reveals `text` word-by-word with a small stagger, mimicking
 * a natural "typed" streaming reveal. Returns the partial text plus whether
 * the reveal is still in progress (for driving a blinking cursor).
 */
export function useTypewriter(text: string, speedMs = 20) {
  const [visibleWordCount, setVisibleWordCount] = useState(0);
  const words = useRef<string[]>([]);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    words.current = text.split(/(\s+)/);
    if (reduced) {
      setVisibleWordCount(words.current.length);
      return;
    }
    setVisibleWordCount(0);
    let cancelled = false;
    let i = 0;
    function tick() {
      if (cancelled) return;
      i += 1;
      setVisibleWordCount(i);
      if (i < words.current.length) {
        window.setTimeout(tick, speedMs);
      }
    }
    const id = window.setTimeout(tick, speedMs);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [text, speedMs, reduced]);

  const partial = words.current.slice(0, visibleWordCount).join("");
  const done = visibleWordCount >= words.current.length;
  return { text: partial, done };
}
