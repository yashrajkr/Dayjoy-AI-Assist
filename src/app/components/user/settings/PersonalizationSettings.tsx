import { useCallback, useEffect, useState } from "react";
import { Brain, Pin, Trash2, Plus } from "lucide-react";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/AuthContext";
import { BRAND } from "../../../lib/brand";
import { Button } from "../../ui/button";
import { SettingsDetailShell, SettingsHint } from "./SettingsUI";

type UserPreference = {
  id: string;
  pref_key: string;
  pref_value: string | null;
  category: string;
  pinned: boolean;
};

export function PersonalizationSettings() {
  const { currentUser } = useAuth();
  const [prefs, setPrefs] = useState<UserPreference[]>([]);
  const [newPrefKey, setNewPrefKey] = useState("");
  const [newPrefValue, setNewPrefValue] = useState("");

  const loadPrefs = useCallback(async () => {
    if (!supabase || !currentUser?.id) return;
    try {
      const { data } = await supabase
        .from("user_preferences")
        .select("*")
        .eq("user_id", currentUser.id)
        .eq("category", "general")
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false });
      setPrefs((data ?? []) as UserPreference[]);
    } catch {
      // table may not exist yet — silently ignore
    }
  }, [currentUser?.id]);

  useEffect(() => {
    loadPrefs();
  }, [loadPrefs]);

  const addPref = async () => {
    if (!supabase || !currentUser?.id || !newPrefKey.trim()) return;
    try {
      const { data, error } = await supabase
        .from("user_preferences")
        .insert({
          user_id: currentUser.id,
          pref_key: newPrefKey.trim(),
          pref_value: newPrefValue.trim() || null,
          category: "general",
        })
        .select("*")
        .single();
      if (error) throw error;
      if (data) {
        setPrefs((prev) => [data as UserPreference, ...prev]);
        setNewPrefKey("");
        setNewPrefValue("");
      }
    } catch (e) {
      console.warn("[prefs] add failed", e);
    }
  };

  const togglePin = async (p: UserPreference) => {
    if (!supabase) return;
    try {
      await supabase.from("user_preferences").update({ pinned: !p.pinned }).eq("id", p.id);
      setPrefs((prev) => prev.map((x) => (x.id === p.id ? { ...x, pinned: !x.pinned } : x)));
    } catch (e) {
      console.warn("[prefs] pin failed", e);
    }
  };

  const deletePref = async (p: UserPreference) => {
    if (!supabase) return;
    try {
      await supabase.from("user_preferences").delete().eq("id", p.id);
      setPrefs((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e) {
      console.warn("[prefs] delete failed", e);
    }
  };

  return (
    <SettingsDetailShell title="Personalization" subtitle="What the AI remembers about you" icon={Brain}>
      <SettingsHint>
        Save preferences that {BRAND.name} will remember across conversations. Pinned items are prioritized.
      </SettingsHint>

      <div className="rounded-xl border border-border bg-card p-3.5 space-y-2">
        {prefs.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">
            No saved memories yet. Add one below to personalize your AI experience.
          </p>
        ) : (
          prefs.map((p) => (
            <div
              key={p.id}
              className={`flex items-start gap-2 p-2 rounded-lg ${
                p.pinned ? "bg-primary/5 border border-primary/20" : "bg-accent/30"
              }`}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => togglePin(p)}
                className="h-auto w-auto p-1 shrink-0"
                aria-label={p.pinned ? "Unpin memory" : "Pin memory"}
                title={p.pinned ? "Unpin" : "Pin"}
              >
                <Pin className={`w-3.5 h-3.5 ${p.pinned ? "text-primary" : "text-muted-foreground"}`} aria-hidden="true" />
              </Button>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{p.pref_key}</p>
                {p.pref_value ? <p className="text-xs text-muted-foreground truncate">{p.pref_value}</p> : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => deletePref(p)}
                className="h-auto w-auto p-1 text-destructive hover:bg-destructive/10 shrink-0"
                aria-label={`Delete ${p.pref_key}`}
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </Button>
            </div>
          ))
        )}

        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <input
            type="text"
            value={newPrefKey}
            onChange={(e) => setNewPrefKey(e.target.value)}
            placeholder="e.g. Favorite product category"
            className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            aria-label="Memory key"
          />
          <input
            type="text"
            value={newPrefValue}
            onChange={(e) => setNewPrefValue(e.target.value)}
            placeholder="e.g. Health Care"
            className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            aria-label="Memory value"
          />
          <Button type="button" onClick={addPref} disabled={!newPrefKey.trim()} aria-label="Add memory" className="shrink-0">
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            Add
          </Button>
        </div>
      </div>
    </SettingsDetailShell>
  );
}
