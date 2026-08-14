import { useEffect, useState } from "react";

/**
 * The source logo file is a flat PNG on a solid black background (no alpha
 * channel) — fine as a standalone image, but unusable as a UI mark on cards,
 * headers, or the orb. This chroma-keys near-black pixels to transparent at
 * runtime via canvas (no server-side image tooling in this project), so the
 * lotus/brain mark can sit on any background. Result is cached per src so
 * every consumer (header, sidebar, orb badge) processes the image once.
 */

const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

const BLACK_THRESHOLD = 24; // 0-255; pixels at/below this on all channels become transparent

function keyOutBlack(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("2D canvas context unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = frame.data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] <= BLACK_THRESHOLD && data[i + 1] <= BLACK_THRESHOLD && data[i + 2] <= BLACK_THRESHOLD) {
          data[i + 3] = 0;
        }
      }
      ctx.putImageData(frame, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

/** Returns a transparent-background data URL for `src` once processed, or null while pending/unavailable. */
export function useTransparentLogo(src: string): string | null {
  const [url, setUrl] = useState<string | null>(cache.get(src) ?? null);

  useEffect(() => {
    if (cache.has(src)) {
      setUrl(cache.get(src)!);
      return;
    }
    let cancelled = false;
    let promise = inFlight.get(src);
    if (!promise) {
      promise = keyOutBlack(src);
      inFlight.set(src, promise);
    }
    promise
      .then((dataUrl) => {
        cache.set(src, dataUrl);
        if (!cancelled) setUrl(dataUrl);
      })
      .catch(() => {
        // Leave url as null — callers fall back to their existing mark.
      })
      .finally(() => {
        inFlight.delete(src);
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  return url;
}
