import { motion } from "framer-motion";
import { Mic, Volume2, VolumeX, Square } from "lucide-react";
import { useEffect } from "react";
import type { VoiceState } from "../../lib/useVoice";
import { Button } from "../ui/button";

/**
 * VoiceControls — chat composer voice toolbar.
 *
 * Renders 3 buttons:
 *   1. Microphone toggle (STT) — starts/stops speech recognition
 *   2. Speak toggle (TTS) — reads the last assistant message aloud
 *   3. Mute toggle — silences TTS
 *
 * When listening, an animated waveform appears next to the mic button.
 * When speaking, the speak button pulses.
 *
 * If the browser doesn't support the Web Speech API, all buttons are
 * hidden and a tooltip explains why.
 */
export function VoiceControls({
  voice,
  onTranscript,
  className = "",
}: {
  voice: VoiceState;
  onTranscript: (text: string) => void;
  className?: string;
}) {
  // When recognition produces a final transcript, push it to the composer
  // and immediately clear it — otherwise it lingers in hook state and can
  // leak back into the input box (and get re-sent) on a later render.
  useEffect(() => {
    if (voice.transcript) {
      onTranscript(voice.transcript);
      voice.clearTranscript();
    }
  }, [voice.transcript, voice.clearTranscript, onTranscript]);

  if (!voice.supported) {
    // Hide entirely when unsupported — no broken buttons.
    return null;
  }

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {/* Waveform — shown only while listening */}
      {voice.listening ? (
        <div className="flex items-center gap-0.5 mr-1" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <motion.span
              key={i}
              className="w-0.5 h-4 rounded-full bg-primary"
              animate={{ scaleY: [0.3, 1, 0.3] }}
              transition={{
                duration: 0.6,
                repeat: Infinity,
                delay: i * 0.08,
                ease: "easeInOut",
              }}
              style={{ transformOrigin: "center" }}
            />
          ))}
        </div>
      ) : null}

      {/* Microphone toggle */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={voice.listening ? voice.stopListening : voice.startListening}
        className={`h-auto w-auto p-2 rounded-lg ${
          voice.listening
            ? "bg-destructive/15 text-destructive hover:bg-destructive/20"
            : "text-muted-foreground"
        }`}
        aria-label={voice.listening ? "Stop listening" : "Start voice input"}
        aria-pressed={voice.listening}
        title={voice.listening ? "Stop listening" : "Voice input"}
      >
        {voice.listening ? (
          <Square className="w-4 h-4" aria-hidden="true" />
        ) : (
          <Mic className="w-4 h-4" aria-hidden="true" />
        )}
      </Button>

      {/* Speak toggle */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={voice.speaking ? voice.stopSpeaking : undefined}
        className={`h-auto w-auto p-2 rounded-lg ${
          voice.speaking
            ? "bg-primary/15 text-primary animate-pulse hover:bg-primary/20"
            : "text-muted-foreground"
        }`}
        aria-label={voice.speaking ? "Stop speaking" : "Speaking"}
        aria-pressed={voice.speaking}
        title={voice.speaking ? "Stop speaking" : "Speaking"}
        disabled={!voice.speaking}
      >
        <Volume2 className="w-4 h-4" aria-hidden="true" />
      </Button>

      {/* Mute toggle */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={voice.toggleMute}
        className={`h-auto w-auto p-2 rounded-lg ${
          voice.muted
            ? "bg-warning/15 text-warning hover:bg-warning/20"
            : "text-muted-foreground"
        }`}
        aria-label={voice.muted ? "Unmute voice" : "Mute voice"}
        aria-pressed={voice.muted}
        title={voice.muted ? "Unmute" : "Mute"}
      >
        {voice.muted ? (
          <VolumeX className="w-4 h-4" aria-hidden="true" />
        ) : (
          <Volume2 className="w-4 h-4" aria-hidden="true" />
        )}
      </Button>

      {voice.error ? (
        <span role="alert" className="text-[11px] text-destructive ml-1 max-w-[220px] truncate" title={voice.error}>
          {voice.error}
        </span>
      ) : null}
    </div>
  );
}
