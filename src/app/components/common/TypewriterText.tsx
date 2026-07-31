import { useEffect, useRef, useState } from "react";

/**
 * TypewriterText — reveals text one character at a time.
 *
 * Used for AI responses to give a "thinking + speaking" feel.
 * Skips the animation if the user has `prefers-reduced-motion` set.
 *
 * When `text` changes (e.g. new streaming chunk arrives), the component
 * only animates the NEW characters — already-revealed characters stay
 * visible. This makes it safe to use with streaming responses.
 */
export function TypewriterText({
  text,
  speed = 18, // ms per character
  onComplete,
  className = "",
}: {
  text: string;
  speed?: number;
  onComplete?: () => void;
  className?: string;
}) {
  const [revealed, setRevealed] = useState(0);
  const lastTextRef = useRef("");

  // Respect reduced motion
  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    // If the new text starts with the previous text, only animate the delta.
    // Otherwise, restart from 0.
    const prev = lastTextRef.current;
    let startIdx = 0;
    if (text.startsWith(prev) && prev.length > 0) {
      startIdx = prev.length;
    }
    lastTextRef.current = text;

    if (prefersReduced) {
      setRevealed(text.length);
      onComplete?.();
      return;
    }

    if (startIdx >= text.length) {
      setRevealed(text.length);
      onComplete?.();
      return;
    }

    setRevealed(startIdx);
    let i = startIdx;
    const timer = setInterval(() => {
      i++;
      setRevealed(i);
      if (i >= text.length) {
        clearInterval(timer);
        onComplete?.();
      }
    }, speed);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, speed, prefersReduced]);

  return (
    <span className={className} aria-label={text}>
      {text.slice(0, revealed)}
      {revealed < text.length ? (
        <span className="inline-block w-0.5 h-[1em] bg-current ml-0.5 animate-pulse" aria-hidden="true" />
      ) : null}
    </span>
  );
}
