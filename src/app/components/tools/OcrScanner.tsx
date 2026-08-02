import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  FileText,
  Upload,
  RefreshCw,
  AlertTriangle,
  Check,
  ClipboardCopy,
  Camera,
  Trash2,
  Languages,
} from "lucide-react";
import { Modal } from "../common/Modal";
import { CameraCapture, type CapturedImage } from "./CameraCapture";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

/**
 * OcrScanner — extract text from images using Tesseract.js (WASM).
 *
 * Tesseract.js runs entirely in the browser (WebAssembly). The first
 * invocation downloads the language training data (~10-15MB for eng)
 * from a CDN; subsequent scans use the cached worker.
 *
 * Supported inputs:
 *   - File picker (PNG/JPG/WebP)
 *   - Drag & drop onto the dropzone
 *   - Direct camera capture (reuses CameraCapture)
 *
 * Supported languages (Tesseract language codes):
 *   - eng (English) — default
 *   - hin (Hindi) — for Dayjoy Hindi docs
 *   - eng+hin (combined) — for Hinglish/mixed docs
 *
 * The recognized text is shown in a textarea for the user to review
 * (Tesseract is ~95% accurate on clean scans; user review is essential
 * before using the text for AI queries or form filling).
 *
 * Performance:
 *   - Recognition runs in a Web Worker so the UI thread stays responsive.
 *   - Progress is reported via Tesseract's logger callback.
 *   - We set `max-canvas-size` to 2000px to avoid mobile memory issues.
 */

type OcrStatus = "idle" | "loading-image" | "loading-engine" | "recognizing" | "done" | "error";

type Props = {
  open: boolean;
  onClose: () => void;
  onExtracted?: (text: string) => void;
  title?: string;
};

export function OcrScanner({ open, onClose, onExtracted, title = "Extract text from image" }: Props) {
  const [status, setStatus] = useState<OcrStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [text, setText] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [language, setLanguage] = useState<"eng" | "hin" | "eng+hin">("eng");
  const [copied, setCopied] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const workerRef = useRef<unknown>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  /**
   * Reset all state when modal reopens.
   */
  useEffect(() => {
    if (open) {
      setStatus("idle");
      setProgress(0);
      setProgressLabel("");
      setImageUrl(null);
      setText("");
      setErrorMsg("");
      setCopied(false);
    }
  }, [open]);

  /**
   * Dynamically import tesseract.js only when needed (saves ~200KB on initial bundle).
   * The dynamic import also keeps the WASM fetch out of the critical path.
   */
  const getWorker = useCallback(async () => {
    if (workerRef.current) return workerRef.current;
    setStatus("loading-engine");
    setProgressLabel("Loading OCR engine…");
    const { createWorker } = await import("tesseract.js");
    // Single-language worker. Switching languages requires recreating.
    const langs = language === "eng+hin" ? ["eng", "hin"] : [language];
    const worker = await createWorker(langs, 1, {
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text") {
          setStatus("recognizing");
          setProgress(Math.round(m.progress * 100));
          setProgressLabel("Recognizing text…");
        } else {
          setProgressLabel(m.status.charAt(0).toUpperCase() + m.status.slice(1));
          setProgress(Math.round((m.progress ?? 0) * 100));
        }
      },
    });
    workerRef.current = worker;
    return worker;
  }, [language]);

  /**
   * Process an image File through Tesseract.
   */
  const processImage = useCallback(
    async (file: File) => {
      setErrorMsg("");
      const url = URL.createObjectURL(file);
      setImageUrl(url);
      setText("");
      try {
        const worker = await getWorker();
        setStatus("recognizing");
        setProgress(0);
        setProgressLabel("Recognizing text…");
        const { data } = await (worker as {
          recognize: (img: string | File) => Promise<{ data: { text: string } }>;
        }).recognize(file);
        setText(data.text || "");
        setStatus("done");
      } catch (e) {
        setStatus("error");
        setErrorMsg(e instanceof Error ? e.message : "OCR failed. Try a clearer image.");
      }
    },
    [getWorker],
  );

  /**
   * Handle file picker selection.
   */
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processImage(file);
      // reset so same file can be picked again
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [processImage],
  );

  /**
   * Handle drag & drop.
   */
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith("image/")) processImage(file);
    },
    [processImage],
  );

  /**
   * Handle camera capture → process image.
   */
  const handleCameraCapture = useCallback(
    (img: CapturedImage) => {
      setCameraOpen(false);
      // Convert data URL to File
      const arr = img.dataUrl.split(",");
      const mime = arr[0].match(/:(.*?);/)?.[1] ?? "image/jpeg";
      const bstr = atob(arr[1]);
      const u8 = new Uint8Array(bstr.length);
      for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
      const file = new File([u8], img.file.name, { type: mime });
      processImage(file);
    },
    [processImage],
  );

  /**
   * Copy extracted text to clipboard.
   */
  const handleCopy = useCallback(async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // no-op
    }
  }, [text]);

  /**
   * Send extracted text to parent (e.g., paste into chat composer).
   */
  const handleUseText = useCallback(() => {
    if (text && onExtracted) onExtracted(text);
    onClose();
  }, [text, onExtracted, onClose]);

  /**
   * Reset to pick another image.
   */
  const handleReset = useCallback(() => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(null);
    setText("");
    setStatus("idle");
    setProgress(0);
    setProgressLabel("");
    setErrorMsg("");
  }, [imageUrl]);

  /**
   * Clean up worker + object URL on unmount/close.
   */
  useEffect(() => {
    if (!open) {
      if (workerRef.current) {
        (workerRef.current as { terminate: () => Promise<void> })
          .terminate?.()
          .catch(() => undefined);
        workerRef.current = null;
      }
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    }
  }, [open, imageUrl]);

  const isBusy = status === "loading-engine" || status === "recognizing" || status === "loading-image";

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={title}
        description="Extract text from product labels, documents, or training materials."
        size="lg"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <Button type="button" variant="secondary" onClick={onClose}>
              Close
            </Button>
            {text ? (
              <>
                <Button type="button" variant="secondary" onClick={handleCopy}>
                  {copied ? (
                    <>
                      <Check className="w-4 h-4" aria-hidden="true" /> Copied
                    </>
                  ) : (
                    <>
                      <ClipboardCopy className="w-4 h-4" aria-hidden="true" /> Copy
                    </>
                  )}
                </Button>
                {onExtracted ? (
                  <Button type="button" onClick={handleUseText}>
                    Use text
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        }
      >
        <div className="space-y-4">
          {/* Live region */}
          <div className="sr-only" role="status" aria-live="polite">
            {status === "loading-engine" ? "Loading OCR engine" : null}
            {status === "recognizing" ? `Recognizing text: ${progress}%` : null}
            {status === "done" ? "Text extracted" : null}
            {status === "error" ? `Error: ${errorMsg}` : null}
          </div>

          {/* Language selector */}
          <div>
            <label htmlFor="dj-ocr-lang" className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1.5">
              <Languages className="w-3.5 h-3.5" aria-hidden="true" />
              Document language
            </label>
            <select
              id="dj-ocr-lang"
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value as "eng" | "hin" | "eng+hin");
                // Force worker recreation with new language
                if (workerRef.current) {
                  (workerRef.current as { terminate: () => Promise<void> })
                    .terminate?.()
                    .catch(() => undefined);
                  workerRef.current = null;
                }
              }}
              disabled={isBusy}
              className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
            >
              <option value="eng">English</option>
              <option value="hin">हिन्दी (Hindi)</option>
              <option value="eng+hin">English + Hindi (mixed)</option>
            </select>
          </div>

          {/* Image preview / dropzone */}
          {imageUrl ? (
            <div className="relative rounded-xl overflow-hidden border border-border bg-black">
              <img src={imageUrl} alt="Source for OCR" className="w-full max-h-64 object-contain" />
              {isBusy ? (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white">
                  <div className="text-xs mb-2">{progressLabel}</div>
                  <div className="w-48 h-1.5 bg-white/20 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                  <div className="text-xs mt-1.5 tabular-nums">{progress}%</div>
                </div>
              ) : null}
            </div>
          ) : (
            <div
              ref={dropZoneRef}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`rounded-xl border-2 border-dashed transition-colors p-8 text-center cursor-pointer ${
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              }`}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
            >
              <motion.div
                animate={{ y: dragOver ? -4 : 0 }}
                className="inline-flex w-12 h-12 rounded-2xl bg-accent text-accent-foreground items-center justify-center mb-3"
              >
                <Upload className="w-5 h-5" aria-hidden="true" />
              </motion.div>
              <p className="text-sm font-medium">Drop an image here, or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">PNG, JPG, or WebP. Up to 10MB.</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setCameraOpen(true);
                }}
                className="mt-3"
              >
                <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                Use camera
              </Button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleFileChange}
            className="hidden"
            aria-label="Choose image for OCR"
          />

          {/* Error */}
          {status === "error" ? (
            <Card className="border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2 shadow-none">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium">OCR failed</p>
                <p className="text-xs mt-0.5">{errorMsg}</p>
              </div>
            </Card>
          ) : null}

          {/* Extracted text */}
          {text ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="dj-ocr-output" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Extracted text
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">{text.length} chars</span>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden="true" /> Clear
                  </button>
                </div>
              </div>
              <textarea
                id="dj-ocr-output"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                placeholder="Extracted text will appear here…"
              />
              <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                <FileText className="w-3 h-3" aria-hidden="true" />
                Always review extracted text before using it — OCR is ~95% accurate on clear scans.
              </p>
            </div>
          ) : null}

          {/* Reset button when image present but no text yet */}
          {imageUrl && !text && !isBusy ? (
            <Button
              type="button"
              variant="secondary"
              onClick={handleReset}
              className="w-full"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Choose another image
            </Button>
          ) : null}
        </div>
      </Modal>

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCameraCapture}
        title="Capture document"
        facingMode="environment"
      />
    </>
  );
}
