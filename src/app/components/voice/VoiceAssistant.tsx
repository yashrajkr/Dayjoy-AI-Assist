import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Mic, Square, Volume2, VolumeX, MessageSquare, Languages, Trash2 } from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import { useVoice } from "../../lib/useVoice";
import { streamChatWithBackend } from "../../../lib/api";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card } from "../common/AdminUI";

type Turn = { role: "user" | "assistant"; text: string; at: string };
type Lang = "English" | "Hindi";

/**
 * Voice Assistant — full-page hands-free conversation surface.
 *
 * Distinct from VoiceControls (the small mic/speak toggles inside the chat
 * composer): this is a dedicated screen for speaking naturally, watching a
 * live transcript build, and hearing answers read back. It reuses the same
 * useVoice hook and the same streaming chat backend as UserChat, so answers
 * come from identical approved-knowledge RAG — no separate pipeline.
 */
export function VoiceAssistant() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [language, setLanguage] = useState<Lang>("English");
  const voice = useVoice(language === "Hindi" ? "hi" : "en");

  const [turns, setTurns] = useState<Turn[]>([]);
  const [thinking, setThinking] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);

  // Auto-scroll transcript as turns arrive
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [turns, thinking]);

  const ask = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || sendingRef.current) return;
      sendingRef.current = true;
      setThinking(true);
      setTurns((prev) => [...prev, { role: "user", text: question, at: new Date().toISOString() }]);

      let aggregated = "";
      try {
        // Voice reads the completed answer aloud rather than rendering tokens,
        // so streaming chunks are collected but not surfaced incrementally.
        const res = await streamChatWithBackend(
          { message: question, role: role ?? "customer", language },
          () => {},
        );
        aggregated = res.answer || "Sorry, I couldn't find an answer for that.";
      } catch (e) {
        aggregated = e instanceof Error ? `Error: ${e.message}` : "Something went wrong. Please try again.";
      } finally {
        setTurns((prev) => [...prev, { role: "assistant", text: aggregated, at: new Date().toISOString() }]);
        setThinking(false);
        sendingRef.current = false;
        if (voice.supported && !voice.muted) voice.speak(aggregated);
      }
    },
    [language, role, voice],
  );

  // When the recognizer produces a final transcript, send it and clear.
  useEffect(() => {
    if (voice.transcript) {
      const text = voice.transcript;
      voice.clearTranscript();
      void ask(text);
    }
  }, [voice.transcript, voice, ask]);

  const state: "idle" | "listening" | "thinking" | "speaking" = voice.listening
    ? "listening"
    : thinking
      ? "thinking"
      : voice.speaking
        ? "speaking"
        : "idle";

  const statusText = {
    idle: "Tap the microphone and speak naturally.",
    listening: "Listening… speak naturally, pause when you're done.",
    thinking: "Searching approved Dayjoy knowledge…",
    speaking: "Speaking the answer aloud.",
  }[state];

  if (!voice.supported) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4 sm:p-8">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl sm:text-3xl font-semibold mb-1">Voice Assistant</h1>
          <Card className="mt-6 text-center py-10">
            <MicOffIcon />
            <p className="text-sm font-medium mt-3">Voice isn't supported in this browser</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              Speech recognition needs Chrome, Edge, or Safari. You can still ask everything by typing in AI Chat.
            </p>
            <Button className="mt-4" onClick={() => navigate("/")}>
              <MessageSquare className="w-4 h-4" aria-hidden="true" /> Switch to chat
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold mb-1">Voice Assistant</h1>
          <p className="text-sm text-muted-foreground">
            Low-latency speech · {language === "Hindi" ? "हिन्दी" : "English"} · answers grounded in approved Dayjoy knowledge
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Mic orb panel */}
          <Card className="flex flex-col items-center justify-center py-10 px-6">
            <div className="relative flex items-center justify-center mb-6" style={{ width: 200, height: 200 }}>
              {/* Breathing rings — animate only while listening/speaking */}
              {(state === "listening" || state === "speaking") &&
                [0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="absolute rounded-full bg-primary/15"
                    style={{ width: 200, height: 200 }}
                    animate={{ scale: [0.7, 1, 0.7], opacity: [0.5, 0.15, 0.5] }}
                    transition={{ duration: 3.2, repeat: Infinity, delay: i * 0.7, ease: "easeInOut" }}
                    aria-hidden="true"
                  />
                ))}
              <button
                type="button"
                onClick={voice.listening ? voice.stopListening : voice.startListening}
                disabled={thinking}
                className={`relative z-10 w-28 h-28 rounded-full flex items-center justify-center transition-all shadow-overlay disabled:opacity-60 ${
                  voice.listening
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-primary text-primary-foreground hover:scale-105 active:scale-95"
                }`}
                aria-label={voice.listening ? "Stop listening" : "Start voice input"}
                aria-pressed={voice.listening}
              >
                {voice.listening ? (
                  <Square className="w-9 h-9" aria-hidden="true" />
                ) : (
                  <Mic className="w-9 h-9" aria-hidden="true" />
                )}
              </button>
            </div>

            {/* Waveform */}
            <div className="flex items-end justify-center gap-1 h-10 mb-4" aria-hidden="true">
              {Array.from({ length: 20 }).map((_, i) => (
                <motion.span
                  key={i}
                  className="w-1 rounded-full bg-primary"
                  animate={
                    state === "listening" || state === "speaking"
                      ? { height: [6, 8 + ((i * 7) % 26), 6] }
                      : { height: 4 }
                  }
                  transition={{
                    duration: 0.8,
                    repeat: state === "listening" || state === "speaking" ? Infinity : 0,
                    delay: i * 0.04,
                    ease: "easeInOut",
                  }}
                />
              ))}
            </div>

            <p className="text-sm text-muted-foreground text-center min-h-5" aria-live="polite">
              {statusText}
            </p>
            {voice.interimTranscript ? (
              <p className="text-sm mt-2 text-center italic text-foreground/80">"{voice.interimTranscript}"</p>
            ) : null}
            {voice.error ? (
              <p role="alert" className="text-xs text-destructive mt-2 text-center max-w-xs">
                {voice.error}
              </p>
            ) : null}

            {/* Controls */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setLanguage((l) => (l === "English" ? "Hindi" : "English"))}
                className="rounded-full"
              >
                <Languages className="w-4 h-4" aria-hidden="true" />
                {language === "Hindi" ? "हिन्दी" : "English (India)"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={voice.toggleMute}
                className="rounded-full"
                aria-pressed={voice.muted}
              >
                {voice.muted ? (
                  <VolumeX className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Volume2 className="w-4 h-4" aria-hidden="true" />
                )}
                {voice.muted ? "Muted" : "Voice on"}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => navigate("/")} className="rounded-full">
                <MessageSquare className="w-4 h-4" aria-hidden="true" /> Switch to chat
              </Button>
            </div>
          </Card>

          {/* Live transcript panel */}
          <Card className="flex flex-col min-h-[420px]">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-semibold">Live transcript</h2>
              <div className="flex items-center gap-2">
                {turns.length > 0 ? (
                  <>
                    <Badge variant="success">Auto-saved</Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-auto w-auto p-1.5 text-muted-foreground"
                      onClick={() => setTurns([])}
                      aria-label="Clear transcript"
                      title="Clear transcript"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                  </>
                ) : null}
              </div>
            </div>

            <div ref={transcriptRef} className="flex-1 overflow-y-auto scrollbar-thin space-y-4 pr-1">
              {turns.length === 0 && !thinking ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-10">
                  <p className="text-sm font-medium">No conversation yet</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                    Ask something like "What is the return policy?" or "Which products support daily immunity?"
                  </p>
                </div>
              ) : (
                turns.map((t, i) => (
                  <div key={`${t.at}-${i}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      {t.role === "user" ? "You" : "Dayjoy Assist"}
                    </p>
                    <p className={t.role === "assistant" ? "ai-prose text-sm" : "text-sm"}>{t.text}</p>
                  </div>
                ))
              )}
              {thinking ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    Dayjoy Assist
                  </p>
                  <div className="flex items-center gap-1">
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-primary"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t border-border">
              Tip: pause after speaking so the assistant knows you've finished. Answers cite approved Dayjoy knowledge —
              verify medical or compliance claims before sharing externally.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MicOffIcon() {
  return (
    <div className="inline-flex w-12 h-12 rounded-2xl bg-accent text-muted-foreground items-center justify-center">
      <VolumeX className="w-5 h-5" aria-hidden="true" />
    </div>
  );
}
