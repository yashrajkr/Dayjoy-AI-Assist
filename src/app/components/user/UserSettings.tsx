import { useEffect, useState, useCallback } from "react";
import { useTheme } from "next-themes";
import {
  Settings,
  Globe,
  Bell,
  Shield,
  Save,
  CheckCircle2,
  Brain,
  Pin,
  Trash2,
  Plus,
  BellRing,
  BellOff,
  Smartphone,
  AlertCircle,
  Check,
  UserRound,
  Sun,
  Moon,
  Monitor,
  Sparkles,
  Compass,
  Download,
  Info,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/AuthContext";
import { formatRoleLabel } from "../../lib/auth";
import { BRAND } from "../../lib/brand";
import { Card } from "../common/AdminUI";
import { AppHeader } from "../common/AppHeader";
import { Button } from "../ui/button";
import { useChatExperience, type ChatExperience } from "../../lib/chatMode";
import { useInstallPrompt, isStandalone } from "../../lib/useInstallPrompt";
import {
  getPushSubscriptionState,
  subscribeToPush,
  unsubscribeFromPush,
  sendLocalNotification,
  type PushSubscriptionState,
} from "../../lib/pushNotifications";

type Language = "English" | "Hindi" | "Hinglish";
const LS_LANGUAGE_KEY = "dayjoy_user_language";
const LS_NOTIFICATIONS_KEY = "dayjoy_user_notifications";

type UserPreference = {
  id: string;
  pref_key: string;
  pref_value: string | null;
  category: string;
  pinned: boolean;
};

export function UserSettings() {
  const { currentUser, role } = useAuth();
  const displayName = currentUser?.user_metadata?.full_name
    ? String(currentUser.user_metadata.full_name)
    : currentUser?.email?.split("@")[0] ?? "Dayjoy User";
  const initials = displayName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const [language, setLanguage] = useState<Language>("English");
  const [notifications, setNotifications] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // Appearance — System / Light / Dark, persisted via next-themes
  const { theme, setTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  useEffect(() => setThemeMounted(true), []);

  // Chat Experience — Professional (default, minimal mobile chat) vs Explorer
  const [chatExperience, setChatExperienceState] = useChatExperience();

  // App install
  const { installed, installable, promptInstall } = useInstallPrompt();
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const handleInstallClick = useCallback(async () => {
    const outcome = await promptInstall();
    if (outcome === "unavailable") {
      setInstallMessage(
        "Your browser hasn't offered an install prompt yet. On iOS Safari, use Share → Add to Home Screen.",
      );
      setTimeout(() => setInstallMessage(null), 5000);
    }
  }, [promptInstall]);

  // Push notifications state
  const [pushState, setPushState] = useState<PushSubscriptionState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  const refreshPushState = useCallback(async () => {
    const s = await getPushSubscriptionState();
    setPushState(s);
  }, []);

  useEffect(() => {
    refreshPushState();
  }, [refreshPushState]);

  const handleEnablePush = useCallback(async () => {
    setPushBusy(true);
    setPushMessage(null);
    const ok = await subscribeToPush();
    await refreshPushState();
    setPushMessage(ok ? "Push notifications enabled." : "Permission denied. Enable notifications in your browser settings.");
    setTimeout(() => setPushMessage(null), 3500);
    setPushBusy(false);
    if (ok) {
      // Send a welcome test notification so the user sees the format.
      setTimeout(() => {
        sendLocalNotification({
          title: `${BRAND.shortName} notifications are on`,
          body: "You'll be notified about ticket updates, training reminders, and AI completions.",
          tag: "welcome-push",
          route: "/",
        });
      }, 800);
    }
  }, [refreshPushState]);

  const handleDisablePush = useCallback(() => {
    unsubscribeFromPush();
    refreshPushState();
    setPushMessage("Push notifications disabled.");
    setTimeout(() => setPushMessage(null), 2500);
  }, [refreshPushState]);

  const handleTestPush = useCallback(() => {
    sendLocalNotification({
      title: "Test notification",
      body: `This is how ${BRAND.shortName} notifications appear.`,
      tag: "test-push",
      route: "/settings",
    });
  }, []);

  // AI Memory state
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
      await supabase
        .from("user_preferences")
        .update({ pinned: !p.pinned })
        .eq("id", p.id);
      setPrefs((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, pinned: !x.pinned } : x)),
      );
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

  useEffect(() => {
    const rawLang = window.localStorage.getItem(LS_LANGUAGE_KEY) as Language | null;
    if (rawLang === "English" || rawLang === "Hindi" || rawLang === "Hinglish") {
      setLanguage(rawLang);
    }
    const rawNotif = window.localStorage.getItem(LS_NOTIFICATIONS_KEY);
    if (rawNotif === "false") setNotifications(false);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSavedMessage(null);
    try {
      window.localStorage.setItem(LS_LANGUAGE_KEY, language);
      window.localStorage.setItem(LS_NOTIFICATIONS_KEY, String(notifications));
      // Persist language to profile if signed in
      if (supabase && currentUser?.id) {
        await supabase.from("profiles").update({ language }).eq("id", currentUser.id);
      }
      setSavedMessage("Settings saved.");
      setTimeout(() => setSavedMessage(null), 2500);
    } catch {
      setSavedMessage("Could not save settings. Please try again.");
      setTimeout(() => setSavedMessage(null), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <AppHeader title="Settings" subtitle={`Customize your ${BRAND.name} experience.`} icon={Settings} showBackButton />
      <div className="flex-1 overflow-y-auto">
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full space-y-4">
        <Card className="bg-gradient-to-br from-primary/8 to-transparent border-primary/15">
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-full bg-forest text-forest-foreground flex items-center justify-center font-semibold text-lg shrink-0"
              aria-hidden="true"
            >
              {initials || <UserRound className="w-6 h-6" aria-hidden="true" />}
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold truncate">{displayName}</h2>
              <p className="text-sm text-muted-foreground truncate">{currentUser?.email ?? "Demo session"}</p>
              {role ? (
                <span className="inline-flex items-center mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  {formatRoleLabel(role)}
                </span>
              ) : null}
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center shrink-0">
              <Globe className="w-5 h-5 text-primary" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold">Language</h2>
              <p className="text-sm text-muted-foreground mb-3">
                Choose the language for AI responses and notifications.
              </p>
              <label htmlFor="dj-user-lang" className="sr-only">
                Language
              </label>
              <select
                id="dj-user-lang"
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
                className="w-full sm:w-auto px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="English">English</option>
                <option value="Hindi">हिन्दी (Hindi)</option>
                <option value="Hinglish">Hinglish</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Appearance — System / Light / Dark */}
        <Card>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center shrink-0">
              <Sun className="w-5 h-5 text-primary" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold">Appearance</h2>
              <p className="text-sm text-muted-foreground mb-3">
                Choose how {BRAND.shortName} looks. System follows your device setting.
              </p>
              <div className="inline-flex rounded-lg border border-border p-1 gap-1" role="radiogroup" aria-label="Theme">
                {(
                  [
                    { value: "system", label: "System", icon: Monitor },
                    { value: "light", label: "Light", icon: Sun },
                    { value: "dark", label: "Dark", icon: Moon },
                  ] as const
                ).map((opt) => {
                  const active = themeMounted && theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setTheme(opt.value)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                        active ? "bg-primary text-primary-foreground" : "hover:bg-accent/60 text-foreground"
                      }`}
                    >
                      <opt.icon className="w-3.5 h-3.5" aria-hidden="true" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>

        {/* Chat Experience — Professional (default) vs Explorer */}
        <Card>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-primary" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold">Chat Experience</h2>
              <p className="text-sm text-muted-foreground mb-3">
                Professional keeps the mobile chat screen to just the conversation. Explorer brings back quick-start prompt cards and shortcuts.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(
                  [
                    { value: "professional" as ChatExperience, label: "Professional", desc: "Minimal, chat-first", icon: Shield },
                    { value: "explorer" as ChatExperience, label: "Explorer", desc: "Discovery shortcuts", icon: Compass },
                  ]
                ).map((opt) => {
                  const active = chatExperience === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setChatExperienceState(opt.value)}
                      aria-pressed={active}
                      className={`text-left p-3 rounded-xl border transition-colors ${
                        active ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40"
                      }`}
                    >
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <opt.icon className={`w-4 h-4 ${active ? "text-primary" : "text-muted-foreground"}`} aria-hidden="true" />
                        {opt.label}
                        {active ? <Check className="w-3.5 h-3.5 text-primary ml-auto" aria-hidden="true" /> : null}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center shrink-0">
              <Bell className="w-5 h-5 text-primary" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold">Notifications</h2>
              <p className="text-sm text-muted-foreground mb-3">
                Receive updates when your support tickets are updated or new training is assigned.
              </p>
              <button
                type="button"
                onClick={() => setNotifications((v) => !v)}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
                  notifications
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border"
                }`}
                aria-pressed={notifications}
              >
                {notifications ? "Enabled" : "Disabled"}
              </button>
            </div>
          </div>
        </Card>

        {/* Push Notifications — OS-level notifications via browser */}
        <Card>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center shrink-0">
              <BellRing className="w-5 h-5 text-primary" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold">Push Notifications</h2>
              <p className="text-sm text-muted-foreground mb-3">
                Get OS-level notifications on this device when tickets update, training is assigned, or AI responses finish — even when {BRAND.shortName} is in the background.
              </p>

              {/* Status row */}
              <div className="flex items-center gap-2 mb-3 text-xs flex-wrap">
                {pushState ? (
                  <>
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${
                      pushState.subscribed
                        ? "bg-primary/10 text-primary"
                        : pushState.permission === "denied"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-muted text-muted-foreground"
                    }`}>
                      {pushState.subscribed ? (
                        <>
                          <Check className="w-3 h-3" aria-hidden="true" /> Subscribed
                        </>
                      ) : pushState.permission === "denied" ? (
                        <>
                          <AlertCircle className="w-3 h-3" aria-hidden="true" /> Blocked
                        </>
                      ) : (
                        <>
                          <BellOff className="w-3 h-3" aria-hidden="true" /> Not subscribed
                        </>
                      )}
                    </span>
                    <span className="text-muted-foreground">
                      Permission: <span className="font-mono">{pushState.permission}</span>
                    </span>
                    {pushState.swRegistered ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Smartphone className="w-3 h-3" aria-hidden="true" /> SW ready
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-muted-foreground">Checking…</span>
                )}
              </div>

              {/* Unsupported notice */}
              {pushState && !pushState.supported ? (
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-2.5 text-xs text-warning mb-3 flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    Push notifications aren't supported in this browser. On iOS, install {BRAND.shortName} to your home screen first.
                  </span>
                </div>
              ) : null}

              {/* Blocked notice */}
              {pushState && pushState.permission === "denied" ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive mb-3 flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    Notifications are blocked at the browser level. Open site settings (lock icon in URL bar) and allow notifications to re-enable.
                  </span>
                </div>
              ) : null}

              {/* Action buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                {pushState && !pushState.subscribed ? (
                  <Button
                    type="button"
                    onClick={handleEnablePush}
                    disabled={pushBusy || !pushState.supported}
                  >
                    <BellRing className="w-4 h-4" aria-hidden="true" />
                    {pushBusy ? "Requesting…" : "Enable push"}
                  </Button>
                ) : null}
                {pushState && pushState.subscribed ? (
                  <>
                    <Button type="button" variant="secondary" onClick={handleTestPush}>
                      <Bell className="w-4 h-4" aria-hidden="true" />
                      Send test
                    </Button>
                    <Button type="button" variant="ghost" onClick={handleDisablePush}>
                      <BellOff className="w-4 h-4" aria-hidden="true" />
                      Disable
                    </Button>
                  </>
                ) : null}
              </div>

              {/* Status message */}
              {pushMessage ? (
                <p className="text-xs text-primary mt-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  {pushMessage}
                </p>
              ) : null}
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-primary" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold">Privacy & Safety</h2>
              <p className="text-sm text-muted-foreground mb-3">
                What you can expect from {BRAND.name}:
              </p>
              <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1 mb-3">
                <li>Safety rules block unsafe medical and income claims.</li>
                <li>Every AI response cites its sources from approved company knowledge.</li>
                <li>Your chat history is private to your account (RLS-protected).</li>
                <li>You can delete any conversation at any time.</li>
              </ul>
            </div>
          </div>
        </Card>

        {/* AI Memory — remember user preferences */}
        <Card>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center shrink-0">
              <Brain className="w-5 h-5 text-primary" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold">AI Memory</h2>
              <p className="text-sm text-muted-foreground mb-3">
                Save preferences that {BRAND.name} will remember across conversations. Pinned items are prioritized.
              </p>

              {/* Existing preferences */}
              <div className="space-y-2 mb-4">
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
                        <Pin
                          className={`w-3.5 h-3.5 ${p.pinned ? "text-primary" : "text-muted-foreground"}`}
                          aria-hidden="true"
                        />
                      </Button>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{p.pref_key}</p>
                        {p.pref_value ? (
                          <p className="text-xs text-muted-foreground truncate">{p.pref_value}</p>
                        ) : null}
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
              </div>

              {/* Add new preference */}
              <div className="flex flex-col sm:flex-row gap-2">
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
                <Button
                  type="button"
                  onClick={addPref}
                  disabled={!newPrefKey.trim()}
                  aria-label="Add memory"
                  className="shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  Add
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* App — install + version */}
        <Card>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center shrink-0">
              <Download className="w-5 h-5 text-primary" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold">App</h2>
              <p className="text-sm text-muted-foreground mb-3">
                {isStandalone() || installed
                  ? `${BRAND.shortName} is installed on this device.`
                  : `Install ${BRAND.shortName} for a faster, full-screen experience.`}
              </p>
              {!isStandalone() && !installed ? (
                <Button type="button" onClick={handleInstallClick} disabled={!installable}>
                  <Download className="w-4 h-4" aria-hidden="true" />
                  {installable ? "Install Dayjoy AI" : "Install not available yet"}
                </Button>
              ) : null}
              {installMessage ? (
                <p className="text-xs text-muted-foreground mt-2 flex items-start gap-1">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                  {installMessage}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground mt-3">
                {BRAND.name} · v2.13.0
              </p>
            </div>
          </div>
        </Card>

        <div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving}
            >
              <Save className="w-4 h-4" aria-hidden="true" />
              {saving ? "Saving…" : "Save language & notifications"}
            </Button>
            {savedMessage ? (
              <span className="inline-flex items-center gap-1 text-sm text-primary">
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                {savedMessage}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Push notifications and AI Memory save instantly — this button only applies your language and in-app notification preference.
          </p>
        </div>
      </div>
      </div>
    </div>
  );
}
