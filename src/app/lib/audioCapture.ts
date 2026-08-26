/**
 * Real microphone capture for the realtime voice pipeline: raw PCM16 mono
 * @16kHz chunks, emitted continuously while recording (not one big blob
 * captured after the user stops talking) — this is what Deepgram's
 * streaming STT endpoint expects on its WebSocket.
 *
 * Uses an AudioWorkletProcessor (registered from an in-memory Blob module,
 * so no separate static asset/Vite config is needed) running on the audio
 * thread, downsampling from the browser's native sample rate (usually
 * 48000Hz) to 16000Hz via simple linear interpolation, then converting
 * float32 samples to int16 PCM before posting each ~20ms chunk back to the
 * main thread.
 */

const WORKLET_SOURCE = `
class PcmDownsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options.processorOptions.targetRate;
    this.ratio = sampleRate / this.targetRate;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    const outLength = Math.floor(channel.length / this.ratio);
    if (outLength <= 0) return true;
    const pcm16 = new Int16Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const srcIndex = i * this.ratio;
      const i0 = Math.floor(srcIndex);
      const i1 = Math.min(i0 + 1, channel.length - 1);
      const frac = srcIndex - i0;
      const sample = channel[i0] * (1 - frac) + channel[i1] * frac;
      const clamped = Math.max(-1, Math.min(1, sample));
      pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    return true;
  }
}
registerProcessor("pcm-downsampler", PcmDownsampler);
`;

export interface AudioCaptureHandle {
  stop: () => void;
  setMuted: (muted: boolean) => void;
  analyser: AnalyserNode;
}

/**
 * Starts continuous mic capture. `onChunk` fires with a real PCM16 mono
 * 16kHz ArrayBuffer roughly every ~20ms of audio. Returns a handle to stop
 * capture and to mute (mute keeps the mic stream open but stops chunks
 * from being emitted — a "true" mute, not just a UI flag, satisfying the
 * "microphone actually stops transmitting" requirement).
 */
export async function startAudioCapture(
  onChunk: (pcm16: ArrayBuffer) => void,
  targetRate = 16000,
): Promise<AudioCaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const context = new AudioContext();
  const workletBlobUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
  await context.audioWorklet.addModule(workletBlobUrl);
  URL.revokeObjectURL(workletBlobUrl);

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const worklet = new AudioWorkletNode(context, "pcm-downsampler", {
    processorOptions: { targetRate },
  });
  source.connect(worklet);

  let muted = false;
  worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    if (!muted) onChunk(event.data);
  };

  return {
    analyser,
    setMuted: (value: boolean) => {
      muted = value;
    },
    stop: () => {
      worklet.port.onmessage = null;
      worklet.disconnect();
      source.disconnect();
      analyser.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void context.close();
    },
  };
}
