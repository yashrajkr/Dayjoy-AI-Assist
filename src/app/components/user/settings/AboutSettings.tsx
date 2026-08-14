import { useCallback, useState } from "react";
import { Info, Download, CheckCircle2 } from "lucide-react";
import { BRAND } from "../../../lib/brand";
import { useInstallPrompt } from "../../../lib/useInstallPrompt";
import { Button } from "../../ui/button";
import { SettingsDetailShell, SettingsSection, SettingsRow, SettingsHint } from "./SettingsUI";

export function AboutSettings() {
  const { canInstall, installed, promptInstall } = useInstallPrompt();
  const [installMessage, setInstallMessage] = useState<string | null>(null);

  const handleInstall = useCallback(async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      setInstallMessage("Installed! Look for Dayjoy AI on your home screen or app list.");
    } else if (outcome === "dismissed") {
      setInstallMessage(null);
    }
    setTimeout(() => setInstallMessage(null), 3500);
  }, [promptInstall]);

  return (
    <SettingsDetailShell title="About Dayjoy" subtitle="App info and install" icon={Info}>
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <SettingsHint>
          {installed
            ? `${BRAND.shortName} is installed on this device.`
            : canInstall
              ? `Install ${BRAND.shortName} for a full-screen, app-like experience with faster loading.`
              : `Use your browser's "Add to Home Screen" or "Install app" option to install ${BRAND.shortName}.`}
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

      <SettingsSection>
        <SettingsRow label="Version" value={`${BRAND.name} · v2`} chevron={false} />
      </SettingsSection>
    </SettingsDetailShell>
  );
}
