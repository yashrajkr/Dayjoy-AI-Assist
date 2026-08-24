/**
 * voiceCommands — local interaction-command recognition.
 *
 * Certain finalized utterances ("stop", "repeat that", "speak in Hindi")
 * are conversation *controls*, not questions for the LLM — handling them
 * client-side means they execute instantly (no round trip) and never
 * pollute the transcript with a wasted backend call. Deliberately a small
 * fixed phrase list, not a classifier — every command here is something
 * the user can trigger unambiguously and predictably.
 */

export type VoiceCommand =
  | { type: "stop" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "repeat" }
  | { type: "slower" }
  | { type: "faster" }
  | { type: "shorter" }
  | { type: "switch_language"; languageCode: string }
  | { type: "switch_to_chat" }
  | { type: "end_conversation" }
  | { type: "show_sources" }
  | { type: "confirm" }
  | { type: "cancel" };

const LANGUAGE_TRIGGERS: Array<{ code: string; phrases: string[] }> = [
  { code: "hi", phrases: ["speak in hindi", "switch to hindi", "hindi mein baat karo", "hindi me bolo"] },
  { code: "en", phrases: ["speak in english", "switch to english"] },
  { code: "mr", phrases: ["speak in marathi", "switch to marathi"] },
  { code: "bn", phrases: ["speak in bengali", "switch to bengali"] },
  { code: "ta", phrases: ["speak in tamil", "switch to tamil"] },
  { code: "te", phrases: ["speak in telugu", "switch to telugu"] },
  { code: "gu", phrases: ["speak in gujarati", "switch to gujarati"] },
  { code: "pa", phrases: ["speak in punjabi", "switch to punjabi"] },
  { code: "kn", phrases: ["speak in kannada", "switch to kannada"] },
  { code: "ml", phrases: ["speak in malayalam", "switch to malayalam"] },
  { code: "ur", phrases: ["speak in urdu", "switch to urdu"] },
];

/** Backchannel acknowledgements — must NOT interrupt AI speech mid-answer. */
export const BACKCHANNEL_WORDS = new Set([
  "hmm",
  "hm",
  "mm",
  "mhm",
  "okay",
  "ok",
  "yes",
  "yeah",
  "yep",
  "right",
  "sure",
  "got it",
  "i see",
  "uh huh",
  "uhhuh",
  "acha",
  "achha",
  "theek hai",
]);

/** A short utterance made only of backchannel words — not a real interruption. */
export function isBackchannelOnly(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.,!?]/g, "");
  if (!normalized) return false;
  if (normalized.length > 24) return false; // too long to be a pure acknowledgement
  return BACKCHANNEL_WORDS.has(normalized) || normalized.split(/\s+/).every((w) => BACKCHANNEL_WORDS.has(w));
}

export function parseVoiceCommand(rawText: string): VoiceCommand | null {
  const text = rawText.trim().toLowerCase().replace(/[.,!?]+$/g, "");
  if (!text) return null;

  if (["stop", "stop talking", "stop speaking", "quiet"].includes(text)) return { type: "stop" };
  if (text === "pause") return { type: "pause" };
  if (text === "resume" || text === "continue") return { type: "resume" };
  if (["repeat that", "repeat", "say that again", "can you repeat that", "come again"].includes(text)) {
    return { type: "repeat" };
  }
  if (["speak slower", "talk slower", "slow down", "please speak slower"].includes(text)) return { type: "slower" };
  if (["speak faster", "talk faster", "speed up"].includes(text)) return { type: "faster" };
  if (["that's too long", "thats too long", "give me a shorter answer", "shorter answer", "keep it short", "too long"].includes(text)) {
    return { type: "shorter" };
  }
  if (["switch to chat", "switch to text", "let's type instead", "go to chat"].includes(text)) {
    return { type: "switch_to_chat" };
  }
  if (["end the conversation", "end conversation", "end session", "hang up", "goodbye", "bye"].includes(text)) {
    return { type: "end_conversation" };
  }
  if (["show me the sources", "show sources", "what are the sources", "view sources"].includes(text)) {
    return { type: "show_sources" };
  }
  if (["yes", "yeah", "confirm", "go ahead", "please do", "do it", "yes please"].includes(text)) {
    return { type: "confirm" };
  }
  if (["no", "cancel", "never mind", "nevermind", "don't", "stop that"].includes(text)) {
    return { type: "cancel" };
  }

  for (const lang of LANGUAGE_TRIGGERS) {
    if (lang.phrases.some((p) => text.includes(p))) {
      return { type: "switch_language", languageCode: lang.code };
    }
  }

  return null;
}
