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
  /** Dismisses the current error message without touching listening state. */
  clearError: () => void;
  startListening: () => void;
  /**
   * Opens the mic *without* cutting off any in-progress speech — used to let
   * the user barge in (start talking while the AI is still speaking, like
   * ChatGPT's voice mode). The moment real speech is detected, the caller
   * should stop TTS; `startListening` still cancels TTS immediately, for
   * the normal tap-to-talk case.
   */
  startBargeInListening: () => void;
  stopListening: () => void;
  /** Clears the current transcript — call after consuming it so a stale value can't leak into a later render. */
  clearTranscript: () => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  toggleMute: () => void;
  /**
   * "Unlocks" the browser's speech synthesis engine by speaking a silent
   * utterance synchronously inside a real user gesture (tap/click) — call
   * this from a click handler, not from an async callback. Several mobile
   * browsers (iOS Safari, Chrome on Android) require the *first*
   * `speechSynthesis.speak()` call after page load to happen inside a
   * user-gesture call stack, or they silently drop it and every later
   * `speak()` triggered from an async network response (the normal
   * "AI finished answering, now speak it" path) stays silent forever with
   * no error event at all. See `speak`'s declaration for the matching fix.
   */
  primeSpeech: () => void;
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
  kn: "kn-IN",
  ml: "ml-IN",
  or: "or-IN",
  as: "as-IN",
  ur: "ur-IN",
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
  // True only while a passive (barge-in) listen is open — the recognizer is
  // running *underneath* an active TTS playback. The first real speech it
  // picks up should cut the AI off, same as tapping to interrupt.
  const bargeInRef = useRef(false);
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
      // Barge-in: this mic was opened passively under active TTS playback.
      // The first couple of real characters means the user started talking
      // over the AI — cut the AI off right now instead of waiting for a
      // full final result, the same "you can just start talking" behavior
      // ChatGPT's voice mode has.
      if (bargeInRef.current && (interim.trim().length > 1 || final.trim().length > 0)) {
        bargeInRef.current = false;
        if (typeof window !== "undefined" && "speechSynthesis" in window && window.speechSynthesis.speaking) {
          window.speechSynthesis.cancel();
        }
        setSpeaking(false);
        setAmplitude(0);
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
    bargeInRef.current = false;
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

  // Passive listen — deliberately does NOT cancel speechSynthesis, so it can
  // run alongside an in-progress answer. onresult (above) watches for real
  // speech and cuts the AI off the moment it appears.
  const startBargeInListening = useCallback(() => {
    if (!recognitionRef.current || listening) return;
    bargeInRef.current = true;
    setTranscript("");
    setInterimTranscript("");
    setError(null);
    try {
      recognitionRef.current.start();
      setListening(true);
    } catch (e) {
      // Most likely "already started" — fine to drop, the next speaking
      // cycle will retry.
      bargeInRef.current = false;
      console.warn("[voice] barge-in listen failed:", e);
    }
  }, [listening]);

  const stopListening = useCallback(() => {
    bargeInRef.current = false;
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript("");
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Bumped on every speak() call; a queued speak-after-cancel timer (see
  // below) only fires while it still matches the sequence it was issued
  // with, so an older, already-superseded utterance can't start playing
  // after a newer one has already taken over.
  const speakSeqRef = useRef(0);
  // Chrome (desktop and Android) silently pauses speechSynthesis after
  // ~15s of continuous speech unless something calls resume() — without
  // this watchdog, longer AI answers audibly cut off mid-sentence with no
  // error event at all.
  const resumeWatchdogRef = useRef<number | null>(null);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    speakSeqRef.current += 1;
    setSpeaking(false);
    setAmplitude(0);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (resumeWatchdogRef.current) {
      window.clearInterval(resumeWatchdogRef.current);
      resumeWatchdogRef.current = null;
    }
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
      if (!clean.trim()) return;

      const mySeq = ++speakSeqRef.current;
      window.speechSynthesis.cancel();

      // Chrome has a long-standing bug where a speak() call issued in the
      // same tick as cancel() is silently dropped — no error, no onstart,
      // no sound, the exact symptom of "the speaker button doesn't speak"
      // reported on mobile. Deferring speak() one tick past cancel() lets
      // the engine actually flush before the new utterance is queued.
      window.setTimeout(() => {
        if (speakSeqRef.current !== mySeq) return; // superseded before it ran
        const utterance = new SpeechSynthesisUtterance(clean);
        const opts = optionsRef.current;
        utterance.lang = LANG_MAP[language] ?? "en-US";
        utterance.rate = opts.rate ?? 1.0;
        utterance.pitch = opts.pitch ?? 1.0;
        utterance.volume = opts.volume ?? 1.0;
        if (opts.voiceName) {
          const match = window.speechSynthesis.getVoices().find((v) => v.name === opts.voiceName);
          if (match) utterance.voice = match;
        } else {
          // No explicit voice chosen — prefer a system voice that actually
          // matches the selected language over whatever the browser's
          // default happens to be, so switching to e.g. Hindi/Tamil/Kannada
          // is audible instead of silently speaking in an English voice.
          const langPrefix = (LANG_MAP[language] ?? "en-US").split("-")[0];
          const match = window.speechSynthesis
            .getVoices()
            .find((v) => v.lang.toLowerCase().startsWith(langPrefix));
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
          if (resumeWatchdogRef.current) window.clearInterval(resumeWatchdogRef.current);
          resumeWatchdogRef.current = window.setInterval(() => {
            if (window.speechSynthesis.speaking) {
              window.speechSynthesis.pause();
              window.speechSynthesis.resume();
            }
          }, 10000);
        };
        const cleanup = () => {
          setSpeaking(false);
          setAmplitude(0);
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          audioCtxRef.current?.close();
          if (resumeWatchdogRef.current) {
            window.clearInterval(resumeWatchdogRef.current);
            resumeWatchdogRef.current = null;
          }
        };
        utterance.onend = cleanup;
        utterance.onerror = cleanup;
        window.speechSynthesis.speak(utterance);
      }, 30);
    },
    [language, muted, listening, trackAmplitude],
  );

  /** See VoiceState.primeSpeech for why this exists. */
  const primeSpeech = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      const utterance = new SpeechSynthesisUtterance(" ");
      utterance.volume = 0;
      utterance.rate = 10;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Priming is best-effort — a failure here just means the first real
      // speak() call later carries the unlock risk it always had.
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      if (next) {
        // Muting also stops any in-progress speech
        speakSeqRef.current += 1;
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          window.speechSynthesis.cancel();
        }
        setSpeaking(false);
        if (resumeWatchdogRef.current) {
          window.clearInterval(resumeWatchdogRef.current);
          resumeWatchdogRef.current = null;
        }
      }
      return next;
    });
  }, []);

  // Belt-and-braces cleanup on unmount — stop any in-flight speech and the
  // resume watchdog interval so they don't outlive the component.
  useEffect(() => {
    return () => {
      speakSeqRef.current += 1;
      if (resumeWatchdogRef.current) window.clearInterval(resumeWatchdogRef.current);
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
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
    clearError,
    startListening,
    startBargeInListening,
    stopListening,
    clearTranscript,
    speak,
    stopSpeaking,
    toggleMute,
    primeSpeech,
    amplitude,
    voices,
  };
}
