import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import jsQR from "jsqr";
import {
  QrCode,
  RefreshCw,
  AlertTriangle,
  Check,
  ClipboardCopy,
  ExternalLink,
  SwitchCamera,
} from "lucide-react";
import { Modal } from "../common/Modal";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

/**
 * QRScanner — in-browser QR code scanner with live camera feed.
 *
 * Uses the `jsqr` library (pure JS, no native deps) to decode QR codes
 * from video frames captured via MediaDevices.getUserMedia. Each frame
 * is drawn to an offscreen canvas, then `jsQR` scans the pixel buffer.
 *
 * When a QR is detected, scanning pauses and the decoded text is shown
 * for the user to copy / open / dispatch to a parent handler.
 *
 * NOTE: This is a QR-only decoder. Linear barcodes (EAN-13, UPC-A, Code128)
 * require a different decoder algorithm. If the user needs linear barcode
 * support in the future, swap `jsqr` for `@zxing/library` which handles
 * both. For Dayjoy's primary use case (product QR codes on packaging,
 * training material QR links, ticket QR codes), QR-only is sufficient.
 *
 * Browser support: same as CameraCapture — Chrome/Edge/Firefox/Safari
 * on https or localhost. iOS Safari requires PWA install for camera
 * access in background tabs.
 *
 * Performance: scanning runs at ~10fps via requestAnimationFrame, which
 * keeps CPU usage low while still detecting within ~100ms of framing.
 */

export type ScanResult = {
  text: string;
  /** Format detected by jsQR — always "QR" for now. */
  format: "QR";
  /** Raw byte payload if the QR contained binary data. */
  bytes?: Uint8Array;
  /** Timestamp of detection. */
  detectedAt: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onScan: (result: ScanResult) => void;
  title?: string;
  /** Auto-close on first successful scan. Default true. */
  autoClose?: boolean;
};

export function QRScanner({
  open,
  onClose,
  onScan,
  title = "Scan QR code",
  autoClose = true,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastResultRef = useRef<ScanResult | null>(null);

  const [status, setStatus] = useState<"idle" | "loading" | "scanning" | "found" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [copied, setCopied] = useState(false);

  const stopStream = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  /**
   * Main scan loop: pull a frame, draw to canvas, run jsQR on pixels.
   * Loops via requestAnimationFrame until a QR is found or stopped.
   */
  const scanLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(scanLoop);
      return;
    }

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) {
      rafRef.current = requestAnimationFrame(scanLoop);
      return;
    }

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    try {
      const imageData = ctx.getImageData(0, 0, w, h);
      const code = jsQR(imageData.data, w, h, {
        inversionAttempts: "dontInvert",
      });
      if (code && code.data) {
        const detected: ScanResult = {
          text: code.data,
          format: "QR",
          bytes: code.binaryData ? new Uint8Array(code.binaryData) : undefined,
          detectedAt: Date.now(),
        };
        // Debounce: same payload within 1.5s is ignored
        if (
          lastResultRef.current &&
          lastResultRef.current.text === detected.text &&
          detected.detectedAt - lastResultRef.current.detectedAt < 1500
        ) {
          rafRef.current = requestAnimationFrame(scanLoop);
          return;
        }
        lastResultRef.current = detected;
        setResult(detected);
        setStatus("found");
        stopStream();
        onScan(detected);
        if (autoClose) {
          setTimeout(() => {
            onClose();
          }, 600);
        }
        return;
      }
    } catch {
      // getImageData can throw on cross-origin video; we only use camera
      // so this shouldn't happen, but we swallow to keep the loop alive.
    }
    rafRef.current = requestAnimationFrame(scanLoop);
  }, [autoClose, onClose, onScan, stopStream]);

  /**
   * Start the camera and kick off the scan loop.
   */
  const startCamera = useCallback(async () => {
    setStatus("loading");
    setErrorMsg("");
    setResult(null);
    lastResultRef.current = null;
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
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStatus("scanning");
      rafRef.current = requestAnimationFrame(scanLoop);
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
  }, [facingMode, scanLoop, stopStream]);

  /**
   * Copy the detected text to clipboard.
   */
  const handleCopy = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = result.text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // no-op
      }
      document.body.removeChild(ta);
    }
  }, [result]);

  /**
   * Lifecycle: start when open, stop when closed.
   */
  useEffect(() => {
    if (open) {
      startCamera();
    } else {
      stopStream();
      setResult(null);
      setStatus("idle");
    }
    return () => stopStream();
  }, [open, startCamera, stopStream]);

  /**
   * Restart camera on facingMode flip.
   */
  useEffect(() => {
    if (open && (status === "scanning" || status === "loading")) {
      startCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  /**
   * Decide whether a scanned string looks like a URL.
   */
  const isUrl = (s: string): boolean => /^https?:\/\//i.test(s);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description="Point the camera at a Dayjoy product QR, training card, or ticket code."
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          {result ? (
            <Button type="button" onClick={handleCopy}>
              {copied ? (
                <>
                  <Check className="w-4 h-4" aria-hidden="true" /> Copied
                </>
              ) : (
                <>
                  <ClipboardCopy className="w-4 h-4" aria-hidden="true" /> Copy text
                </>
              )}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-3">
        {/* Live region */}
        <div className="sr-only" role="status" aria-live="polite">
          {status === "loading" ? "Starting camera" : null}
          {status === "scanning" ? "Scanning for QR code" : null}
          {status === "found" ? `QR detected: ${result?.text ?? ""}` : null}
          {status === "error" ? `Error: ${errorMsg}` : null}
        </div>

        {/* Scanner viewport */}
        <div className="relative aspect-[4/3] bg-black rounded-xl overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

          {/* Scan target overlay */}
          {status === "scanning" || status === "loading" ? (
            <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
              <div className="absolute inset-0 bg-black/30" />
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2/3 aspect-square">
                <div className="relative w-full h-full bg-transparent rounded-xl overflow-hidden">
                  {/* Corner brackets */}
                  <div className="absolute top-0 left-0 w-8 h-8 border-l-4 border-t-4 border-white rounded-tl-xl" />
                  <div className="absolute top-0 right-0 w-8 h-8 border-r-4 border-t-4 border-white rounded-tr-xl" />
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-l-4 border-b-4 border-white rounded-bl-xl" />
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-r-4 border-b-4 border-white rounded-br-xl" />
                  {/* Animated scan line */}
                  <motion.div
                    className="absolute left-2 right-2 h-0.5 bg-primary shadow-[0_0_8px_2px] shadow-primary/60"
                    initial={{ top: "10%" }}
                    animate={{ top: ["10%", "85%", "10%"] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                  />
                </div>
              </div>
              <p className="absolute bottom-3 left-0 right-0 text-center text-white/80 text-xs">
                {status === "loading" ? "Starting camera…" : "Align QR code within the frame"}
              </p>
            </div>
          ) : null}

          {/* Success overlay */}
          <AnimatePresence>
            {status === "found" && result ? (
              <motion.div
                className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-white p-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  initial={{ scale: 0.5, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 18 }}
                  className="w-14 h-14 rounded-full bg-primary flex items-center justify-center mb-3"
                >
                  <Check className="w-7 h-7" aria-hidden="true" />
                </motion.div>
                <p className="text-sm font-medium">QR code detected</p>
                <p className="text-xs text-white/70 mt-1 max-w-xs truncate font-mono">
                  {result.text}
                </p>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* Error overlay */}
          {status === "error" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/90 p-6 text-center">
              <AlertTriangle className="w-8 h-8 mb-3 text-warning" aria-hidden="true" />
              <p className="text-sm font-medium mb-1">Camera unavailable</p>
              <p className="text-xs text-white/70 max-w-sm">{errorMsg}</p>
            </div>
          ) : null}

          {/* Flip camera button */}
          {status === "scanning" ? (
            <button
              type="button"
              onClick={() => setFacingMode((m) => (m === "user" ? "environment" : "user"))}
              className="absolute top-3 right-3 p-2 rounded-lg bg-black/50 text-white hover:bg-black/70 transition"
              aria-label="Flip camera"
              title="Flip camera"
            >
              <SwitchCamera className="w-5 h-5" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {/* Result panel */}
        {result ? (
          <Card className="border-primary/30 bg-primary/5 p-3 shadow-none">
            <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">
              Decoded content
            </p>
            <p className="text-sm font-mono break-all">{result.text}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {isUrl(result.text) ? (
                <a
                  href={result.text}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  Open link
                </a>
              ) : null}
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3" aria-hidden="true" /> Copied
                  </>
                ) : (
                  <>
                    <ClipboardCopy className="w-3 h-3" aria-hidden="true" /> Copy
                  </>
                )}
              </button>
            </div>
          </Card>
        ) : null}

        {/* Error retry */}
        {status === "error" ? (
          <Button
            type="button"
            onClick={startCamera}
            className="w-full"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Try again
          </Button>
        ) : null}

        {/* Helper */}
        {status === "scanning" ? (
          <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
            <QrCode className="w-3 h-3" aria-hidden="true" />
            Hold steady. Dayjoy product packaging, training cards, and ticket QR codes all work.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
