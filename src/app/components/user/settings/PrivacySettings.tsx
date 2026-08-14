import { ShieldCheck } from "lucide-react";
import { BRAND } from "../../../lib/brand";
import { SettingsDetailShell, SettingsHint } from "./SettingsUI";

export function PrivacySettings() {
  return (
    <SettingsDetailShell title="Data controls" subtitle="Privacy and your data" icon={ShieldCheck}>
      <SettingsHint>What you can expect from {BRAND.name}:</SettingsHint>
      <ul className="text-[15px] text-foreground/90 list-disc pl-5 space-y-2 rounded-xl border border-border bg-card p-4">
        <li>Safety rules block unsafe medical and income claims.</li>
        <li>Every AI response cites its sources from approved company knowledge.</li>
        <li>Your chat history is private to your account and protected by row-level security.</li>
        <li>You can delete any conversation at any time from the chat list.</li>
        <li>Personalization data (memory, voice, and source preferences) is visible and editable in this Settings area, and can be removed at any time.</li>
      </ul>
    </SettingsDetailShell>
  );
}
