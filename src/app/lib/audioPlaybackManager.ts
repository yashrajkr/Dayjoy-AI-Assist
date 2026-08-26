/**
 * Real streaming audio playback for realtime TTS (Deepgram Aura sends
 * linear16 PCM @24kHz chunks over the voice WebSocket as they're
 * generated). Schedules chunks back-to-back on a single AudioContext
 * timeline for gapless playback, and exposes an AnalyserNode so the orb
 * visualizer can react to REAL output amplitude — not a fake/looping
 * animation. `interrupt()` is the true barge-in primitive: it stops
 * everything queued and already-scheduled immediately.
 */
export class AudioPlaybackManager {
  private context: AudioContext;
  private analyser: AnalyserNode;
  private nextStartTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private sampleRate: number;
  private _isPlaying = false;

  constructor(sampleRate = 24000) {
    this.sampleRate = sampleRate;
    this.context = new AudioContext();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.connect(this.context.destination);
  }

  get analyserNode(): AnalyserNode {
    return this.analyser;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  /** Enqueue one PCM16 chunk (as received from the WebSocket binary frame). */
  enqueuePcm16(chunk: ArrayBuffer): void {
    const int16 = new Int16Array(chunk);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000;

    const buffer = this.context.createBuffer(1, float32.length, this.sampleRate);
    buffer.copyToChannel(float32, 0);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);

    const now = this.context.currentTime;
    const startAt = Math.max(now, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
    this._isPlaying = true;
    this.activeSources.push(source);
    source.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== source);
      if (this.activeSources.length === 0) this._isPlaying = false;
    };
  }

  /** True barge-in: stop every scheduled/playing chunk immediately, clear the queue. */
  interrupt(): void {
    for (const source of this.activeSources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.activeSources = [];
    this.nextStartTime = this.context.currentTime;
    this._isPlaying = false;
  }

  async pause(): Promise<void> {
    await this.context.suspend();
  }

  async resume(): Promise<void> {
    await this.context.resume();
  }

  /** Real-time amplitude 0-1, for the audio-reactive orb. Returns 0 when idle. */
  getAmplitude(): number {
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    let sum = 0;
    for (const v of data) sum += v;
    return data.length ? sum / data.length / 255 : 0;
  }

  dispose(): void {
    this.interrupt();
    this.analyser.disconnect();
    void this.context.close();
  }
}
