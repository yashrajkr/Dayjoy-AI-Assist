import { Suspense, lazy, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  Square,
  Volume2,
  VolumeX,
  PhoneOff,
  Settings2,
  ChevronLeft,
  ChevronRight,
  Plus,
  Check,
  Sparkles,
  X,
} from "lucide-react";
import type { VoiceState } from "../../lib/useVoice";
import type { AIOrbState } from "../three/AIOrb";

const AIOrb = lazy(() => import("../three/AIOrb").then((m) => ({ default: m.AIOrb })));

type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

type PersistedSettings = {
  languageCode: string;
  voiceName: string | null;
  rate: number;
  pitch: number;
  volume: number;
  handsFree: boolean;
  autoSummarize: boolean;
};

type LanguageOption = { code: string; label: string; sttCode: string };

/**
 * VoiceAssistantMobile — full-screen, ChatGPT-Voice-style mobile layout.
 *
 * Rendered instead of the desktop split-pane layout below the `lg`
 * breakpoint (see `useIsMobile` gate in VoiceAssistant.tsx). Design intent
 * (from the user's own ChatGPT-app reference screenshots): the orb is the
 * whole screen when idle — no live-transcript sidebar competing for space —
 * with only the most recent exchange surfaced as a transient bubble, and a
 * bottom-sheet for language/voice settings instead of a centered dialog
 * (centered dialogs read as "desktop UI stretched onto a phone").
 */
export function VoiceAssistantMobile({
  phase,
  orbState,
  phaseCopy,
  voice,
  toggleMic,
  onSpeakerTap,
  endSession,
  startNewSession,
  ended,
  onClose,
  onSwitchToChat,
  settings,
  setSettings,
  languages,
  langVoices,
  selectedVoiceLabel,
  currentLanguageLabel,
  turns,
  streamingText,
  thinking,
}: {
  phase: string;
  orbState: AIOrbState;
  phaseCopy: string;
  voice: VoiceState;
  toggleMic: () => void;
  onSpeakerTap: () => void;
  endSession: () => void;
  startNewSession: () => void;
  ended: boolean;
  onClose: () => void;
  onSwitchToChat: () => void;
  settings: PersistedSettings;
  setSettings: (updater: (s: PersistedSettings) => PersistedSettings) => void;
  languages: LanguageOption[];
  langVoices: SpeechSynthesisVoice[];
  selectedVoiceLabel: string;
  currentLanguageLabel: string;
  turns: Turn[];
  streamingText: string;
  thinking: boolean;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);

  const lastUserTurn = useMemo(() => [...turns].reverse().find((t) => t.role === "user"), [turns]);
  const lastAssistantTurn = useMemo(
    () => [...turns].reverse().find((t) => t.role === "assistant"),
    [turns],
  );
  // Only the most recent exchange is shown — older turns scroll out of view
  // entirely rather than accumulating, matching the reference screenshots
  // where the previous line disappears the moment a new one starts.
  const visibleExchangeKey = streamingText ? "streaming" : lastAssistantTurn?.id ?? lastUserTurn?.id ?? "none";
  const hasActivity = turns.length > 0 || voice.listening || voice.speaking || thinking || !!streamingText;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0B0908] text-white">
      {/* Ambient background glow — brand-colored, not a flat black void */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(circle at 50% 28%, rgba(221,107,61,0.16) 0%, rgba(79,111,70,0.08) 45%, transparent 72%)",
        }}
      />

      {/* Top bar */}
      <div className="relative shrink-0 flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close voice assistant"
          className="w-10 h-10 rounded-full flex items-center justify-center bg-white/8 active:bg-white/15 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" aria-hidden="true" />
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold">Dayjoy Voice</p>
          <p className="text-[11px] text-white/50">{currentLanguageLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="Voice settings"
          className="w-10 h-10 rounded-full flex items-center justify-center bg-white/8 active:bg-white/15 transition-colors"
        >
          <Settings2 className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {/* Orb stage */}
      <div className="relative flex-1 min-h-0 flex flex-col items-center justify-center px-6">
        <PersonalizedOrb orbState={orbState} phase={phase} />

        <p className="mt-7 text-sm text-white/60 text-center max-w-[280px]" aria-live="polite">
          {phaseCopy}
        </p>

        {/* Transient exchange bubble — only the latest turn, never a
            growing list. Absolutely positioned within the stage so it
            doesn't push the orb around as its content changes length. */}
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-3 flex flex-col items-center pointer-events-none">
          <AnimatePresence mode="wait">
            {hasActivity ? (
              <motion.div
                key={visibleExchangeKey}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.25 }}
                className="pointer-events-auto w-full max-w-sm rounded-2xl bg-white/8 backdrop-blur-md border border-white/10 px-4 py-3 max-h-40 overflow-y-auto"
              >
                {lastUserTurn ? (
                  <p className="text-[11px] font-medium text-white/45 mb-1 truncate">
                    You: {lastUserTurn.content}
                  </p>
                ) : null}
                <p className="text-sm leading-relaxed text-white/90">
                  {streamingText || lastAssistantTurn?.content || (thinking ? "…" : "")}
                </p>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* Bottom control bar */}
      <div className="relative shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {hasActivity ? (
          <div className="flex items-center justify-center gap-4">
            <ControlIcon
              onClick={toggleMic}
              disabled={!voice.sttSupported || ended}
              active={voice.listening}
              label={voice.listening ? "Stop listening" : "Start voice input"}
            >
              {voice.listening ? <Square className="w-5 h-5" aria-hidden="true" /> : <Mic className="w-5 h-5" aria-hidden="true" />}
            </ControlIcon>
            <ControlIcon
              onClick={onSpeakerTap}
              active={voice.speaking}
              muted={voice.muted}
              label={voice.speaking ? "Stop speaking" : voice.muted ? "Unmute" : "Replay last answer"}
            >
              {voice.muted ? <VolumeX className="w-5 h-5" aria-hidden="true" /> : <Volume2 className="w-5 h-5" aria-hidden="true" />}
            </ControlIcon>
            <ControlIcon onClick={() => setSheetOpen(true)} label="Voice settings">
              <Settings2 className="w-5 h-5" aria-hidden="true" />
            </ControlIcon>
            {ended ? (
              <button
                type="button"
                onClick={startNewSession}
                className="h-14 px-5 rounded-full bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-1.5 active:scale-95 transition-transform"
              >
                New session <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={endSession}
                aria-label="End session"
                className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center active:scale-95 transition-transform shadow-lg shadow-red-500/30"
              >
                <PhoneOff className="w-6 h-6 text-white" aria-hidden="true" />
              </button>
            )}
          </div>
        ) : (
          // Idle compose bar — mirrors the ChatGPT reference: a pill to
          // switch to typed chat, a muted-mic affordance, and a close
          // button, before the user has spoken at all this session.
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSwitchToChat}
              className="flex-1 h-12 rounded-full bg-white/8 border border-white/10 flex items-center gap-2 px-4 text-sm text-white/60 active:bg-white/12 transition-colors"
            >
              <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
              Ask Dayjoy
            </button>
            <ControlIcon onClick={toggleMic} disabled={!voice.sttSupported} label="Start voice input">
              <Mic className="w-5 h-5" aria-hidden="true" />
            </ControlIcon>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close voice assistant"
              className="w-12 h-12 rounded-full bg-white flex items-center justify-center active:scale-95 transition-transform"
            >
              <X className="w-5 h-5 text-black" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {voice.error ? (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 max-w-[calc(100vw-2rem)] bg-red-500/95 text-white text-xs px-3 py-2 rounded-lg shadow-lg flex items-center gap-2 z-10">
          <span className="min-w-0">{voice.error}</span>
          <button type="button" onClick={voice.clearError} aria-label="Dismiss" className="shrink-0">
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {/* Settings bottom sheet */}
      <AnimatePresence>
        {sheetOpen ? (
          <>
            <motion.div
              className="fixed inset-0 z-[60] bg-black/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setSheetOpen(false);
                setLanguagePickerOpen(false);
              }}
            />
            <motion.div
              className="fixed left-0 right-0 bottom-0 z-[61] rounded-t-3xl bg-[#1A1512] text-white pb-[max(1.25rem,env(safe-area-inset-bottom))] max-h-[85vh] overflow-y-auto"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 34 }}
            >
              <div className="flex items-center justify-center pt-2.5 pb-1">
                <div className="w-9 h-1 rounded-full bg-white/20" />
              </div>

              {languagePickerOpen ? (
                <div className="px-5 pt-2 pb-4">
                  <div className="flex items-center gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setLanguagePickerOpen(false)}
                      aria-label="Back"
                      className="w-8 h-8 rounded-full flex items-center justify-center bg-white/8"
                    >
                      <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <h3 className="text-base font-semibold">Language</h3>
                  </div>
                  <div className="space-y-1">
                    {languages.map((l) => (
                      <button
                        key={l.code}
                        type="button"
                        onClick={() => {
                          setSettings((s) => ({ ...s, languageCode: l.code, voiceName: null }));
                          setLanguagePickerOpen(false);
                        }}
                        className="w-full flex items-center justify-between px-3 py-3 rounded-xl active:bg-white/8 transition-colors"
                      >
                        <span className="text-sm">{l.label}</span>
                        {settings.languageCode === l.code ? (
                          <Check className="w-4 h-4 text-primary" aria-hidden="true" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="px-5 pb-4">
                  <div className="flex flex-col items-center mb-4">
                    <div className="w-16 h-16 rounded-full overflow-hidden mb-2">
                      <Suspense
                        fallback={<div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center"><Sparkles className="w-5 h-5 text-primary" /></div>}
                      >
                        <AIOrb state="idle" size={64} mobile />
                      </Suspense>
                    </div>
                    <h2 className="text-lg font-semibold">Dayjoy Assist</h2>
                    <p className="text-xs text-white/50">Warm and helpful</p>
                  </div>

                  <SettingsRow
                    label="Language"
                    value={currentLanguageLabel}
                    onClick={() => setLanguagePickerOpen(true)}
                  />
                  <SettingsRow
                    label="Voice output"
                    value={selectedVoiceLabel}
                    onClick={() => {
                      // Cycle through available voices for this language —
                      // a full picker is overkill on mobile for a list
                      // that's often just 1-2 system voices per language.
                      if (langVoices.length === 0) return;
                      const idx = langVoices.findIndex((v) => v.name === settings.voiceName);
                      const next = langVoices[(idx + 1) % langVoices.length];
                      setSettings((s) => ({ ...s, voiceName: next.name }));
                    }}
                  />

                  <div className="mt-4 space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-medium text-white/60">Speed</label>
                        <span className="text-xs text-white/40">{settings.rate.toFixed(1)}x</span>
                      </div>
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

                    <div className="flex items-center justify-between py-1">
                      <div>
                        <p className="text-sm font-medium">Hands-free mode</p>
                        <p className="text-[11px] text-white/45">Auto-listen again after each reply</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={settings.handsFree}
                        onClick={() => setSettings((s) => ({ ...s, handsFree: !s.handsFree }))}
                        className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${settings.handsFree ? "bg-primary" : "bg-white/15"}`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${settings.handsFree ? "translate-x-4" : ""}`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function SettingsRow({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl bg-white/6 border border-white/8 mb-2 active:bg-white/10 transition-colors"
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="flex items-center gap-1.5 text-xs text-white/50 min-w-0">
        <span className="truncate max-w-[140px]">{value}</span>
        <ChevronRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      </span>
    </button>
  );
}

function ControlIcon({
  onClick,
  disabled,
  active,
  muted,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  muted?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 disabled:opacity-40 disabled:active:scale-100 ${
        active
          ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
          : muted
            ? "bg-white/8 text-white/40 border border-white/10"
            : "bg-white/8 text-white border border-white/10"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * PersonalizedOrb — the Dayjoy voice-mode centerpiece. Layers the existing
 * three.js AIOrb over a slow-rotating, brand-colored blurred halo so it
 * reads as a deliberately designed "presence" (per the user's ask for a
 * unique, personalized sphere) rather than a generic flat circle — while
 * keeping the Dayjoy orange/gold/green palette instead of borrowing
 * ChatGPT's blue.
 */
function PersonalizedOrb({ orbState, phase }: { orbState: AIOrbState; phase: string }) {
  const size = 240;
  const active = phase === "listening" || phase === "speaking" || phase === "thinking";
  return (
    <div className="relative flex items-center justify-center" style={{ width: size + 80, height: size + 80 }}>
      <motion.div
        className="absolute rounded-full"
        style={{
          width: size + 70,
          height: size + 70,
          background:
            "conic-gradient(from 0deg, rgba(221,107,61,0.35), rgba(255,201,139,0.15), rgba(79,111,70,0.25), rgba(221,107,61,0.35))",
          filter: "blur(38px)",
        }}
        animate={{ rotate: 360, scale: active ? [1, 1.06, 1] : 1 }}
        transition={{
          rotate: { duration: 18, repeat: Infinity, ease: "linear" },
          scale: { duration: 2.4, repeat: active ? Infinity : 0, ease: "easeInOut" },
        }}
        aria-hidden="true"
      />
      <motion.div
        className="absolute rounded-full"
        style={{
          width: size + 30,
          height: size + 30,
          background: "radial-gradient(circle, rgba(255,201,139,0.28) 0%, transparent 70%)",
        }}
        animate={{ opacity: active ? [0.5, 0.9, 0.5] : 0.45 }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden="true"
      />
      <Suspense
        fallback={
          <div className="w-[240px] h-[240px] rounded-full bg-primary/10 animate-pulse-glow flex items-center justify-center">
            <Sparkles className="w-9 h-9 text-primary" aria-hidden="true" />
          </div>
        }
      >
        <AIOrb state={orbState} size={size} mobile />
      </Suspense>
    </div>
  );
}

export default VoiceAssistantMobile;
export type { PersistedSettings, LanguageOption, Turn as MobileTurn };
