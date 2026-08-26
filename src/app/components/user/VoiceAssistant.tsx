import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { useNavigate, useLocation, useOutletContext } from "react-router-dom";
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
  Package,
  Briefcase,
  GraduationCap,
  ScrollText,
  LifeBuoy,
  Wand2,
  Wifi,
  WifiOff,
  Gauge,
  Bug,
  Pause,
  Play,
  Camera as CameraIcon,
  MonitorUp,
  ImageOff,
} from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import { AppHeader } from "../common/AppHeader";
import { useVoice, type VoiceOptions } from "../../lib/useVoice";
import { useIsMobile } from "../../lib/useIsMobile";
import { VoiceAssistantMobile } from "./VoiceAssistantMobile";
import { CameraCapture, type CapturedImage } from "../tools/CameraCapture";
import { captureScreenFrame } from "../../lib/captureScreenFrame";
import { spokenify, splitSentences, toConciseSpeech } from "../../lib/voiceText";
import { parseVoiceCommand, isBackchannelOnly, type VoiceCommand } from "../../lib/voiceCommands";
import { RealtimeVoiceClient } from "../../lib/voiceRealtime";
import { BRAND } from "../../lib/brand";
import {
  createConversation,
  appendMessage,
  deriveTitle,
  renameConversation,
} from "../../lib/chatStore";
import {
  streamChatWithBackend,
  chatWithBackend,
  generateConversationTitle,
  healthCheck,
  ragCreateSupportTicket,
  type ChatSource,
  type ChatProductCard,
} from "../../../lib/api";
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
  answerSource?: string | null;
  productCards?: ChatProductCard[] | null;
  /** Set when this question carried a captured photo/screen frame — real vision analysis, see pendingImage. */
  attachedImageSource?: "camera" | "screen" | null;
};

type SessionPhase = "idle" | "listening" | "thinking" | "speaking" | "paused" | "error" | "offline";

/**
 * Real backend tool/RAG telemetry — these are the exact `status` values the
 * /chat/stream SSE endpoint emits mid-request (backend/main.py), surfaced
 * here for the first time in Voice Mode. Not synthesized: if the backend
 * doesn't emit a status this turn, nothing is shown beyond "Thinking…".
 */
const TOOL_STATUS_LABELS: Record<string, string> = {
  connected: "Thinking…",
  searching_knowledge: "Searching DayJoy Knowledge…",
  searching_web: "Searching the web…",
  checking_pricing: "Checking pricing…",
  checking_recommendations: "Finding recommendations…",
  checking_wellness_goals: "Checking your wellness goals…",
  analyzing: "Analyzing…",
  verifying: "Verifying the answer…",
};

const TURN_EAGERNESS_LABELS: Record<"eager" | "normal" | "patient", string> = {
  eager: "Eager — responds quickly",
  normal: "Normal — balanced",
  patient: "Patient — waits longer",
};

type PendingConfirmation = {
  type: "create_ticket";
  query: string;
};

const QUICK_ACTIONS: Array<{ label: string; icon: typeof Package; prompt: string }> = [
  { label: "Product Info", icon: Package, prompt: "Tell me about DayJoy's products." },
  { label: "Business Guidance", icon: Briefcase, prompt: "I'd like some business guidance as a DayJoy distributor." },
  { label: "Training Help", icon: GraduationCap, prompt: "What training resources are available for me?" },
  { label: "Policies", icon: ScrollText, prompt: "Can you explain DayJoy's policies I should know about?" },
  { label: "Customer Support", icon: LifeBuoy, prompt: "I need help with a customer support issue." },
  { label: "Product Recommendation", icon: Wand2, prompt: "Can you recommend a DayJoy product for me?" },
];

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
  { code: "as", label: "Assamese", sttCode: "as-IN" },
  { code: "ur", label: "Urdu", sttCode: "ur-IN" },
];

/** Short, human-readable labels for the AI router's answer_source field. */
const ANSWER_SOURCE_LABELS: Record<string, string> = {
  dayjoy_knowledge: "Dayjoy Knowledge",
  web_search: "Web Search",
  hybrid: "Hybrid — Dayjoy + Web",
  general_llm: "General AI knowledge",
  casual: "",
  unsafe: "",
};

const SETTINGS_KEY = "dayjoy.voiceAssistant.settings.v1";

export type PersistedSettings = {
  languageCode: string;
  voiceName: string | null;
  rate: number;
  pitch: number;
  volume: number;
  handsFree: boolean;
  autoSummarize: boolean;
  /** How long to wait in silence before treating speech as a finished turn. */
  turnEagerness: "eager" | "normal" | "patient";
  /** Whether the user can barge in (interrupt) while the AI is speaking. */
  interruptionsEnabled: boolean;
  /** Whether the live transcript/caption text is shown at all. */
  captionsEnabled: boolean;
  /** How many sentences of a spoken answer to say aloud before offering "I can share more" — lowered by the "shorter answer" voice command. */
  maxSpokenSentences: number;
  /** Developer-only latency diagnostics panel in Settings. */
  showDiagnostics: boolean;
  micDeviceId: string | null;
};

function loadSettings(): PersistedSettings {
  const defaults: PersistedSettings = {
    languageCode: "en",
    voiceName: null,
    rate: 1,
    pitch: 1,
    volume: 1,
    // Defaulted true previously: on a brand-new session (nothing saved to
    // localStorage yet) that silently started the mic ~500ms after the
    // page mounted via the hands-free "auto-resume listening" effect below
    // — no tap required, and often failed instantly with "needs an
    // internet connection" if the device couldn't reach the STT service
    // yet. Voice must only ever start from an explicit user action; users
    // who want the ChatGPT-style continuous conversation loop can still
    // opt in via the Hands-free toggle in session settings.
    handsFree: false,
    autoSummarize: true,
    turnEagerness: "normal",
    interruptionsEnabled: true,
    captionsEnabled: true,
    maxSpokenSentences: 4,
    showDiagnostics: false,
    micDeviceId: null,
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

/** Formats a millisecond duration as "Mm Ss" — used for real session duration (Part 44), never a fabricated number. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
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
  const location = useLocation();
  const { currentUser, role } = useAuth();
  const isMobile = useIsMobile();
  // UserLayout hands its mobile drawer opener down through Outlet context —
  // the mobile voice screen is a full-screen overlay with no header of its
  // own, so its "menu" button needs this to open the real app sidebar
  // (all sections) instead of the voice page just closing/backing out.
  const outletCtx = useOutletContext<{ openDrawer: () => void } | undefined>();

  const [settings, setSettings] = useState<PersistedSettings>(() => loadSettings());
  useEffect(() => saveSettings(settings), [settings]);

  const voiceOptions: VoiceOptions = useMemo(
    () => ({
      rate: settings.rate,
      pitch: settings.pitch,
      volume: settings.volume,
      voiceName: settings.voiceName ?? undefined,
      turnEagerness: settings.turnEagerness,
      isBackchannel: isBackchannelOnly,
    }),
    [settings.rate, settings.pitch, settings.volume, settings.voiceName, settings.turnEagerness],
  );
  const voice = useVoice(settings.languageCode, voiceOptions);

  useEffect(() => {
    if (settings.micDeviceId !== voice.selectedInputDeviceId) {
      voice.setInputDeviceId(settings.micDeviceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.micDeviceId]);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [thinking, setThinking] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [paused, setPaused] = useState(false);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [copiedAll, setCopiedAll] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [ended, setEnded] = useState(false);
  const [endedDuration, setEndedDuration] = useState<string | null>(null);
  const [aiServiceOnline, setAiServiceOnline] = useState<boolean | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmation | null>(null);
  const [lastLatency, setLastLatency] = useState<{ sttToRequest: number; firstToken: number; total: number } | null>(
    null,
  );
  // Multimodal voice input (Part 20-22): a captured photo or screen frame
  // waits here until the user's next spoken/typed question, at which point
  // it rides along as `image_data_url` on the same real /chat/stream
  // request UserChat's own camera flow already uses — genuine vision
  // analysis via the existing backend endpoint, not a stub.
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string; source: "camera" | "screen" } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [screenCaptureError, setScreenCaptureError] = useState<string | null>(null);
  const [capturingScreen, setCapturingScreen] = useState(false);

  // Real session metadata (Part 44) — an id + start time that exist for the
  // lifetime of this component instance, not fabricated display strings.
  const sessionIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `voice-${Date.now()}`,
  );
  const sessionStartedAtRef = useRef<number>(Date.now());
  // Ticks once a second, only while the diagnostics panel is actually open,
  // so the "Duration" line is real elapsed time rather than a value frozen
  // at whenever the settings modal happened to be opened.
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (!settingsOpen || !settings.showDiagnostics) return;
    const interval = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [settingsOpen, settings.showDiagnostics]);

  // Real "is the AI service reachable" check — distinct from "does this
  // browser support speech APIs" (voice.supported). Both are shown
  // separately in the header rather than one conflated "Connected" badge,
  // per the rule against showing a false Connected state when a critical
  // service is actually down.
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      void healthCheck().then((ok) => {
        if (!cancelled) setAiServiceOnline(ok);
      });
    };
    check();
    const interval = window.setInterval(check, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  // Realtime voice pipeline availability (Phase 1 of the realtime voice
  // architecture — see backend/voice_api.py). `null` while checking, then a
  // real true/false from the backend's own /voice/capabilities — never
  // assumed available. Wiring the full mic/TTS control flow over to this
  // transport is deliberately NOT done yet: it needs a real DEEPGRAM_API_KEY
  // configured on the backend to test end-to-end (this deployment doesn't
  // have one), so activating it as the primary path before that would ship
  // an untested code path. This probe only surfaces true status in
  // diagnostics for now; the existing browser voice pipeline below remains
  // the one actually driving the mic/TTS experience.
  const [realtimeAvailable, setRealtimeAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void RealtimeVoiceClient.isAvailable().then((ok) => {
      if (!cancelled) setRealtimeAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const conversationIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Bumped on every handleUserUtterance call; a request only applies its
  // results (streaming chunks, final turn, TTS) while this still matches
  // the sequence it was issued with. Without this, a second utterance
  // starting before the first's fetch resolved let both run concurrently
  // — both mutated `turns`/streamingText independently, whichever network
  // response resolved last always "won" regardless of which question was
  // actually asked most recently, and the second call's TTS silently
  // cancelled the first's mid-utterance (speak()/startListening() both
  // unconditionally call speechSynthesis.cancel()) — together these read
  // as "duplicate answer that vanishes" and "answered a different
  // question than I asked."
  const requestSeqRef = useRef(0);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  // Guards the hands-free auto-resume effect below: it must never be the
  // thing that opens the mic for the very first time on this page visit —
  // only a real tap on the mic button (toggleMic) may do that. Without this,
  // an account with `handsFree: true` already saved from a previous session
  // got the mic requested ~500ms after mount with zero user gesture, which
  // browsers often silently deny (no permission prompt shown at all,
  // straight to a "Microphone access was denied" error).
  const hasUserStartedMicRef = useRef(false);
  // Mirrors the latest assistant turn so handleSpeakerTap (defined before
  // `turns` is filtered/derived further down) always reads the current
  // value without needing to be redeclared after every derived variable.
  const lastAssistantTurnRef = useRef<Turn | null>(null);
  useEffect(() => {
    const last = [...turns].reverse().find((t) => t.role === "assistant");
    lastAssistantTurnRef.current = last ?? null;
  }, [turns]);
  const currentLanguageLabel =
    LANGUAGES.find((l) => l.code === settings.languageCode)?.label ?? "English (India)";

  // Personalized, concise greeting (Part 38) — computed once per mount from
  // the real local time, shown as idle-state copy only (never auto-spoken:
  // speaking on cold mount with no user gesture yet is exactly the mobile
  // TTS-unlock problem primeSpeech exists to work around).
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    const timeGreeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const name = currentUser?.user_metadata?.full_name
      ? String(currentUser.user_metadata.full_name).split(" ")[0]
      : null;
    return `${timeGreeting}${name ? `, ${name}` : ""}. Ask about DayJoy products, business guidance, training, or support.`;
  }, [currentUser?.user_metadata?.full_name]);

  // Derive the single visible session state from voice + network activity —
  // one source of truth instead of the UI independently checking multiple
  // booleans (which can otherwise briefly disagree with each other, e.g.
  // "thinking" and "listening" both true for a frame during a barge-in).
  useEffect(() => {
    if (!voice.supported) {
      setPhase("offline");
    } else if (voice.error) {
      setPhase("error");
    } else if (paused) {
      setPhase("paused");
    } else if (thinking) {
      setPhase("thinking");
    } else if (voice.speaking) {
      setPhase("speaking");
    } else if (voice.listening) {
      setPhase("listening");
    } else {
      setPhase("idle");
    }
  }, [voice.supported, voice.error, voice.listening, voice.speaking, thinking, paused]);

  // Barge-in: while the AI is speaking and interruptions are enabled, open a
  // passive listening mic underneath the playback (see useVoice's
  // startBargeInListening) so the user can just start talking, the same as
  // tapping the mic to interrupt. Backchannel words ("okay", "hmm") are
  // filtered out inside useVoice via voiceOptions.isBackchannel and do not
  // stop playback.
  useEffect(() => {
    if (
      settings.interruptionsEnabled &&
      voice.speaking &&
      !voice.listening &&
      voice.sttSupported &&
      hasUserStartedMicRef.current
    ) {
      voice.startBargeInListening();
    }
  }, [settings.interruptionsEnabled, voice.speaking, voice.listening, voice.sttSupported, voice]);

  // `behavior: "smooth"` re-fired on every streamed token (streamingText
  // changes many times a second while the assistant is speaking/writing),
  // so each new call cancelled the previous still-in-flight smooth-scroll
  // animation before it reached the bottom — the transcript visually got
  // stuck part-way up instead of settling on the latest turn. requestAnimationFrame
  // defers the scroll until layout has actually committed, and instant
  // ("auto") scrolling can't be interrupted by the next call the way a
  // smooth animation can.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      transcriptEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    });
    return () => cancelAnimationFrame(raf);
  }, [turns, streamingText]);

  // Conversation continuity, the other direction: hand the SAME
  // conversation id back to the text UI instead of always landing on a
  // blank "New Chat" — /chat/:chatId? (see src/app/App.tsx) opens that
  // exact conversation, whose history the backend already persisted from
  // this voice session's own turns.
  const navigateToChatContinuingConversation = useCallback(() => {
    navigate(conversationIdRef.current ? `/chat/${conversationIdRef.current}` : "/");
  }, [navigate]);

  const ensureConversation = useCallback(async () => {
    if (conversationIdRef.current || !currentUser?.id) return conversationIdRef.current;
    const conv = await createConversation(currentUser.id, "Voice session");
    conversationIdRef.current = conv?.id ?? null;
    return conversationIdRef.current;
  }, [currentUser?.id]);

  const handleUserUtterance = useCallback(
    async (text: string, opts: { sttFinalAt?: number } = {}) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Supersede any still-in-flight previous turn rather than letting
      // both run concurrently — see requestSeqRef's declaration for why.
      abortRef.current?.abort();
      voice.stopSpeaking();
      const mySeq = ++requestSeqRef.current;
      const isStale = () => requestSeqRef.current !== mySeq;

      const convId = await ensureConversation();
      const now = new Date().toISOString();
      // A captured photo/screen frame attaches to exactly the next question
      // and is then consumed — grabbed here (not re-read later) so a second
      // utterance that arrives before this one finishes can't accidentally
      // reuse or race over the same image.
      const imageForThisTurn = pendingImage;
      if (imageForThisTurn) setPendingImage(null);
      const userTurn: Turn = {
        id: `u-${Date.now()}`,
        role: "user",
        content: trimmed,
        timestamp: now,
        language: currentLanguageLabel,
        attachedImageSource: imageForThisTurn?.source ?? null,
      };
      setTurns((prev) => [...prev, userTurn]);
      setThinking(true);
      setStreamingText("");
      setToolStatus(null);

      const controller = new AbortController();
      abortRef.current = controller;

      // Latency tracking (Part 31) — internal-only, surfaced solely via the
      // opt-in "Show diagnostics" toggle in Settings, never to normal users.
      const requestStartAt = performance.now();
      let firstTokenAt: number | null = null;

      // Sentence-chunked progressive speech: as tokens stream in, speak each
      // completed sentence immediately rather than waiting for the whole
      // answer — a real reduction in time-to-first-audio given there's no
      // server-side streaming TTS. Capped at maxSpokenSentences so voice
      // answers stay concise (Part 26); the full text still always reaches
      // the transcript.
      let spokenCount = 0;
      let trailerQueued = false;
      const speakNewSentences = (fullTextSoFar: string, isFinalChunk: boolean) => {
        if (!voice.ttsSupported || voice.muted) return;
        const sentences = splitSentences(fullTextSoFar);
        const endsComplete = isFinalChunk || /[.!?]\s*$/.test(fullTextSoFar.trimEnd());
        const completeCount = endsComplete ? sentences.length : Math.max(0, sentences.length - 1);
        while (spokenCount < completeCount) {
          if (spokenCount >= settings.maxSpokenSentences) {
            if (!trailerQueued) {
              voice.enqueueSpeech("I can share more if you'd like.");
              trailerQueued = true;
            }
            spokenCount = completeCount; // stop scanning further sentences this turn
            break;
          }
          voice.enqueueSpeech(spokenify(sentences[spokenCount]));
          spokenCount += 1;
        }
      };

      let aggregated = "";
      try {
        const res = await streamChatWithBackend(
          {
            message: trimmed,
            role: role ?? "customer",
            language: currentLanguageLabel.split(" ")[0],
            conversation_id: convId ?? undefined,
            image_data_url: imageForThisTurn?.dataUrl,
          },
          (chunk) => {
            if (isStale()) return;
            if (firstTokenAt === null) firstTokenAt = performance.now();
            aggregated += chunk;
            setStreamingText(aggregated);
            speakNewSentences(aggregated, false);
          },
          controller.signal,
          (status) => {
            if (isStale()) return;
            setToolStatus(status);
          },
        );
        if (isStale()) return; // superseded while this request was in flight
        aggregated = res.answer || aggregated;
        setToolStatus(null);

        const assistantTurn: Turn = {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: aggregated,
          timestamp: new Date().toISOString(),
          language: currentLanguageLabel,
          confidence: res.confidence,
          verified: res.verification_status === "verified",
          sources: res.sources,
          answerSource: res.answer_source,
          productCards: res.products,
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
            answer_source: res.answer_source ?? null,
          });
          if (turns.length === 0) {
            // Same pattern as UserChat: show the truncated fallback title
            // instantly, then upgrade to an AI-summarized title if the
            // backend can produce one. Fires once per session (guarded by
            // turns.length === 0); any failure silently keeps the fallback.
            const fallbackTitle = deriveTitle(trimmed);
            void renameConversation(convId, fallbackTitle);
            void generateConversationTitle(trimmed).then((summarized) => {
              if (summarized && summarized !== fallbackTitle) {
                void renameConversation(convId, summarized);
              }
            });
          }
        }

        // Flush whatever's left unspoken now that the full answer is known
        // (the trailing fragment that never got a chance to look "complete"
        // mid-stream, plus anything if streaming produced no chunks at all).
        if (voice.ttsSupported && !voice.muted && aggregated) {
          speakNewSentences(aggregated, true);
        }

        const totalMs = Math.round(performance.now() - requestStartAt);
        setLastLatency({
          sttToRequest: opts.sttFinalAt ? Math.round(requestStartAt - opts.sttFinalAt) : 0,
          firstToken: firstTokenAt !== null ? Math.round(firstTokenAt - requestStartAt) : totalMs,
          total: totalMs,
        });
      } catch (e) {
        // Superseded requests are deliberately aborted (see above) — that
        // throws too, but it's not a real failure, so it must not show an
        // error turn for a question the user has already moved past.
        if (isStale()) return;
        console.warn("[voice-assistant] send failed:", e);
        setToolStatus(null);
        const errorText = "Sorry, I couldn't reach the assistant just now. Please try again.";
        setTurns((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: errorText,
            timestamp: new Date().toISOString(),
            language: currentLanguageLabel,
          },
        ]);
        if (voice.ttsSupported && !voice.muted) voice.speak(errorText);
      } finally {
        // A stale request's finally must not clear `thinking` out from
        // under the newer request that superseded it (which already set
        // thinking=true for itself).
        if (!isStale()) {
          setThinking(false);
          setToolStatus(null);
        }
      }
    },
    [ensureConversation, currentLanguageLabel, role, voice, turns.length, settings.maxSpokenSentences, pendingImage],
  );

  // Hands-free mode: automatically resume listening once the AI stops
  // speaking — but only after the user has explicitly started the mic once
  // via toggleMic. Never on cold mount, even if handsFree was saved as
  // true from a previous session.
  useEffect(() => {
    if (!settings.handsFree || !voice.sttSupported || !hasUserStartedMicRef.current) return;
    if (!voice.speaking && !voice.listening && !thinking && !ended) {
      const t = window.setTimeout(() => voice.startListening(), 500);
      return () => window.clearTimeout(t);
    }
  }, [settings.handsFree, voice.sttSupported, voice.speaking, voice.listening, thinking, ended, voice]);

  const toggleMic = useCallback(() => {
    // First real tap of this session — unlock speechSynthesis inside this
    // click's call stack so the *next* speak() call (fired later from an
    // async network response, which mobile browsers otherwise treat as
    // "not a user gesture" and silently drop) actually produces sound.
    if (!hasUserStartedMicRef.current) {
      voice.primeSpeech();
    }
    hasUserStartedMicRef.current = true;
    if (voice.listening) {
      voice.stopListening();
    } else {
      voice.startListening();
    }
  }, [voice]);

  // Tapping the speaker icon: interrupt if currently speaking, replay the
  // last answer if there is one, otherwise just toggle mute. Previously
  // this button only ever toggled mute — with nothing queued to speak yet,
  // tapping it right after an answer looked exactly like "the speaker
  // button doesn't speak" (the bug reported), because it was never wired
  // to actually produce sound, only to allow/block future sound.
  const handleSpeakerTap = useCallback(() => {
    if (voice.speaking) {
      voice.stopSpeaking();
      return;
    }
    if (!voice.muted && lastAssistantTurnRef.current) {
      voice.speak(lastAssistantTurnRef.current.content);
      return;
    }
    voice.toggleMute();
  }, [voice]);

  // Camera capture (Part 22) — real photo, attached to the next question.
  const handleCameraCapture = useCallback((img: CapturedImage) => {
    setPendingImage({ dataUrl: img.dataUrl, source: "camera" });
    setCameraOpen(false);
  }, []);

  // Screen capture (Part 21) — real single-frame getDisplayMedia grab, see
  // captureScreenFrame.ts for why this is single-frame rather than a
  // continuous share.
  const handleScreenCapture = useCallback(async () => {
    setScreenCaptureError(null);
    setCapturingScreen(true);
    try {
      const result = await captureScreenFrame();
      if (result) setPendingImage({ dataUrl: result.dataUrl, source: "screen" });
    } catch (e) {
      // NotAllowedError fires when the user cancels the share picker —
      // that's a normal choice, not a failure worth surfacing as an error.
      const err = e as DOMException;
      if (err.name !== "NotAllowedError") {
        console.warn("[voice-assistant] screen capture failed:", e);
        setScreenCaptureError(
          err.message?.includes("supported")
            ? err.message
            : "Couldn't capture the screen. Your browser may not support screen sharing.",
        );
      }
    } finally {
      setCapturingScreen(false);
    }
  }, []);

  // The composer's voice-assistant button navigates here with
  // `state: { autoStart: true }` — that click IS the user gesture, so it's
  // safe to open the mic immediately rather than waiting for a second tap.
  // Runs once per navigation (guarded by hasUserStartedMicRef, same as a
  // manual toggleMic tap) and only once STT is confirmed supported.
  useEffect(() => {
    const navState = location.state as { autoStart?: boolean; conversationId?: string | null } | null;
    // Conversation continuity (switching Text -> Voice must not start a
    // fresh, context-less conversation): if UserChat handed off an active
    // conversation id, adopt it instead of ensureConversation() creating a
    // brand-new "Voice session" row. The backend's own history loader
    // (load_history in backend/main.py) then pulls the real prior turns for
    // this id on the very next request, same as it does for text chat.
    if (navState?.conversationId && !conversationIdRef.current) {
      conversationIdRef.current = navState.conversationId;
    }
    if (navState?.autoStart && voice.sttSupported && !hasUserStartedMicRef.current) {
      toggleMic();
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, voice.sttSupported]);

  const endSession = useCallback(async () => {
    voice.stopListening();
    voice.stopSpeaking();
    abortRef.current?.abort();
    setEnded(true);
    setEndedDuration(formatDuration(Date.now() - sessionStartedAtRef.current));

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
    // Full reset — a previous run left `ended` toggling the bottom bar
    // between "New session"/"End session" correctly, but paused,
    // pendingConfirm, toolStatus, and lastLatency all carried over from the
    // old session, so a fresh session could open already "paused" or with a
    // stale confirmation waiting, which looked like "New session did
    // nothing."
    conversationIdRef.current = null;
    abortRef.current?.abort();
    voice.stopSpeaking();
    voice.stopListening();
    setTurns([]);
    setSummary(null);
    setEnded(false);
    setEndedDuration(null);
    setStreamingText("");
    setToolStatus(null);
    setPaused(false);
    setPendingConfirm(null);
    setLastLatency(null);
    setSummarizing(false);
    setPendingImage(null);
    // A "new session" really is a new session — real start time and id, not
    // the old session's clock still running underneath.
    sessionStartedAtRef.current = Date.now();
    sessionIdRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `voice-${Date.now()}`;
  }, [voice]);

  // Executes the pending confirmable action for real (Part 36: Preview →
  // Confirm → Execute) — currently just support-ticket creation, using the
  // same /rag/support-ticket endpoint the text-chat "low confidence" flow
  // already uses. Nothing here is simulated: a "yes" really calls the API
  // and the resulting ticket id comes back from the server.
  const executeConfirmedAction = useCallback(
    async (confirmation: PendingConfirmation) => {
      if (confirmation.type === "create_ticket") {
        try {
          const result = await ragCreateSupportTicket({
            query: confirmation.query,
            conversation_id: conversationIdRef.current ?? undefined,
          });
          const ticketId = (result.ticket?.id as string | number | undefined) ?? null;
          const reply = ticketId
            ? `Done — I've created support ticket #${ticketId}. Our team will follow up.`
            : "Done — I've created the support ticket. Our team will follow up.";
          const turn: Turn = {
            id: `sys-${Date.now()}`,
            role: "assistant",
            content: reply,
            timestamp: new Date().toISOString(),
            language: currentLanguageLabel,
          };
          setTurns((prev) => [...prev, turn]);
          if (voice.ttsSupported && !voice.muted) voice.speak(reply);
        } catch (e) {
          console.warn("[voice-assistant] ticket creation failed:", e);
          const reply = "Sorry, I couldn't create that ticket just now. You can also create one from the Support page.";
          setTurns((prev) => [
            ...prev,
            { id: `sys-${Date.now()}`, role: "assistant", content: reply, timestamp: new Date().toISOString(), language: currentLanguageLabel },
          ]);
          if (voice.ttsSupported && !voice.muted) voice.speak(reply);
        }
      }
    },
    [currentLanguageLabel, voice],
  );

  // Local interaction-command interception (Part 28/57) — a fixed set of
  // conversation controls ("stop", "repeat that", "switch to Hindi"...)
  // handled entirely client-side, before anything reaches the backend. Not
  // every finalized utterance is a question for the LLM.
  const handleVoiceCommand = useCallback(
    (cmd: VoiceCommand): boolean => {
      switch (cmd.type) {
        case "stop":
          voice.stopSpeaking();
          return true;
        case "pause":
          voice.stopSpeaking();
          voice.stopListening();
          setPaused(true);
          return true;
        case "resume":
          setPaused(false);
          voice.startListening();
          return true;
        case "repeat": {
          const last = lastAssistantTurnRef.current;
          if (last && voice.ttsSupported && !voice.muted) {
            voice.speak(toConciseSpeech(last.content, settings.maxSpokenSentences).speech);
          }
          return true;
        }
        case "slower":
          setSettings((s) => ({ ...s, rate: Math.max(0.5, Math.round((s.rate - 0.2) * 10) / 10) }));
          return true;
        case "faster":
          setSettings((s) => ({ ...s, rate: Math.min(2, Math.round((s.rate + 0.2) * 10) / 10) }));
          return true;
        case "shorter":
          setSettings((s) => ({ ...s, maxSpokenSentences: Math.max(1, s.maxSpokenSentences - 1) }));
          return true;
        case "switch_language":
          setSettings((s) => ({ ...s, languageCode: cmd.languageCode, voiceName: null }));
          return true;
        case "switch_to_chat":
          navigateToChatContinuingConversation();
          return true;
        case "end_conversation":
          void endSession();
          return true;
        case "show_sources": {
          const last = lastAssistantTurnRef.current;
          const count = Array.isArray(last?.sources) ? last.sources.length : 0;
          const reply =
            count > 0
              ? `That answer used ${count} DayJoy source${count === 1 ? "" : "s"} — you can see them in the transcript.`
              : "That answer didn't cite any specific DayJoy sources.";
          if (voice.ttsSupported && !voice.muted) voice.speak(reply);
          return true;
        }
        case "confirm":
          if (pendingConfirm) {
            const confirmation = pendingConfirm;
            setPendingConfirm(null);
            void executeConfirmedAction(confirmation);
            return true;
          }
          return false; // not a command in this context — let it fall through to the LLM
        case "cancel":
          if (pendingConfirm) {
            setPendingConfirm(null);
            const reply = "Okay, I won't do that.";
            setTurns((prev) => [
              ...prev,
              { id: `sys-${Date.now()}`, role: "assistant", content: reply, timestamp: new Date().toISOString(), language: currentLanguageLabel },
            ]);
            if (voice.ttsSupported && !voice.muted) voice.speak(reply);
            return true;
          }
          return false;
        default:
          return false;
      }
    },
    [voice, settings.maxSpokenSentences, navigateToChatContinuingConversation, endSession, pendingConfirm, executeConfirmedAction, currentLanguageLabel],
  );

  // Finalized speech recognition result -> either a local command or a real
  // turn sent to the backend.
  useEffect(() => {
    if (voice.transcript) {
      const text = voice.transcript;
      const sttFinalAt = performance.now();
      voice.clearTranscript();
      const command = parseVoiceCommand(text);
      if (command && handleVoiceCommand(command)) return;
      void handleUserUtterance(text, { sttFinalAt });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.transcript]);

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
    idle: toolStatus === null && turns.length === 0 ? greeting : "Tap the mic or press Space, and speak naturally.",
    listening: "Listening… speak naturally, interrupt any time.",
    thinking: toolStatus ? TOOL_STATUS_LABELS[toolStatus] ?? "Thinking…" : "Thinking…",
    speaking: "Speaking — just start talking to interrupt.",
    paused: "Paused. Say \"resume\" or tap the mic to continue.",
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
  const lastUserTurn = [...turns].reverse().find((t) => t.role === "user");
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
      // Preview -> Confirm -> Execute (Part 36) — asks first, and only
      // actually calls /rag/support-ticket once the user confirms (by
      // voice: "yes"/"confirm", or a second tap here).
      onClick: () => {
        if (pendingConfirm?.type === "create_ticket") {
          setPendingConfirm(null);
          void executeConfirmedAction(pendingConfirm);
          return;
        }
        const query = lastUserTurn?.content ?? "Voice session support request";
        setPendingConfirm({ type: "create_ticket", query });
        const reply = `I can create a support ticket for: "${query}". Should I go ahead?`;
        setTurns((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, role: "assistant", content: reply, timestamp: new Date().toISOString(), language: currentLanguageLabel },
        ]);
        if (voice.ttsSupported && !voice.muted) voice.speak(reply);
      },
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
  }, [
    lastAssistantTurn,
    lastUserTurn,
    endSession,
    summary,
    transcriptPlainText,
    pendingConfirm,
    executeConfirmedAction,
    currentLanguageLabel,
    voice,
  ]);

  if (isMobile) {
    return (
      <>
        <VoiceAssistantMobile
          phase={phase}
          orbState={orbState}
          phaseCopy={phaseCopy[phase]}
          voice={voice}
          toggleMic={toggleMic}
          onSpeakerTap={handleSpeakerTap}
          endSession={() => void endSession()}
          startNewSession={startNewSession}
          ended={ended}
          onClose={() => navigate("/")}
          onSwitchToChat={navigateToChatContinuingConversation}
          onOpenDrawer={outletCtx?.openDrawer}
          settings={settings}
          setSettings={setSettings}
          languages={LANGUAGES}
          langVoices={langVoices}
          selectedVoiceLabel={selectedVoiceLabel}
          currentLanguageLabel={currentLanguageLabel}
          turns={turns}
          streamingText={streamingText}
          thinking={thinking}
          toolStatusLabel={toolStatus ? TOOL_STATUS_LABELS[toolStatus] ?? null : null}
          aiServiceOnline={aiServiceOnline}
          paused={paused}
          onTogglePause={() => {
            if (paused) {
              setPaused(false);
              voice.startListening();
            } else {
              voice.stopSpeaking();
              voice.stopListening();
              setPaused(true);
            }
          }}
          pendingImage={pendingImage}
          onClearPendingImage={() => setPendingImage(null)}
          onOpenCamera={() => setCameraOpen(true)}
          onScreenCapture={() => void handleScreenCapture()}
          capturingScreen={capturingScreen}
        />
        <CameraCapture
          open={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onCapture={handleCameraCapture}
          title="Show DayJoy AI a photo"
          facingMode="environment"
        />
      </>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Session header — shared AppHeader (title/subtitle + notifications,
          theme, and profile avatar) instead of a bespoke one, so this page
          isn't the only one in the app missing a way to reach the profile
          menu without going back to the sidebar drawer. */}
      <AppHeader
        title="Voice Assistant"
        subtitle="Low-latency speech · English, Hindi, Marathi"
        icon={Mic}
        actions={
          <div className="hidden sm:flex items-center gap-2">
            {/* Two independent statuses, shown honestly rather than one
                conflated "Connected" — a browser can support voice while
                the AI backend is down, or vice versa on an old browser. */}
            <Badge variant={voice.supported && !voice.error ? "success" : "warning"}>
              <span
                className={`w-1.5 h-1.5 rounded-full ${voice.supported && !voice.error ? "bg-success" : "bg-warning"}`}
                aria-hidden="true"
              />
              {voice.supported && !voice.error ? "Voice ready" : "Voice unavailable"}
            </Badge>
            <Badge variant={aiServiceOnline === false ? "destructive" : aiServiceOnline === null ? "outline" : "success"}>
              {aiServiceOnline === false ? (
                <WifiOff className="w-3 h-3" aria-hidden="true" />
              ) : (
                <Wifi className="w-3 h-3" aria-hidden="true" />
              )}
              {aiServiceOnline === false ? "AI service offline" : aiServiceOnline === null ? "Checking…" : "AI service online"}
            </Badge>
            <Badge variant="outline">{currentLanguageLabel}</Badge>
          </div>
        }
      />

      {/* overflow-y-auto (not overflow-hidden) below `lg`: the two columns
          stack into one on mobile and together exceed viewport height —
          overflow-hidden was clipping the transcript/summary instead of
          letting the page scroll to it. Desktop keeps overflow-hidden since
          each column manages its own internal scroll instead. */}
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
                  // Matches AIOrb's actual 200px size below — a mismatched
                  // fallback (previously 160px) caused a visible layout
                  // jump the instant the lazy three.js orb finished loading.
                  <div className="w-[200px] h-[200px] rounded-full bg-primary/10 animate-pulse-glow flex items-center justify-center">
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
              {toolStatus ? TOOL_STATUS_LABELS[toolStatus] ?? phaseCopy[phase] : phaseCopy[phase]}
            </p>

            {pendingConfirm ? (
              <p className="mt-2 text-xs text-primary text-center max-w-sm">
                Say "yes" to confirm, or "no" to cancel.
              </p>
            ) : null}
          </div>

          {/* Quick actions — real starter prompts, shown before the first
              exchange. Each seeds a genuine question sent to the same
              /chat/stream backend as speaking would, not inserted text. */}
          {turns.length === 0 && !thinking ? (
            <div className="flex flex-wrap items-center justify-center gap-2 mt-6 max-w-lg">
              {QUICK_ACTIONS.map((qa) => (
                <button
                  key={qa.label}
                  type="button"
                  onClick={() => void handleUserUtterance(qa.prompt)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-accent/30 text-xs font-medium hover:bg-accent/60 transition-colors"
                >
                  <qa.icon className="w-3.5 h-3.5" aria-hidden="true" />
                  {qa.label}
                </button>
              ))}
            </div>
          ) : null}

          {/* Pending image — a captured photo/screen frame waiting to ride
              along with the next question. Real thumbnail of what was
              actually captured, not a placeholder. */}
          {pendingImage ? (
            <div className="flex items-center gap-2 mt-4 px-3 py-2 rounded-xl border border-border bg-accent/30">
              <img
                src={pendingImage.dataUrl}
                alt={pendingImage.source === "camera" ? "Captured photo" : "Captured screen"}
                className="w-10 h-10 rounded-lg object-cover border border-border"
              />
              <span className="text-xs text-muted-foreground">
                {pendingImage.source === "camera" ? "Photo" : "Screen"} attached — ask your question and I'll look at it.
              </span>
              <button
                type="button"
                onClick={() => setPendingImage(null)}
                aria-label="Remove attached image"
                className="p-1 rounded-md hover:bg-accent/60"
              >
                <ImageOff className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
              </button>
            </div>
          ) : null}

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
            <Button variant="outline" size="sm" onClick={() => setCameraOpen(true)} title="Show me a photo">
              <CameraIcon className="w-4 h-4" aria-hidden="true" />
              Camera
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleScreenCapture()}
              disabled={capturingScreen}
              title="Share your screen"
            >
              <MonitorUp className="w-4 h-4" aria-hidden="true" />
              {capturingScreen ? "Capturing…" : "Screen"}
            </Button>
            <Button variant="secondary" size="sm" onClick={navigateToChatContinuingConversation}>
              <MessageSquare className="w-4 h-4" aria-hidden="true" />
              Switch to chat
            </Button>
          </div>
        </div>

        {/* Right: live transcript */}
        <div className="flex flex-col rounded-3xl border border-border bg-card overflow-hidden min-h-[320px]">
          <div className="shrink-0 flex items-center justify-between px-4 py-3.5 border-b border-border">
            <h2 className="text-sm font-semibold">Live transcript</h2>
            <Badge variant="secondary">Auto-saved</Badge>
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
                  {t.role === "assistant" && t.answerSource && ANSWER_SOURCE_LABELS[t.answerSource] ? (
                    <span className="text-[10px] text-muted-foreground">
                      · {ANSWER_SOURCE_LABELS[t.answerSource]}
                    </span>
                  ) : null}
                  {t.role === "assistant" && t.confidence !== undefined ? (
                    <Badge variant={t.verified ? "success" : "warning"} className="ml-auto">
                      {t.verified ? "Verified" : "Needs verification"}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-sm leading-relaxed">{t.content}</p>
                {/* Multimodal + Voice Convergence (Next-Gen spec, Phase 12) —
                    structured product data (verified DB rows only, same
                    source as UserChat's ProductCard — never AI-generated
                    text) was captured but never shown here before. Compact
                    variant rather than reusing UserChat's ProductCard
                    directly since that's a private, unexported function in
                    a large unrelated file. */}
                {t.role === "assistant" && t.productCards && t.productCards.length > 0 ? (
                  <div className="space-y-1.5 mt-1.5">
                    {t.productCards.slice(0, 3).map((p, i) => (
                      <div
                        key={p.product_id ?? i}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border bg-accent/30 px-2.5 py-1.5 text-xs"
                      >
                        <span className="font-medium truncate">{p.product_name ?? "Dayjoy product"}</span>
                        {p.price ? (
                          <span className="text-muted-foreground shrink-0">
                            {p.price.currency ?? "INR"} {p.price.dp ?? p.price.mrp}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {/* Multimodal + Voice Convergence (Next-Gen spec, Phase 12) —
                    citations captured on every voice turn (see `sources` in
                    Turn's type above) were never rendered here before, even
                    though the exact same evidence is shown for a text-chat
                    answer. A spoken answer is only as trustworthy as its
                    text counterpart if the same evidence is visible. */}
                {t.role === "assistant" && Array.isArray(t.sources) && t.sources.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {t.sources.slice(0, 4).map((s, i) => {
                      const label = typeof s === "string" ? s : s.title || s.table;
                      return (
                        <span
                          key={typeof s === "string" ? `${t.id}-${i}` : s.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border bg-accent/40 text-[10px] text-muted-foreground"
                        >
                          <FileTextIcon className="w-2.5 h-2.5" aria-hidden="true" />
                          {label}
                        </span>
                      );
                    })}
                  </div>
                ) : null}
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

          {ended && endedDuration ? (
            <div className="shrink-0 border-t border-border px-4 py-2 text-[11px] text-muted-foreground flex items-center justify-between">
              <span>Session duration: {endedDuration}</span>
              <span>{turns.length} turn{turns.length === 1 ? "" : "s"}</span>
            </div>
          ) : null}

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
          onClick={handleSpeakerTap}
          aria-label={voice.speaking ? "Stop speaking" : voice.muted ? "Unmute voice" : "Replay last answer"}
          aria-pressed={voice.muted}
          title={voice.speaking ? "Stop speaking" : voice.muted ? "Unmute" : "Replay last answer"}
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
          variant={paused ? "default" : "outline"}
          size="icon"
          className="h-11 w-11 rounded-full"
          onClick={() => {
            if (paused) {
              setPaused(false);
              voice.startListening();
            } else {
              voice.stopSpeaking();
              voice.stopListening();
              setPaused(true);
            }
          }}
          aria-label={paused ? "Resume" : "Pause"}
          aria-pressed={paused}
          title={paused ? "Resume" : "Pause"}
        >
          {paused ? <Play className="w-5 h-5" aria-hidden="true" /> : <Pause className="w-5 h-5" aria-hidden="true" />}
        </Button>
        {/* Desktop only — Space/Esc/Tab shortcuts don't apply on a touch
            keyboard, so this button was dead weight on mobile. */}
        <Button
          variant="outline"
          size="icon"
          className="hidden sm:inline-flex h-11 w-11 rounded-full"
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

          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5" aria-hidden="true" />
              Turn-taking
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["eager", "normal", "patient"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSettings((s) => ({ ...s, turnEagerness: mode }))}
                  aria-pressed={settings.turnEagerness === mode}
                  className={`py-2 rounded-lg text-xs font-medium capitalize border transition-colors ${
                    settings.turnEagerness === mode
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:bg-accent/40"
                  }`}
                  title={TURN_EAGERNESS_LABELS[mode]}
                >
                  {mode}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              How long to wait in silence before treating your speech as finished.
            </p>
          </div>

          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm font-medium">Interruptions</p>
              <p className="text-xs text-muted-foreground">Let you talk over the AI to interrupt it (barge-in)</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.interruptionsEnabled}
              onClick={() => setSettings((s) => ({ ...s, interruptionsEnabled: !s.interruptionsEnabled }))}
              className={`relative w-10 h-6 rounded-full transition-colors ${settings.interruptionsEnabled ? "bg-primary" : "bg-muted"}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${settings.interruptionsEnabled ? "translate-x-4" : ""}`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm font-medium">Captions</p>
              <p className="text-xs text-muted-foreground">Show live transcript text (mobile caption bubble)</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.captionsEnabled}
              onClick={() => setSettings((s) => ({ ...s, captionsEnabled: !s.captionsEnabled }))}
              className={`relative w-10 h-6 rounded-full transition-colors ${settings.captionsEnabled ? "bg-primary" : "bg-muted"}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${settings.captionsEnabled ? "translate-x-4" : ""}`}
              />
            </button>
          </div>

          {voice.inputDevices.length > 0 ? (
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Microphone</label>
              <select
                value={settings.micDeviceId ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, micDeviceId: e.target.value || null }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">System default</option>
                {voice.inputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${d.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

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

          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-1.5">
              <Bug className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">Show diagnostics</p>
                <p className="text-xs text-muted-foreground">Developer-only latency numbers for the last answer</p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.showDiagnostics}
              onClick={() => setSettings((s) => ({ ...s, showDiagnostics: !s.showDiagnostics }))}
              className={`relative w-10 h-6 rounded-full transition-colors ${settings.showDiagnostics ? "bg-primary" : "bg-muted"}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${settings.showDiagnostics ? "translate-x-4" : ""}`}
              />
            </button>
          </div>

          {settings.showDiagnostics ? (
            <div className="rounded-lg border border-border bg-accent/20 px-3 py-2.5 font-mono text-[11px] text-muted-foreground space-y-1">
              <p>Session: {sessionIdRef.current}</p>
              <p>Started: {new Date(sessionStartedAtRef.current).toLocaleTimeString()}</p>
              <p>Duration: {formatDuration(nowTick - sessionStartedAtRef.current)}</p>
              <p>Turns: {turns.length}</p>
              <p>AI service: {aiServiceOnline === null ? "checking…" : aiServiceOnline ? "online" : "offline"}</p>
              <p>
                Realtime voice:{" "}
                {realtimeAvailable === null
                  ? "checking…"
                  : realtimeAvailable
                    ? "provider configured (not yet wired as primary path)"
                    : "not configured — using browser voice pipeline"}
              </p>
              {lastLatency ? (
                <>
                  <p>STT final → request sent: {lastLatency.sttToRequest}ms</p>
                  <p>Request → first token: {lastLatency.firstToken}ms</p>
                  <p>Total turn latency: {lastLatency.total}ms</p>
                </>
              ) : (
                <p>No completed turn yet this session.</p>
              )}
            </div>
          ) : null}

          <div className="rounded-lg border border-dashed border-border px-3 py-2.5">
            <p className="text-xs text-muted-foreground">
              <Badge variant="warning" className="mr-1.5">Coming soon</Badge>
              Noise suppression, echo cancellation, wake-word (“Hey Dayjoy”), and TTS output-device
              selection require a dedicated speech provider and browser APIs that don't exist yet —
              {" "}{BRAND.name} currently uses your browser's built-in speech engine, which always plays
              through the system's current default audio output.
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
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            role="alert"
            // Anchored just under the header, not over the bottom control
            // bar — "bottom-20" used to land it directly on top of the
            // "Switch to chat" button/controls row on short mobile
            // viewports, and its dismiss button was wired to close the
            // settings modal instead of the error itself, so it had no way
            // to go away on its own.
            className="fixed top-16 left-1/2 -translate-x-1/2 max-w-[calc(100vw-2rem)] bg-destructive text-destructive-foreground text-xs px-3 py-2 rounded-lg shadow-overlay flex items-center gap-2 z-50"
          >
            <span className="min-w-0">{voice.error}</span>
            <button type="button" onClick={voice.clearError} aria-label="Dismiss" className="shrink-0">
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {screenCaptureError ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            role="alert"
            className="fixed top-16 left-1/2 -translate-x-1/2 max-w-[calc(100vw-2rem)] bg-destructive text-destructive-foreground text-xs px-3 py-2 rounded-lg shadow-overlay flex items-center gap-2 z-50"
          >
            <span className="min-w-0">{screenCaptureError}</span>
            <button type="button" onClick={() => setScreenCaptureError(null)} aria-label="Dismiss" className="shrink-0">
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCameraCapture}
        title="Show DayJoy AI a photo"
        facingMode="environment"
      />
    </div>
  );
}

export default VoiceAssistant;
