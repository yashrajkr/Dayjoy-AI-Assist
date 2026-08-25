/**
 * captureScreenFrame — real, single-frame screen capture via
 * `getDisplayMedia`, for "look at what's on my screen" voice questions.
 *
 * Deliberately NOT a continuous screen-share: it requests the share,
 * grabs exactly one frame to a canvas, then immediately stops every track
 * — so there's no ongoing broadcast, no "screen sharing active" state to
 * manage or forget to tear down, and no ambiguity about how long the
 * browser's native "sharing your screen" indicator stays up. A continuous
 * live feed would need a persistent video pipeline into the backend that
 * doesn't exist yet (see VoiceAssistant.tsx's honesty notes) — this is the
 * genuinely-supported subset of that capability today.
 */
export async function captureScreenFrame(): Promise<{ dataUrl: string } | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Screen sharing isn't supported in this browser.");
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "monitor" } as MediaTrackConstraints,
    audio: false,
  });

  try {
    const track = stream.getVideoTracks()[0];
    if (!track) return null;

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play().catch(() => undefined);

    // Wait for the first real frame's dimensions to be available —
    // capturing before loadedmetadata produces a 0x0 canvas.
    if (!video.videoWidth) {
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => resolve();
        window.setTimeout(resolve, 1500); // safety timeout, don't hang forever
      });
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return { dataUrl: canvas.toDataURL("image/jpeg", 0.85) };
  } finally {
    // Stop every track immediately — this is what makes it a single-frame
    // capture rather than a live share; the browser's "sharing" indicator
    // disappears right after this runs.
    stream.getTracks().forEach((t) => t.stop());
  }
}
