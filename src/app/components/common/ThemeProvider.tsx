import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Theme provider — wraps next-themes to enable dark mode.
 *
 * The `class` strategy adds `.dark` to the <html> element when dark mode is
 * active. The `.dark` selector in `theme.css` then swaps all the CSS
 * variables. We disable `disableTransitionOnChange` to avoid a jarring
 * flash during the swap.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      themes={["light", "dark", "system"]}
      disableTransitionOnChange={false}
      storageKey="dayjoy-theme"
    >
      {children}
    </NextThemesProvider>
  );
}
