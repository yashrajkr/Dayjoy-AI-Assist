import { useEffect, useState } from "react";
import { Globe, Check } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/AuthContext";
import { BRAND } from "../../../lib/brand";
import { SettingsDetailShell, SettingsSection, SettingsHint } from "./SettingsUI";

type Language = "English" | "Hindi" | "Hinglish";
const LS_LANGUAGE_KEY = "dayjoy_user_language";

const LANGUAGES: { value: Language; label: string }[] = [
  { value: "English", label: "English" },
  { value: "Hindi", label: "हिन्दी (Hindi)" },
  { value: "Hinglish", label: "Hinglish" },
];

export function LanguageSettings() {
  const { currentUser } = useAuth();
  const [language, setLanguage] = useState<Language>("English");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(LS_LANGUAGE_KEY) as Language | null;
    if (raw === "English" || raw === "Hindi" || raw === "Hinglish") setLanguage(raw);
  }, []);

  const choose = async (value: Language) => {
    setLanguage(value);
    window.localStorage.setItem(LS_LANGUAGE_KEY, value);
    if (supabase && currentUser?.id) {
      try {
        await supabase.from("profiles").update({ language: value }).eq("id", currentUser.id);
      } catch {
        // profile column may not exist yet — local preference still applies
      }
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <SettingsDetailShell title="Language" subtitle="Applies to AI responses and notifications" icon={Globe}>
      <SettingsHint>Choose the language {BRAND.shortName} uses for AI responses and in-app notifications.</SettingsHint>
      <SettingsSection>
        {LANGUAGES.map((l) => (
          <button
            key={l.value}
            type="button"
            onClick={() => choose(l.value)}
            className="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-accent/50 active:bg-accent/70 transition-colors"
          >
            <span className="flex-1 text-[15px]">{l.label}</span>
            {language === l.value ? <Check className="w-4 h-4 text-primary shrink-0" aria-hidden="true" /> : null}
          </button>
        ))}
      </SettingsSection>
      {saved ? <p className="text-[13px] text-primary">Saved.</p> : null}
    </SettingsDetailShell>
  );
}
