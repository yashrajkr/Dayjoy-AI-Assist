import { useEffect, useState } from "react";
import { BookMarked, Check } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/AuthContext";
import { BRAND } from "../../../lib/brand";
import { SettingsDetailShell, SettingsSection, SettingsHint } from "./SettingsUI";

const PREF_KEY = "knowledge_source_preference";
const CATEGORY = "knowledge";

type SourcePreference = "verified" | "all";

const OPTIONS: { value: SourcePreference; label: string; description: string }[] = [
  {
    value: "verified",
    label: "Verified only",
    description: "Prefer answers grounded in approved company knowledge",
  },
  {
    value: "all",
    label: "All approved sources",
    description: "Draw from the full approved knowledge base",
  },
];

export function KnowledgeSourceSettings() {
  const { currentUser } = useAuth();
  const [value, setValue] = useState<SourcePreference>("verified");
  const [loaded, setLoaded] = useState(false);

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
        if (!cancelled && data?.pref_value === "all") setValue("all");
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

  const choose = async (next: SourcePreference) => {
    setValue(next);
    if (!supabase || !currentUser?.id) return;
    try {
      await supabase
        .from("user_preferences")
        .upsert(
          { user_id: currentUser.id, pref_key: PREF_KEY, pref_value: next, category: CATEGORY },
          { onConflict: "user_id,pref_key" },
        );
    } catch (e) {
      console.warn("[knowledge-source-settings] save failed", e);
    }
  };

  return (
    <SettingsDetailShell title="Knowledge sources" subtitle="What the AI draws answers from" icon={BookMarked}>
      <SettingsHint>
        Every {BRAND.shortName} answer already cites its source from approved company knowledge. This preference is
        saved with your AI memory and biases which sources get priority.
      </SettingsHint>
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
