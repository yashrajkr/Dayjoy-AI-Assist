/**
 * voiceText — turns raw LLM/markdown text into speech-friendly output.
 *
 * The backend's /chat/stream answers are written for reading (markdown
 * lists, bold, links, citation-style source mentions) — spoken verbatim
 * they sound like "asterisk asterisk" and raw URLs (explicitly called out
 * as a mistake to avoid). This module is the single place that converts
 * written text into something natural to hear, and — separately — trims a
 * full answer down to a voice-appropriate length while preserving the
 * complete text for the transcript.
 */

/** Splits into sentences on ., !, ? followed by whitespace/EOF — good enough for TTS pacing without a full NLP sentence splitter. */
export function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const matches = trimmed.match(/[^.!?\n]+[.!?]+(?=\s|$)|[^.!?\n]+$/g);
  return (matches ?? [trimmed]).map((s) => s.trim()).filter(Boolean);
}

/**
 * Converts markdown/structured text into natural spoken phrasing.
 * Deliberately conservative — better to leave something slightly literal
 * than to mangle meaning.
 */
export function spokenify(text: string): string {
  let out = text;

  // Fenced code blocks and inline code — never speak literal syntax.
  out = out.replace(/```[\s\S]*?```/g, " a code snippet ");
  out = out.replace(/`([^`]+)`/g, "$1");

  // Markdown links [label](url) -> just the label; bare URLs -> dropped
  // entirely rather than spelled out character by character.
  out = out.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1");
  out = out.replace(/https?:\/\/\S+/g, "");

  // Numbered lists: "1. Product A" -> "First, Product A." ordinal prefixes
  // read far more naturally aloud than a bare digit + period.
  const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];
  const lines = out.split("\n");
  let ordinalIdx = 0;
  out = lines
    .map((line) => {
      const m = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
      if (m) {
        const label = ORDINALS[ordinalIdx] ?? `Number ${m[1]}`;
        ordinalIdx += 1;
        return `${label}, ${m[2]}`;
      }
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      if (bullet) return bullet[1];
      return line;
    })
    .join(". ");

  // Bold/italic/heading/strikethrough markers
  out = out.replace(/[#*_~`]/g, "");

  // Collapse whitespace/newlines produced by the above into speech pauses.
  out = out.replace(/\n+/g, ". ").replace(/\s{2,}/g, " ").replace(/\.\s*\./g, ".").trim();

  return out;
}

/**
 * Trims a full answer down to a voice-appropriate length: the first
 * `maxSentences` sentences, with a natural "ask for more" offer appended
 * only when content was actually cut. The full, untrimmed text still goes
 * to the transcript — this only affects what gets spoken.
 */
export function toConciseSpeech(text: string, maxSentences = 3): { speech: string; trimmed: boolean } {
  const clean = spokenify(text);
  const sentences = splitSentences(clean);
  if (sentences.length <= maxSentences) {
    return { speech: clean, trimmed: false };
  }
  const head = sentences.slice(0, maxSentences).join(" ");
  return { speech: `${head} I can share more if you'd like.`, trimmed: true };
}
