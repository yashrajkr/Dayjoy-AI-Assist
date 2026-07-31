import { useI18n } from "../../lib/i18n/I18nContext";
import { Globe } from "lucide-react";
import { useState, useRef, useEffect } from "react";

/**
 * LanguageSwitcher — compact dropdown for switching UI language.
 *
 * Renders a globe icon + current language code. Click opens a small
 * popover with the available languages. Selecting one calls
 * `setLanguage` which persists to localStorage and updates the
 * `useI18n` context app-wide.
 */
export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { language, setLanguage, languages } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 p-2 rounded-lg hover:bg-accent/50 transition-colors text-sm"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Change language"
      >
        <Globe className="w-4 h-4" aria-hidden="true" />
        <span className="uppercase text-xs font-medium">{language}</span>
      </button>
      {open ? (
        <div
          role="listbox"
          className="absolute right-0 mt-1 w-40 glass rounded-xl shadow-xl py-1 z-50"
        >
          {languages.map((l) => (
            <button
              key={l.code}
              type="button"
              role="option"
              aria-selected={language === l.code}
              onClick={() => {
                setLanguage(l.code);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-accent/60 flex items-center justify-between ${
                language === l.code ? "text-primary font-medium" : "text-foreground"
              }`}
            >
              <span>{l.nativeLabel}</span>
              <span className="text-[10px] uppercase text-muted-foreground">{l.code}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
