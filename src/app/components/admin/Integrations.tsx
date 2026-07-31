import { useCallback, useEffect, useState } from "react";
import { Plug, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { healthCheck } from "../../../lib/api";
import {
  PageHeader,
  Card,
  LoadingState,
  EmptyState,
  btnClass,
} from "../common/AdminUI";

type Integration = {
  key: string;
  name: string;
  description: string;
  category: "ai" | "database" | "storage" | "communication" | "analytics";
};

const INTEGRATIONS: Integration[] = [
  {
    key: "supabase",
    name: "Supabase",
    description: "Postgres database, auth, storage, and RLS for all business data.",
    category: "database",
  },
  {
    key: "backend",
    name: "Dayjoy AI Backend (FastAPI)",
    description: "AI chat endpoint with RAG retrieval and safety filtering.",
    category: "ai",
  },
  {
    key: "openai",
    name: "OpenAI",
    description: "Fallback LLM provider when Groq is unavailable.",
    category: "ai",
  },
  {
    key: "groq",
    name: "Groq",
    description: "Primary LLM provider for low-latency streaming responses.",
    category: "ai",
  },
  {
    key: "knowledge-documents",
    name: "Knowledge Documents Storage",
    description: "Supabase Storage bucket for PDFs, images, and training materials.",
    category: "storage",
  },
  {
    key: "camera-capture",
    name: "Camera Capture (MediaDevices)",
    description: "In-browser camera for capturing product photos, documents, and ticket attachments.",
    category: "analytics",
  },
  {
    key: "qr-scanner",
    name: "QR Scanner (jsQR)",
    description: "Decode QR codes on product packaging, training cards, and tickets via device camera.",
    category: "analytics",
  },
  {
    key: "ocr",
    name: "OCR Document Scanner (Tesseract.js)",
    description: "Extract text from product labels and scanned docs. Supports English + Hindi.",
    category: "ai",
  },
  {
    key: "push-notifications",
    name: "Push Notifications (Web API + SW)",
    description: "OS-level notifications for ticket updates, training reminders, and AI completions.",
    category: "communication",
  },
  {
    key: "email",
    name: "Email Notifications",
    description: "Send ticket updates and lead confirmations to customers.",
    category: "communication",
  },
];

export function Integrations() {
  const [statuses, setStatuses] = useState<Record<string, boolean | null>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const next: Record<string, boolean | null> = {};
    next.supabase = !!supabase;
    next["knowledge-documents"] = !!supabase; // bucket lives in same project
    next.openai = Boolean(import.meta.env.VITE_API_BASE_URL); // proxy via backend
    next.groq = Boolean(import.meta.env.VITE_API_BASE_URL);
    next.email = false; // SMTP not yet wired (P3)
    // Client-side device capabilities — always available in modern browsers
    next["camera-capture"] =
      typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
    next["qr-scanner"] = true; // pure-JS jsQR library
    next["ocr"] = true; // Tesseract.js WASM
    next["push-notifications"] =
      typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
    try {
      next.backend = await healthCheck();
    } catch {
      next.backend = false;
    }
    setStatuses(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Integrations"
        description="Connect Dayjoy AI Assist with company systems and external providers."
        icon={<Plug className="w-5 h-5" />}
        actions={
          <button type="button" className={btnClass.secondary} onClick={refresh}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Test connections
          </button>
        }
      />

      {loading ? (
        <LoadingState label="Testing connections…" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {INTEGRATIONS.map((i) => {
            const status = statuses[i.key];
            return (
              <Card key={i.key}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{i.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{i.description}</p>
                    <p className="text-[11px] text-muted-foreground mt-2 uppercase tracking-wide">
                      {i.category}
                    </p>
                  </div>
                  <div className="shrink-0">
                    {status === null ? (
                      <span className="text-xs text-muted-foreground">Unknown</span>
                    ) : status ? (
                      <span className="inline-flex items-center gap-1 text-xs text-primary">
                        <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Connected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-destructive">
                        <XCircle className="w-4 h-4" aria-hidden="true" /> Offline
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="mt-6">
        <EmptyState
          title="Want to add another integration?"
          description="Slack, WhatsApp Business, HubSpot, Zendesk, and Twilio are common next steps. Contact the platform team to scope."
          icon={<Plug className="w-5 h-5" />}
        />
      </Card>
    </div>
  );
}
