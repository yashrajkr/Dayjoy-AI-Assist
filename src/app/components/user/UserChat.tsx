import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence } from "framer-motion";
import {
  Paperclip,
  ThumbsUp,
  ThumbsDown,
  Shield,
  ExternalLink,
  AlertTriangle,
  Phone,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  Pin,
  PinOff,
  Archive,
  Sparkles,
  Clock,
  Search,
  MessageSquarePlus,
  PanelRightOpen,
  PanelRightClose,
  Download,
  Share2,
  Camera,
  QrCode,
  FileText,
  Image as ImageIcon,
  ChevronUp,
  ArrowUp,
  ShieldCheck,
  Leaf,
  Rocket,
  ScrollText,
  BadgeCheck,
  X,
  Plus,
  History as HistoryIcon,
  Eye,
  FileDown,
  Maximize2,
  GitCompare,
  Menu,
  MoreVertical,
  type LucideIcon,
} from "lucide-react";
import { BRAND } from "../../lib/brand";
import { useAuth } from "../../lib/AuthContext";
import {
  listConversations,
  createConversation,
  renameConversation,
  deleteConversation,
  archiveConversation,
  pinConversation,
  listMessages,
  appendMessage,
  setMessageFeedback,
  deriveTitle,
  hasDefaultTitle,
  type Conversation,
  type ChatMessage,
} from "../../lib/chatStore";
import {
  streamChatWithBackend,
  generateConversationTitle,
  SessionExpiredError,
  type ChatSource,
} from "../../../lib/api";
import { KnowledgeSearchViz } from "../common/KnowledgeSearchViz";
import { VoiceControls } from "../voice/VoiceControls";
import { CameraCapture, type CapturedImage } from "../tools/CameraCapture";
import { QRScanner, type ScanResult } from "../tools/QRScanner";
import { OcrScanner } from "../tools/OcrScanner";
import { notifyAIResponseReady } from "../../lib/pushNotifications";
import { AccountMenu } from "../common/AccountMenu";
import { DayjoyLogo } from "../brand/DayjoyLogo";
import { NotificationCenter } from "../notifications/NotificationCenter";
import { ThemeToggle } from "../common/ThemeToggle";
import { Modal } from "../common/Modal";
import { useVoice } from "../../lib/useVoice";
import { isVoiceRepliesEnabled } from "../../lib/voicePreference";
import { useIsMobile } from "../../lib/useIsMobile";
import { useChatExperience } from "../../lib/ChatExperienceContext";
import { useTransparentLogo } from "../../lib/useTransparentLogo";
import logoSrc from "../../../assets/dayjoy-logo.png";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card } from "../ui/card";

// Lazy-load the 3D orb — heavy chunk (three.js + R3F)
const AIOrb = lazy(() =>
  import("../three/AIOrb").then((m) => ({ default: m.AIOrb })),
);

/** Time-based greeting. */
function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * Generate context-aware follow-up suggestions based on the assistant's
 * response and the sources it cited. These are heuristic (not LLM-generated)
 * to keep the UX instant and free of extra API calls.
 */
function generateFollowUps(answer: string, sources: unknown): string[] {
  const followUps: string[] = [];
  const lower = answer.toLowerCase();

  // Product-related follow-ups
  if (sources && Array.isArray(sources) && sources.length > 0) {
    const hasProducts = (sources as Array<{ table?: string }>).some((s) => s?.table === "products");
    if (hasProducts) {
      followUps.push("Compare this with similar products");
      followUps.push("What are the safety notes?");
    }
  }

  // Category-based follow-ups
  if (lower.includes("policy") || lower.includes("refund") || lower.includes("return")) {
    followUps.push("Where can I find the full policy document?");
  }
  if (lower.includes("training") || lower.includes("distributor")) {
    followUps.push("What training modules are available?");
    followUps.push("How do I become a distributor?");
  }
  if (lower.includes("safe") || lower.includes("safety") || lower.includes("usage")) {
    followUps.push("Are there any contraindications?");
  }
  if (lower.includes("ingredient") || lower.includes("benefit")) {
    followUps.push("Tell me about related products");
  }

  // Generic fallbacks — always offer at least 2 options
  if (followUps.length < 2) {
    followUps.push("Tell me more about this");
    followUps.push("Can you give me an example?");
  }

  return followUps.slice(0, 3);
}

type Lang = "English" | "Hindi" | "Hinglish";

/**
 * Suggested prompts — each tied to a Dayjoy-themed category with its own
 * accent color + lucide icon. This makes the welcome screen feel curated
 * rather than generic, and visually connects each card to the brand palette.
 */
type PromptCategory = "wellness" | "distributor" | "safety" | "policy";
const PROMPT_THEME: Record<PromptCategory, { icon: typeof Leaf; tint: string; ring: string }> = {
  wellness: { icon: Leaf, tint: "bg-primary/10 text-primary", ring: "group-hover:border-primary/40" },
  distributor: { icon: Rocket, tint: "bg-gold-accent/20 text-warning", ring: "group-hover:border-gold-accent/50" },
  safety: { icon: ShieldCheck, tint: "bg-secondary/10 text-secondary", ring: "group-hover:border-secondary/40" },
  policy: { icon: ScrollText, tint: "bg-accent text-accent-foreground", ring: "group-hover:border-primary/30" },
};

/**
 * A <textarea> placeholder renders on a single line — it cannot wrap, so a
 * long string is clipped mid-word on narrow screens rather than reflowed.
 * Keep this short; the full description lives on the textarea's aria-label.
 * (BRAND.shortName is already "Dayjoy AI", so naming Dayjoy again here would
 * read as "Ask Dayjoy AI ... about Dayjoy products".)
 */
const composerPlaceholder = `Ask ${BRAND.shortName} anything…`;

/** Attachments are inlined as data URLs, so keep them small. */
const MAX_ATTACHMENT_BYTES = 10_000_000;
const MAX_ATTACHMENTS = 5;

const SUGGESTED_PROMPTS: ReadonlyArray<{ title: string; text: string; category: PromptCategory }> = [
  {
    title: "Wellness products",
    text: "Which Dayjoy products support daily wellness and immunity?",
    category: "wellness",
  },
  {
    title: "Distributor onboarding",
    text: "What are the first 3 steps to start as a Dayjoy distributor?",
    category: "distributor",
  },
  {
    title: "Safety & usage",
    text: "Are there any products not recommended during pregnancy?",
    category: "safety",
  },
  {
    title: "Company policies",
    text: "What is the Dayjoy return and refund policy?",
    category: "policy",
  },
] as const;

/**
 * Role-aware welcome subtitle. Instead of one generic line, the user sees
 * a prompt tailored to their role — making the assistant feel personal.
 */
function getRoleWelcome(role: string | null | undefined): { label: string; cta: string } {
  switch (role) {
    case "customer":
      return { label: "Customer assistant", cta: "Ask me about products, usage, or policies." };
    case "distributor":
      return { label: "Distributor copilot", cta: "Get objection handling, training, and plan guidance." };
    case "leader":
      return { label: "Leader dashboard", cta: "Coach your team and track progress." };
    case "trainer":
      return { label: "Trainer assistant", cta: "Build quizzes, training modules, and certificates." };
    case "employee":
    case "support":
      return { label: "Staff assistant", cta: "Find policies, products, and ticket answers fast." };
    case "admin":
    case "management":
    case "super_admin":
      return { label: "Admin assistant", cta: "Manage knowledge, products, and analytics." };
    default:
      return { label: "AI Assistant", cta: "Trusted Dayjoy knowledge, on tap." };
  }
}

function sourceLabel(s: ChatSource | string): string {
  if (typeof s === "string") return s;
  return s.title || s.id || s.table;
}

function sourceKey(s: ChatSource | string, idx: number): string {
  if (typeof s === "string") return `${s}-${idx}`;
  return `${s.table}:${s.id}:${idx}`;
}

function sourceHref(s: ChatSource | string): string | undefined {
  if (typeof s === "string") return undefined;
  return s.url;
}

function formatTimestamp(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export function UserChat() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { currentUser, role } = useAuth();
  const isMobile = useIsMobile();
  const { mode: chatExperienceMode } = useChatExperience();
  // UserLayout only supplies this context on chat routes; other embeddings
  // (none currently) simply fall back to no-ops.
  const outletCtx = useOutletContext<{ openDrawer: () => void; professionalMobile: boolean } | undefined>();
  const professionalMobile = isMobile && chatExperienceMode === "professional";
  const transparentLogo = useTransparentLogo(logoSrc);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<Lang>("English");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sourcesPanelOpen, setSourcesPanelOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [findInChatOpen, setFindInChatOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatchIndex, setFindMatchIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [lastAssistantId, setLastAssistantId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");

  // Voice AI (Web Speech API — gracefully degrades if unsupported)
  const voice = useVoice(language === "Hindi" ? "hi" : "en");

  // ---- Tap-the-orb hands-free voice mode ----
  // Distinct from the composer's dictate-to-input mic (VoiceControls): this
  // is a continuous loop — tap the orb once to start, speak your question,
  // it's sent and answered in this same chat, and the mic re-opens
  // automatically once the answer finishes speaking. Tap again to end.
  // (Effects that drive this loop are defined after handleSend, below.)
  const [voiceMode, setVoiceMode] = useState(false);

  // Tools state: camera / QR / OCR modals + attach menu
  const [cameraOpen, setCameraOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ name: string; dataUrl: string; kind: "image" }>>([]);
  const attachMenuRef = useRef<HTMLDivElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sources panel: expanded preview state + attachment preview state
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [previewAttachment, setPreviewAttachment] = useState<{ name: string; dataUrl: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // Synchronous re-entrancy guard: `sending` state lags a render, so two taps
  // dispatched in the same tick both read it as false and both fire.
  const sendingRef = useRef(false);

  // Close attach menu on outside click
  useEffect(() => {
    if (!attachMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [attachMenuOpen]);

  // ---- Load conversations list ----
  const refreshConversations = useCallback(async () => {
    if (!currentUser) return;
    const list = await listConversations(currentUser.id);
    setConversations(list);
  }, [currentUser]);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  // ---- Track the active conversation record ----
  // Split out from the message loader on purpose: this depends on
  // `conversations`, which gets a fresh array identity after every send.
  // Keeping it separate means a refresh updates the header without
  // re-running the message fetch below.
  useEffect(() => {
    if (!chatId) {
      setActiveConv(null);
      return;
    }
    const conv = conversations.find((c) => c.id === chatId);
    // Only overwrite when found — a just-created conversation may not be in
    // the list yet, and clobbering it with null would blank the header.
    if (conv) setActiveConv(conv);
  }, [chatId, conversations]);

  // ---- Load active conversation messages ----
  // Keyed on `chatId` alone. Previously this also depended on `conversations`,
  // so `refreshConversations()` at the end of every send re-ran it and replaced
  // the freshly rendered transcript with a stale (or empty) DB snapshot —
  // the answer would be spoken aloud but vanish from the screen.
  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      setLastAssistantId(null);
      return;
    }
    // A send in flight owns `messages`; refetching here would race it.
    if (sendingRef.current) return;
    let cancelled = false;
    (async () => {
      const msgs = await listMessages(chatId);
      if (cancelled || sendingRef.current) return;
      setMessages(msgs);
      setLastAssistantId(
        [...msgs].reverse().find((m) => m.role === "assistant")?.id ?? null,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  // ---- Auto-focus the composer on a fresh "/" visit (no conversation
  // loaded yet), matching ChatGPT's "ready to type immediately" feel.
  // Scoped to a brand-new chat only — never fires when opening an existing
  // conversation (`/chat/:id`), so returning to read past messages doesn't
  // unexpectedly yank focus/scroll into the composer.
  // Note: most mobile browsers only open the on-screen keyboard in response
  // to a real user gesture (tap), not a programmatic .focus() from an
  // effect — this sets logical focus either way, but the OS keyboard may
  // not visibly pop until the user actually taps the field on mobile.
  useEffect(() => {
    if (!chatId) inputRef.current?.focus();
  }, [chatId]);

  // ---- Auto-scroll on new message / streaming token ----
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  // ---- Send message ----
  const handleSend = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      // Ref, not state: a rapid double/triple tap on a suggestion card
      // dispatches several calls before React commits `setSending(true)`.
      if (!text || sending || sendingRef.current) return;
      if (text.length > 4000) {
        setError("Message is too long (max 4000 characters).");
        return;
      }

      sendingRef.current = true;
      setError(null);
      setInput("");
      setStreamingText("");
      setSending(true);

      let convId = chatId ?? activeConv?.id;
      let conv: Conversation | null = activeConv;

      if (!convId) {
        if (!currentUser) {
          setError("Unable to start a conversation without a logged-in user.");
          sendingRef.current = false;
          setSending(false);
          return;
        }

        const createdConv = await createConversation(currentUser.id, "New conversation", language);
        if (!createdConv) {
          setError("Could not create a new conversation. Please try again.");
          sendingRef.current = false;
          setSending(false);
          return;
        }

        conv = createdConv;
        convId = createdConv.id;
        setConversations((prev) => [createdConv, ...prev]);
        setActiveConv(createdConv);
        navigate(`/chat/${createdConv.id}`);
      }

      const userMsg: ChatMessage = {
        conversation_id: convId ?? undefined,
        role: "user",
        content: text,
        safety_status: "safe",
        handoff_required: false,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // Build conversation history for multi-turn context (last 6 messages).
      // Passed to the backend so the LLM has multi-turn context.
      const history = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      void history; // used by backend via streamChatWithBackend conversation_id

      const controller = new AbortController();
      abortRef.current = controller;

      let assistantId: string | null = null;
      let aggregated = "";
      let sourcesSnapshot: ChatSource[] | string[] = [];
      let meta: {
        category?: string;
        safety_status?: string;
        handoff_required?: boolean;
        confidence?: number;
        verification_status?: "verified" | "partial" | "unverified";
        handoff_message?: string | null;
        rag_metadata?: unknown;
        answer_source?: string | null;
        web_search_provider?: string | null;
      } = {};

      try {
        const res = await streamChatWithBackend(
          {
            message: text,
            role: role ?? "customer",
            language,
            conversation_id: convId,
          },
          (chunk) => {
            aggregated += chunk;
            setStreamingText(aggregated);
          },
          controller.signal,
        );

        aggregated = res.answer || aggregated;
        sourcesSnapshot = res.sources;
        meta = {
          category: res.category,
          safety_status: res.safety_status,
          handoff_required: res.handoff_required,
          confidence: res.confidence,
          verification_status: res.verification_status,
          handoff_message: res.handoff_message,
          rag_metadata: res.rag_metadata,
          answer_source: res.answer_source,
          web_search_provider: res.web_search_provider,
        };

        const persisted = await appendMessage(convId!, {
          role: "user",
          content: text,
        });
        if (persisted?.id) {
          setMessages((prev) =>
            prev.map((m) =>
              m === userMsg ? { ...m, id: persisted.id, conversation_id: convId ?? undefined } : m,
            ),
          );
        }

        const assistantMsg = await appendMessage(convId!, {
          role: "assistant",
          content: aggregated,
          sources: sourcesSnapshot as unknown,
          safety_status: meta.safety_status ?? "safe",
          handoff_required: meta.handoff_required ?? false,
          confidence: meta.confidence ?? null,
          verification_status: meta.verification_status ?? null,
          handoff_message: meta.handoff_message ?? null,
          rag_metadata: meta.rag_metadata ?? null,
          answer_source: meta.answer_source ?? null,
        });

        // The answer must always render, even if the Supabase write above
        // failed (network blip, RLS, etc.) — fall back to a locally-built
        // message so the reply never silently vanishes after streaming.
        assistantId = assistantMsg?.id ?? null;
        const displayedAssistantMsg: ChatMessage =
          (assistantMsg as ChatMessage | null) ?? {
            conversation_id: convId ?? undefined,
            role: "assistant",
            content: aggregated,
            sources: sourcesSnapshot as unknown,
            safety_status: meta.safety_status ?? "safe",
            handoff_required: meta.handoff_required ?? false,
            confidence: meta.confidence ?? null,
            verification_status: meta.verification_status ?? null,
            handoff_message: meta.handoff_message ?? null,
            rag_metadata: meta.rag_metadata ?? null,
            answer_source: meta.answer_source ?? null,
            created_at: new Date().toISOString(),
            _unsaved: !assistantMsg,
          };
        setMessages((prev) => [...prev, displayedAssistantMsg]);
        setLastAssistantId(assistantId);
        // Auto-speak the response only inside hands-free Voice mode — a
        // normal typed chat shouldn't read every answer aloud. Previously
        // this fired unconditionally whenever TTS was available, so every
        // text message got spoken too.
        if (voiceMode && voice.ttsSupported && !voice.muted && aggregated) {
          voice.speak(aggregated);
        }

        // Auto-title the conversation from the opening question.
        // `deriveTitle` (a truncated first message) is applied immediately so
        // the sidebar is never blank, then upgraded to a short summarized
        // title if the backend can produce one.
        if (conv && hasDefaultTitle(conv.title)) {
          const convIdForTitle = conv.id!;
          const fallbackTitle = deriveTitle(text);
          const applyTitle = (title: string) => {
            setConversations((prev) =>
              prev.map((c) => (c.id === convIdForTitle ? { ...c, title } : c)),
            );
            setActiveConv((prev) =>
              prev && prev.id === convIdForTitle ? { ...prev, title } : prev,
            );
          };

          applyTitle(fallbackTitle);
          await renameConversation(convIdForTitle, fallbackTitle);

          const summarized = await generateConversationTitle(text);
          if (summarized && summarized !== fallbackTitle) {
            applyTitle(summarized);
            await renameConversation(convIdForTitle, summarized);
          }
        }

        await refreshConversations();
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          // User pressed stop — keep what we have, even if persistence fails.
          if (aggregated && convId) {
            const stoppedContent = aggregated + "\n\n_⃠ Generation stopped by user._";
            const m = await appendMessage(convId!, {
              role: "assistant",
              content: stoppedContent,
              safety_status: "safe",
              handoff_required: false,
            });
            // Show the partial answer even if it failed to persist.
            setMessages((prev) => [
              ...prev,
              (m as ChatMessage | null) ?? {
                conversation_id: convId ?? undefined,
                role: "assistant",
                content: stoppedContent,
                safety_status: "safe",
                handoff_required: false,
                created_at: new Date().toISOString(),
                _unsaved: true,
              },
            ]);
          }
        } else if (e instanceof SessionExpiredError) {
          // No/expired Supabase session — sending would otherwise 401 with an
          // opaque "Authentication required" and leave the user stuck here.
          setError(e.message);
          navigate("/login");
        } else {
          console.error("[chat] send failed", e);
          setError(
            e instanceof Error
              ? e.message
              : "Failed to get a response. Please try again.",
          );
        }
      } finally {
        sendingRef.current = false;
        setSending(false);
        setStreamingText("");
        abortRef.current = null;
        inputRef.current?.focus();
        // Notify the user that the AI response is ready (respects their push opt-in).
        // Useful when they switched tabs while a long RAG query was streaming.
        void notifyAIResponseReady();
      }
    },
    [activeConv, currentUser, input, language, messages, navigate, refreshConversations, role, voiceMode],
  );

  const toggleVoiceMode = useCallback(() => {
    if (voiceMode) {
      voice.stopListening();
      voice.stopSpeaking();
      setVoiceMode(false);
    } else if (voice.sttSupported) {
      setVoiceMode(true);
      voice.startListening();
    }
  }, [voiceMode, voice]);

  // Finalized speech -> send as a normal chat message, same as typing + Enter.
  useEffect(() => {
    if (voiceMode && voice.transcript) {
      const text = voice.transcript;
      voice.clearTranscript();
      void handleSend(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceMode, voice.transcript]);

  // Barge-in: the instant the AI starts speaking, open a passive mic
  // alongside it — like ChatGPT's voice mode, the user can just start
  // talking to interrupt instead of tapping anything first. useVoice cuts
  // TTS the moment it hears real speech; if it hears nothing this cycle
  // ends on its own and this effect reopens it on the next render (browser
  // recognizers don't stay open indefinitely).
  useEffect(() => {
    if (!voiceMode || !voice.sttSupported) return;
    if (!voice.speaking || voice.listening) return;
    voice.startBargeInListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceMode, voice.speaking, voice.listening, voice.sttSupported]);

  // Hands-free loop: once the spoken answer finishes and nothing else is in
  // flight, re-open the mic automatically so the conversation keeps going
  // without another tap.
  useEffect(() => {
    if (!voiceMode || !voice.sttSupported) return;
    if (voice.listening || voice.speaking || sending || streamingText) return;
    const t = window.setTimeout(() => voice.startListening(), 500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceMode, voice.listening, voice.speaking, sending, streamingText, voice.sttSupported]);

  // Leaving the page mid-voice-mode shouldn't leave the mic running.
  useEffect(() => {
    return () => {
      if (voiceMode) {
        voice.stopListening();
        voice.stopSpeaking();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Stop generation ----
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ---- Tools: camera capture → attachment ----
  const handleCameraCapture = useCallback((img: CapturedImage) => {
    setAttachments((prev) => [
      ...prev,
      { name: img.file.name, dataUrl: img.dataUrl, kind: "image" as const },
    ]);
    setCameraOpen(false);
    // Pre-fill the composer with a context prompt
    setInput((prev) =>
      prev.trim()
        ? `${prev}\n\n[Attached photo: ${img.file.name}]`
        : `I'm attaching a photo of ${img.file.name.includes("capture") ? "a product/document" : img.file.name}. Please help me understand it.`,
    );
    inputRef.current?.focus();
  }, []);

  // ---- Tools: pick images/files from the device ----
  // The attach menu previously offered only camera/QR/OCR, so there was no
  // way to send something already saved on the device.
  const handleFilesPicked = useCallback((fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    const tooLarge = files.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooLarge.length > 0) {
      setError(
        `${tooLarge.map((f) => f.name).join(", ")} exceeds the ${Math.round(
          MAX_ATTACHMENT_BYTES / 1_000_000,
        )}MB limit and was not attached.`,
      );
    }

    const accepted = files
      .filter((f) => f.size <= MAX_ATTACHMENT_BYTES)
      .slice(0, MAX_ATTACHMENTS);
    if (accepted.length === 0) return;

    accepted.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        if (!dataUrl) return;
        setAttachments((prev) =>
          prev.length >= MAX_ATTACHMENTS
            ? prev
            : [...prev, { name: file.name, dataUrl, kind: "image" as const }],
        );
      };
      reader.onerror = () => setError(`Could not read ${file.name}.`);
      reader.readAsDataURL(file);
    });

    setInput((prev) => {
      const names = accepted.map((f) => f.name).join(", ");
      return prev.trim()
        ? `${prev}\n\n[Attached: ${names}]`
        : `I'm attaching ${names}. Please help me understand it.`;
    });
    inputRef.current?.focus();
  }, []);

  // ---- Tools: QR scan → paste into composer ----
  const handleQrScan = useCallback((res: ScanResult) => {
    setQrOpen(false);
    const text = res.text;
    // If it's a Dayjoy product URL or contains a product code, surface a relevant prompt.
    const isUrl = /^https?:\/\//i.test(text);
    const prompt = isUrl
      ? `I scanned a QR code that links to: ${text}\n\nWhat is this about?`
      : `I scanned a QR code with this content:\n${text}\n\nPlease help me understand it.`;
    setInput((prev) => (prev.trim() ? `${prev}\n\n${prompt}` : prompt));
    inputRef.current?.focus();
  }, []);

  // ---- Tools: OCR → paste extracted text into composer ----
  const handleOcrExtracted = useCallback((text: string) => {
    setOcrOpen(false);
    const prompt = `I extracted this text from an image using OCR:\n\n"""\n${text}\n"""\n\nPlease help me understand what this is and answer any questions about it.`;
    setInput((prev) => (prev.trim() ? `${prev}\n\n${prompt}` : prompt));
    inputRef.current?.focus();
  }, []);

  // ---- Remove attachment ----
  const handleRemoveAttachment = useCallback((idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // ---- Sources panel: download all citations as text file ----
  // (Defined after lastAssistant/lastSources declarations — see below)

  // ---- Sources panel: toggle expanded preview for a source ----
  const toggleSourcePreview = useCallback((key: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // ---- Sources panel: download a single attachment ----
  const handleDownloadAttachment = useCallback((att: { name: string; dataUrl: string }) => {
    const a = document.createElement("a");
    a.href = att.dataUrl;
    a.download = att.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  // ---- Regenerate last assistant response ----
  const handleRegenerate = useCallback(async () => {
    if (!activeConv || messages.length === 0) return;
    // Find the last user message that precedes an assistant message
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) return;
    const lastUserText = messages[lastUserIdx].content;
    // Drop trailing assistant messages after that user msg
    setMessages((prev) => prev.slice(0, lastUserIdx + 1));
    setInput("");
    await handleSend(lastUserText);
  }, [activeConv, messages, handleSend]);

  // ---- Feedback ----
  const handleFeedback = useCallback(
    async (messageId: string | undefined, rating: "up" | "down") => {
      if (!messageId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                feedback: m.feedback === rating ? null : rating,
              }
            : m,
        ),
      );
      const msg = messages.find((m) => m.id === messageId);
      if (msg?.feedback === rating) {
        // Toggle off
        await setMessageFeedback(messageId, "up"); // backend treats null as no-op
      } else {
        await setMessageFeedback(messageId, rating);
      }
    },
    [messages],
  );

  // ---- Copy ----
  const handleCopy = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // ignore
    }
  }, []);

  // ---- Conversation actions ----
  const handleNewChat = useCallback(() => {
    setActiveConv(null);
    setMessages([]);
    setStreamingText("");
    setError(null);
    navigate("/");
    setSidebarOpen(false);
    inputRef.current?.focus();
  }, [navigate]);

  const handleSelect = useCallback(
    (id: string) => {
      navigate(`/chat/${id}`);
      setSidebarOpen(false);
    },
    [navigate],
  );

  const RENAME_TITLE_MAX_LEN = 80;
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameRegenerating, setRenameRegenerating] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const openRename = useCallback((id: string, currentTitle: string) => {
    setRenameTargetId(id);
    setRenameValue(currentTitle ?? "");
    setRenameError(null);
    setRenameRegenerating(false);
  }, []);

  const closeRename = useCallback(() => {
    if (renameSaving || renameRegenerating) return;
    setRenameTargetId(null);
    setRenameValue("");
    setRenameError(null);
  }, [renameSaving, renameRegenerating]);

  // Manual rename always wins: this is the only place `chat_conversations.title`
  // is written outside the once-only auto-title flow, and it's user-initiated
  // either way (typed by hand or accepted after "Regenerate with AI").
  const submitRename = useCallback(async () => {
    const id = renameTargetId;
    const next = renameValue.trim();
    if (!id) return;
    if (!next) {
      setRenameError("Title can't be empty.");
      return;
    }
    if (next.length > RENAME_TITLE_MAX_LEN) {
      setRenameError(`Title must be ${RENAME_TITLE_MAX_LEN} characters or fewer.`);
      return;
    }
    setRenameSaving(true);
    setRenameError(null);
    try {
      await renameConversation(id, next);
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: next } : c)));
      setActiveConv((prev) => (prev && prev.id === id ? { ...prev, title: next } : prev));
      setRenameTargetId(null);
      setRenameValue("");
    } finally {
      setRenameSaving(false);
    }
  }, [renameTargetId, renameValue]);

  const regenerateRenameTitle = useCallback(async () => {
    if (!renameTargetId) return;
    setRenameRegenerating(true);
    setRenameError(null);
    try {
      const msgs = await listMessages(renameTargetId);
      const firstUserMessage = msgs.find((m) => m.role === "user")?.content;
      if (!firstUserMessage) {
        setRenameError("This conversation has no messages to summarize yet.");
        return;
      }
      const title = await generateConversationTitle(firstUserMessage);
      if (title) {
        setRenameValue(title);
      } else {
        setRenameError("Couldn't generate a title right now. Try again, or edit it manually.");
      }
    } finally {
      setRenameRegenerating(false);
    }
  }, [renameTargetId]);

  const handlePin = useCallback(async (id: string, pinned: boolean) => {
    await pinConversation(id, pinned);
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned } : c)),
    );
  }, []);

  const handleArchive = useCallback(async (id: string, archived: boolean) => {
    await archiveConversation(id, archived);
    setConversations((prev) => prev.filter((c) => c.id !== id || !archived));
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this conversation? This cannot be undone.")) return;
      await deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConv?.id === id) handleNewChat();
    },
    [activeConv, handleNewChat],
  );

  // ---- Keyboard: Enter to send, Shift+Enter for newline ----
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // ---- Export conversation (print-to-PDF via browser) ----
  const handleExportConversation = useCallback(() => {
    const title = activeConv?.title ?? "Conversation";
    const lines: string[] = [
      `<html><head><title>${title}</title>`,
      `<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#2A2019}h1{color:#DD6B3D}.msg{margin:16px 0;padding:12px;border-radius:8px}.user{background:#FBE7D8}.ai{background:#F3EAD8}.role{font-weight:600;font-size:12px;color:#7A6D63;margin-bottom:4px}.ts{font-size:10px;color:#999}.src{font-size:11px;color:#666;margin-top:8px}</style>`,
      `</head><body>`,
      `<h1>${BRAND.name}</h1>`,
      `<p style="color:#7A6D63">Conversation: ${title}</p>`,
      `<hr/>`,
    ];
    for (const m of messages) {
      const role = m.role === "user" ? "You" : BRAND.name;
      const ts = m.created_at ? new Date(m.created_at).toLocaleString() : "";
      const cls = m.role === "user" ? "user" : "ai";
      lines.push(
        `<div class="msg ${cls}"><div class="role">${role} <span class="ts">${ts}</span></div><div>${m.content.replace(/\n/g, "<br/>")}</div></div>`,
      );
    }
    lines.push(`<hr/><p style="font-size:11px;color:#999">Exported from ${BRAND.name} on ${new Date().toLocaleString()}</p>`);
    lines.push(`</body></html>`);
    const blob = new Blob([lines.join("\n")], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    // A real file download via a temporary <a download>, not window.open()
    // + print(). The popup-and-print-dialog approach silently produced no
    // file on mobile browsers (many block or ignore programmatic print()
    // on a page they didn't navigate to directly), even though the button
    // was labeled "Export as PDF". This always saves a file the user can
    // open, print, or convert themselves.
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(activeConv?.title ?? "conversation").replace(/[^\w\- ]+/g, "").trim() || "conversation"}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [activeConv, messages]);

  // ---- Share conversation (copy link to clipboard) ----
  const handleShareConversation = useCallback(() => {
    if (!activeConv?.id) return;
    const shareUrl = `${window.location.origin}/chat/${activeConv.id}`;
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setError(null);
        // Brief visual feedback — reuse the error state with a success message
        // (simplest approach without adding new state)
        setCopiedId("share-" + activeConv.id);
        setTimeout(() => setCopiedId(null), 2000);
      })
      .catch(() => {
        setError("Could not copy link to clipboard.");
      });
  }, [activeConv]);

  const filteredConversations = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter((c) => c.title?.toLowerCase().includes(q));
  }, [conversations, search]);

  const lastAssistant = useMemo(() => {
    return [...messages].reverse().find((m) => m.role === "assistant");
  }, [messages]);

  const lastSources: (ChatSource | string)[] = useMemo(() => {
    if (!lastAssistant?.sources) return [];
    if (Array.isArray(lastAssistant.sources)) {
      return lastAssistant.sources as (ChatSource | string)[];
    }
    return [];
  }, [lastAssistant]);

  // ---- Sources panel: download all citations as text file ----
  const handleDownloadSources = useCallback(() => {
    if (lastSources.length === 0 && !lastAssistant) return;
    const lines: string[] = [];
    lines.push(`${BRAND.name} — Sources & Citations`);
    lines.push("=".repeat(50));
    lines.push("");
    lines.push(`Conversation: ${activeConv?.title ?? "New conversation"}`);
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push("");
    lines.push("AI Response:");
    lines.push("-".repeat(50));
    lines.push(lastAssistant?.content ?? "(no response)");
    lines.push("");
    lines.push("Cited Sources:");
    lines.push("-".repeat(50));
    if (lastSources.length === 0) {
      lines.push("(no sources cited)");
    } else {
      lastSources.forEach((s, idx) => {
        const num = idx + 1;
        if (typeof s === "string") {
          lines.push(`${num}. ${s}`);
        } else {
          lines.push(`${num}. [${s.table}] ${s.title ?? s.id}`);
          if (s.id) lines.push(`   ID: ${s.id}`);
          if (s.url) lines.push(`   URL: ${s.url}`);
        }
        lines.push("");
      });
    }
    if (lastAssistant?.confidence != null) {
      lines.push(`Confidence: ${Math.round((lastAssistant.confidence ?? 0) * 100)}%`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dayjoy-sources-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [activeConv, lastAssistant, lastSources]);

  return (
    <div className="flex h-full min-h-0 bg-background">
      {/* Skip link */}
      <a
        href="#dj-chat-input"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to chat input
      </a>

      {/* ============================= Sidebar (chat list) — slide-out drawer ============================= */}
      {/* Converted from permanent sidebar to overlay drawer so it doesn't double up
          with the UserLayout's nav sidebar. Opens via the menu button in the chat header. */}
      <AnimatePresence>
      {sidebarOpen ? (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <motion.aside
            initial={{ x: "-100%", scale: 0.97, boxShadow: "0 0 0 rgba(0,0,0,0)" }}
            animate={{
              x: 0,
              scale: 1,
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.3)",
              transition: { type: "spring", stiffness: 320, damping: 32 },
            }}
            exit={{
              x: "-100%",
              scale: 0.98,
              boxShadow: "0 0 0 rgba(0,0,0,0)",
              transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] },
            }}
            className="fixed top-0 left-0 z-50 h-full w-80 sm:w-96 bg-card border-r border-border shadow-2xl flex flex-col"
            aria-label="Conversation history"
          >
        {/* Brand header — gives the sidebar instant brand presence */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <DayjoyLogo variant="mark" size={26} />
            <div className="min-w-0">
              <p className="text-xs font-semibold truncate leading-tight">{BRAND.name}</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Personal AI assistant</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(false)}
            className="h-auto w-auto p-1.5"
            aria-label="Close conversation history"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="p-3 border-b border-border">
          <Button
            type="button"
            onClick={handleNewChat}
            className="w-full gap-2 rounded-xl py-2.5"
          >
            <MessageSquarePlus className="w-4 h-4" aria-hidden="true" />
            New conversation
          </Button>
        </div>
        <div className="p-3 border-b border-border">
          <label htmlFor="dj-chat-search" className="sr-only">
            Search conversations
          </label>
          <div className="relative">
            <Search
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              id="dj-chat-search"
              type="search"
              placeholder="Search conversations"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-colors"
            />
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin" aria-label="Conversations">
          {filteredConversations.length === 0 ? (
            <div className="text-center py-10 px-4">
              <div className="inline-flex w-10 h-10 rounded-xl bg-accent/60 items-center justify-center mb-2">
                <MessageSquarePlus className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium">No conversations yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Start a new chat to ask your first question.
              </p>
            </div>
          ) : (
            filteredConversations.map((c) => {
              const isActive = c.id === chatId;
              return (
                <div
                  key={c.id}
                  className={`group relative rounded-lg border transition-colors ${
                    isActive
                      ? "border-primary/30 bg-primary/5"
                      : "border-transparent hover:bg-accent/40"
                  }`}
                >
                  {/* Active left bar */}
                  {isActive ? (
                    <span
                      className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full bg-primary"
                      aria-hidden="true"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleSelect(c.id!)}
                    className="w-full text-left px-3 py-2 flex items-start gap-2"
                  >
                    {c.pinned ? (
                      <Pin className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" aria-hidden="true" />
                    ) : null}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{c.title}</span>
                      {c.updated_at ? (
                        <span className="block text-[11px] text-muted-foreground">
                          {formatTimestamp(c.updated_at)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  <div className="flex items-center justify-end gap-1 px-2 pb-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-lg:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => handlePin(c.id!, !c.pinned)}
                      className="p-1 rounded hover:bg-background"
                      aria-label={c.pinned ? "Unpin conversation" : "Pin conversation"}
                      title={c.pinned ? "Unpin" : "Pin"}
                    >
                      {c.pinned ? (
                        <PinOff className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <Pin className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => openRename(c.id!, c.title)}
                      className="p-1 rounded hover:bg-background"
                      aria-label="Rename conversation"
                      title="Rename"
                    >
                      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleArchive(c.id!, true)}
                      className="p-1 rounded hover:bg-background"
                      aria-label="Archive conversation"
                      title="Archive"
                    >
                      <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id!)}
                      className="p-1 rounded hover:bg-background text-destructive"
                      aria-label="Delete conversation"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </nav>
          </motion.aside>
        </>
      ) : null}
      </AnimatePresence>

      {/* ============================= Chat area ============================= */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Professional-mode mobile header — the ONLY header rendered below
            the `lg` breakpoint when Professional mode is on (UserLayout's own
            mobile top bar steps aside for this route, see useChatOwnHeader).
            Deliberately minimal: hamburger, title, new chat, conversation
            options — everything else (notifications, theme, profile, export,
            language, sources) lives one tap away in the drawer / options menu
            / profile menu instead of being permanently on screen. */}
        {professionalMobile ? (
          <header className="lg:hidden flex items-center justify-between gap-2 px-3 h-14 border-b border-border bg-card/80 backdrop-blur-sm shrink-0">
            <button
              type="button"
              onClick={() => outletCtx?.openDrawer()}
              className="flex items-center justify-center w-9 h-9 rounded-full bg-accent/60 text-foreground hover:bg-accent active:scale-90 transition-all"
              aria-label="Open navigation"
            >
              <Menu className="w-4.5 h-4.5" aria-hidden="true" />
            </button>
            {/* Logo + "Dayjoy AI Assist" wordmark, centered — the chat
                screen's own brand moment. No profile avatar here: this is
                the one page in the app that's deliberately chat-first with
                no account chrome in its header; profile is still reachable
                from the hamburger drawer, and from every other page's
                header/mobile top bar as before. */}
            <div className="flex-1 min-w-0 flex items-center justify-center px-1">
              <DayjoyLogo variant="full" size={22} />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleNewChat}
                disabled={!activeConv && messages.length === 0}
                className="flex items-center justify-center w-9 h-9 rounded-full bg-accent/60 text-foreground hover:bg-accent active:scale-90 transition-all disabled:opacity-40"
                aria-label="Start new chat"
                title="New chat"
              >
                <MessageSquarePlus className="w-4.5 h-4.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setMoreMenuOpen(true)}
                className="flex items-center justify-center w-9 h-9 rounded-full bg-accent/60 text-foreground hover:bg-accent active:scale-90 transition-all"
                aria-label="Conversation options"
                aria-haspopup="menu"
              >
                <MoreVertical className="w-4.5 h-4.5" aria-hidden="true" />
              </button>
            </div>
          </header>
        ) : null}

        {/* Chat header — branded with logo mark + trust badge. Full controls;
            on mobile in Professional mode this is replaced by the minimal
            header above (still rendered for lg+ / Explorer mode). */}
        <header
          className={`${professionalMobile ? "hidden lg:flex" : "flex"} items-center justify-between gap-2 sm:gap-3 px-3 sm:px-6 py-2.5 sm:py-3 border-b border-border bg-card/80 backdrop-blur-sm flex-nowrap`}
        >
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 overflow-hidden">
            {/* Conversation history toggle — opens the slide-out drawer */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
              className={`relative h-auto w-auto p-2 ${
                sidebarOpen ? "bg-accent/60 text-primary" : "text-muted-foreground"
              }`}
              aria-label="Open conversation history"
              title="Conversation history"
            >
              <HistoryIcon className="w-5 h-5" aria-hidden="true" />
              {conversations.length > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                  {conversations.length > 99 ? "99+" : conversations.length}
                </span>
              ) : null}
            </Button>
            {/* Always-visible New chat action — previously the only way to
                start fresh was re-clicking "AI Chat" in the main sidebar
                (a second nav layer away on mobile). Matches the one-tap
                "new chat" pattern of ChatGPT/Claude/etc. */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleNewChat}
              disabled={!activeConv && messages.length === 0}
              className="h-auto w-auto p-2 text-muted-foreground disabled:opacity-40"
              aria-label="Start new chat"
              title="New chat"
            >
              <MessageSquarePlus className="w-5 h-5" aria-hidden="true" />
            </Button>
            <div className="flex flex-col min-w-0">
              <h2 className="text-sm sm:text-base font-semibold truncate leading-tight">
                {activeConv?.title ?? "New conversation"}
              </h2>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground min-w-0">
                {activeConv ? (
                  <span className="inline-flex items-center gap-1 truncate">
                    <Clock className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{formatTimestamp(activeConv.updated_at ?? activeConv.created_at)}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-primary font-medium truncate">
                    <ShieldCheck className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">Answers from approved knowledge</span>
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {activeConv ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleExportConversation}
                  className="h-auto w-auto p-2 hidden sm:inline-flex"
                  aria-label="Export conversation as PDF"
                  title="Export as PDF"
                >
                  <Download className="w-4 h-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleShareConversation}
                  className="h-auto w-auto p-2 hidden sm:inline-flex"
                  aria-label={
                    copiedId === `share-${activeConv.id}` ? "Link copied" : "Share conversation link"
                  }
                  title={copiedId === `share-${activeConv.id}` ? "Link copied!" : "Share link"}
                >
                  {/* Previously this set `copiedId` but nothing ever read that
                      exact value, so clicking Share had zero visible
                      feedback — a silent clipboard write that looked broken. */}
                  {copiedId === `share-${activeConv.id}` ? (
                    <Check className="w-4 h-4 text-primary" aria-hidden="true" />
                  ) : (
                    <Share2 className="w-4 h-4" aria-hidden="true" />
                  )}
                </Button>
              </>
            ) : null}
            <label htmlFor="dj-chat-language" className="sr-only">
              Response language
            </label>
            <select
              id="dj-chat-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as Lang)}
              className="hidden sm:block text-xs sm:text-sm border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
            >
              <option value="English">English</option>
              <option value="Hindi">हिन्दी</option>
              <option value="Hinglish">Hinglish</option>
            </select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSourcesPanelOpen((v) => !v)}
              className={`relative h-auto w-auto p-2 ${
                sourcesPanelOpen ? "bg-accent/60 text-primary" : "text-muted-foreground"
              }`}
              aria-label={sourcesPanelOpen ? "Close sources panel" : "Open sources panel"}
              aria-expanded={sourcesPanelOpen}
              title={sourcesPanelOpen ? "Close sources" : "View sources & related"}
            >
              {sourcesPanelOpen ? (
                <PanelRightClose className="w-5 h-5" aria-hidden="true" />
              ) : (
                <PanelRightOpen className="w-5 h-5" aria-hidden="true" />
              )}
              {/* Badge — shows source count when available, hidden when panel open */}
              {!sourcesPanelOpen && lastSources.length > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                  {lastSources.length}
                </span>
              ) : null}
            </Button>
            <div className="w-px h-6 bg-border mx-0.5 hidden sm:block" aria-hidden="true" />
            <NotificationCenter />
            <ThemeToggle />
            {/* Profile avatar shows on laptop/desktop (lg+) only — mobile
                never gets one on the chat page, matching AppHeader.tsx's
                own `hidden lg:inline-flex` avatar everywhere else. This
                header block can also render on mobile when Explorer mode
                is on, so the breakpoint guard (not just the mobile-
                Professional header's simple omission above) is what
                actually keeps mobile avatar-free in every mode. */}
            <div className="hidden lg:inline-flex">
              <AccountMenu />
            </div>
          </div>
        </header>

        {/* Messages */}
        <div
          ref={scrollRef}
          // overflow-x-hidden: the orb's halo glow below uses a negative
          // margin to bleed past its own box for a soft radial fade, which
          // was wide enough to push this container past the viewport on
          // narrow phones and surface a stray horizontal scrollbar that
          // scrolled nothing.
          className="flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-6 py-6"
          aria-live="polite"
          aria-relevant="additions text"
        >
          <div className="max-w-3xl mx-auto space-y-5">
            {messages.length === 0 && !streamingText ? (
              <div className="py-3 sm:py-12 text-center">
                {/* Hero — orb + brand mark, layered for depth */}
                <div className="relative flex justify-center mb-3 sm:mb-5">
                  {/* Soft mesh halo behind the orb */}
                  <div
                    className="absolute inset-0 -m-8 rounded-full opacity-60 pointer-events-none"
                    aria-hidden="true"
                    style={{
                      background:
                        "radial-gradient(circle at 50% 50%, rgba(var(--primary-rgb), 0.18) 0%, rgba(var(--gold-accent-rgb), 0.10) 40%, transparent 70%)",
                      filter: "blur(20px)",
                    }}
                  />
                  {/* AIOrb takes a fixed pixel size, so scale it down on
                      narrow phones — 140px plus the halo eats ~40% of a
                      360px viewport. The wrapper height matches the scaled
                      box so no dead space is left behind.
                      Tappable: starts hands-free voice mode (speak your
                      question, hear the answer, mic re-opens automatically)
                      — tap again, or the mic button in the composer, to end. */}
                  <button
                    type="button"
                    onClick={toggleVoiceMode}
                    disabled={!voice.sttSupported || !isVoiceRepliesEnabled()}
                    className="relative h-[100px] sm:h-[140px] origin-top scale-[0.714] sm:scale-100 rounded-full disabled:cursor-default focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30"
                    aria-label={
                      voiceMode
                        ? "Voice mode active — tap to end"
                        : !isVoiceRepliesEnabled()
                          ? "Voice is disabled — enable it in Settings to talk"
                          : voice.sttSupported
                            ? "Tap to start voice conversation"
                            : "Voice input is not supported in this browser"
                    }
                    aria-pressed={voiceMode}
                  >
                    {/* AIOrb always renders at its true 140px size (the
                        `sm:h-140` / `h-100` on the button above is a layout
                        flow trick, so the *scaled-down* box is what reserves
                        space in the page — not the orb's real size). The
                        badge below must center against that real 140x140
                        box, not the button's shorter mobile layout height,
                        or the CSS transform ends up scaling the badge toward
                        a different point than the orb's actual center. */}
                    <div className="relative w-[140px] h-[140px]">
                      <Suspense
                        fallback={
                          <div className="w-32 h-32 rounded-full bg-primary/10 animate-pulse-glow flex items-center justify-center">
                            <Sparkles className="w-7 h-7 text-primary" aria-hidden="true" />
                          </div>
                        }
                      >
                        <AIOrb
                          state={
                            sending
                              ? "thinking"
                              : streamingText
                                ? "answering"
                                : voice.listening
                                  ? "listening"
                                  : "idle"
                          }
                          size={140}
                        />
                      </Suspense>
                      {/* Brand mark centered on the orb — a static badge over
                          the shader sphere rather than a texture baked into
                          it, so the noise/breathing animation is untouched. */}
                      {transparentLogo ? (
                        <img
                          src={transparentLogo}
                          alt=""
                          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 sm:w-16 sm:h-16 object-contain pointer-events-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.25)]"
                        />
                      ) : null}
                    </div>
                  </button>
                </div>
                {voice.sttSupported && isVoiceRepliesEnabled() ? (
                  <p className="text-xs text-muted-foreground -mt-1 mb-2" aria-live="polite">
                    {voiceMode
                      ? voice.listening
                        ? "Listening… tap the orb or the mic below to stop"
                        : voice.speaking
                          ? "Speaking…"
                          : "Voice mode on — tap the orb or the mic below to stop"
                      : "Tap the orb to talk"}
                  </p>
                ) : null}

                {/* Role-aware pill badge — an internal-sounding label
                    ("Customer assistant") that repeats what the header
                    ("Dayjoy AI") already says. Kept for Explorer/desktop,
                    dropped in Professional mobile for a cleaner welcome
                    state — see item 10 of the UX pass this addresses. */}
                {!professionalMobile ? (
                  (() => {
                    const welcome = getRoleWelcome(role);
                    return (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/8 border border-primary/15 text-[11px] font-medium text-primary mb-3"
                      >
                        <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" />
                        {welcome.label}
                      </motion.div>
                    );
                  })()
                ) : null}

                <motion.h1
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.05 }}
                  className="text-2xl sm:text-3xl font-semibold mb-1 tracking-tight"
                >
                  <span className="text-gradient">{getGreeting()}</span>
                  <span className="text-foreground">
                    {currentUser?.user_metadata?.full_name
                      ? `, ${String(currentUser.user_metadata.full_name).split(" ")[0]}`
                      : ""}
                  </span>
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.1 }}
                  className="text-sm sm:text-base text-muted-foreground mb-2 max-w-md mx-auto"
                >
                  {professionalMobile ? "How can I help you today?" : getRoleWelcome(role).cta}
                </motion.p>

                {/* Trust signals — condensed to one subtle line in
                    Professional mobile instead of three competing badges;
                    also no longer claims a specific fabricated record count
                    (was a hardcoded "57", never sourced from the backend). */}
                {professionalMobile ? (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.4, delay: 0.15 }}
                    className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground mb-7"
                  >
                    <ShieldCheck className="w-3 h-3 text-primary" aria-hidden="true" />
                    Answers grounded in verified Dayjoy knowledge
                  </motion.p>
                ) : (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.4, delay: 0.15 }}
                    className="flex items-center justify-center gap-4 sm:gap-5 text-[11px] text-muted-foreground mb-7 flex-wrap"
                  >
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                      Safety-filtered
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <BadgeCheck className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                      Verified knowledge
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-gold-accent" aria-hidden="true" />
                      Cited answers
                    </span>
                  </motion.div>
                )}

                {/* Curated prompt cards — category-themed. Hidden on mobile in
                    Professional mode: a chat-first empty state shouldn't
                    front-load a grid of suggestions before the user has typed
                    anything. Still available in Explorer mode and on desktop. */}
                <div
                  className={`${professionalMobile ? "hidden lg:grid" : "grid"} grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto text-left`}
                >
                  {SUGGESTED_PROMPTS.map((p, idx) => {
                    const theme = PROMPT_THEME[p.category];
                    const Icon = theme.icon;
                    return (
                      <motion.button
                        key={p.title}
                        type="button"
                        onClick={() => handleSend(p.text)}
                        // Visibly inert while a send is in flight. The ref
                        // guard in handleSend already blocks the duplicate
                        // request; this makes that state legible.
                        disabled={sending}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, delay: 0.2 + idx * 0.06 }}
                        whileHover={sending ? undefined : { y: -3 }}
                        whileTap={sending ? undefined : { scale: 0.98 }}
                        className={`group relative text-left p-4 rounded-2xl border border-border bg-card hover:bg-accent/40 transition-all overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none ${theme.ring}`}
                      >
                        {/* Subtle gradient sheen on hover */}
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                          style={{
                            background:
                              "linear-gradient(135deg, rgba(var(--primary-rgb), 0.06) 0%, transparent 60%)",
                          }}
                        />
                        <div className="flex items-start gap-3 relative">
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${theme.tint}`}
                            aria-hidden="true"
                          >
                            <Icon className="w-4.5 h-4.5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold flex items-center gap-1.5">
                              {p.title}
                              <ArrowUp
                                className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 -rotate-45 transition-all"
                                aria-hidden="true"
                              />
                            </div>
                            <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                              {p.text}
                            </div>
                          </div>
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <>
                {messages.map((m) => (
                  <MessageBubble
                    key={m.id ?? `${m.role}-${m.created_at}`}
                    message={m}
                    onFeedback={handleFeedback}
                    onCopy={handleCopy}
                    copiedId={copiedId}
                    onRegenerate={
                      m.role === "assistant" && m.id === lastAssistantId
                        ? handleRegenerate
                        : undefined
                    }
                  />
                ))}

                {/* Follow-up suggestions — only after the last assistant message, when not sending */}
                {lastAssistant && !sending && !streamingText ? (
                  <FollowUpChips
                    suggestions={generateFollowUps(lastAssistant.content, lastAssistant.sources)}
                    onSelect={handleSend}
                    disabled={sending}
                  />
                ) : null}
              </>
            )}

            {/* Knowledge search visualization — shown while sending, before tokens arrive */}
            <KnowledgeSearchViz active={sending && !streamingText} />

            {streamingText ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-3 group"
              >
                {/* Branded avatar with thinking-state glow */}
                <div className="relative shrink-0">
                  <motion.div
                    className="absolute inset-0 rounded-xl"
                    aria-hidden="true"
                    style={{
                      background:
                        "radial-gradient(circle, rgba(var(--gold-accent-rgb), 0.6) 0%, transparent 70%)",
                      filter: "blur(8px)",
                    }}
                    animate={{ opacity: [0.4, 0.8, 0.4], scale: [0.95, 1.05, 0.95] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <div className="relative w-9 h-9 rounded-xl overflow-hidden ring-1 ring-gold-accent/40">
                    <DayjoyLogo variant="mark" size={36} className="block" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs mb-1 flex items-center gap-2">
                    <span className="font-semibold text-foreground">{BRAND.shortName}</span>
                    <span className="inline-flex items-center gap-1 text-[10px] text-gold-accent font-medium">
                      <motion.span
                        className="inline-block w-1 h-1 rounded-full bg-gold-accent"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1, repeat: Infinity, delay: 0 }}
                      />
                      <motion.span
                        className="inline-block w-1 h-1 rounded-full bg-gold-accent"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
                      />
                      <motion.span
                        className="inline-block w-1 h-1 rounded-full bg-gold-accent"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
                      />
                      <span className="ml-1 text-muted-foreground">writing</span>
                    </span>
                  </div>
                  <div className="ai-prose relative prose prose-sm max-w-none rounded-2xl rounded-tl-md bg-card border border-gold-accent/30 px-4 py-3 overflow-hidden">
                    {/* Shimmering top edge while writing */}
                    <motion.span
                      className="absolute top-0 left-0 right-0 h-px origin-left"
                      style={{
                        background:
                          "linear-gradient(90deg, transparent, rgba(var(--gold-accent-rgb), 0.8), transparent)",
                      }}
                      animate={{ scaleX: [0, 1], opacity: [0.6, 0] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                      aria-hidden="true"
                    />
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {streamingText + " ▌"}
                    </ReactMarkdown>
                  </div>
                </div>
              </motion.div>
            ) : null}

            {error ? (
              <div
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-start gap-2"
              >
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <div className="font-medium">Something went wrong</div>
                  <div className="text-xs opacity-90 mt-0.5">{error}</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-border bg-card px-4 sm:px-6 py-3">
          <div className="max-w-3xl mx-auto">
            <div className="group/composer relative rounded-2xl border border-border bg-background transition-all focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/10">
              {/* Glow halo on focus */}
              <span
                aria-hidden="true"
                className="absolute -inset-px rounded-2xl opacity-0 group-focus-within/composer:opacity-100 transition-opacity pointer-events-none"
                style={{
                  background:
                    "radial-gradient(circle at 50% 100%, rgba(var(--primary-rgb), 0.08) 0%, transparent 60%)",
                }}
              />
              <textarea
                id="dj-chat-input"
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={composerPlaceholder}
                rows={1}
                maxLength={4000}
                disabled={sending}
                className="relative w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm focus:outline-none disabled:opacity-60"
                aria-label={`Ask ${BRAND.shortName} about Dayjoy products, policies, or training`}
                style={{ minHeight: "44px", maxHeight: "200px" }}
              />
              <div className="relative flex items-center justify-between gap-2 px-2 pb-2">
                <div className="flex items-center gap-1">
                  {/* Attach / Tools dropdown */}
                  <div className="relative" ref={attachMenuRef}>
                    {/* Hidden pickers driven by the menu items below. */}
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        handleFilesPicked(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,.pdf,.txt,.csv,.doc,.docx"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        handleFilesPicked(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    {/* "+" (ChatGPT-style attachment trigger) instead of a
                        paperclip/chevron pair — rotates into an "×" when
                        open instead of swapping icon shape entirely. */}
                    <button
                      type="button"
                      onClick={() => setAttachMenuOpen((v) => !v)}
                      className="flex items-center justify-center w-9 h-9 rounded-full bg-accent/60 text-foreground hover:bg-accent active:scale-90 transition-all disabled:opacity-40 shrink-0"
                      disabled={sending}
                      aria-label={attachMenuOpen ? "Close attachment menu" : "Add photo or file"}
                      aria-expanded={attachMenuOpen}
                      aria-haspopup="menu"
                      title="Add photo or file"
                    >
                      <motion.span
                        animate={{ rotate: attachMenuOpen ? 45 : 0 }}
                        transition={{ duration: 0.15 }}
                        className="flex"
                      >
                        <Plus className="w-4.5 h-4.5" aria-hidden="true" />
                      </motion.span>
                    </button>
                    {attachMenuOpen ? (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.15 }}
                        className="absolute bottom-full mb-2 left-0 w-60 rounded-xl border border-border bg-card shadow-xl py-1.5 z-50"
                        role="menu"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setAttachMenuOpen(false);
                            setCameraOpen(true);
                          }}
                          className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-accent/60"
                          role="menuitem"
                        >
                          <Camera className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden="true" />
                          <div>
                            <p className="text-sm font-medium">Take photo</p>
                            <p className="text-[11px] text-muted-foreground">Capture a product label or document</p>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAttachMenuOpen(false);
                            photoInputRef.current?.click();
                          }}
                          className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-accent/60"
                          role="menuitem"
                        >
                          <ImageIcon className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden="true" />
                          <div>
                            <p className="text-sm font-medium">Photo library</p>
                            <p className="text-[11px] text-muted-foreground">Attach an image already on your device</p>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAttachMenuOpen(false);
                            fileInputRef.current?.click();
                          }}
                          className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-accent/60"
                          role="menuitem"
                        >
                          <Paperclip className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden="true" />
                          <div>
                            <p className="text-sm font-medium">Choose file</p>
                            <p className="text-[11px] text-muted-foreground">Attach a document or image</p>
                          </div>
                        </button>
                        <div className="my-1 h-px bg-border" aria-hidden="true" />
                        <button
                          type="button"
                          onClick={() => {
                            setAttachMenuOpen(false);
                            setQrOpen(true);
                          }}
                          className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-accent/60"
                          role="menuitem"
                        >
                          <QrCode className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden="true" />
                          <div>
                            <p className="text-sm font-medium">Scan QR code</p>
                            <p className="text-[11px] text-muted-foreground">Decode product or training QR</p>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAttachMenuOpen(false);
                            setOcrOpen(true);
                          }}
                          className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-accent/60"
                          role="menuitem"
                        >
                          <FileText className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden="true" />
                          <div>
                            <p className="text-sm font-medium">Extract text (OCR)</p>
                            <p className="text-[11px] text-muted-foreground">Read text from an image</p>
                          </div>
                        </button>
                      </motion.div>
                    ) : null}
                  </div>
                  <span className="text-[11px] text-muted-foreground hidden sm:inline ml-1">
                    <kbd className="px-1 py-0.5 rounded border border-border bg-accent/40 text-[10px] font-mono">Enter</kbd>{" "}
                    send ·{" "}
                    <kbd className="px-1 py-0.5 rounded border border-border bg-accent/40 text-[10px] font-mono">Shift+Enter</kbd>{" "}
                    newline
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {sending ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleStop}
                    >
                      Stop
                    </Button>
                  ) : null}
                  {/* Mic sits beside Send — both always visible (Send just
                      disables when empty) rather than swapping one for the
                      other, so the send control is never simply missing.
                      Mic itself is hidden when voice is turned off in
                      Settings (isVoiceRepliesEnabled). Speak/mute toggles
                      are omitted here since normal text chat no longer
                      auto-speaks answers. */}
                  {isVoiceRepliesEnabled() ? (
                    <VoiceControls
                      voice={voice}
                      onTranscript={setInput}
                      voiceMode={voiceMode}
                      onToggleVoiceMode={toggleVoiceMode}
                      showSpeakToggle={false}
                    />
                  ) : null}
                  <motion.button
                    type="button"
                    onClick={() => handleSend()}
                    disabled={!input.trim() || sending}
                    whileTap={{ scale: 0.95 }}
                    whileHover={{ scale: input.trim() && !sending ? 1.05 : 1 }}
                    className="group/send relative inline-flex items-center justify-center w-9 h-9 rounded-full bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md shrink-0"
                    aria-label="Send message"
                  >
                    {/* Gradient sheen on hover */}
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full opacity-0 group-hover/send:opacity-100 transition-opacity pointer-events-none"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(255,255,255,0.18) 0%, transparent 60%)",
                      }}
                    />
                    <ArrowUp className="w-4 h-4 relative" aria-hidden="true" />
                  </motion.button>
                </div>
              </div>
              {/* Attachments preview row */}
              {attachments.length > 0 ? (
                <div className="flex gap-2 px-3 pb-2 overflow-x-auto">
                  {attachments.map((att, idx) => (
                    <div
                      key={`${att.name}-${idx}`}
                      className="relative w-14 h-14 rounded-lg overflow-hidden border border-border shrink-0 group"
                    >
                      <img src={att.dataUrl} alt={att.name} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(idx)}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 max-lg:opacity-100 transition-opacity"
                        aria-label={`Remove ${att.name}`}
                      >
                        <Trash2 className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* ============================= Tools modals ============================= */}
      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCameraCapture}
        title="Take a photo"
        facingMode="environment"
        multiple
      />
      <QRScanner
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        onScan={handleQrScan}
        title="Scan QR code"
      />
      <OcrScanner
        open={ocrOpen}
        onClose={() => setOcrOpen(false)}
        onExtracted={handleOcrExtracted}
        title="Extract text from image"
      />

      {/* ============================= Sources / Related panel (overlay drawer) ============================= */}
      {/* Default CLOSED. Opens as a right-side overlay so it doesn't squeeze the chat area. */}
      <AnimatePresence>
      {sourcesPanelOpen ? (
        <>
          {/* Backdrop — click anywhere outside to close */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
            onClick={() => setSourcesPanelOpen(false)}
            aria-hidden="true"
          />
          <motion.aside
            initial={{ x: "100%", scale: 0.97, boxShadow: "0 0 0 rgba(0,0,0,0)" }}
            animate={{
              x: 0,
              scale: 1,
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.3)",
              transition: { type: "spring", stiffness: 320, damping: 32 },
            }}
            exit={{
              x: "100%",
              scale: 0.98,
              boxShadow: "0 0 0 rgba(0,0,0,0)",
              transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] },
            }}
            className="fixed top-0 right-0 z-50 h-full w-80 sm:w-96 bg-card border-l border-border shadow-2xl flex flex-col"
            aria-label="Sources and related information"
          >
            {/* Panel header with Download + close buttons */}
            <div className="flex items-center justify-between gap-2 p-4 border-b border-border bg-gradient-to-r from-primary/5 to-transparent">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Shield className="w-4 h-4 text-primary" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">Sources & Related</h3>
                  <p className="text-[10px] text-muted-foreground">
                    {lastSources.length > 0
                      ? `${lastSources.length} citation${lastSources.length === 1 ? "" : "s"}`
                      : "No citations yet"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {/* Download all sources as text file */}
                {(lastSources.length > 0 || lastAssistant) ? (
                  <button
                    type="button"
                    onClick={handleDownloadSources}
                    className="p-2 rounded-lg hover:bg-accent/60 transition-colors text-muted-foreground hover:text-primary"
                    aria-label="Download all sources as text file"
                    title="Download sources"
                  >
                    <FileDown className="w-4 h-4" aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setSourcesPanelOpen(false)}
                  className="p-2 rounded-lg hover:bg-accent/60 transition-colors"
                  aria-label="Close sources panel"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Panel body — scrollable */}
            <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
              {lastSources.length === 0 ? (
                <div className="text-center py-12 px-2">
                  <div className="inline-flex w-12 h-12 rounded-2xl bg-accent/60 items-center justify-center mb-3">
                    <Shield className="w-6 h-6 text-muted-foreground opacity-60" aria-hidden="true" />
                  </div>
                  <p className="text-sm font-medium">No citations yet</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-[220px] mx-auto">
                    When {BRAND.shortName} cites approved knowledge, the sources will appear here automatically.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {lastSources.slice(0, 6).map((s, idx) => {
                    const href = sourceHref(s);
                    const label = sourceLabel(s);
                    const key = sourceKey(s, idx);
                    const isExpanded = expandedSources.has(key);
                    const isObj = typeof s !== "string";
                    return (
                      <li key={key} className="rounded-xl border border-border hover:border-primary/20 transition-colors overflow-hidden">
                        {/* Card header — click to expand preview */}
                        <div className="flex items-start gap-2 px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">
                              {typeof s === "string" ? s.split(":")[0] : s.table}
                            </div>
                            <div className="text-sm font-medium truncate">{label}</div>
                          </div>
                          {/* Action buttons */}
                          <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
                            {/* Preview toggle — expand to see details */}
                            <button
                              type="button"
                              onClick={() => toggleSourcePreview(key)}
                              className="p-1 rounded-md hover:bg-accent/60 text-muted-foreground hover:text-primary transition-colors"
                              aria-label={isExpanded ? "Hide preview" : "Preview source"}
                              title={isExpanded ? "Hide preview" : "Preview"}
                            >
                              {isExpanded ? (
                                <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                              )}
                            </button>
                            {/* Open external link */}
                            {href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1 rounded-md hover:bg-accent/60 text-muted-foreground hover:text-primary transition-colors"
                                aria-label="Open source in new tab"
                                title="Open link"
                              >
                                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                              </a>
                            ) : null}
                          </div>
                        </div>
                        {/* ID line (always visible for object sources) */}
                        {isObj && typeof s.id === "string" ? (
                          <div className="px-3 pb-1 text-[10px] text-muted-foreground font-mono">
                            {s.id}
                          </div>
                        ) : null}
                        {/* Expandable preview section */}
                        {isExpanded ? (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="border-t border-border bg-accent/20 px-3 py-2.5"
                          >
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
                              Preview
                            </p>
                            <div className="space-y-1.5 text-xs">
                              <div>
                                <span className="text-muted-foreground">Type:</span>{" "}
                                <span className="font-medium">{isObj ? s.table : "text"}</span>
                              </div>
                              {isObj && s.title ? (
                                <div>
                                  <span className="text-muted-foreground">Title:</span>{" "}
                                  <span className="font-medium">{s.title}</span>
                                </div>
                              ) : null}
                              {isObj && s.id ? (
                                <div>
                                  <span className="text-muted-foreground">ID:</span>{" "}
                                  <span className="font-mono">{s.id}</span>
                                </div>
                              ) : null}
                              {isObj && s.url ? (
                                <div className="truncate">
                                  <span className="text-muted-foreground">URL:</span>{" "}
                                  <a
                                    href={s.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-primary hover:underline"
                                  >
                                    {s.url}
                                  </a>
                                </div>
                              ) : null}
                              {!isObj ? (
                                <div>
                                  <span className="text-muted-foreground">Content:</span>{" "}
                                  <span className="font-mono break-all">{s}</span>
                                </div>
                              ) : null}
                            </div>
                            {/* Download this single source */}
                            <button
                              type="button"
                              onClick={() => {
                                const text = isObj
                                  ? `[${s.table}] ${s.title ?? s.id}\nID: ${s.id}\nURL: ${s.url ?? "N/A"}`
                                  : s;
                                const blob = new Blob([text], { type: "text/plain" });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = `source-${idx + 1}.txt`;
                                a.click();
                                URL.revokeObjectURL(url);
                              }}
                              className="mt-2 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                            >
                              <Download className="w-3 h-3" aria-hidden="true" />
                              Download this source
                            </button>
                          </motion.div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}

              {lastAssistant?.handoff_required ? (
                <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 text-warning shrink-0" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">
                        {lastAssistant?.verification_status === "unverified"
                          ? "Unverified answer"
                          : "Need a human?"}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {lastAssistant?.handoff_message
                          || "This answer could not be verified from approved Dayjoy documents. Please create a support ticket for a verified response."}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={async () => {
                            try {
                              const { ragCreateSupportTicket } = await import("../../../lib/api");
                              await ragCreateSupportTicket({
                                query: lastAssistant?.content?.slice(0, 500) ?? "",
                                conversation_id: activeConv?.id,
                                confidence: lastAssistant?.confidence ?? undefined,
                                verification_status: lastAssistant?.verification_status ?? undefined,
                                cited_sources: (lastSources as Array<Record<string, unknown>>).slice(0, 5),
                                issue_category: "unverified_answer",
                                priority: "normal",
                              });
                              // Brief visual feedback
                              setCopiedId("ticket-created-" + (activeConv?.id ?? ""));
                              setTimeout(() => setCopiedId(null), 2500);
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "Failed to create ticket");
                            }
                          }}
                          className="h-auto text-xs px-2 py-1"
                        >
                          <Phone className="w-3 h-3" aria-hidden="true" /> Create support ticket
                        </Button>
                        <a
                          href="/support"
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline px-2 py-1"
                        >
                          Contact support <ExternalLink className="w-3 h-3" aria-hidden="true" />
                        </a>
                      </div>
                      {copiedId?.startsWith("ticket-created-") ? (
                        <p className="text-[10px] text-primary mt-1.5">Support ticket created. The team will follow up shortly.</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Verification badge + confidence meter (RAG) */}
              {lastAssistant ? (
                <div className="mt-4 space-y-2">
                  {/* Verified / Unverified badge */}
                  {lastAssistant.verification_status ? (
                    <Badge
                      variant={
                        lastAssistant.verification_status === "verified"
                          ? "default"
                          : lastAssistant.verification_status === "partial"
                          ? "warning"
                          : "destructive"
                      }
                      className="px-2 py-1 text-[11px]"
                    >
                      {lastAssistant.verification_status === "verified" ? (
                        <><BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> Verified from approved Dayjoy source</>
                      ) : lastAssistant.verification_status === "partial" ? (
                        <><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> Partial match — verify before relying</>
                      ) : (
                        <><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> No approved source found</>
                      )}
                    </Badge>
                  ) : null}

                  {/* Answer source badge — which knowledge source(s) produced this answer */}
                  {lastAssistant.answer_source ? (
                    <Badge variant="outline" className="px-2 py-1 text-[11px]">
                      {lastAssistant.answer_source === "dayjoy_knowledge" ? (
                        <><ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" /> Dayjoy Knowledge</>
                      ) : lastAssistant.answer_source === "web_search" ? (
                        <><Search className="w-3.5 h-3.5" aria-hidden="true" /> Web Search</>
                      ) : lastAssistant.answer_source === "hybrid" ? (
                        <><GitCompare className="w-3.5 h-3.5" aria-hidden="true" /> Hybrid — Dayjoy + Web</>
                      ) : lastAssistant.answer_source === "general_llm" ? (
                        <><Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> General AI knowledge</>
                      ) : null}
                    </Badge>
                  ) : null}

                  {/* Confidence meter */}
                  {typeof lastAssistant.confidence === "number" ? (
                    <Card className="px-3 py-2 shadow-none">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Confidence</span>
                        <span className="font-medium">
                          {Math.round((lastAssistant.confidence ?? 0) * 100)}%
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 rounded-full bg-border overflow-hidden">
                        <div
                          className={`h-full ${
                            (lastAssistant.confidence ?? 0) >= 0.7
                              ? "bg-primary"
                              : (lastAssistant.confidence ?? 0) >= 0.4
                              ? "bg-warning"
                              : "bg-destructive"
                          }`}
                          style={{
                            width: `${Math.round((lastAssistant.confidence ?? 0) * 100)}%`,
                          }}
                        />
                      </div>
                      {lastAssistant.rag_metadata ? (
                        <div className="mt-1.5 text-[10px] text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5">
                          {(lastAssistant.rag_metadata as { retrieval_time_ms?: number }).retrieval_time_ms != null ? (
                            <span>Retrieval: {(lastAssistant.rag_metadata as { retrieval_time_ms: number }).retrieval_time_ms}ms</span>
                          ) : null}
                          {(lastAssistant.rag_metadata as { model_used?: string }).model_used ? (
                            <span>Model: {(lastAssistant.rag_metadata as { model_used: string }).model_used}</span>
                          ) : null}
                          {(lastAssistant.rag_metadata as { chunks?: unknown[] }).chunks ? (
                            <span>{((lastAssistant.rag_metadata as { chunks: unknown[] }).chunks).length} chunks retrieved</span>
                          ) : null}
                        </div>
                      ) : null}
                    </Card>
                  ) : null}
                </div>
              ) : null}

              {/* Related documents (RAG) */}
              {lastAssistant?.rag_metadata
              && Array.isArray((lastAssistant.rag_metadata as { related_documents?: unknown[] }).related_documents)
              && ((lastAssistant.rag_metadata as { related_documents: unknown[] }).related_documents).length > 0 ? (
                <div className="mt-4">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
                    Related documents
                  </p>
                  <ul className="space-y-1">
                    {((lastAssistant.rag_metadata as { related_documents: Array<Record<string, unknown>> }).related_documents).slice(0, 3).map((d, i) => (
                      <li key={String(d.id ?? i)} className="flex items-center gap-1.5 text-xs rounded-lg border border-border px-2 py-1.5">
                        <FileText className="w-3 h-3 text-muted-foreground shrink-0" aria-hidden="true" />
                        <span className="truncate">{String(d.file_name ?? d.name ?? "Document")}</span>
                        {d.category ? (
                          <span className="ml-auto text-[10px] text-muted-foreground uppercase">{String(d.category)}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Related products (RAG) */}
              {lastAssistant?.rag_metadata
              && Array.isArray((lastAssistant.rag_metadata as { related_products?: unknown[] }).related_products)
              && ((lastAssistant.rag_metadata as { related_products: unknown[] }).related_products).length > 0 ? (
                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
                    Related products
                  </p>
                  <ul className="space-y-1">
                    {((lastAssistant.rag_metadata as { related_products: Array<Record<string, unknown>> }).related_products).slice(0, 3).map((p, i) => (
                      <li key={String(p.id ?? i)} className="flex items-center gap-1.5 text-xs rounded-lg border border-border px-2 py-1.5">
                        <Leaf className="w-3 h-3 text-primary shrink-0" aria-hidden="true" />
                        <span className="truncate">{String(p.product_name ?? p.name ?? "Product")}</span>
                        {p.category ? (
                          <span className="ml-auto text-[10px] text-muted-foreground">{String(p.category)}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Related FAQs (RAG) */}
              {lastAssistant?.rag_metadata
              && Array.isArray((lastAssistant.rag_metadata as { related_faqs?: unknown[] }).related_faqs)
              && ((lastAssistant.rag_metadata as { related_faqs: unknown[] }).related_faqs).length > 0 ? (
                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
                    Related FAQs
                  </p>
                  <ul className="space-y-1">
                    {((lastAssistant.rag_metadata as { related_faqs: Array<Record<string, unknown>> }).related_faqs).slice(0, 3).map((f, i) => (
                      <li key={String(f.id ?? i)} className="text-xs rounded-lg border border-border px-2 py-1.5">
                        <div className="font-medium truncate">{String(f.question ?? "FAQ")}</div>
                        {f.answer ? (
                          <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{String(f.answer)}</div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Related policies (RAG) */}
              {lastAssistant?.rag_metadata
              && Array.isArray((lastAssistant.rag_metadata as { related_policies?: unknown[] }).related_policies)
              && ((lastAssistant.rag_metadata as { related_policies: unknown[] }).related_policies).length > 0 ? (
                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
                    Related policies
                  </p>
                  <ul className="space-y-1">
                    {((lastAssistant.rag_metadata as { related_policies: Array<Record<string, unknown>> }).related_policies).slice(0, 3).map((p, i) => (
                      <li key={String(p.id ?? i)} className="flex items-center gap-1.5 text-xs rounded-lg border border-border px-2 py-1.5">
                        <ScrollText className="w-3 h-3 text-muted-foreground shrink-0" aria-hidden="true" />
                        <span className="truncate">{String(p.topic ?? p.title ?? "Policy")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Attachments section — show captured photos with Download + Preview */}
              {attachments.length > 0 ? (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                      Attachments ({attachments.length})
                    </p>
                    <button
                      type="button"
                      onClick={() => setAttachments([])}
                      className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {attachments.map((att, idx) => (
                      <div
                        key={`${att.name}-${idx}`}
                        className="group relative rounded-lg border border-border overflow-hidden bg-accent/20"
                      >
                        <img
                          src={att.dataUrl}
                          alt={att.name}
                          className="w-full h-24 object-cover"
                        />
                        {/* Overlay actions on hover */}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => setPreviewAttachment(att)}
                            className="p-1.5 rounded-lg bg-white/90 text-foreground hover:bg-white transition-colors"
                            aria-label={`Preview ${att.name}`}
                            title="Preview"
                          >
                            <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadAttachment(att)}
                            className="p-1.5 rounded-lg bg-white/90 text-foreground hover:bg-white transition-colors"
                            aria-label={`Download ${att.name}`}
                            title="Download"
                          >
                            <Download className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                        {/* Filename */}
                        <div className="px-2 py-1 text-[9px] text-muted-foreground truncate bg-card">
                          {att.name}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </motion.aside>
        </>
      ) : null}
      </AnimatePresence>

      {/* Attachment preview modal — full-size image view */}
      <Modal
        open={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
        title={previewAttachment?.name ?? "Preview"}
        description="Full-size preview of attached image"
        size="xl"
        footer={
          <>
            <Button
              type="button"
              onClick={() => previewAttachment && handleDownloadAttachment(previewAttachment)}
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              Download
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPreviewAttachment(null)}
            >
              Close
            </Button>
          </>
        }
      >
        {previewAttachment ? (
          <div className="flex justify-center">
            <img
              src={previewAttachment.dataUrl}
              alt={previewAttachment.name}
              className="max-w-full max-h-[60vh] rounded-lg object-contain"
            />
          </div>
        ) : null}
      </Modal>

      {/* Rename conversation modal */}
      <Modal
        open={!!renameTargetId}
        onClose={closeRename}
        title="Rename conversation"
        description="Give this conversation a title, or let AI suggest one from the first message."
        size="sm"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeRename} disabled={renameSaving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void submitRename()} disabled={renameSaving || renameRegenerating}>
              {renameSaving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <label htmlFor="rename-conversation-input" className="text-xs font-medium text-muted-foreground">
            Title
          </label>
          <input
            id="rename-conversation-input"
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitRename();
              }
            }}
            maxLength={RENAME_TITLE_MAX_LEN}
            autoFocus
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Conversation title"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              {renameValue.length}/{RENAME_TITLE_MAX_LEN}
            </span>
            <button
              type="button"
              onClick={() => void regenerateRenameTitle()}
              disabled={renameRegenerating || renameSaving}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${renameRegenerating ? "animate-spin" : ""}`} aria-hidden="true" />
              {renameRegenerating ? "Generating…" : "Regenerate with AI"}
            </button>
          </div>
          {renameError ? (
            <p className="text-xs text-destructive" role="alert">
              {renameError}
            </p>
          ) : null}
        </div>
      </Modal>

      {/* Conversation options ("•••" menu) — mobile Professional mode's
          consolidated home for actions that used to be separate always-on
          header icons. Only lists actions actually backed by existing
          functionality (share, rename, export, sources, attachments in this
          chat, pin, archive, delete, find in chat) — no placeholder buttons. */}
      <Modal
        open={moreMenuOpen}
        onClose={() => setMoreMenuOpen(false)}
        title="Conversation options"
        size="sm"
      >
        <div className="-m-1 space-y-1">
          {/* Search all conversations — reuses the existing conversation
              list + search box (previously only reachable via a header icon
              this redesign removed in favor of the hamburger drawer). Not
              conversation-specific, so it's available even with no active
              chat. */}
          <MoreMenuItem
            icon={Search}
            label="Search chats"
            onClick={() => {
              setMoreMenuOpen(false);
              setSidebarOpen(true);
            }}
          />
          {activeConv ? (
            <>
              <div className="h-px bg-border my-1" />
              <MoreMenuItem
                icon={Share2}
                label="Share"
                onClick={() => {
                  handleShareConversation();
                  setMoreMenuOpen(false);
                }}
              />
              <MoreMenuItem
                icon={RefreshCw}
                label="Rename"
                onClick={() => {
                  setMoreMenuOpen(false);
                  openRename(activeConv.id, activeConv.title);
                }}
              />
              <MoreMenuItem
                icon={Download}
                label="Export as PDF"
                onClick={() => {
                  handleExportConversation();
                  setMoreMenuOpen(false);
                }}
              />
              <MoreMenuItem
                icon={PanelRightOpen}
                label={`View verified sources${lastSources.length > 0 ? ` (${lastSources.length})` : ""}`}
                onClick={() => {
                  setSourcesPanelOpen(true);
                  setMoreMenuOpen(false);
                }}
              />
              <MoreMenuItem
                icon={Paperclip}
                label={`Attachments in this chat${attachments.length > 0 ? ` (${attachments.length})` : ""}`}
                onClick={() => {
                  setMoreMenuOpen(false);
                  setSourcesPanelOpen(true);
                }}
              />
              <MoreMenuItem
                icon={Search}
                label="Find in chat"
                onClick={() => {
                  setMoreMenuOpen(false);
                  setFindInChatOpen(true);
                }}
              />
              <div className="h-px bg-border my-1" />
              <MoreMenuItem
                icon={activeConv.pinned ? PinOff : Pin}
                label={activeConv.pinned ? "Unpin" : "Pin"}
                onClick={() => {
                  handlePin(activeConv.id, !activeConv.pinned);
                  setMoreMenuOpen(false);
                }}
              />
              <MoreMenuItem
                icon={Archive}
                label="Archive"
                onClick={() => {
                  handleArchive(activeConv.id, true);
                  setMoreMenuOpen(false);
                }}
              />
              <MoreMenuItem
                icon={Trash2}
                label="Delete"
                destructive
                onClick={() => {
                  setMoreMenuOpen(false);
                  void handleDelete(activeConv.id);
                }}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground px-2 py-1">
              Start a conversation to see sharing, export, and organization options here.
            </p>
          )}
        </div>
      </Modal>

      {/* Find in chat — simple client-side search across the current
          conversation's messages, with jump-to-match navigation. */}
      <Modal
        open={findInChatOpen}
        onClose={() => {
          setFindInChatOpen(false);
          setFindQuery("");
          setFindMatchIndex(0);
        }}
        title="Find in chat"
        size="sm"
      >
        <FindInChatPanel
          messages={messages}
          query={findQuery}
          onQueryChange={(q) => {
            setFindQuery(q);
            setFindMatchIndex(0);
          }}
          matchIndex={findMatchIndex}
          onMatchIndexChange={setFindMatchIndex}
          onJump={(id) => {
            setFindInChatOpen(false);
            const el = id ? document.getElementById(`msg-${id}`) : null;
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        />
      </Modal>
    </div>
  );
}

/** One row inside the "•••" conversation options menu. */
function MoreMenuItem({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left transition-colors hover:bg-accent/60 ${
        destructive ? "text-destructive" : "text-foreground"
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Search-within-conversation panel used by the "Find in chat" modal. */
function FindInChatPanel({
  messages,
  query,
  onQueryChange,
  matchIndex,
  onMatchIndexChange,
  onJump,
}: {
  messages: ChatMessage[];
  query: string;
  onQueryChange: (q: string) => void;
  matchIndex: number;
  onMatchIndexChange: (i: number) => void;
  onJump: (messageId?: string) => void;
}) {
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return messages.filter((m) => m.content.toLowerCase().includes(q));
  }, [messages, query]);

  const current = matches[matchIndex];

  return (
    <div className="space-y-3">
      <input
        type="text"
        autoFocus
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search this conversation…"
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {query.trim() ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {matches.length === 0
              ? "No matches"
              : `${matchIndex + 1} of ${matches.length} match${matches.length === 1 ? "" : "es"}`}
          </span>
          {matches.length > 1 ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onMatchIndexChange((matchIndex - 1 + matches.length) % matches.length)}
                className="px-2 py-1 rounded hover:bg-accent/60"
                aria-label="Previous match"
              >
                <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onMatchIndexChange((matchIndex + 1) % matches.length)}
                className="px-2 py-1 rounded hover:bg-accent/60 rotate-180"
                aria-label="Next match"
              >
                <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {current ? (
        <button
          type="button"
          onClick={() => onJump(current.id)}
          className="w-full text-left p-3 rounded-lg border border-border bg-accent/30 hover:bg-accent/50 transition-colors"
        >
          <p className="text-[11px] font-medium text-muted-foreground mb-1">
            {current.role === "user" ? "You" : BRAND.name} · {formatTimestamp(current.created_at)}
          </p>
          <p className="text-sm line-clamp-3">{current.content}</p>
        </button>
      ) : null}
    </div>
  );
}

/** Single message bubble — user or assistant. */
function MessageBubble({
  message,
  onFeedback,
  onCopy,
  copiedId,
  onRegenerate,
}: {
  message: ChatMessage;
  onFeedback: (id: string | undefined, rating: "up" | "down") => void;
  onCopy: (text: string, id: string) => void;
  copiedId: string | null;
  onRegenerate?: () => void;
}) {
  const isUser = message.role === "user";
  const bubbleId = message.id ?? `temp-${message.created_at}`;
  const isBlocked = message.safety_status === "blocked";

  if (isUser) {
    return (
      <motion.div
        id={`msg-${bubbleId}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="flex gap-3 justify-end group"
      >
        <div className="flex flex-col items-end max-w-[80%]">
          <div className="relative rounded-2xl rounded-tr-md bg-primary text-primary-foreground px-4 py-2.5 shadow-sm">
            {/* Subtle gradient sheen */}
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-2xl rounded-tr-md opacity-30 pointer-events-none"
              style={{
                background:
                  "linear-gradient(135deg, rgba(255,255,255,0.12) 0%, transparent 50%)",
              }}
            />
            <p className="text-sm whitespace-pre-wrap break-words relative">{message.content}</p>
          </div>
          {message.created_at ? (
            <div className="text-[10px] text-muted-foreground mt-1 pr-1 opacity-70 group-hover:opacity-100 transition-opacity">
              {formatTimestamp(message.created_at)}
            </div>
          ) : null}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      id={`msg-${bubbleId}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="flex gap-3 group"
    >
      {/* Branded avatar — Dayjoy mark with subtle halo */}
      <div className="relative shrink-0">
        <div
          className="absolute inset-0 rounded-xl opacity-30 blur-md group-hover:opacity-50 transition-opacity"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(circle, rgba(var(--primary-rgb), 0.6) 0%, transparent 70%)",
          }}
        />
        <div className="relative w-9 h-9 rounded-xl overflow-hidden ring-1 ring-primary/20">
          <DayjoyLogo variant="mark" size={36} className="block" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs mb-1 flex items-center gap-2">
          <span className="font-semibold text-foreground">{BRAND.shortName}</span>
          <span className="inline-flex items-center gap-0.5 text-[10px] text-primary font-medium px-1.5 py-0.5 rounded-full bg-primary/8">
            <BadgeCheck className="w-2.5 h-2.5" aria-hidden="true" />
            Verified
          </span>
          {message.created_at ? (
            <span className="text-muted-foreground">· {formatTimestamp(message.created_at)}</span>
          ) : null}
          {message._unsaved ? (
            <span
              className="text-[10px] text-muted-foreground/80 italic"
              title="This reply couldn't be saved, but is shown here for this session."
            >
              · not saved
            </span>
          ) : null}
        </div>
        <div
          className={`ai-prose prose prose-sm max-w-none rounded-2xl rounded-tl-md border px-4 py-3 transition-colors ${
            isBlocked
              ? "border-destructive/30 bg-destructive/5"
              : "border-border bg-card group-hover:border-primary/20"
          }`}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>

        {/* Action bar — revealed on hover, with labeled tooltips */}
        <div className="flex items-center gap-0.5 mt-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-lg:opacity-100 transition-opacity">
          <ActionButton
            onClick={() => onCopy(message.content, bubbleId)}
            label={copiedId === bubbleId ? "Copied" : "Copy"}
            active={copiedId === bubbleId}
            activeColor="primary"
          >
            {copiedId === bubbleId ? (
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </ActionButton>
          <ActionButton
            onClick={() => onFeedback(message.id, "up")}
            label="Helpful"
            active={message.feedback === "up"}
            activeColor="primary"
          >
            <ThumbsUp className="w-3.5 h-3.5" aria-hidden="true" />
          </ActionButton>
          <ActionButton
            onClick={() => onFeedback(message.id, "down")}
            label="Not helpful"
            active={message.feedback === "down"}
            activeColor="destructive"
          >
            <ThumbsDown className="w-3.5 h-3.5" aria-hidden="true" />
          </ActionButton>
          {onRegenerate ? (
            <ActionButton onClick={onRegenerate} label="Regenerate">
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            </ActionButton>
          ) : null}
        </div>

        {isBlocked ? (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-destructive">
            <Shield className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Safety filter blocked this response.</span>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

/**
 * ActionButton — small icon button with optional active state and hover label.
 * Replaces the bare icon-only buttons with a consistent, accessible pattern.
 */
function ActionButton({
  children,
  onClick,
  label,
  active = false,
  activeColor = "primary",
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
  activeColor?: "primary" | "destructive";
}) {
  const activeBg =
    activeColor === "primary" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive";
  return (
    <button
      type="button"
      onClick={onClick}
      // Explicit flex centering — a bare <button> falls back to inline-block
      // in some browsers, which can leave the icon riding the text baseline
      // instead of sitting centered in the padded box (the reported
      // off-center refresh/regenerate icon).
      className={`group/action relative inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-accent/60 transition-colors ${
        active ? activeBg : "text-muted-foreground"
      }`}
      aria-label={label}
      title={label}
      aria-pressed={active}
    >
      {children}
      <span
        className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-foreground text-background opacity-0 group-hover/action:opacity-100 transition-opacity whitespace-nowrap"
        aria-hidden="true"
      >
        {label}
      </span>
    </button>
  );
}

/**
 * FollowUpChips — clickable suggestion chips rendered after the last AI
 * response. Clicking a chip sends it as a new message.
 */
function FollowUpChips({
  suggestions,
  onSelect,
  disabled,
}: {
  suggestions: string[];
  onSelect: (text: string) => void;
  disabled?: boolean;
}) {
  if (suggestions.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      className="flex flex-col gap-2 pl-11"
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1">
        <Sparkles className="w-2.5 h-2.5 text-gold-accent" aria-hidden="true" />
        Follow-up suggestions
      </p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s, i) => (
          <motion.button
            key={i}
            type="button"
            onClick={() => onSelect(s)}
            disabled={disabled}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.25 + i * 0.05 }}
            className="group inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-border bg-card hover:border-primary/40 hover:bg-primary/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
          >
            <span className="text-foreground">{s}</span>
            <ArrowUp
              className="w-2.5 h-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 -rotate-45 transition-all"
              aria-hidden="true"
            />
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}
