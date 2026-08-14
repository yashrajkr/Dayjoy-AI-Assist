import { useEffect, useState } from "react";
import { Mic2 } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/AuthContext";
import { BRAND } from "../../../lib/brand";
import { isVoiceRepliesEnabled, setVoiceRepliesEnabled } from "../../../lib/voicePreference";
import { SettingsDetailShell, SettingsSection, SettingsHint } from "./SettingsUI";
import { Switch } from "../../ui/switch";

const PREF_KEY = "voice_replies";
const CATEGORY = "voice";

type VoicePreference = "enabled" | "disabled";

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
        <div className="w-full flex items-center gap-3 px-3.5 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-medium leading-tight">Voice in chat</p>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              Show mic, voice orb, and speak-aloud controls in chat
            </p>
          </div>
          <Switch
            checked={value === "enabled"}
            disabled={!loaded}
            onCheckedChange={(checked) => void choose(checked ? "enabled" : "disabled")}
            aria-label="Voice in chat"
          />
        </div>
      </SettingsSection>
    </SettingsDetailShell>
  );
}
