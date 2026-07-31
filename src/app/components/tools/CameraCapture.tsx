import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera,
  RefreshCw,
  Check,
  X,
  Download,
  AlertTriangle,
  SwitchCamera,
  Image as ImageIcon,
} from "lucide-react";
import { Modal, modalButtonClass } from "../common/Modal";

/**
 * CameraCapture — accessible in-browser camera capture component.
 *
 * Uses the MediaDevices.getUserMedia API to stream the device camera
 * into a <video> element, lets the user frame a shot, captures a still
 * to a <canvas>, and returns the captured image as a File + data URL.
 *
 * Browser support:
 *   - Chrome / Edge / Firefox (desktop + Android): full support
 *   - iOS Safari 11+: requires user gesture (button click), which we honour
 *   - Insecure contexts (http://): API unavailable — surface clear error
 *
 * Accessibility:
 *   - Live region announces status ("Camera ready", "Captured", etc.)
 *   - All icon-only buttons have aria-label
 *   - Keyboard: Space/Enter on the capture button triggers capture
 *   - Focus is trapped inside the modal (Modal component handles this)
 *
 * Security:
 *   - Camera stream is never persisted; it stops on unmount.
 *   - Captured images live in memory only until the parent picks them up.
 *   - No upload happens here — the parent decides where the file goes.
 */

export type CapturedImage = {
  file: File;
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCapture: (image: CapturedImage) => void;
  /** Optional title for the modal. */
  title?: string;
  /** Preferred facing mode for mobile. */
  facingMode?: "user" | "environment";
  /** Allow multiple captures (gallery) before closing. */
  multiple?: boolean;
};

export function CameraCapture({
  open,
  onClose,
  onCapture,
  title = "Take a photo",
  facingMode: initialFacing = "environment",
  multiple = false,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "captured" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [facingMode, setFacingMode] = useState<"user" | "environment">(initialFacing);
  const [captured, setCaptured] = useState<CapturedImage | null>(null);
  const [gallery, setGallery] = useState<CapturedImage[]>([]);

  /**
   * Stop the active camera stream and release tracks.
   */
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  /**
   * Request camera access with the current facingMode.
   */
  const startCamera = useCallback(async () => {
    setStatus("loading");
    setErrorMsg("");
    setCaptured(null);
    stopStream();

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setErrorMsg(
        "Camera API not available. Use a secure (https://) connection in Chrome, Edge, Firefox, or Safari.",
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStatus("ready");
    } catch (e) {
      setStatus("error");
      const err = e as DOMException;
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setErrorMsg("Camera permission denied. Enable it in your browser settings and try again.");
      } else if (err.name === "NotFoundError" || err.name === "OverconstrainedError") {
        setErrorMsg("No camera found on this device.");
      } else if (err.name === "NotReadableError") {
        setErrorMsg("Camera is in use by another application. Close it and try again.");
      } else {
        setErrorMsg(err.message || "Could not access the camera.");
      }
    }
  }, [facingMode, stopStream]);

  /**
   * Capture a still frame from the video stream to a canvas.
   */
  const handleCapture = useCallback(() => {
    if (!videoRef.current || status !== "ready") return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Mirror horizontally if front-facing for natural UX
    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(canvas, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `dayjoy-capture-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        const img: CapturedImage = {
          file,
          dataUrl,
          width: canvas.width,
          height: canvas.height,
          capturedAt: Date.now(),
        };
        setCaptured(img);
        setStatus("captured");
      },
      "image/jpeg",
      0.92,
    );
  }, [status, facingMode]);

  /**
   * Accept the current capture, dispatch to parent, optionally reset.
   */
  const handleAccept = useCallback(() => {
    if (!captured) return;
    if (multiple) {
      setGallery((prev) => [...prev, captured]);
      setCaptured(null);
      setStatus("ready");
      // Resume live preview
      if (videoRef.current && streamRef.current) {
        videoRef.current.play().catch(() => undefined);
      }
    } else {
      onCapture(captured);
      onClose();
    }
  }, [captured, multiple, onCapture, onClose]);

  /**
   * Discard current capture and return to live preview.
   */
  const handleRetake = useCallback(() => {
    setCaptured(null);
    setStatus("ready");
    if (videoRef.current && streamRef.current) {
      videoRef.current.play().catch(() => undefined);
    }
  }, []);

  /**
   * Flip front/back camera (mobile only). On desktop both modes return
   * the same webcam; we still allow the toggle for parity.
   */
  const handleFlip = useCallback(() => {
    setFacingMode((m) => (m === "user" ? "environment" : "user"));
  }, []);

  /**
   * Finish multiple-capture session: dispatch the gallery and close.
   */
  const handleFinishMultiple = useCallback(() => {
    if (gallery.length === 0 && captured) {
      onCapture(captured);
    } else if (gallery.length > 0) {
      // Send last one as primary; parent can extend for multi-upload.
      onCapture(captured ?? gallery[gallery.length - 1]);
    }
    onClose();
  }, [gallery, captured, onCapture, onClose]);

  /**
   * Start camera when modal opens; stop on close.
   */
  useEffect(() => {
    if (open) {
      startCamera();
    } else {
      stopStream();
      setCaptured(null);
      setGallery([]);
      setStatus("idle");
    }
    return () => stopStream();
  }, [open, startCamera, stopStream]);

  /**
   * Restart camera when facing mode flips.
   */
  useEffect(() => {
    if (open && status === "ready") {
      startCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description="Frame your subject and tap the shutter button."
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <span className="text-xs text-muted-foreground">
            {gallery.length > 0 ? `${gallery.length} captured` : ""}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className={modalButtonClass.secondary}>
              Cancel
            </button>
            {status === "captured" ? (
              <button type="button" onClick={handleAccept} className={modalButtonClass.primary}>
                <Check className="w-4 h-4" aria-hidden="true" />
                {multiple && gallery.length > 0 ? "Add another" : "Use photo"}
              </button>
            ) : null}
            {multiple && gallery.length > 0 ? (
              <button type="button" onClick={handleFinishMultiple} className={modalButtonClass.primary}>
                Done ({gallery.length})
              </button>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Live region for screen readers */}
        <div className="sr-only" role="status" aria-live="polite">
          {status === "loading" ? "Starting camera" : null}
          {status === "ready" ? "Camera ready" : null}
          {status === "captured" ? "Photo captured" : null}
          {status === "error" ? `Error: ${errorMsg}` : null}
        </div>

        {/* Camera viewport */}
        <div className="relative aspect-[4/3] bg-black rounded-xl overflow-hidden flex items-center justify-center">
          <video
            ref={videoRef}
            playsInline
            muted
            className={`w-full h-full object-cover ${facingMode === "user" ? "scale-x-[-1]" : ""} ${
              status === "captured" ? "opacity-0" : "opacity-100"
            }`}
          />
          <AnimatePresence>
            {captured ? (
              <motion.img
                key={captured.capturedAt}
                src={captured.dataUrl}
                alt="Captured preview"
                className="absolute inset-0 w-full h-full object-cover"
                initial={{ opacity: 0, scale: 1.02 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.15 }}
              />
            ) : null}
          </AnimatePresence>

          {/* Loading overlay */}
          {status === "loading" ? (
            <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" aria-hidden="true" />
              Starting camera…
            </div>
          ) : null}

          {/* Error overlay */}
          {status === "error" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/90 p-6 text-center">
              <AlertTriangle className="w-8 h-8 mb-3 text-warning" aria-hidden="true" />
              <p className="text-sm font-medium mb-1">Camera unavailable</p>
              <p className="text-xs text-white/70 max-w-sm">{errorMsg}</p>
            </div>
          ) : null}

          {/* Framing guide overlay (only when ready) */}
          {status === "ready" ? (
            <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
              <div className="absolute inset-6 border-2 border-white/40 rounded-xl" />
              <div className="absolute top-3 left-3 w-6 h-6 border-l-2 border-t-2 border-white/80 rounded-tl" />
              <div className="absolute top-3 right-3 w-6 h-6 border-r-2 border-t-2 border-white/80 rounded-tr" />
              <div className="absolute bottom-3 left-3 w-6 h-6 border-l-2 border-b-2 border-white/80 rounded-bl" />
              <div className="absolute bottom-3 right-3 w-6 h-6 border-r-2 border-b-2 border-white/80 rounded-br" />
            </div>
          ) : null}

          {/* Flip camera button */}
          {status === "ready" ? (
            <button
              type="button"
              onClick={handleFlip}
              className="absolute top-3 right-3 p-2 rounded-lg bg-black/50 text-white hover:bg-black/70 transition"
              aria-label="Flip camera"
              title="Flip camera"
            >
              <SwitchCamera className="w-5 h-5" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {/* Action row */}
        <div className="flex items-center justify-center gap-3">
          {status === "captured" ? (
            <>
              <button
                type="button"
                onClick={handleRetake}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-sm font-medium hover:bg-accent/60"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                Retake
              </button>
              <a
                href={captured?.dataUrl}
                download={`dayjoy-capture-${Date.now()}.jpg`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-sm font-medium hover:bg-accent/60"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                Save copy
              </a>
            </>
          ) : status === "ready" ? (
            <button
              type="button"
              onClick={handleCapture}
              className="relative w-16 h-16 rounded-full bg-white border-4 border-primary shadow-lg hover:scale-105 active:scale-95 transition-transform"
              aria-label="Take photo"
            >
              <span className="absolute inset-2 rounded-full bg-primary/20" />
              <Camera className="absolute inset-0 m-auto w-6 h-6 text-primary" aria-hidden="true" />
            </button>
          ) : status === "error" ? (
            <button
              type="button"
              onClick={startCamera}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Try again
            </button>
          ) : null}
        </div>

        {/* Gallery thumbnails (multiple mode) */}
        {multiple && gallery.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {gallery.map((g) => (
              <div
                key={g.capturedAt}
                className="relative w-16 h-16 rounded-lg overflow-hidden border border-border shrink-0"
              >
                <img src={g.dataUrl} alt="Captured thumbnail" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => setGallery((prev) => prev.filter((x) => x.capturedAt !== g.capturedAt))}
                  className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/60 text-white hover:bg-black/80"
                  aria-label="Remove from gallery"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {/* Helper text */}
        {status === "ready" ? (
          <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
            <ImageIcon className="w-3 h-3" aria-hidden="true" />
            Tap the shutter to capture. Photos stay on your device until you choose to upload.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
