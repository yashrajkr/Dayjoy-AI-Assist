import { useEffect, useState } from "react";

/**
 * Tracks `window.visualViewport.height` (px), which shrinks live when the
 * on-screen keyboard opens. `100dvh` already accounts for mobile browser
 * chrome (address bar), but several Android Chrome versions do NOT shrink
 * `dvh` when the on-screen keyboard opens — the layout viewport stays tall,
 * so content pinned to its bottom (the composer) ends up with a gap of dead
 * space between it and the keyboard. visualViewport reflects the keyboard
 * in both iOS Safari and Android Chrome, so callers should prefer it over
 * `100dvh` and fall back to `null` (→ CSS `100dvh`) when unsupported.
 */
export function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(() =>
    typeof window !== "undefined" && window.visualViewport
      ? window.visualViewport.height
      : null,
  );

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setHeight(vv.height);
    onResize();
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  return height;
}
