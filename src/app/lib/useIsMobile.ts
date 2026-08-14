import { useEffect, useState } from "react";

const MOBILE_QUERY = "(max-width: 1023px)";

/** Tracks the `lg` Tailwind breakpoint (1024px) so JS-driven layout
 * decisions stay in sync with the `lg:` utility classes used elsewhere. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(MOBILE_QUERY).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
