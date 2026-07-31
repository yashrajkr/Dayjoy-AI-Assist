/**
 * Dayjoy AI Assist — Brand constants
 *
 * Central source of truth for the product name, tagline, and design tokens.
 * Any reference to the legacy name "Dayjoy GPT" should be replaced with
 * `BRAND.name` from this file. Keeping it centralized prevents drift across
 * the codebase if the brand evolves.
 */

export const BRAND = {
  /** Canonical product name — used in sidebars, login, headers, metadata */
  name: "Dayjoy AI Assist",
  /** Short name for compact UIs (mobile sidebars, app switchers) */
  shortName: "Dayjoy AI",
  /** Tagline / subtitle shown under the logo */
  tagline: "Enterprise AI Assistant",
  /** Owner organization */
  organization: "Dayjoy",
  /** Full description for meta tags and About pages */
  description:
    "Enterprise AI Assistant for Dayjoy — approved company knowledge, safe answers, and human escalation whenever needed.",
  /** Color tokens (mirrors theme.css but usable from TS without CSS var indirection) */
  colors: {
    primary: "#234F1E",
    primaryForeground: "#FFFFFF",
    secondary: "#4F6F46",
    accent: "#DDEDD5",
    goldAccent: "#FFC98B",
    background: "#F8F7EE",
    card: "#FFFFFF",
    cardBeige: "#F3EAD8",
    foreground: "#1F1F1F",
    muted: "#6B6B6B",
    destructive: "#C62828",
    warning: "#B7791F",
    border: "rgba(0, 0, 0, 0.08)",
  },
} as const;

/**
 * Legacy brand name(s) that must not appear in user-facing UI.
 * Searched by the audit script; used by the test suite to prevent regressions.
 */
export const LEGACY_NAMES = ["Dayjoy GPT", "DAYJOY GPT", "dayjoy-gpt"] as const;
