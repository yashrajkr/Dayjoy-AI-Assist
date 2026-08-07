import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  Square,
  Volume2,
  VolumeX,
  PhoneOff,
  MessageSquare,
  Languages,
  Settings2,
  Search,
  Copy,
  Download,
  Check,
  Keyboard,
  X,
  Sparkles,
  ShieldCheck,
  ArrowRight,
  Ticket,
  Mail,
  FileText as FileTextIcon,
} from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import { useVoice, type VoiceOptions } from "../../lib/useVoice";
import { BRAND } from "../../lib/brand";
import {
  createConversation,
  appendMessage,
  deriveTitle,
  renameConversation,
} from "../../lib/chatStore";
import { streamChatWithBackend, chatWithBackend, type ChatSource } from "../../../lib/api";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Modal } from "../common/Modal";

const AIOrb = lazy(() =>
  import("../three/AIOrb").then((m) => ({ default: m.AIOrb })),
);

type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  language: string;
  confidence?: number;
  verified?: boolean;
  sources?: ChatSource[] | string[];
};

type SessionPhase = "idle" | "listening" | "thinking" | "speaking" | "error" | "offline";

const LANGUAGES: Array<{ code: string; label: string; sttCode: string }> = [
  { code: "en", label: "English (India)", sttCode: "en-US" },
  { code: "hi", label: "Hindi", sttCode: "hi-IN" },
  { code: "mr", label: "Marathi", sttCode: "mr-IN" },
  { code: "bn", label: "Bengali", sttCode: "bn-IN" },
  { code: "ta", label: "Tamil", sttCode: "ta-IN" },
  { code: "te", label: "Telugu", sttCode: "te-IN" },
  { code: "gu", label: "Gujarati", sttCode: "gu-IN" },
  { code: "pa", label: "Punjabi", sttCode: "pa-IN" },
  { code: "kn", label: "Kannada", sttCode: "kn-IN" },
  { code: "ml", label: "Malayalam", sttCode: "ml-IN" },
  { code: "or", label: "Odia", sttCode: "or-IN" },
  { code: "ur", label: "Urdu", sttCode: "ur-IN" },
];

const SETTINGS_KEY = "dayjoy.voiceAssistant.settings.v1";

type PersistedSettings = {
  languageCode: string;
  voiceName: string | null;
  rate: number;
  pitch: number;
  volume: number;
  handsFree: boolean;
  autoSummarize: boolean;
};

function loadSettings(): PersistedSettings {
  const defaults: PersistedSettings = {
    languageCode: "en",
    voiceName: null,
    rate: 1,
    pitch: 1,
    volume: 1,
    handsFree: true,
    autoSummarize: true,
  };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Partial<PersistedSettings>) };
  } catch {
    return defaults;
  }
}

function saveSettings(s: PersistedSettings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable (private mode) — settings just won't persist
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/**
 * VoiceAssistant — flagship voice-first interface for Dayjoy AI Assist.
 *
 * Real speech in/out via the browser Web Speech API (useVoice), real
 * streamed answers from the existing /chat/stream backend, and real
 * conversation persistence via chatStore — the same primitives UserChat
 * already uses. No provider abstraction (Groq/ElevenLabs/etc.) exists in
 * the backend yet, so TTS voice quality is whatever the OS/browser ships;
 * swapping in a higher-fidelity provider is a backend task (see roadmap).
 */
export function VoiceAssistant() {
  const navigate = useNavigate();
  const { currentUser, role } = useAuth();

  const [settings, setSettings] = useState<PersistedSettings>(() => loadSettings());
  useEffect(() => saveSettings(settings), [settings]);

  const voiceOptions: VoiceOptions = useMemo(
    () => ({
      rate: settings.rate,
      pitch: settings.pitch,
      volume: settings.volume,
      voiceName: settings.voiceName ?? undefined,
    }),
    [settings.rate, settings.pitch, settings.volume, settings.voiceName],
  );
  const voice = useVoice(settings.languageCode, voiceOptions);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [thinking, setThinking] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [copiedAll, setCopiedAll] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [ended, setEnded] = useState(false);

  const conversationIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const currentLanguageLabel =
    LANGUAGES.find((l) => l.code === settings.languageCode)?.label ?? "English (India)";

  // Derive the visible orb/session state from voice + network activity.
  useEffect(() => {
    if (!voice.supported) {
      setPhase("offline");
    } else if (voice.error) {
      setPhase("error");
    } else if (thinking) {
      setPhase("thinking");
    } else if (voice.speaking) {
      setPhase("speaking");
    } else if (voice.listening) {
      setPhase("listening");
    } else {
      setPhase("idle");
    }
  }, [voice.supported, voice.error, voice.listening, voice.speaking, thinking]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, streamingText]);

  const ensureConversation = useCallback(async () => {
    if (conversationIdRef.current || !currentUser?.id) return conversationIdRef.current;
    const conv = await createConversation(currentUser.id, "Voice session");
    conversationIdRef.current = conv?.id ?? null;
    return conversationIdRef.current;
  }, [currentUser?.id]);

  const handleUserUtterance = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const convId = await ensureConversation();
      const now = new Date().toISOString();
      const userTurn: Turn = {
        id: `u-${Date.now()}`,
        role: "user",
        content: trimmed,
        timestamp: now,
        language: currentLanguageLabel,
      };
      setTurns((prev) => [...prev, userTurn]);
      setThinking(true);
      setStreamingText("");

      const controller = new AbortController();
      abortRef.current = controller;

      let aggregated = "";
      try {
        const res = await streamChatWithBackend(
          {
            message: trimmed,
            role: role ?? "customer",
            language: currentLanguageLabel.split(" ")[0],
            conversation_id: convId ?? undefined,
          },
          (chunk) => {
            aggregated += chunk;
            setStreamingText(aggregated);
          },
          controller.signal,
        );
        aggregated = res.answer || aggregated;

        const assistantTurn: Turn = {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: aggregated,
          timestamp: new Date().toISOString(),
          language: currentLanguageLabel,
          confidence: res.confidence,
          verified: res.verification_status === "verified",
          sources: res.sources,
        };
        setTurns((prev) => [...prev, assistantTurn]);
        setStreamingText("");

        if (convId) {
          void appendMessage(convId, { role: "user", content: trimmed });
          void appendMessage(convId, {
            role: "assistant",
            content: aggregated,
            sources: res.sources as unknown,
            safety_status: res.safety_status,
            handoff_required: res.handoff_required,
            confidence: res.confidence ?? null,
            verification_status: res.verification_status ?? null,
            handoff_message: res.handoff_message ?? null,
            rag_metadata: res.rag_metadata ?? null,
          });
          if (turns.length === 0) {
            void renameConversation(convId, deriveTitle(trimmed));
          }
        }

        if (voice.ttsSupported && !voice.muted && aggregated) {
          voice.speak(aggregated);
        }
      } catch (e) {
        console.warn("[voice-assistant] send failed:", e);
        setTurns((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: "Sorry, I couldn't reach the assistant just now. Please try again.",
            timestamp: new Date().toISOString(),
            language: currentLanguageLabel,
          },
        ]);
      } finally {
        setThinking(false);
      }
    },
    [ensureConversation, currentLanguageLabel, role, voice, turns.length],
  );

  // Finalized speech recognition result -> send as a turn.
  useEffect(() => {
    if (voice.transcript) {
      const text = voice.transcript;
      voice.clearTranscript();
      void handleUserUtterance(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.transcript]);

  // Hands-free mode: automatically resume listening once the AI stops speaking.
  useEffect(() => {
    if (!settings.handsFree || !voice.sttSupported) return;
    if (!voice.speaking && !voice.listening && !thinking && !ended) {
      const t = window.setTimeout(() => voice.startListening(), 500);
      return () => window.clearTimeout(t);
    }
  }, [settings.handsFree, voice.sttSupported, voice.speaking, voice.listening, thinking, ended, voice]);

  const toggleMic = useCallback(() => {
    if (voice.listening) {
      voice.stopListening();
    } else {
      voice.startListening();
    }
  }, [voice]);

  const endSession = useCallback(async () => {
    voice.stopListening();
    voice.stopSpeaking();
    abortRef.current?.abort();
    setEnded(true);

    if (settings.autoSummarize && turns.length > 0) {
      setSummarizing(true);
      try {
        const transcriptText = turns
          .map((t) => `${t.role === "user" ? "Customer" : "Assistant"}: ${t.content}`)
          .join("\n");
        const res = await chatWithBackend({
          message: `Summarize this voice support call in 3-4 sentences, then list any action items as bullet points. Call transcript:\n\n${transcriptText}`,
          role: role ?? "customer",
          language: "English",
        });
        setSummary(res.answer);
      } catch (e) {
        console.warn("[voice-assistant] summary failed:", e);
      } finally {
        setSummarizing(false);
      }
    }
  }, [voice, settings.autoSummarize, turns, role]);

  const startNewSession = useCallback(() => {
    conversationIdRef.current = null;
    setTurns([]);
    setSummary(null);
    setEnded(false);
    setStreamingText("");
  }, []);

  // Keyboard shortcuts: Space toggles mic, Esc ends session.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = target && ["INPUT", "TEXTAREA"].includes(target.tagName);
      if (isTyping || settingsOpen || shortcutsOpen) return;
      if (e.code === "Space") {
        e.preventDefault();
        toggleMic();
      } else if (e.code === "Escape") {
        if (!ended) void endSession();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMic, endSession, ended, settingsOpen, shortcutsOpen]);

  const filteredTurns = useMemo(() => {
    if (!transcriptSearch.trim()) return turns;
    const q = transcriptSearch.toLowerCase();
    return turns.filter((t) => t.content.toLowerCase().includes(q));
  }, [turns, transcriptSearch]);

  const transcriptPlainText = useMemo(
    () =>
      turns
        .map((t) => `[${formatTime(t.timestamp)}] ${t.role === "user" ? "You" : "Dayjoy Assist"}: ${t.content}`)
        .join("\n\n"),
    [turns],
  );

  const copyTranscript = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(transcriptPlainText);
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 1800);
    } catch {
      // clipboard permission denied — silently ignore
    }
  }, [transcriptPlainText]);

  const downloadTranscript = useCallback(() => {
    const blob = new Blob([transcriptPlainText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dayjoy-voice-transcript-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [transcriptPlainText]);

  const langVoices = useMemo(() => {
    const sttCode = LANGUAGES.find((l) => l.code === settings.languageCode)?.sttCode ?? "en-US";
    const prefix = sttCode.split("-")[0];
    const matches = voice.voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
    return matches.length > 0 ? matches : voice.voices;
  }, [voice.voices, settings.languageCode]);

  const selectedVoiceLabel = settings.voiceName ?? langVoices[0]?.name ?? "System default";

  const phaseCopy: Record<SessionPhase, string> = {
    idle: "Tap the mic or press Space, and speak naturally.",
    listening: "Listening… speak naturally, interrupt any time.",
    thinking: "Thinking…",
    speaking: "Speaking — tap the mic to interrupt.",
    error: voice.error ?? "Something went wrong.",
    offline: "Voice isn't supported in this browser. Try Chrome or Edge, or switch to chat.",
  };

  const orbState =
    phase === "thinking"
      ? "thinking"
      : phase === "speaking"
        ? "answering"
        : phase === "listening"
          ? "listening"
          : phase === "error"
            ? "error"
            : phase === "offline"
              ? "blocked"
              : "idle";

  const lastAssistantTurn = [...turns].reverse().find((t) => t.role === "assistant");
  const smartSuggestions = useMemo(() => {
    const actions: Array<{ label: string; icon: typeof Ticket; onClick: () => void }> = [];
    if (lastAssistantTurn) {
      actions.push({
        label: "Copy answer",
        icon: Copy,
        onClick: () => void navigator.clipboard.writeText(lastAssistantTurn.content),
      });
    }
    actions.push({
      label: "Summarize call",
      icon: FileTextIcon,
      onClick: () => void endSession(),
    });
    actions.push({
      label: "Create support ticket",
      icon: Ticket,
      onClick: () => navigate("/support"),
    });
    actions.push({
      label: "Email me this",
      icon: Mail,
      onClick: () => {
        const subject = encodeURIComponent("Dayjoy AI Assist — voice session summary");
        const body = encodeURIComponent(summary ?? transcriptPlainText);
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
      },
    });
    return actions;
  }, [lastAssistantTurn, endSession, navigate, summary, transcriptPlainText]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Session header */}
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-border">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Voice Assistant</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Low-latency speech · English, Hindi, Marathi
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={voice.supported && !voice.error ? "success" : "warning"}>
            <span
              className={`w-1.5 h-1.5 rounded-full ${voice.supported && !voice.error ? "bg-success" : "bg-warning"}`}
              aria-hidden="true"
            />
            {voice.supported && !voice.error ? "Connected" : "Offline"}
          </Badge>
          <Badge variant="outline">{currentLanguageLabel}</Badge>
        </div>
      </header>

      {/* On narrow screens the two panels stack instead of sitting
          side-by-side, and their combined height exceeds the viewport —
          `overflow-hidden` here clipped the transcript panel instead of
          letting the page scroll to it. Desktop keeps overflow-hidden since
          the fixed two-column layout already fits. */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 sm:gap-6 p-4 sm:p-6 overflow-y-auto lg:overflow-hidden">
        {/* Center: voice interaction */}
        <div className="flex flex-col items-center justify-center rounded-3xl border border-border bg-card p-6 sm:p-10 relative overflow-hidden min-h-[420px]">
          <div
            className="absolute inset-0 pointer-events-none opacity-70"
            aria-hidden="true"
            style={{
              background:
                "radial-gradient(circle at 50% 35%, rgba(var(--primary-rgb), 0.10) 0%, rgba(var(--gold-accent-rgb), 0.08) 45%, transparent 75%)",
            }}
          />

          <div className="relative flex flex-col items-center">
            <button
              type="button"
              onClick={toggleMic}
              disabled={!voice.sttSupported}
              aria-label={voice.listening ? "Stop listening" : "Start voice input"}
              aria-pressed={voice.listening}
              className="relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Suspense
                fallback={
                  <div className="w-40 h-40 rounded-full bg-primary/10 animate-pulse-glow flex items-center justify-center">
                    <Sparkles className="w-8 h-8 text-primary" aria-hidden="true" />
                  </div>
                }
              >
                <AIOrb state={orbState} size={200} />
              </Suspense>
              <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                {voice.listening ? (
                  <Square className="w-7 h-7 text-primary-foreground drop-shadow" aria-hidden="true" />
                ) : (
                  <Mic className="w-7 h-7 text-primary-foreground drop-shadow" aria-hidden="true" />
                )}
              </span>
            </button>

            {/* Waveform */}
            <div className="flex items-end gap-1 h-10 mt-6" aria-hidden="true">
              {Array.from({ length: 20 }).map((_, i) => {
                const active = voice.listening || voice.speaking;
                const base = 6 + (i % 5) * 3;
                return (
                  <motion.span
                    key={i}
                    className={`w-1 rounded-full ${active ? "bg-primary" : "bg-border"}`}
                    animate={
                      active
                        ? { height: [base, base + voice.amplitude * 28 + 10, base] }
                        : { height: base * 0.6 }
                    }
                    transition={{
                      duration: 0.5 + (i % 4) * 0.1,
                      repeat: active ? Infinity : 0,
                      delay: i * 0.03,
                      ease: "easeInOut",
                    }}
                  />
                );
              })}
            </div>

            <p className="mt-4 text-sm sm:text-base text-muted-foreground text-center max-w-sm" aria-live="polite">
              {phaseCopy[phase]}
            </p>
          </div>

          {/* Inline controls row */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-8">
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} title="Language">
              <Languages className="w-4 h-4" aria-hidden="true" />
              {currentLanguageLabel}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} title="Voice settings">
              <Volume2 className="w-4 h-4" aria-hidden="true" />
              Voice: {selectedVoiceLabel.split(" ")[0]}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => navigate("/")}>
              <MessageSquare className="w-4 h-4" aria-hidden="true" />
              Switch to chat
            </Button>
          </div>
        </div>

        {/* Right: live transcript */}
        <div className="flex flex-col rounded-3xl border border-border bg-card overflow-hidden min-h-[320px]">
          <div className="shrink-0 flex items-center justify-between px-4 py-3.5 border-b border-border">
            <h2 className="text-sm font-semibold">Live transcript</h2>
            {/* variant="secondary" (muted bg + muted text) was near-invisible
                against the card background — this status is worth surfacing
                clearly since it's the only indicator that the session is
                being persisted. */}
            <Badge variant="success">
              <Check className="w-3 h-3" aria-hidden="true" />
              Auto-saved
            </Badge>
          </div>

          <div className="shrink-0 px-4 py-2 border-b border-border flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={transcriptSearch}
                onChange={(e) => setTranscriptSearch(e.target.value)}
                placeholder="Search transcript"
                aria-label="Search transcript"
                className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg border border-border bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={copyTranscript}
              disabled={turns.length === 0}
              aria-label="Copy transcript"
              title="Copy transcript"
            >
              {copiedAll ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={downloadTranscript}
              disabled={turns.length === 0}
              aria-label="Download transcript"
              title="Download transcript"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4" aria-live="polite">
            {filteredTurns.length === 0 && !streamingText ? (
              <p className="text-xs text-muted-foreground text-center py-8">
                Your conversation will appear here as you speak.
              </p>
            ) : null}
            {filteredTurns.map((t) => (
              <div key={t.id}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t.role === "user" ? "You" : "Dayjoy Assist"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{formatTime(t.timestamp)}</span>
                  {t.role === "assistant" && t.confidence !== undefined ? (
                    <Badge variant={t.verified ? "success" : "warning"} className="ml-auto">
                      {t.verified ? "Verified" : "Needs verification"}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-sm leading-relaxed">{t.content}</p>
              </div>
            ))}
            {streamingText ? (
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Dayjoy Assist
                  </span>
                  <span className="text-[10px] text-muted-foreground">typing…</span>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{streamingText}</p>
              </div>
            ) : null}
            <div ref={transcriptEndRef} />
          </div>

          {summary ? (
            <div className="shrink-0 border-t border-border px-4 py-3 bg-accent/30">
              <h3 className="text-xs font-semibold mb-1 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                Call summary
              </h3>
              <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed max-h-32 overflow-y-auto">
                {summary}
              </p>
            </div>
          ) : summarizing ? (
            <div className="shrink-0 border-t border-border px-4 py-3 text-xs text-muted-foreground">
              Generating summary…
            </div>
          ) : null}

          {/* Smart suggestions */}
          {turns.length > 0 ? (
            <div className="shrink-0 border-t border-border px-4 py-3 flex flex-wrap gap-1.5">
              {smartSuggestions.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={s.onClick}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-border text-[11px] font-medium hover:bg-accent/50 transition-colors"
                >
                  <s.icon className="w-3 h-3" aria-hidden="true" />
                  {s.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="shrink-0 border-t border-border px-4 py-3">
              <p className="text-[11px] text-muted-foreground bg-accent/30 rounded-lg px-2.5 py-2">
                Tip: say "Dayjoy, summarise this call" to generate a ticket note.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom floating control bar */}
      <div className="shrink-0 flex items-center justify-center gap-2 px-4 py-3 border-t border-border bg-card/80 backdrop-blur-sm">
        <Button
          variant={voice.listening ? "destructive" : "default"}
          size="icon"
          className="h-11 w-11 rounded-full"
          onClick={toggleMic}
          disabled={!voice.sttSupported || ended}
          aria-label={voice.listening ? "Stop listening" : "Start voice input"}
          aria-pressed={voice.listening}
          title="Toggle microphone (Space)"
        >
          {voice.listening ? <Square className="w-5 h-5" aria-hidden="true" /> : <Mic className="w-5 h-5" aria-hidden="true" />}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 rounded-full"
          onClick={voice.toggleMute}
          aria-label={voice.muted ? "Unmute voice" : "Mute voice"}
          aria-pressed={voice.muted}
          title={voice.muted ? "Unmute" : "Mute"}
        >
          {voice.muted ? <VolumeX className="w-5 h-5" aria-hidden="true" /> : <Volume2 className="w-5 h-5" aria-hidden="true" />}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 rounded-full"
          onClick={() => setSettingsOpen(true)}
          aria-label="Voice settings"
          title="Settings"
        >
          <Settings2 className="w-5 h-5" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 rounded-full"
          onClick={() => setShortcutsOpen(true)}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
        >
          <Keyboard className="w-5 h-5" aria-hidden="true" />
        </Button>
        {ended ? (
          <Button variant="default" size="sm" onClick={startNewSession} className="rounded-full">
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
            New session
          </Button>
        ) : (
          <Button
            variant="destructive"
            size="icon"
            className="h-11 w-11 rounded-full"
            onClick={() => void endSession()}
            aria-label="End session"
            title="End session (Esc)"
          >
            <PhoneOff className="w-5 h-5" aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* Settings modal */}
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Voice settings"
        description="Changes apply immediately to this session."
        size="md"
      >
        <div className="space-y-5">
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Language</label>
            <select
              value={settings.languageCode}
              onChange={(e) => setSettings((s) => ({ ...s, languageCode: e.target.value, voiceName: null }))}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">System voice</label>
            <select
              value={settings.voiceName ?? ""}
              onChange={(e) => setSettings((s) => ({ ...s, voiceName: e.target.value || null }))}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">System default</option>
              {langVoices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                Speed {settings.rate.toFixed(1)}x
              </label>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={settings.rate}
                onChange={(e) => setSettings((s) => ({ ...s, rate: Number(e.target.value) }))}
                className="w-full accent-[var(--primary)]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                Pitch {settings.pitch.toFixed(1)}
              </label>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={settings.pitch}
                onChange={(e) => setSettings((s) => ({ ...s, pitch: Number(e.target.value) }))}
                className="w-full accent-[var(--primary)]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                Volume {Math.round(settings.volume * 100)}%
              </label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.volume}
                onChange={(e) => setSettings((s) => ({ ...s, volume: Number(e.target.value) }))}
                className="w-full accent-[var(--primary)]"
              />
            </div>
          </div>

          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm font-medium">Hands-free mode</p>
              <p className="text-xs text-muted-foreground">Auto-listen again after each reply</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.handsFree}
              onClick={() => setSettings((s) => ({ ...s, handsFree: !s.handsFree }))}
              className={`relative w-10 h-6 rounded-full transition-colors ${settings.handsFree ? "bg-primary" : "bg-muted"}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${settings.handsFree ? "translate-x-4" : ""}`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm font-medium">Auto-summarize on end</p>
              <p className="text-xs text-muted-foreground">Generate a call summary when you end a session</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoSummarize}
              onClick={() => setSettings((s) => ({ ...s, autoSummarize: !s.autoSummarize }))}
              className={`relative w-10 h-6 rounded-full transition-colors ${settings.autoSummarize ? "bg-primary" : "bg-muted"}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${settings.autoSummarize ? "translate-x-4" : ""}`}
              />
            </button>
          </div>

          <div className="rounded-lg border border-dashed border-border px-3 py-2.5">
            <p className="text-xs text-muted-foreground">
              <Badge variant="warning" className="mr-1.5">Coming soon</Badge>
              Noise suppression, echo cancellation and wake-word (“Hey Dayjoy”) require a dedicated
              speech provider (e.g. Deepgram/Groq) on the backend — {BRAND.name} currently uses your
              browser's built-in speech engine.
            </p>
          </div>
        </div>
      </Modal>

      {/* Keyboard shortcuts modal */}
      <Modal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title="Keyboard shortcuts" size="sm">
        <ul className="space-y-2 text-sm">
          <li className="flex items-center justify-between">
            <span className="text-muted-foreground">Toggle microphone</span>
            <kbd className="px-2 py-0.5 rounded border border-border bg-muted text-xs">Space</kbd>
          </li>
          <li className="flex items-center justify-between">
            <span className="text-muted-foreground">End session</span>
            <kbd className="px-2 py-0.5 rounded border border-border bg-muted text-xs">Esc</kbd>
          </li>
          <li className="flex items-center justify-between">
            <span className="text-muted-foreground">Navigate controls</span>
            <kbd className="px-2 py-0.5 rounded border border-border bg-muted text-xs">Tab</kbd>
          </li>
        </ul>
      </Modal>

      <AnimatePresence>
        {voice.error ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            role="alert"
            className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-destructive text-destructive-foreground text-xs px-3 py-2 rounded-lg shadow-overlay flex items-center gap-2 z-50"
          >
            {voice.error}
            <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Dismiss">
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default VoiceAssistant;
