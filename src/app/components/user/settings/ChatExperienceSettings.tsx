import { LayoutGrid, Check } from "lucide-react";
import { useChatExperience } from "../../../lib/ChatExperienceContext";
import { SettingsDetailShell, SettingsSection, SettingsHint } from "./SettingsUI";

const MODES = [
  {
    value: "professional" as const,
    label: "Professional",
    description:
      "Minimal, chat-first mobile screen — no quick-prompt cards or bottom tab bar. Everything else is one tap away in the menu.",
  },
  {
    value: "explorer" as const,
    label: "Explorer",
    description: "The fuller mobile layout with quick-prompt cards and the bottom tab bar always visible.",
  },
];

export function ChatExperienceSettings() {
  const { mode, setMode } = useChatExperience();

  return (
    <SettingsDetailShell title="Chat experience" subtitle="Mobile chat layout" icon={LayoutGrid}>
      <SettingsHint>Controls the mobile chat screen only — desktop is unaffected either way.</SettingsHint>
      <SettingsSection>
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setMode(m.value)}
            aria-pressed={mode === m.value}
            className="w-full flex items-start gap-3 px-3.5 py-3 text-left hover:bg-accent/50 active:bg-accent/70 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-medium leading-tight">
                {m.label}
                {m.value === "professional" ? (
                  <span className="ml-1.5 text-[11px] font-normal text-primary">(recommended)</span>
                ) : null}
              </p>
              <p className="text-[13px] text-muted-foreground mt-0.5">{m.description}</p>
            </div>
            {mode === m.value ? <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" aria-hidden="true" /> : null}
          </button>
        ))}
      </SettingsSection>
    </SettingsDetailShell>
  );
}
