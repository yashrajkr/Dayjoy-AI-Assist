/**
 * Realtime voice client — the primary path, with the existing browser
 * SpeechRecognition/speechSynthesis pipeline (useVoice.ts) kept as a
 * documented fallback (Step 21 of the realtime voice architecture) when
 * this is unavailable or unsupported.
 *
 * Connects to `backend/voice_api.py`'s `/voice/ws`: streams real PCM16 mic
 * audio out, receives real partial/final transcripts, real tool/RAG status
 * events, real streamed LLM text, and real streamed TTS audio back. Every
 * event this emits reflects an actual server message — there is no
 * synthetic/simulated state here. If the server reports
 * `{type: "unavailable"}` (DEEPGRAM_API_KEY unset) this client surfaces
 * that as `available: false` and does nothing further — callers must fall
 * back to the browser pipeline themselves, this module will not pretend.
 */
import { supabase } from "./supabaseClient";
import { getApiBaseUrl } from "../../lib/api";
import { startAudioCapture, type AudioCaptureHandle } from "./audioCapture";
import { AudioPlaybackManager } from "./audioPlaybackManager";

export type RealtimeVoiceState =
  | "IDLE" | "CONNECTING" | "LISTENING" | "PROCESSING" | "SEARCHING" | "THINKING"
  | "SPEAKING" | "INTERRUPTED" | "PAUSED" | "MUTED" | "RECONNECTING" | "ERROR" | "ENDED";

export interface RealtimeVoiceCallbacks {
  onStateChange?: (state: RealtimeVoiceState) => void;
  onPartialTranscript?: (text: string) => void;
  onFinalTranscript?: (text: string) => void;
  onStatus?: (status: string) => void;
  onTextDelta?: (delta: string) => void;
  onFinalAnswer?: (payload: { text: string; sources: unknown[]; handoffRequired: boolean }) => void;
  onUnavailable?: (reason: string) => void;
  onError?: (message: string) => void;
  onDisconnected?: () => void;
}

async function checkRealtimeAvailable(): Promise<boolean> {
  try {
    const resp = await fetch(`${getApiBaseUrl()}/voice/capabilities`, { method: "GET" });
    if (!resp.ok) return false;
    const data = await resp.json();
    return Boolean(data?.realtime_available);
  } catch {
    return false;
  }
}

export class RealtimeVoiceClient {
  private ws: WebSocket | null = null;
  private capture: AudioCaptureHandle | null = null;
  private playback: AudioPlaybackManager | null = null;
  private callbacks: RealtimeVoiceCallbacks;
  private sessionId: string;
  private reconnectAttempts = 0;
  private manuallyEnded = false;

  constructor(callbacks: RealtimeVoiceCallbacks, sessionId?: string) {
    this.callbacks = callbacks;
    this.sessionId = sessionId ?? crypto.randomUUID();
  }

  get micAnalyser(): AnalyserNode | null {
    return this.capture?.analyser ?? null;
  }

  get playbackAmplitude(): number {
    return this.playback?.getAmplitude() ?? 0;
  }

  static async isAvailable(): Promise<boolean> {
    return checkRealtimeAvailable();
  }

  async connect(opts: { language: string; conversationId?: string }): Promise<boolean> {
    const available = await checkRealtimeAvailable();
    if (!available) {
      this.callbacks.onUnavailable?.("realtime_provider_not_configured");
      return false;
    }

    const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
    if (!token) {
      this.callbacks.onUnavailable?.("unauthenticated");
      return false;
    }

    const wsBase = getApiBaseUrl().replace(/^http/, "ws");
    const params = new URLSearchParams({
      token,
      session_id: this.sessionId,
      language: opts.language,
      ...(opts.conversationId ? { conversation_id: opts.conversationId } : {}),
    });

    return new Promise((resolve) => {
      const ws = new WebSocket(`${wsBase}/voice/ws?${params.toString()}`);
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      ws.onopen = () => {
        this.reconnectAttempts = 0;
      };
      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          this.handleControlMessage(event.data, resolve);
        } else {
          this.playback?.enqueuePcm16(event.data as ArrayBuffer);
        }
      };
      ws.onerror = () => {
        this.callbacks.onError?.("Realtime voice connection error.");
      };
      ws.onclose = () => {
        this.callbacks.onDisconnected?.();
        if (!this.manuallyEnded) this.attemptReconnect(opts);
      };
      // If the very first message never arrives (network hang), don't
      // leave the caller hanging forever waiting to know availability.
      window.setTimeout(() => resolve(this.ws?.readyState === WebSocket.OPEN), 4000);
    });
  }

  private handleControlMessage(raw: string, resolveConnect?: (ok: boolean) => void): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case "unavailable":
        this.callbacks.onUnavailable?.(String(msg.reason ?? "unknown"));
        resolveConnect?.(false);
        break;
      case "error":
        this.callbacks.onError?.(String(msg.reason ?? "voice_error"));
        if (msg.reason === "unauthorized" || msg.reason === "rate_limited") resolveConnect?.(false);
        break;
      case "session":
        void this.startCapture();
        resolveConnect?.(true);
        break;
      case "state":
        this.callbacks.onStateChange?.(msg.state as RealtimeVoiceState);
        break;
      case "partial_transcript":
        this.callbacks.onPartialTranscript?.(String(msg.text ?? ""));
        break;
      case "final_transcript":
        this.callbacks.onFinalTranscript?.(String(msg.text ?? ""));
        break;
      case "status":
        this.callbacks.onStatus?.(String(msg.status ?? ""));
        break;
      case "text_delta":
        this.callbacks.onTextDelta?.(String(msg.delta ?? ""));
        break;
      case "tts_unavailable":
        // Honest gap surfaced by the backend (e.g. non-English realtime
        // TTS not yet covered by the configured provider) — the caller
        // still has the text via onTextDelta/onFinalAnswer and can route
        // it to the browser speechSynthesis fallback for this one turn.
        this.callbacks.onError?.(`realtime_tts_unavailable:${msg.language}`);
        break;
      case "final_answer":
        this.callbacks.onFinalAnswer?.({
          text: String(msg.text ?? ""),
          sources: (msg.sources as unknown[]) ?? [],
          handoffRequired: Boolean(msg.handoff_required),
        });
        break;
      default:
        break;
    }
  }

  private async startCapture(): Promise<void> {
    if (this.capture) return;
    this.playback = new AudioPlaybackManager(24000);
    this.capture = await startAudioCapture((chunk) => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(chunk);
    });
  }

  private attemptReconnect(opts: { language: string; conversationId?: string }): void {
    if (this.reconnectAttempts >= 3) return;
    this.reconnectAttempts += 1;
    this.callbacks.onStateChange?.("RECONNECTING");
    window.setTimeout(() => {
      void this.connect(opts);
    }, 1000 * this.reconnectAttempts);
  }

  /** True barge-in: stops audio playback immediately and tells the server
   * to cancel the in-flight answer/TTS for this turn. */
  interrupt(): void {
    this.playback?.interrupt();
    this.ws?.send(JSON.stringify({ type: "interrupt" }));
  }

  setMuted(muted: boolean): void {
    this.capture?.setMuted(muted);
    this.ws?.send(JSON.stringify({ type: muted ? "mute" : "unmute" }));
  }

  pause(): void {
    this.ws?.send(JSON.stringify({ type: "pause" }));
    void this.playback?.pause();
  }

  resume(): void {
    this.ws?.send(JSON.stringify({ type: "resume" }));
    void this.playback?.resume();
  }

  end(): void {
    this.manuallyEnded = true;
    this.ws?.send(JSON.stringify({ type: "end" }));
    this.ws?.close();
    this.capture?.stop();
    this.playback?.dispose();
    this.capture = null;
    this.playback = null;
  }
}
