import { useTheme } from "next-themes";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import { BRAND } from "../../../lib/brand";
import { SettingsDetailShell, SettingsSection, SettingsHint } from "./SettingsUI";

const THEMES = [
  { value: "system", label: "System", description: "Match your device setting", icon: Monitor },
  { value: "light", label: "Light", description: "Bright background, dark text", icon: Sun },
  { value: "dark", label: "Dark", description: "Dark background, light text", icon: Moon },
] as const;

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();

  return (
    <SettingsDetailShell title="Appearance" subtitle="Theme for this device" icon={Sun}>
      <SettingsHint>Choose how {BRAND.shortName} looks on this device. System follows your OS setting automatically.</SettingsHint>
      <SettingsSection>
        {THEMES.map(({ value, label, description, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={theme === value}
            className="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-accent/50 active:bg-accent/70 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0" aria-hidden="true">
              <Icon className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-medium leading-tight">{label}</p>
              <p className="text-[13px] text-muted-foreground mt-0.5">{description}</p>
            </div>
            {theme === value ? <Check className="w-4 h-4 text-primary shrink-0" aria-hidden="true" /> : null}
          </button>
        ))}
      </SettingsSection>
    </SettingsDetailShell>
  );
}
