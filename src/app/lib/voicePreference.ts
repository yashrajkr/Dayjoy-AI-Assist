/**
 * Whether the chat composer shows its inline mic / voice controls.
 * Synchronous + localStorage-backed so the composer can gate on it during
 * first render without waiting on a Supabase round-trip. Settings/VoiceSettings.tsx
 * mirrors the same value to `user_preferences` (pref_key "voice_replies") for
 * cross-device sync; this key is the fast local source of truth.
 */
const LS_VOICE_REPLIES_KEY = "dayjoy_voice_replies";

export function isVoiceRepliesEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(LS_VOICE_REPLIES_KEY) !== "disabled";
}

export function setVoiceRepliesEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_VOICE_REPLIES_KEY, enabled ? "enabled" : "disabled");
}
