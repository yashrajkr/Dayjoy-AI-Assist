import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  Settings,
  Globe,
  Sun,
  Bell,
  LayoutGrid,
  Mic2,
  Brain,
  BookMarked,
  Heart,
  ShieldCheck,
  KeyRound,
  LifeBuoy,
  Flag,
  Info,
  LogOut,
  Download,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/AuthContext";
import { formatRoleLabel } from "../../lib/auth";
import { BRAND } from "../../lib/brand";
import { AppHeader } from "../common/AppHeader";
import { UserAvatar } from "../common/UserAvatar";
import { AccountMenuItems } from "../common/AccountMenu";
import { DropdownMenu, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { useChatExperience } from "../../lib/ChatExperienceContext";
import { isVoiceRepliesEnabled } from "../../lib/voicePreference";
import { useInstallPrompt } from "../../lib/useInstallPrompt";
import { SettingsSection, SettingsRow } from "./settings/SettingsUI";

type Language = "English" | "Hindi" | "Hinglish";
const LS_LANGUAGE_KEY = "dayjoy_user_language";
const LS_NOTIFICATIONS_KEY = "dayjoy_user_notifications";
const THEME_LABEL: Record<string, string> = { system: "System", light: "Light", dark: "Dark" };
const LANGUAGE_LABEL: Record<Language, string> = { English: "English", Hindi: "Hindi", Hinglish: "Hinglish" };

export function UserSettings() {
  const navigate = useNavigate();
  const { currentUser, role, logout } = useAuth();
  const { theme } = useTheme();
  const { mode: chatExperienceMode } = useChatExperience();
  const { canInstall, installed, promptInstall } = useInstallPrompt();

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
  const [knowledgePref, setKnowledgePref] = useState<"Verified" | "All sources">("Verified");

  useEffect(() => {
    const rawLang = window.localStorage.getItem(LS_LANGUAGE_KEY) as Language | null;
    if (rawLang === "English" || rawLang === "Hindi" || rawLang === "Hinglish") setLanguage(rawLang);
    const rawNotif = window.localStorage.getItem(LS_NOTIFICATIONS_KEY);
    setNotifications(rawNotif !== "false");
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase || !currentUser?.id) return;
      try {
        const { data } = await supabase
          .from("user_preferences")
          .select("pref_value")
          .eq("user_id", currentUser.id)
          .eq("pref_key", "knowledge_source_preference")
          .maybeSingle();
        if (!cancelled && data?.pref_value === "all") setKnowledgePref("All sources");
      } catch {
        // no saved preference yet — default stands
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <AppHeader title="Settings" icon={Settings} showBackButton />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 max-w-2xl mx-auto w-full space-y-5 pb-10">
          <SettingsSection label="Account">
            {/* Opens the same Profile / Notifications / Settings / Switch
                View / Help / Sign out menu as the top-bar avatar, instead of
                jumping straight to /profile and hiding the rest one tap
                behind that. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div>
                  <SettingsRow
                    leading={<UserAvatar user={currentUser} initials={initials} size={40} className="text-sm shrink-0" />}
                    label={displayName}
                    description={role ? formatRoleLabel(role) : currentUser?.email ?? "Demo session"}
                    onClick={() => {}}
                    // No chevron here — the arrow convention means "this
                    // navigates forward to another page," but this row now
                    // opens a menu in place instead.
                    chevron={false}
                  />
                </div>
              </DropdownMenuTrigger>
              <AccountMenuItems showLabel={false} />
            </DropdownMenu>
          </SettingsSection>

          <SettingsSection label="General">
            <SettingsRow
              icon={Globe}
              label="Language"
              value={LANGUAGE_LABEL[language]}
              onClick={() => navigate("/settings/language")}
            />
            <SettingsRow
              icon={Sun}
              label="Appearance"
              value={THEME_LABEL[theme ?? "system"] ?? "System"}
              onClick={() => navigate("/settings/appearance")}
            />
            <SettingsRow
              icon={Bell}
              label="Notifications"
              value={notifications ? "On" : "Off"}
              onClick={() => navigate("/settings/notifications")}
            />
          </SettingsSection>

          <SettingsSection label="AI Experience">
            <SettingsRow
              icon={LayoutGrid}
              label="Chat experience"
              value={chatExperienceMode === "explorer" ? "Explorer" : "Professional"}
              onClick={() => navigate("/settings/chat-experience")}
            />
            <SettingsRow
              icon={Mic2}
              label="Voice"
              value={isVoiceRepliesEnabled() ? "Enabled" : "Disabled"}
              onClick={() => navigate("/settings/voice")}
            />
            <SettingsRow
              icon={Brain}
              label="Personalization"
              description="What the AI remembers about you"
              onClick={() => navigate("/settings/personalization")}
            />
            <SettingsRow
              icon={BookMarked}
              label="Knowledge sources"
              value={knowledgePref}
              onClick={() => navigate("/settings/knowledge-sources")}
            />
            <SettingsRow
              icon={Heart}
              label="Favorites"
              description="Products and answers you've saved"
              onClick={() => navigate("/favorites")}
            />
          </SettingsSection>

          <SettingsSection label="Privacy & Security">
            <SettingsRow icon={ShieldCheck} label="Data controls" onClick={() => navigate("/settings/privacy")} />
            <SettingsRow icon={KeyRound} label="Security & login" onClick={() => navigate("/settings/security")} />
          </SettingsSection>

          {/* Only shown when the browser actually supports install-on-demand
              and it isn't already installed — otherwise this row would be
              dead weight (desktop Safari, or an already-installed PWA).
              Full install details still live on the About page below. */}
          {canInstall && !installed ? (
            <SettingsSection label="App">
              <SettingsRow
                icon={Download}
                label={`Install ${BRAND.shortName}`}
                description="Add to your home screen for faster, full-screen access"
                onClick={() => void promptInstall()}
                chevron={false}
              />
            </SettingsSection>
          ) : null}

          <SettingsSection label="Support">
            <SettingsRow icon={LifeBuoy} label="Help & Support" onClick={() => navigate("/support")} />
            <SettingsRow icon={Flag} label="Report a problem" onClick={() => navigate("/support")} />
            <SettingsRow icon={Info} label={`About ${BRAND.name}`} onClick={() => navigate("/settings/about")} />
          </SettingsSection>

          <SettingsSection>
            <SettingsRow icon={LogOut} label="Log out" onClick={handleLogout} chevron={false} danger />
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}
