import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Info,
  Download,
  CheckCircle2,
  MessageSquare,
  Package,
  BookMarked,
  ShieldCheck,
  Sparkles,
  LifeBuoy,
  FileText,
} from "lucide-react";
import { BRAND } from "../../../lib/brand";
import { useInstallPrompt } from "../../../lib/useInstallPrompt";
import { Button } from "../../ui/button";
import { SettingsDetailShell, SettingsSection, SettingsRow, SettingsHint } from "./SettingsUI";

const FEATURES: { icon: typeof MessageSquare; label: string; description: string }[] = [
  {
    icon: MessageSquare,
    label: "AI Chat",
    description: "Ask anything about Dayjoy products, policies, or your business — answered from verified company knowledge, with sources cited.",
  },
  {
    icon: Package,
    label: "Product Discovery",
    description: "Search, filter, and compare approved Dayjoy products by category, benefits, and safe usage guidance.",
  },
  {
    icon: BookMarked,
    label: "Knowledge Center",
    description: "Browse FAQs, policies, training material, and documents in one place.",
  },
  {
    icon: ShieldCheck,
    label: "Safe, verified answers",
    description: "Every answer is grounded in approved sources — the assistant hands off to a human whenever it can't verify something.",
  },
];

export function AboutSettings() {
  const navigate = useNavigate();
  const { canInstall, installed, promptInstall } = useInstallPrompt();
  const [installMessage, setInstallMessage] = useState<string | null>(null);

  const handleInstall = useCallback(async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      setInstallMessage(`Installed! Look for ${BRAND.shortName} on your home screen or app list.`);
    } else if (outcome === "dismissed") {
      setInstallMessage(null);
    }
    setTimeout(() => setInstallMessage(null), 3500);
  }, [promptInstall]);

  return (
    <SettingsDetailShell title={`About ${BRAND.name}`} subtitle="What the app does, and how to install it" icon={Info}>
      {/* Overview */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold">{BRAND.name}</h2>
        </div>
        <p className="text-[13px] text-muted-foreground leading-relaxed">{BRAND.description}</p>
      </div>

      {/* Install */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Download className="w-4 h-4 text-primary" aria-hidden="true" />
          Install the app
        </h2>
        <SettingsHint>
          {installed
            ? `${BRAND.shortName} is installed on this device.`
            : canInstall
              ? `Install ${BRAND.shortName} for a full-screen, app-like experience with faster loading and offline access to your recent chats.`
              : `Your browser didn't offer an in-app install prompt. Open your browser's menu and look for "Add to Home Screen" or "Install app" to install ${BRAND.shortName} — on iPhone/iPad, use the Share button → "Add to Home Screen" in Safari.`}
        </SettingsHint>
        {canInstall ? (
          <Button type="button" onClick={handleInstall}>
            <Download className="w-4 h-4" aria-hidden="true" />
            Install {BRAND.shortName}
          </Button>
        ) : null}
        {installMessage ? (
          <p className="text-xs text-primary flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            {installMessage}
          </p>
        ) : null}
      </div>

      {/* Key features */}
      <SettingsSection label="What you can do here">
        {FEATURES.map((f) => (
          <SettingsRow
            key={f.label}
            icon={f.icon}
            label={f.label}
            description={f.description}
            chevron={false}
          />
        ))}
      </SettingsSection>

      {/* Support & legal */}
      <SettingsSection label="Support">
        <SettingsRow icon={LifeBuoy} label="Help & Support" onClick={() => navigate("/support")} />
        <SettingsRow icon={FileText} label="Privacy & data controls" onClick={() => navigate("/settings/privacy")} />
      </SettingsSection>

      <SettingsSection>
        <SettingsRow label="Version" value={`${BRAND.name} · v2`} chevron={false} />
        <SettingsRow label="Organization" value={BRAND.organization} chevron={false} />
      </SettingsSection>
    </SettingsDetailShell>
  );
}
