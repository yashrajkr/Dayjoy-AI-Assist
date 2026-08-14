import { useEffect, useState } from "react";
import { Mic2, Check } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/AuthContext";
import { BRAND } from "../../../lib/brand";
import { isVoiceRepliesEnabled, setVoiceRepliesEnabled } from "../../../lib/voicePreference";
import { SettingsDetailShell, SettingsSection, SettingsHint } from "./SettingsUI";

const PREF_KEY = "voice_replies";
const CATEGORY = "voice";

type VoicePreference = "enabled" | "disabled";

const OPTIONS: { value: VoicePreference; label: string; description: string }[] = [
  { value: "enabled", label: "Enabled", description: "Show mic, voice orb, and speak-aloud controls in chat" },
  { value: "disabled", label: "Disabled", description: "Hide voice input and voice replies throughout chat" },
];

export function VoiceSettings() {
  const { currentUser } = useAuth();
  const [value, setValue] = useState<VoicePreference>(isVoiceRepliesEnabled() ? "enabled" : "disabled");
  const [loaded, setLoaded] = useState(false);
  const supported =
    typeof window !== "undefined" &&
    (("SpeechRecognition" in window) || ("webkitSpeechRecognition" in window) || "speechSynthesis" in window);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase || !currentUser?.id) {
        setLoaded(true);
        return;
      }
      try {
        const { data } = await supabase
          .from("user_preferences")
          .select("pref_value")
          .eq("user_id", currentUser.id)
          .eq("pref_key", PREF_KEY)
          .maybeSingle();
        if (!cancelled && data?.pref_value) {
          const next = data.pref_value === "disabled" ? "disabled" : "enabled";
          setValue(next);
          setVoiceRepliesEnabled(next === "enabled");
        }
      } catch {
        // no saved preference yet — default stands
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  const choose = async (next: VoicePreference) => {
    setValue(next);
    setVoiceRepliesEnabled(next === "enabled");
    if (!supabase || !currentUser?.id) return;
    try {
      await supabase
        .from("user_preferences")
        .upsert(
          { user_id: currentUser.id, pref_key: PREF_KEY, pref_value: next, category: CATEGORY },
          { onConflict: "user_id,pref_key" },
        );
    } catch (e) {
      console.warn("[voice-settings] save failed", e);
    }
  };

  return (
    <SettingsDetailShell title="Voice" subtitle="Voice input and spoken replies" icon={Mic2}>
      <SettingsHint>
        {BRAND.shortName} can listen to your questions and read answers aloud using your browser's built-in speech
        features. Tap the mic or speaker icons in chat to use voice hands-free.
      </SettingsHint>
      {!supported ? (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-2.5 text-xs text-warning">
          This browser doesn't support voice input or speech playback.
        </div>
      ) : null}
      <SettingsSection>
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={!loaded}
            onClick={() => choose(o.value)}
            aria-pressed={value === o.value}
            className="w-full flex items-start gap-3 px-3.5 py-3 text-left hover:bg-accent/50 active:bg-accent/70 transition-colors disabled:opacity-60"
          >
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-medium leading-tight">{o.label}</p>
              <p className="text-[13px] text-muted-foreground mt-0.5">{o.description}</p>
            </div>
            {value === o.value ? <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" aria-hidden="true" /> : null}
          </button>
        ))}
      </SettingsSection>
    </SettingsDetailShell>
  );
}
