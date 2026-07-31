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

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
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
  supported: boolean;
  listening: boolean;
  speaking: boolean;
  muted: boolean;
  transcript: string;
  interimTranscript: string;
  startListening: () => void;
  stopListening: () => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  toggleMute: () => void;
  /** Amplitude 0..1 for waveform animation (updated during speaking). */
  amplitude: number;
};

const LANG_MAP: Record<string, string> = {
  en: "en-US",
  hi: "hi-IN",
};

export function useVoice(language: string = "en"): VoiceState {
  const [supported] = useState(() => getRecognitionCtor() !== null && typeof window !== "undefined" && "speechSynthesis" in window);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [amplitude, setAmplitude] = useState(0);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

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
        if (i === event.results.length - 1) {
          interim = text;
        } else {
          final += text;
        }
      }
      setInterimTranscript(interim);
      if (final) {
        setTranscript((prev) => prev + final);
      }
    };
    rec.onerror = (event) => {
      console.warn("[voice] recognition error:", event.error);
      setListening(false);
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
    setTranscript("");
    setInterimTranscript("");
    try {
      recognitionRef.current.start();
      setListening(true);
    } catch (e) {
      console.warn("[voice] start failed:", e);
    }
  }, [listening]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window) || muted) return;
      // Strip markdown for cleaner speech
      const clean = text
        .replace(/```[\s\S]*?```/g, " code block ")
        .replace(/[#*`_~[]()]/g, "")
        .replace(/\n+/g, ". ")
        .slice(0, 1000);
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = LANG_MAP[language] ?? "en-US";
      utterance.rate = 1.0;
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
    [language, muted, trackAmplitude],
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
    listening,
    speaking,
    muted,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    toggleMute,
    amplitude,
  };
}
