import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LANGUAGES, type LanguageCode, type TranslationKey } from "./types";
import { en } from "./locales/en";
import { hi } from "./locales/hi";

/**
 * i18n context — translation lookup + language switching.
 *
 * Language resolution order:
 *   1. localStorage `dayjoy_language` (if valid)
 *   2. browser `navigator.language` prefix (en/hi)
 *   3. fallback to `en`
 *
 * When the user switches language, we persist to localStorage. The
 * `profiles.language` column sync is handled separately by UserSettings.
 */

const LOCALES: Record<LanguageCode, Record<TranslationKey, string>> = {
  en: en as Record<TranslationKey, string>,
  hi: hi as Record<TranslationKey, string>,
};

const STORAGE_KEY = "dayjoy_language";

type I18nState = {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: (key: TranslationKey, fallback?: string) => string;
  languages: typeof LANGUAGES;
};

const I18nContext = createContext<I18nState | null>(null);

function detectInitialLanguage(): LanguageCode {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "hi") return stored;
  const nav = navigator.language?.slice(0, 2).toLowerCase();
  if (nav === "hi") return "hi";
  return "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(detectInitialLanguage);

  // Sync <html lang> attribute for accessibility / screen readers
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((lang: LanguageCode) => {
    setLanguageState(lang);
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore — localStorage may be unavailable
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey, fallback?: string) => {
      const dict = LOCALES[language];
      return dict[key] ?? fallback ?? LOCALES.en[key] ?? String(key);
    },
    [language],
  );

  const value = useMemo<I18nState>(
    () => ({ language, setLanguage, t, languages: LANGUAGES }),
    [language, setLanguage, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
