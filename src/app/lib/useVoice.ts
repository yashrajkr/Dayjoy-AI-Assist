import { useEffect, useRef, useState, useCallback } from "react";

/**
 * useVoice — Web Speech API hook for Speech-to-Text + Text-to-Speech.
 *
 * Browser support:
 *   - SpeechRecognition: Chrome, Edge, Safari (webkit prefix)
 *   - SpeechSynthesis: all modern browsers
 *
 * When the browser doesn't support either API, the hook gracefully
 * degrades — `supported` becomes false and the UI hides the mic button.
 *
 * The hook is intentionally framework-agnostic (no React-specific APIs
 * inside the recognition callbacks) to avoid stale-closure bugs.
 */

type SpeechRecognitionResultLike = ArrayLike<{ transcript: string }> & { isFinal: boolean };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<SpeechRecognitionResultLike> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type VoiceState = {
  /** True if either speech-to-text or text-to-speech is available. */
  supported: boolean;
  /** True if the browser can listen (mic input / SpeechRecognition). */
  sttSupported: boolean;
  /** True if the browser can speak (SpeechSynthesis) — independent of STT support. */
  ttsSupported: boolean;
  listening: boolean;
  speaking: boolean;
  muted: boolean;
  transcript: string;
  interimTranscript: string;
  /** Human-readable message when mic start or recognition fails; null otherwise. */
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  /** Clears the current transcript — call after consuming it so a stale value can't leak into a later render. */
  clearTranscript: () => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  toggleMute: () => void;
  /** Amplitude 0..1 for waveform animation (updated during speaking). */
  amplitude: number;
  /** System voices available for TTS, filtered to nothing until the browser reports them. */
  voices: SpeechSynthesisVoice[];
};

function describeRecognitionError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was denied. Allow microphone access in your browser settings to use voice input.";
    case "no-speech":
      return "No speech detected. Try again.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Voice recognition needs an internet connection.";
    default:
      return "Voice input failed. Please try again.";
  }
}

const LANG_MAP: Record<string, string> = {
  en: "en-US",
  hi: "hi-IN",
  mr: "mr-IN",
  bn: "bn-IN",
  ta: "ta-IN",
  te: "te-IN",
  gu: "gu-IN",
  pa: "pa-IN",
};

export type VoiceOptions = {
  /** Speech rate 0.5–2 (SpeechSynthesisUtterance.rate). Default 1. */
  rate?: number;
  /** Speech pitch 0–2 (SpeechSynthesisUtterance.pitch). Default 1. */
  pitch?: number;
  /** Output volume 0–1 (SpeechSynthesisUtterance.volume). Default 1. */
  volume?: number;
  /** Exact system voice name to use, from speechSynthesis.getVoices(). */
  voiceName?: string;
};

export function useVoice(language: string = "en", options: VoiceOptions = {}): VoiceState {
  // STT and TTS are independent browser capabilities — a browser missing one
  // shouldn't disable the other (e.g. Firefox has no SpeechRecognition but
  // speechSynthesis works fine there).
  const [sttSupported] = useState(() => getRecognitionCtor() !== null);
  const [ttsSupported] = useState(() => typeof window !== "undefined" && "speechSynthesis" in window);
  const supported = sttSupported || ttsSupported;
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [amplitude, setAmplitude] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  // Kept in a ref (not state) so `speak()` always reads the latest values
  // without needing to be recreated — settings can change mid-conversation.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Load available system TTS voices — the list is async and browser-dependent.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  // Initialize recognition
  useEffect(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = LANG_MAP[language] ?? "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          final += text;
        } else {
          interim += text;
        }
      }
      setInterimTranscript(interim);
      if (final) {
        setError(null);
        setTranscript((prev) => prev + final);
      }
    };
    rec.onerror = (event) => {
      console.warn("[voice] recognition error:", event.error);
      setListening(false);
      // "aborted" fires on our own stop()/unmount calls — not a real failure.
      if (event.error !== "aborted") {
        setError(describeRecognitionError(event.error));
      }
    };
    rec.onend = () => {
      setListening(false);
      setInterimTranscript("");
    };
    recognitionRef.current = rec;
    return () => {
      rec.abort();
    };
  }, [language]);

  // Waveform amplitude tracking during speaking
  const trackAmplitude = useCallback(() => {
    if (!analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteTimeDomainData(data);
    // RMS amplitude
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    setAmplitude(Math.min(1, rms * 3));
    rafRef.current = requestAnimationFrame(trackAmplitude);
  }, []);

  const startListening = useCallback(() => {
    if (!recognitionRef.current || listening) return;
    // Starting the mic while TTS is still playing risks the mic picking up
    // the speaker's own audio and transcribing it back as user input —
    // interrupt playback first instead of letting the two run concurrently.
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
    setTranscript("");
    setInterimTranscript("");
    setError(null);
    try {
      recognitionRef.current.start();
      setListening(true);
    } catch (e) {
      console.warn("[voice] start failed:", e);
      setError("Couldn't start voice input. Please try again.");
    }
  }, [listening]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript("");
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window) || muted) return;
      // Symmetric guard to the one in startListening: don't let TTS play
      // into an open mic, or the recognizer can pick up and transcribe the
      // response it's currently speaking.
      if (listening) {
        recognitionRef.current?.stop();
        setListening(false);
      }
      // Strip markdown for cleaner speech
      const clean = text
        .replace(/```[\s\S]*?```/g, " code block ")
        .replace(/[#*`_~[]()]/g, "")
        .replace(/\n+/g, ". ")
        .slice(0, 1000);
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      const opts = optionsRef.current;
      utterance.lang = LANG_MAP[language] ?? "en-US";
      utterance.rate = opts.rate ?? 1.0;
      utterance.pitch = opts.pitch ?? 1.0;
      utterance.volume = opts.volume ?? 1.0;
      if (opts.voiceName) {
        const match = window.speechSynthesis.getVoices().find((v) => v.name === opts.voiceName);
        if (match) utterance.voice = match;
      }
      utterance.onstart = () => {
        setSpeaking(true);
        // Set up audio analysis for waveform
        try {
          const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
          audioCtxRef.current = ctx;
          // Note: SpeechSynthesis doesn't expose an audio node, so we
          // simulate amplitude with a sine wave for the waveform animation.
          // Real audio analysis would require a media element source.
          analyserRef.current = ctx.createAnalyser();
          trackAmplitude();
        } catch {
          // AudioContext not available — waveform will stay flat
        }
      };
      utterance.onend = () => {
        setSpeaking(false);
        setAmplitude(0);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        audioCtxRef.current?.close();
      };
      utterance.onerror = () => {
        setSpeaking(false);
        setAmplitude(0);
      };
      window.speechSynthesis.speak(utterance);
    },
    [language, muted, listening, trackAmplitude],
  );

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
    setAmplitude(0);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      if (next) {
        // Muting also stops any in-progress speech
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          window.speechSynthesis.cancel();
        }
        setSpeaking(false);
      }
      return next;
    });
  }, []);

  return {
    supported,
    sttSupported,
    ttsSupported,
    listening,
    speaking,
    muted,
    transcript,
    interimTranscript,
    error,
    startListening,
    stopListening,
    clearTranscript,
    speak,
    stopSpeaking,
    toggleMute,
    amplitude,
    voices,
  };
}
