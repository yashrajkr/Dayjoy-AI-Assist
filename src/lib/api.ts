import { supabase } from "../app/lib/supabaseClient";
import { BRAND } from "../app/lib/brand";

/**
 * Frontend → Backend API contract for Dayjoy AI Assist.
 *
 * The chat endpoint is the primary interface. It accepts a user message,
 * the authenticated user's role, and the preferred language, then returns
 * the AI answer along with retrieved sources and safety metadata.
 *
 * When a Supabase session is available we attach the access token as a
 * Bearer header so the FastAPI backend can re-verify identity and enforce
 * RLS via the user's JWT (instead of a service-role key).
 */

export type ChatRole = "customer" | "distributor" | "employee" | "admin" | "management" | string;

export type ChatRequest = {
  message: string;
  role: ChatRole;
  language: string;
  /** Optional conversation ID for multi-turn context. */
  conversation_id?: string;
  /** Temporary Chat: tells the backend not to auto-create/persist a conversation. */
  is_temporary?: boolean;
  /** AI Mode System — "normal" | "thinking" | "deep_research" | "compare_products". */
  ai_mode?: string;
  /** Multimodal Understanding (Capability 1/2/19/20) — a single attached
   * image as a data: URL. When present, the backend answers from the image
   * via a vision-capable model instead of the normal RAG pipeline. */
  image_data_url?: string;
  /** Knowledge Scope Selector (Capability 16) — narrows retrieval to one
   * category instead of all of DayJoy's knowledge base. */
  knowledge_scope?: KnowledgeScope;
  /** Context Scope Control (Capability 15) — whether this message may fall
   * back to a live web search. Defaults to true server-side if omitted. */
  allow_web_search?: boolean;
  /** Advanced File Intelligence / PDF Intelligence / Document Comparison /
   * Cross-Document Reasoning (Capabilities 3, 21, 22, 5) — up to 3
   * attached PDF/DOCX/PPTX/XLSX/CSV/TXT/JSON files. When present, the
   * backend answers from their extracted text instead of the normal RAG
   * pipeline; 2+ documents supports comparison/cross-document reasoning. */
  attached_documents?: AttachedDocument[];
};

export type AttachedDocument = {
  name: string;
  mime?: string;
  data_url: string;
};

export type KnowledgeScope = "all" | "products" | "training" | "policies" | "faqs";

export const KNOWLEDGE_SCOPE_OPTIONS: { value: KnowledgeScope; label: string }[] = [
  { value: "all", label: "All DayJoy knowledge" },
  { value: "products", label: "Products" },
  { value: "training", label: "Training" },
  { value: "policies", label: "Policies" },
  { value: "faqs", label: "FAQs" },
];

export type ChatSource = {
  /** Source table (products, faqs, policies, distributor_training, objection_handling, knowledge_chunks). */
  table: string;
  /** Row id within that table. */
  id: string;
  /** Human-readable label (product name, FAQ question, chunk section, etc.). */
  title?: string;
  /** Optional URL to a detail page or document. */
  url?: string;
  // ---- RAG enrichment (added in v2.1) ----
  /** Page number for PDF/DOCX sources. */
  page_number?: number;
  /** Section title within the source document. */
  section?: string;
  /** Cosine similarity score 0..1. */
  score?: number;
  /** Document ID (when source is a knowledge_chunks row). */
  document_id?: string;
  /** Document display name. */
  document_name?: string;
  /** Document version number. */
  document_version?: number;
  /** Document category (product, training, policy, faq, ...). */
  document_category?: string;
  /** Document tags. */
  document_tags?: string[];
  /** Document last-updated timestamp (ISO string). */
  document_updated_at?: string;
  /** Document approval status (approved, pending, rejected). */
  approval_status?: string;
};

/** Verification status returned by the RAG retriever. */
export type VerificationStatus = "verified" | "partial" | "unverified";

/** RAG metadata returned alongside chat responses (v2.1+). */
export type RAGMetadata = {
  /** Aggregate confidence 0..1. */
  confidence: number;
  /** Verification status — verified / partial / unverified. */
  verification_status: VerificationStatus;
  /** Matched documents (deduped, ranked by score). */
  matched_documents: MatchedDocument[];
  /** Related items (populated when include_related=true). */
  related_documents: RelatedItem[];
  related_products: RelatedItem[];
  related_faqs: RelatedItem[];
  related_policies: RelatedItem[];
  /** Retrieval latency in ms. */
  retrieval_time_ms: number;
  /** Embedding model used. */
  model_used: string;
  /** Retrieved chunks (full text + metadata). */
  chunks: RetrievedChunk[];
  /** Knowledge Conflict Resolution (Capability 9) — set when 2+ matched
   * documents in the same category had different update dates; the model
   * was instructed to prefer the newer one. */
  knowledge_conflict?: {
    category: string;
    authoritative_document: string;
    authoritative_updated_at: string | null;
    other_documents: string[];
  } | null;
};

export type MatchedDocument = {
  id: string;
  name: string | null;
  category: string | null;
  tags: string[];
  language: string | null;
  version: number | null;
  approval_status: string | null;
  updated_at: string | null;
  score: number;
  chunk_count: number;
  sections: string[];
};

export type RelatedItem = {
  id: string;
  [key: string]: unknown;
};

export type RetrievedChunk = {
  chunk_id: string;
  document_id: string;
  score: number;
  chunk_text: string;
  section_title: string | null;
  page_number: number | null;
  chunk_order: number | null;
  metadata: Record<string, unknown>;
  document_name: string | null;
  document_category: string | null;
  document_approval_status: string | null;
  document_version: number | null;
  document_updated_at: string | null;
  document_tags: string[];
  document_language: string | null;
};

export type ChatResponse = {
  answer: string;
  category: string;
  sources: ChatSource[] | string[];
  safety_status: "safe" | "blocked" | string;
  handoff_required: boolean;
  /** Optional confidence score 0..1 returned by the backend RAG layer. */
  confidence?: number;
  /** Optional conversation id assigned by the backend. */
  conversation_id?: string;
  // ---- RAG enrichment (added in v2.1) ----
  verification_status?: VerificationStatus;
  handoff_message?: string | null;
  rag_metadata?: RAGMetadata | null;
  // ---- AI router labeling ----
  /** Which knowledge source(s) produced this answer. */
  answer_source?: "dayjoy_knowledge" | "web_search" | "general_llm" | "hybrid" | "casual" | "unsafe" | "live_data" | null;
  /** Which web search provider served results, when answer_source involved web search. */
  web_search_provider?: string | null;
  /** Which AI mode actually produced this answer (echoed back by the backend). */
  ai_mode?: string;
  /** Contextual next-question suggestions computed by the backend (orchestrator/followups.py). */
  follow_ups?: string[];
  /** Structured product data — only ever populated from a verified DB row
   * (pricing_lookup/product_recommendation), never fabricated. */
  products?: ChatProductCard[];
  /** Structured Response JSON (orchestrator/answer_structure.py) — parsed
   * server-side from `answer`'s own markdown. The frontend renders directly
   * from `answer` (see UserChat.tsx's own parseAnswerBlocks) rather than
   * this field; it exists for other API consumers that don't want to
   * reimplement the markdown parsing. */
  structured?: {
    tldr: string | null;
    callouts: Array<{ variant: "insight" | "warning" | "tip" | "recommended"; text: string }>;
    sections: Array<{ heading: string | null; level: number; text: string }>;
    key_points: string[];
    has_table: boolean;
    has_chart: boolean;
  } | null;
  /** Feature: Clarification Intelligence — selectable options accompanying
   * a clarifying-question answer_source="clarification" reply. Each entry
   * is a complete follow-up message, not a bare label. */
  clarification_options?: string[];
  /** Evidence Strength Indicator — qualitative label derived server-side
   * from the existing 5-state grounding classification. Never a fabricated
   * confidence percentage. One of "Strongly supported" | "Supported" |
   * "Partially supported" | "Needs verification" | "Not verified". */
  evidence_strength?: string | null;
  /** Citation Verification / Claim-Level Grounding (Capabilities 7, 8) —
   * per-claim verified/ai_analysis/assumption/unverified breakdown. null
   * when the answer didn't qualify for claim-level checking or the check
   * itself couldn't run. */
  claim_verification?: {
    checked: boolean;
    claims: Array<{ claim: string; state: "verified" | "ai_analysis" | "assumption" | "unverified" }>;
  } | null;
};

export type ChatProductCard = {
  product_id?: string | null;
  product_name?: string | null;
  category?: string | null;
  matched_condition?: string | null;
  benefits?: string | null;
  usage?: string | null;
  who_can_use?: string | null;
  safety_note?: string | null;
  /** Recommendation Strength (Capability 29) — "Strong recommendation" |
   * "Good option" | "Possible option", classified from verification status,
   * evidence source, and documented contraindications. Never a fabricated
   * numeric confidence score. Absent for a structured pricing card (only
   * product_recommendation results carry this). */
  recommendation_strength?: string | null;
  /** Reasoning Summary (Capability 36) — safe, deterministic "why this
   * recommendation" bullets built from real signals (matched condition,
   * verification status, evidence source, contraindications). Never a
   * paraphrase of hidden model reasoning — this recommendation path is
   * rule-based matching, not an LLM call. */
  reasoning_summary?: string[] | null;
  price?: {
    mrp?: number | null;
    dp?: number | null;
    bv?: number | null;
    pv?: number | null;
    currency?: string | null;
  } | null;
  /** Approved primary photo, resolved server-side from the `product_images`
   * table (see backend/orchestrator/tools/product_media.py) — null when the
   * product has none. Never a client- or LLM-supplied URL. */
  image_url?: string | null;
  image_alt?: string | null;
};

const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL?.trim().replace(/^["']|["']$/g, "") ||
  "http://127.0.0.1:8000";

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

/**
 * Resolves the current Supabase access token (if any) so we can forward it
 * to the backend. Returns null when the user is not signed in or when
 * Supabase is not configured — in those cases the backend will fall back
 * to its unauthenticated handling (which should be locked down in prod).
 */
async function getBearerToken(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Thrown by `requireBearerToken` so callers can distinguish "logged out" from other failures. */
export class SessionExpiredError extends Error {
  constructor() {
    super("Your session has expired. Please log in again.");
    this.name = "SessionExpiredError";
  }
}

/**
 * Like `getBearerToken`, but throws `SessionExpiredError` when Supabase is
 * configured yet no session is present. Without this, requests to backend
 * routes that require auth (e.g. /chat) silently went out with no
 * Authorization header and came back as an opaque "401 Authentication
 * required" — indistinguishable from a real config/backend problem.
 */
async function requireBearerToken(): Promise<string | null> {
  const token = await getBearerToken();
  if (!token && supabase) throw new SessionExpiredError();
  return token;
}

/** Overall budget for a non-streaming chat request. */
const CHAT_REQUEST_TIMEOUT_MS = 90_000;
/**
 * Silence budget for a streaming request. Armed before the first byte and
 * re-armed on every chunk, so a slow-but-progressing answer is never cut off
 * while a genuinely dead connection still fails in bounded time.
 */
const CHAT_STREAM_IDLE_TIMEOUT_MS = 45_000;

/** Thrown when we gave up waiting, as opposed to the user pressing Stop. */
export class RequestTimeoutError extends Error {
  constructor(message = "The assistant took too long to respond. Please try again.") {
    super(message);
    this.name = "RequestTimeoutError";
  }
}

/**
 * Wrap an optional caller signal with an inactivity timeout.
 *
 * Returns the merged signal plus `arm()` to restart the clock (call it as data
 * arrives) and `dispose()` to clean up. Without this, a hung upstream left the
 * UI spinning forever — there was no timeout anywhere on the frontend.
 */
function withIdleTimeout(signal: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  // Background tabs throttle (Chrome can delay by minutes) or freeze
  // `setTimeout` — a slow-but-healthy answer that took a while because the
  // user switched away got silently aborted here, either while backgrounded
  // or right as the tab regained focus, which read as "the answer never
  // arrives" even though the backend was still working. Pausing the
  // countdown while hidden means backgrounding never eats into the idle
  // budget; a genuinely dead connection still times out once the tab is
  // visible again, since `arm()` restarts the full window at that point.
  const arm = () => {
    clear();
    if (typeof document !== "undefined" && document.hidden) return;
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
  };

  const onVisibilityChange = () => {
    if (document.hidden) clear();
    else arm();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  const dispose = () => {
    clear();
    signal?.removeEventListener("abort", onAbort);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };

  arm();
  return { signal: controller.signal, arm, dispose, didTimeOut: () => timedOut };
}

/**
 * Send a chat message and return the full AI response.
 *
 * NOTE: This is the non-streaming variant. For streaming, use
 * `streamChatWithBackend` which consumes the SSE endpoint.
 */
export async function chatWithBackend(
  req: ChatRequest,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const apiBaseUrl = getApiBaseUrl();
  const url = `${apiBaseUrl}/chat`;
  const token = await requireBearerToken();

  // Previously this took no signal at all, so once the streaming path fell
  // back to it, Stop was a no-op and the request could hang indefinitely.
  const timeout = withIdleTimeout(signal, CHAT_REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "X-Client": BRAND.shortName,
      },
      body: JSON.stringify(req),
      signal: timeout.signal,
    });
  } catch (e) {
    if (timeout.didTimeOut()) throw new RequestTimeoutError();
    if ((e as Error)?.name === "AbortError") throw e;
    console.error("[chat api] request failed (network/CORS/offline).", e);
    throw new Error("Backend offline. Please try again in a moment.");
  } finally {
    timeout.dispose();
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Backend /chat failed (${res.status}). ${text}`.trim());
  }

  return (await res.json()) as ChatResponse;
}

/**
 * Summarize a first message into a short conversation title.
 *
 * Best-effort by design: returns null on any failure so callers keep their
 * own deterministic fallback rather than showing a blank sidebar entry.
 */
export async function generateConversationTitle(
  message: string,
): Promise<string | null> {
  try {
    const token = await requireBearerToken();
    const res = await fetch(`${getApiBaseUrl()}/chat/title`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "X-Client": BRAND.shortName,
      },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string };
    return data.title?.trim() || null;
  } catch {
    // Titling is cosmetic — never surface this to the user.
    return null;
  }
}

/**
 * Answer Editing, selection-scoped (Capability 12) — rewrites a specific
 * text snippet per `instruction` and returns JUST the replacement, so the
 * caller can splice it back into the original message content in place.
 * Best-effort: the backend itself returns the original text unchanged on
 * any failure (see /transform-text's docstring), so this never throws for
 * a provider error — only for a genuine network/auth failure.
 */
export async function transformTextSnippet(text: string, instruction: string): Promise<string> {
  const token = await requireBearerToken();
  const res = await fetch(`${getApiBaseUrl()}/transform-text`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-Client": BRAND.shortName,
    },
    body: JSON.stringify({ text, instruction }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Transform text failed (${res.status})`);
  const data = (await res.json()) as { result: string };
  return data.result;
}

/**
 * Feature: User Preference Learning — saves a response-style preference
 * (e.g. `preferred_explanation_level=simple`) to the user's own memory
 * (POST /memory, RLS-scoped to auth.uid()) via the EXISTING remember_fact
 * endpoint. Best-effort: never blocks or surfaces an error to the user —
 * this is a background quality-of-life save, not a critical action.
 */
export type MemoryItem = {
  id: string;
  source: string;
  key: string | null;
  value: string;
  pinned: boolean;
  updated_at: string | null;
  relevance: number;
};

/** Reads this user's own saved memory/preferences (GET /memory). Used to
 * seed the Response Style controls in Settings with the currently saved
 * selection. Best-effort: returns [] on any failure. */
export async function listUserMemory(): Promise<MemoryItem[]> {
  try {
    const token = await requireBearerToken();
    if (!token) return [];
    const res = await fetch(`${getApiBaseUrl()}/memory`, {
      headers: { Authorization: `Bearer ${token}`, "X-Client": BRAND.shortName },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: MemoryItem[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

export async function rememberPreference(key: string, value: string): Promise<boolean> {
  try {
    const token = await requireBearerToken();
    if (!token) return false;
    const res = await fetch(`${getApiBaseUrl()}/memory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Client": BRAND.shortName,
      },
      body: JSON.stringify({ key, value, pinned: false }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Streaming chat — opens an SSE connection to `/chat/stream` and invokes
 * `onToken` for each token chunk. Returns the final aggregated response.
 *
 * If the backend does not yet implement streaming, this falls back to the
 * non-streaming endpoint transparently.
 */
export async function streamChatWithBackend(
  req: ChatRequest,
  onToken: (chunk: string) => void,
  signal?: AbortSignal,
  onStatus?: (status: string) => void,
): Promise<ChatResponse> {
  const apiBaseUrl = getApiBaseUrl();
  const streamUrl = `${apiBaseUrl}/chat/stream`;
  const token = await requireBearerToken();

  const timeout = withIdleTimeout(signal, CHAT_STREAM_IDLE_TIMEOUT_MS);

  try {
    const res = await fetch(streamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "X-Client": BRAND.shortName,
      },
      body: JSON.stringify(req),
      signal: timeout.signal,
    });

    if (!res.ok || !res.body) {
      // Backend doesn't support streaming — fall back.
      const fallback = await chatWithBackend(req, signal);
      onToken(fallback.answer);
      return fallback;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let aggregated = "";
    let finalMeta: Partial<ChatResponse> = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Progress resets the silence clock — a long answer is fine, a dead
      // socket is not.
      timeout.arm();
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by \n\n
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const lines = frame.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const evt = JSON.parse(payload);
            if (evt.status) {
              onStatus?.(evt.status);
            }
            if (evt.token) {
              aggregated += evt.token;
              onToken(evt.token);
            }
            if (evt.done) {
              finalMeta = evt;
            }
          } catch {
            // ignore malformed frames
          }
        }
      }
    }

    return {
      answer: aggregated || finalMeta.answer || "",
      category: finalMeta.category ?? "general",
      sources: finalMeta.sources ?? [],
      safety_status: finalMeta.safety_status ?? "safe",
      handoff_required: finalMeta.handoff_required ?? false,
      confidence: finalMeta.confidence,
      conversation_id: finalMeta.conversation_id ?? req.conversation_id,
      verification_status: finalMeta.verification_status,
      handoff_message: finalMeta.handoff_message,
      rag_metadata: finalMeta.rag_metadata,
      answer_source: finalMeta.answer_source,
      web_search_provider: finalMeta.web_search_provider,
      ai_mode: finalMeta.ai_mode ?? req.ai_mode,
      follow_ups: finalMeta.follow_ups,
      products: finalMeta.products,
      structured: finalMeta.structured,
      clarification_options: finalMeta.clarification_options,
      evidence_strength: finalMeta.evidence_strength,
      claim_verification: finalMeta.claim_verification,
    };
  } catch (e) {
    // Our own idle timeout aborted the fetch — surface it as a timeout rather
    // than retrying against a backend that has already gone quiet.
    if (timeout.didTimeOut()) throw new RequestTimeoutError();
    if ((e as Error).name === "AbortError") throw e;
    if (e instanceof SessionExpiredError) throw e;
    // Fall back to non-streaming.
    console.warn("[chat api] streaming failed, falling back to non-stream.", e);
    const fallback = await chatWithBackend(req, signal);
    onToken(fallback.answer);
    return fallback;
  } finally {
    timeout.dispose();
  }
}

/**
 * Health-check the backend.
 */
export async function healthCheck(): Promise<boolean> {
  const apiBaseUrl = getApiBaseUrl();
  try {
    const res = await fetch(`${apiBaseUrl}/health`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Runtime capability status (currently: image understanding). Backend
 * probes the AI provider live and caches for a few minutes, so this
 * reflects reality — e.g. flips to available automatically once OpenAI
 * billing is restored, no redeploy needed.
 */
export interface CapabilityStatus {
  available: boolean;
  reason: string | null;
  message: string | null;
}

export async function getCapabilities(): Promise<{ vision: CapabilityStatus; web_search: CapabilityStatus; chat: { available: boolean } } | null> {
  const apiBaseUrl = getApiBaseUrl();
  try {
    const res = await fetch(`${apiBaseUrl}/capabilities`, { method: "GET" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Submit thumbs-up/down feedback for a chat response.
 */
export async function submitChatFeedback(params: {
  message_id?: string;
  conversation_id?: string;
  rating: "up" | "down";
  comment?: string;
}): Promise<void> {
  const apiBaseUrl = getApiBaseUrl();
  const token = await getBearerToken();
  try {
    await fetch(`${apiBaseUrl}/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
    });
  } catch (e) {
    console.warn("[chat api] feedback submit failed", e);
  }
}

// ===========================================================================
// RAG API (added in v2.1) — admin document management + retrieval
// ===========================================================================

/** Common headers for RAG API calls (includes bearer token when available). */
async function ragHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await getBearerToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "X-Client": BRAND.shortName,
    ...extra,
  };
}

/** RAG health-check. */
export async function ragHealth(): Promise<{
  status: string;
  rag_available: boolean;
  import_error: string | null;
  supabase_configured: boolean;
  embedding_provider: { name?: string; dimensions?: number; error?: string };
  storage_bucket: string;
  confidence_floor: number;
  handoff_threshold: number;
} | null> {
  const apiBaseUrl = getApiBaseUrl();
  try {
    const res = await fetch(`${apiBaseUrl}/rag/health`, { method: "GET" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Document row returned by /rag/documents. */
export type RAGDocument = {
  id: string;
  document_id: string | null;
  file_name: string | null;
  file_type: string | null;
  file_url: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  storage_path: string | null;
  category: string | null;
  tags: string[] | null;
  language: string | null;
  source: string | null;
  version: number | null;
  previous_version_id: string | null;
  is_archived: boolean | null;
  approval_status: string | null;
  uploaded_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  chunk_count: number | null;
  token_count: number | null;
  checksum: string | null;
  extracted_text: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/** List knowledge documents with filters + pagination. */
export async function ragListDocuments(params: {
  limit?: number;
  offset?: number;
  category?: string;
  approval_status?: string;
  search?: string;
} = {}): Promise<{ documents: RAGDocument[]; total: number; limit: number; offset: number }> {
  const apiBaseUrl = getApiBaseUrl();
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  if (params.category) qs.set("category", params.category);
  if (params.approval_status) qs.set("approval_status", params.approval_status);
  if (params.search) qs.set("search", params.search);
  const headers = await ragHeaders();
  const res = await fetch(`${apiBaseUrl}/rag/documents?${qs.toString()}`, { headers });
  if (!res.ok) throw new Error(`ragListDocuments failed (${res.status})`);
  return await res.json();
}

/** Get a single document with its chunks + version history. */
export async function ragGetDocument(documentId: string): Promise<{
  document: RAGDocument;
  chunks: Array<Record<string, unknown>>;
  versions: Array<Record<string, unknown>>;
}> {
  const apiBaseUrl = getApiBaseUrl();
  const headers = await ragHeaders();
  const res = await fetch(`${apiBaseUrl}/rag/documents/${encodeURIComponent(documentId)}`, { headers });
  if (!res.ok) throw new Error(`ragGetDocument failed (${res.status})`);
  return await res.json();
}

/** Upload + ingest a knowledge document (multipart/form-data). */
export async function ragUploadDocument(params: {
  file: File;
  category?: string;
  language?: string;
  tags?: string;
  document_name?: string;
  approval_status?: string;
  source?: string;
}): Promise<{
  document_id: string;
  chunk_count: number;
  embedding_count: number;
  token_count: number;
  char_count: number;
  page_count: number;
  sections: number;
  model_used: string;
  dimensions: number;
  error: string | null;
}> {
  const apiBaseUrl = getApiBaseUrl();
  const form = new FormData();
  form.append("file", params.file);
  if (params.category) form.append("category", params.category);
  if (params.language) form.append("language", params.language);
  if (params.tags) form.append("tags", params.tags);
  if (params.document_name) form.append("document_name", params.document_name);
  if (params.approval_status) form.append("approval_status", params.approval_status);
  if (params.source) form.append("source", params.source);
  const headers = await ragHeaders();
  // Don't set Content-Type — browser sets it with boundary for FormData
  const res = await fetch(`${apiBaseUrl}/rag/documents`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }
  return await res.json();
}

/** Re-index an existing document (re-chunk + re-embed). */
export async function ragReindexDocument(documentId: string): Promise<Record<string, unknown>> {
  const apiBaseUrl = getApiBaseUrl();
  const headers = await ragHeaders();
  const res = await fetch(`${apiBaseUrl}/rag/documents/${encodeURIComponent(documentId)}/reindex`, {
    method: "POST",
    headers,
  });
  if (!res.ok) throw new Error(`Reindex failed (${res.status})`);
  return await res.json();
}

/** Approve / reject / archive a document. */
export async function ragUpdateApproval(
  documentId: string,
  approval_status: "approved" | "rejected" | "pending" | "archived",
  rejection_reason?: string,
): Promise<{ document: RAGDocument }> {
  const apiBaseUrl = getApiBaseUrl();
  const headers = await ragHeaders({ "Content-Type": "application/json" });
  const res = await fetch(`${apiBaseUrl}/rag/documents/${encodeURIComponent(documentId)}/approval`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ approval_status, rejection_reason }),
  });
  if (!res.ok) throw new Error(`Approval update failed (${res.status})`);
  return await res.json();
}

/** Delete (or soft-archive) a document. */
export async function ragDeleteDocument(documentId: string, archiveOnly = true): Promise<{ status: string; document_id: string }> {
  const apiBaseUrl = getApiBaseUrl();
  const headers = await ragHeaders();
  const qs = archiveOnly ? "?archive_only=true" : "?archive_only=false";
  const res = await fetch(`${apiBaseUrl}/rag/documents/${encodeURIComponent(documentId)}${qs}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
  return await res.json();
}

/** Replace a document with a new version. */
export async function ragReplaceDocument(
  documentId: string,
  file: File,
  changeSummary?: string,
): Promise<Record<string, unknown>> {
  const apiBaseUrl = getApiBaseUrl();
  const form = new FormData();
  form.append("file", file);
  if (changeSummary) form.append("change_summary", changeSummary);
  const headers = await ragHeaders();
  const res = await fetch(`${apiBaseUrl}/rag/documents/${encodeURIComponent(documentId)}/replace`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!res.ok) throw new Error(`Replace failed (${res.status})`);
  return await res.json();
}

/** Direct RAG search (no LLM call). Returns chunks + matched documents. */
export async function ragSearch(req: {
  query: string;
  top_k?: number;
  min_similarity?: number;
  language?: string;
  include_related?: boolean;
}): Promise<{
  query: string;
  chunks: RetrievedChunk[];
  confidence: number;
  verification_status: VerificationStatus;
  matched_documents: MatchedDocument[];
  related_documents: RelatedItem[];
  related_products: RelatedItem[];
  related_faqs: RelatedItem[];
  related_policies: RelatedItem[];
  sources: ChatSource[];
  retrieval_time_ms: number;
  model_used: string;
  cache_hit: boolean;
  handoff_required: boolean;
  handoff_message: string | null;
}> {
  const apiBaseUrl = getApiBaseUrl();
  const headers = await ragHeaders({ "Content-Type": "application/json" });
  const res = await fetch(`${apiBaseUrl}/rag/search`, {
    method: "POST",
    headers,
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`RAG search failed (${res.status})`);
  return await res.json();
}

/** Create a support ticket from a low-confidence RAG answer. */
export async function ragCreateSupportTicket(req: {
  query: string;
  conversation_id?: string;
  rag_query_id?: string;
  confidence?: number;
  verification_status?: string;
  cited_sources?: Array<Record<string, unknown>>;
  issue_category?: string;
  priority?: string;
}): Promise<{ ticket: Record<string, unknown> | null }> {
  const apiBaseUrl = getApiBaseUrl();
  const headers = await ragHeaders({ "Content-Type": "application/json" });
  const res = await fetch(`${apiBaseUrl}/rag/support-ticket`, {
    method: "POST",
    headers,
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Ticket creation failed (${res.status})`);
  return await res.json();
}

/** List recent RAG queries (audit log). Staff only. */
export async function ragListQueries(params: {
  limit?: number;
  offset?: number;
  verification_status?: string;
} = {}): Promise<{ queries: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  const apiBaseUrl = getApiBaseUrl();
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  if (params.verification_status) qs.set("verification_status", params.verification_status);
  const headers = await ragHeaders();
  const res = await fetch(`${apiBaseUrl}/rag/queries?${qs.toString()}`, { headers });
  if (!res.ok) throw new Error(`ragListQueries failed (${res.status})`);
  return await res.json();
}

/** Aggregate RAG stats (admin dashboard). Staff only. */
export async function ragStats(): Promise<{
  documents: { total: number; approved: number; pending: number; archived: number };
  chunks_total: number;
  embeddings_active: number;
  queries: { total: number; unverified: number };
  support_tickets_from_rag: number;
}> {
  const apiBaseUrl = getApiBaseUrl();
  const headers = await ragHeaders();
  const res = await fetch(`${apiBaseUrl}/rag/stats`, { headers });
  if (!res.ok) throw new Error(`ragStats failed (${res.status})`);
  return await res.json();
}

/** List chunks for a document (paginated). */
export async function ragListChunks(
  documentId: string,
  params: { limit?: number; offset?: number } = {},
): Promise<{
  chunks: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
}> {
  const apiBaseUrl = getApiBaseUrl();
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  const headers = await ragHeaders();
  const res = await fetch(
    `${apiBaseUrl}/rag/documents/${encodeURIComponent(documentId)}/chunks?${qs.toString()}`,
    { headers },
  );
  if (!res.ok) throw new Error(`ragListChunks failed (${res.status})`);
  return await res.json();
}

// ===========================================================================
// Phase 2 — Enterprise Admin Console API
// ===========================================================================

/** Admin API response shapes. */
export type AdminStats = {
  users: { total: number; active_7d: number };
  ai: {
    conversations_today: number;
    total_rag_queries: number;
    failed_queries: number;
    accuracy_pct: number | null;
    escalations: number;
    avg_response_time_ms: number | null;
  };
  knowledge: {
    total_products: number;
    total_documents: number;
    total_chunks: number;
    pending_approvals: number;
  };
  support: { pending_tickets: number };
  training: { avg_completion_pct: number; course_count: number };
  top_products: Array<{ product_name: string; category: string | null; view_count: number }>;
  top_questions: Array<{ question: string; ask_count: number; last_asked: string }>;
};

export type AdminSearchResult = {
  entity_id: string;
  entity_type: "user" | "product" | "document" | "faq" | "training" | "policy" | "ticket" | "course";
  title: string | null;
  subtitle: string | null;
  metadata: string | null;
  created_at: string | null;
};

export type AIConfig = {
  id?: string;
  groq_model?: string;
  openai_model?: string;
  temperature?: number;
  max_tokens?: number;
  streaming_enabled?: boolean;
  system_prompt?: string;
  fallback_message?: string;
  confidence_floor?: number;
  handoff_threshold?: number;
  top_k?: number;
  min_similarity?: number;
  memory_enabled?: boolean;
  max_history_turns?: number;
  supported_languages?: string[];
  default_language?: string;
};

export type RolePermission = {
  id?: string;
  role: string;
  page: string;
  action: string;
  allowed: boolean;
};

export type AdminUser = {
  id: string;
  full_name: string | null;
  role: string;
  language?: string | null;
  region?: string | null;
  created_at?: string | null;
};

export type AdminProduct = {
  id: string;
  product_name: string;
  brand?: string | null;
  sku?: string | null;
  category?: string | null;
  sub_category?: string | null;
  benefits?: string | null;
  ingredients?: string | null;
  usage?: string | null;
  warnings?: string | null;
  safety_note?: string | null;
  problem_tags?: string[] | null;
  who_can_use?: string | null;
  source?: string | null;
  faqs_json?: Record<string, unknown> | null;
  approval_status?: string | null;
  is_archived?: boolean | null;
  created_at?: string | null;
};

export type AdminFAQ = {
  id: string;
  question: string;
  answer: string;
  category?: string | null;
  approval_status?: string | null;
};

export type AdminCourse = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  difficulty?: string | null;
  estimated_hours?: number | null;
  is_published?: boolean;
  approval_status?: string;
  created_at?: string;
};

export type AdminAuditLog = {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};

export type AdminAPIKey = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
};

export type OrgSettings = {
  company_name?: string;
  logo_url?: string | null;
  primary_color?: string;
  accent_color?: string;
  support_email?: string | null;
  support_phone?: string | null;
  default_language?: string;
  enabled_languages?: string[];
  storage_quota_mb?: number;
  password_min_length?: number;
  session_timeout_minutes?: number;
};

// ---- Admin client functions ----

async function adminGet<T>(path: string): Promise<T> {
  const headers = await ragHeaders();
  const res = await fetch(`${getApiBaseUrl()}${path}`, { headers });
  if (!res.ok) throw new Error(`Admin GET ${path} failed (${res.status})`);
  return await res.json();
}

async function adminJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await ragHeaders({ "Content-Type": "application/json" });
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Admin ${method} ${path} failed (${res.status}): ${text}`);
  }
  return await res.json();
}

/** Executive dashboard stats. */
export async function adminGetStats(): Promise<AdminStats> {
  return adminGet<AdminStats>("/admin/stats");
}

/** Universal admin search. */
export async function adminSearch(q: string, entity_type?: string, limit = 20): Promise<{ results: AdminSearchResult[]; total: number; query: string }> {
  const qs = new URLSearchParams({ q, limit: String(limit) });
  if (entity_type) qs.set("entity_type", entity_type);
  return adminGet(`/admin/search?${qs.toString()}`);
}

/** AI config — get. */
export async function adminGetAIConfig(): Promise<AIConfig> {
  return adminGet<AIConfig>("/admin/ai-config");
}

/** AI config — update. */
export async function adminUpdateAIConfig(payload: Partial<AIConfig>): Promise<{ config: AIConfig }> {
  return adminJson("PATCH", "/admin/ai-config", payload);
}

/** Safety rules — list. */
export async function adminGetSafetyRules(): Promise<Array<Record<string, unknown>>> {
  return adminGet("/admin/safety-rules");
}

/** Safety rule — update. */
export async function adminUpdateSafetyRule(ruleId: string, payload: Record<string, unknown>): Promise<{ rule: Record<string, unknown> | null }> {
  return adminJson("PATCH", `/admin/safety-rules/${ruleId}`, payload);
}

/** RBAC — list. */
export async function adminGetRolePermissions(): Promise<RolePermission[]> {
  return adminGet("/admin/roles/permissions");
}

/** RBAC — bulk update. */
export async function adminUpdateRolePermissions(permissions: RolePermission[]): Promise<{ status: string; updated: number }> {
  return adminJson("PUT", "/admin/roles/permissions", { permissions });
}

/** Users — list. */
export async function adminListUsers(params: { limit?: number; offset?: number; search?: string; role?: string } = {}): Promise<{ users: AdminUser[]; total: number; limit: number; offset: number }> {
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  if (params.search) qs.set("search", params.search);
  if (params.role) qs.set("role", params.role);
  return adminGet(`/admin/users?${qs.toString()}`);
}

/** Users — update. */
export async function adminUpdateUser(userId: string, payload: Partial<{ full_name: string; role: string; language: string; region: string; is_suspended: boolean }>): Promise<{ user: AdminUser | null }> {
  return adminJson("PATCH", `/admin/users/${userId}`, payload);
}

/** Users — reset password. */
export async function adminResetUserPassword(userId: string): Promise<{ status: string }> {
  return adminJson("POST", `/admin/users/${userId}/reset-password`, {});
}

/** Users — export CSV. */
export async function adminExportUsers(role?: string): Promise<{ csv: string; count: number }> {
  const qs = new URLSearchParams();
  if (role) qs.set("role", role);
  return adminJson("POST", `/admin/users/export?${qs.toString()}`, {});
}

/** Products — create. */
export async function adminCreateProduct(payload: Partial<AdminProduct>): Promise<{ product: AdminProduct | null }> {
  return adminJson("POST", "/admin/products", payload);
}

/** Products — update. */
export async function adminUpdateProduct(productId: string, payload: Partial<AdminProduct>): Promise<{ product: AdminProduct | null }> {
  return adminJson("PATCH", `/admin/products/${productId}`, payload);
}

/** Products — delete. */
export async function adminDeleteProduct(productId: string): Promise<{ status: string }> {
  const headers = await ragHeaders();
  const res = await fetch(`${getApiBaseUrl()}/admin/products/${productId}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Delete product failed (${res.status})`);
  return await res.json();
}

/** A single product photo row (product_images table) — the approved-media
 * source for both Product Discovery and the chat Product Visual
 * Intelligence cards (see backend/orchestrator/tools/product_media.py). */
export type AdminProductImage = {
  id: string;
  product_id: string;
  image_url: string;
  alt_text?: string | null;
  is_primary?: boolean | null;
  display_order?: number | null;
};

/** Product images — add. */
export async function adminCreateProductImage(
  productId: string,
  payload: { image_url: string; alt_text?: string; is_primary?: boolean; display_order?: number },
): Promise<{ image: AdminProductImage | null }> {
  return adminJson("POST", `/admin/products/${productId}/images`, payload);
}

/** Product images — update (e.g. set as primary). */
export async function adminUpdateProductImage(
  productId: string,
  imageId: string,
  payload: Partial<{ alt_text: string; is_primary: boolean; display_order: number }>,
): Promise<{ image: AdminProductImage | null }> {
  return adminJson("PATCH", `/admin/products/${productId}/images/${imageId}`, payload);
}

/** Product images — remove. */
export async function adminDeleteProductImage(productId: string, imageId: string): Promise<{ status: string }> {
  const headers = await ragHeaders();
  const res = await fetch(`${getApiBaseUrl()}/admin/products/${productId}/images/${imageId}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw new Error(`Delete product image failed (${res.status})`);
  return await res.json();
}

/** FAQs — create. */
export async function adminCreateFAQ(payload: Partial<AdminFAQ>): Promise<{ faq: AdminFAQ | null }> {
  return adminJson("POST", "/admin/faqs", payload);
}

/** FAQs — update. */
export async function adminUpdateFAQ(faqId: string, payload: Partial<AdminFAQ>): Promise<{ faq: AdminFAQ | null }> {
  return adminJson("PATCH", `/admin/faqs/${faqId}`, payload);
}

/** FAQs — delete. */
export async function adminDeleteFAQ(faqId: string): Promise<{ status: string }> {
  const headers = await ragHeaders();
  const res = await fetch(`${getApiBaseUrl()}/admin/faqs/${faqId}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Delete FAQ failed (${res.status})`);
  return await res.json();
}

/** Training courses — list. */
export async function adminListCourses(params: { limit?: number; offset?: number } = {}): Promise<{ courses: AdminCourse[]; total: number; limit: number; offset: number }> {
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  return adminGet(`/admin/training/courses?${qs.toString()}`);
}

/** Training courses — create. */
export async function adminCreateCourse(payload: Partial<AdminCourse>): Promise<{ course: AdminCourse | null }> {
  return adminJson("POST", "/admin/training/courses", payload);
}

/** Training courses — update. */
export async function adminUpdateCourse(courseId: string, payload: Partial<AdminCourse>): Promise<{ course: AdminCourse | null }> {
  return adminJson("PATCH", `/admin/training/courses/${courseId}`, payload);
}

/** Training courses — delete. */
export async function adminDeleteCourse(courseId: string): Promise<{ status: string }> {
  const headers = await ragHeaders();
  const res = await fetch(`${getApiBaseUrl()}/admin/training/courses/${courseId}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Delete course failed (${res.status})`);
  return await res.json();
}

/** Support tickets — update (assign, escalate, resolve). */
export async function adminUpdateTicket(ticketId: string, payload: Partial<{ status: string; priority: string; assigned_to: string; issue_category: string; escalated: boolean; resolution_notes: string }>): Promise<{ ticket: Record<string, unknown> | null }> {
  return adminJson("PATCH", `/admin/support/tickets/${ticketId}`, payload);
}

/** Support tickets — add note. */
export async function adminAddTicketNote(ticketId: string, note: string, isInternal = true): Promise<{ note: Record<string, unknown> | null }> {
  return adminJson("POST", `/admin/support/tickets/${ticketId}/notes`, { note, is_internal: isInternal });
}

/** Support tickets — list notes. */
export async function adminListTicketNotes(ticketId: string): Promise<Array<Record<string, unknown>>> {
  return adminGet(`/admin/support/tickets/${ticketId}/notes`);
}

/** Analytics — daily summary. */
export async function adminAnalyticsSummary(days = 30): Promise<{ days: Array<{ day: string; total_queries: number; blocked_queries: number; safe_queries: number; unique_users: number }> }> {
  return adminGet(`/admin/analytics/summary?days=${days}`);
}

/** Analytics — top products. */
export async function adminTopProducts(limit = 10): Promise<Array<{ product_name: string; category: string | null; view_count: number }>> {
  return adminGet(`/admin/analytics/top-products?limit=${limit}`);
}

/** Analytics — top questions. */
export async function adminTopQuestions(limit = 20): Promise<Array<{ question: string; ask_count: number; last_asked: string }>> {
  return adminGet(`/admin/analytics/top-questions?limit=${limit}`);
}

/** Analytics — knowledge gaps. */
export async function adminKnowledgeGaps(limit = 50): Promise<Array<Record<string, unknown>>> {
  return adminGet(`/admin/analytics/knowledge-gaps?limit=${limit}`);
}

/** Knowledge Freshness Monitoring (Capability 42) —
 * backend/admin_api.py's admin_knowledge_freshness. */
export type KnowledgeFreshnessReport = {
  stale_documents: Array<{ id: string; file_name: string; last_updated: string; days_since_update: number }>;
  missing_metadata_documents: Array<{ id: string; file_name: string; missing_category: boolean; missing_tags: boolean }>;
  duplicate_documents: Array<{ file_name: string; count: number; document_ids: string[] }>;
  total_active_documents: number;
  stale_after_days: number;
};

export async function adminKnowledgeFreshness(staleAfterDays = 180): Promise<KnowledgeFreshnessReport> {
  return adminGet(`/admin/analytics/knowledge-freshness?stale_after_days=${staleAfterDays}`);
}

/** Feature: Feedback Learning aggregation — backend/admin_api.py's
 * admin_feedback_summary. */
export type AdminFeedbackSummary = {
  total_rated: number;
  total_up: number;
  total_down: number;
  satisfaction_rate: number | null;
  by_answer_source: Record<string, { up: number; down: number }>;
  by_ai_mode: Record<string, { up: number; down: number }>;
  recent_negative_comments: Array<{ feedback_comment: string | null; answer_source: string | null; ai_mode: string | null; created_at: string | null }>;
};

export async function adminFeedbackSummary(): Promise<AdminFeedbackSummary> {
  return adminGet(`/admin/analytics/feedback-summary`);
}

/** Feature: Observability Dashboard — backend/admin_api.py's
 * admin_observability. */
export type AdminObservability = {
  migration_applied: boolean;
  window_days: number;
  total_requests: number;
  blocked_requests: number;
  safety_block_rate: number | null;
  by_category: Record<string, number>;
  by_answer_route: Record<string, number>;
  by_ai_mode: Record<string, number> | null;
  avg_confidence: number | null;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
};

export async function adminObservability(days = 7): Promise<AdminObservability> {
  return adminGet(`/admin/analytics/observability?days=${days}`);
}

/** Audit logs — list with filters. */
export async function adminAuditLogs(params: { limit?: number; offset?: number; action?: string; entity_type?: string; created_by?: string } = {}): Promise<{ logs: AdminAuditLog[]; total: number; limit: number; offset: number }> {
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  if (params.action) qs.set("action", params.action);
  if (params.entity_type) qs.set("entity_type", params.entity_type);
  if (params.created_by) qs.set("created_by", params.created_by);
  return adminGet(`/admin/audit?${qs.toString()}`);
}

/** Notifications — list templates. */
export async function adminListNotificationTemplates(): Promise<Array<Record<string, unknown>>> {
  return adminGet("/admin/notifications/templates");
}

/** Notifications — broadcast. */
export async function adminBroadcastNotification(payload: { title: string; body: string; category?: string; target_role?: string; target_user_id?: string; channels?: string[] }): Promise<{ notification: Record<string, unknown> | null }> {
  return adminJson("POST", "/admin/notifications/broadcast", payload);
}

/** Org settings — get. */
export async function adminGetOrgSettings(): Promise<OrgSettings> {
  return adminGet("/admin/org-settings");
}

/** Org settings — update. */
export async function adminUpdateOrgSettings(payload: Partial<OrgSettings>): Promise<{ settings: OrgSettings }> {
  return adminJson("PATCH", "/admin/org-settings", payload);
}

/** API keys — list. */
export async function adminListAPIKeys(): Promise<AdminAPIKey[]> {
  return adminGet("/admin/api-keys");
}

/** API keys — create (returns full key once). */
export async function adminCreateAPIKey(payload: { name: string; scopes?: string[]; expires_at?: string }): Promise<{ key: string; record: AdminAPIKey | null }> {
  return adminJson("POST", "/admin/api-keys", payload);
}

/** API keys — revoke. */
export async function adminRevokeAPIKey(keyId: string): Promise<{ status: string }> {
  const headers = await ragHeaders();
  const res = await fetch(`${getApiBaseUrl()}/admin/api-keys/${keyId}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Revoke API key failed (${res.status})`);
  return await res.json();
}

// ===========================================================================
// Phase 3 — Distributor AI Copilot API
// ===========================================================================

export type DistributorDashboard = {
  user_id: string;
  goals: {
    daily: Array<Record<string, unknown>>;
    monthly: Array<Record<string, unknown>>;
    pending_count: number;
  };
  customers: { total: number; active: number; leads: number };
  follow_ups: {
    pending: number;
    overdue: number;
    due_today: number;
    recent: Array<Record<string, unknown>>;
  };
  team: { total: number; active: number };
  today: { sales_amount: number; calls_made: number; ai_queries: number; content_generated: number };
  recent_content: Array<Record<string, unknown>>;
  suggestions: Array<Record<string, unknown>>;
  upcoming_events: Array<Record<string, unknown>>;
  business_health_score: number | null;
};

export type CustomerProfile = {
  id?: string;
  distributor_id?: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  age?: number | null;
  gender?: string | null;
  city?: string | null;
  state?: string | null;
  location?: string | null;
  interests?: string[] | null;
  health_goals?: string[] | null;
  lifestyle?: string | null;
  preferred_language?: string;
  budget_range?: string | null;
  notes?: string | null;
  tags?: string[] | null;
  status?: string;
  next_contact_at?: string | null;
  birthday?: string | null;
  last_contacted_at?: string | null;
  created_at?: string;
};

export type FollowUp = {
  id?: string;
  distributor_id?: string;
  customer_id?: string | null;
  customer_name?: string | null;
  task_type?: string;
  title: string;
  description?: string | null;
  due_date: string;
  completed_at?: string | null;
  status?: string;
  priority?: string;
  outcome?: string | null;
  ai_generated?: boolean;
  ai_suggestion?: string | null;
  created_at?: string;
};

export type GeneratedContent = {
  id?: string;
  user_id?: string;
  content_type: string;
  title?: string | null;
  content: string;
  prompt?: string | null;
  language?: string;
  tone?: string | null;
  tags?: string[] | null;
  is_favorite?: boolean;
  usage_count?: number;
  created_at?: string;
};

export type TeamMember = {
  id?: string;
  leader_id?: string;
  member_id?: string | null;
  member_name: string;
  member_email?: string | null;
  member_phone?: string | null;
  joined_date?: string;
  level?: number;
  status?: string;
  rank?: string;
  total_sales?: number;
  team_size?: number;
  training_completion?: number;
  last_active_at?: string | null;
  notes?: string | null;
};

/**
 * Timeout + single-retry wrapper for Business Hub data fetches.
 *
 * The backend (Render free tier) spins down after ~15min idle and takes
 * 20-50s to cold-start on the next request. A plain `fetch` here had no
 * timeout at all, so the first request after any idle period either hung
 * indefinitely or surfaced the browser's raw "Failed to fetch" as the
 * entire page content (every Business Hub page's `catch` rendered
 * `e.message` verbatim). This bounds the wait, retries once after a short
 * delay (covers transient blips and gives a cold instance a second shot),
 * and normalizes failures into a message users can actually act on.
 */
const DIST_FETCH_TIMEOUT_MS = 25_000;
const DIST_FETCH_RETRY_DELAY_MS = 2_500;

async function resilientFetch(url: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIST_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!attempt && [502, 503, 504].includes(res.status)) {
      await new Promise((r) => setTimeout(r, DIST_FETCH_RETRY_DELAY_MS));
      return resilientFetch(url, init, attempt + 1);
    }
    return res;
  } catch {
    if (!attempt) {
      await new Promise((r) => setTimeout(r, DIST_FETCH_RETRY_DELAY_MS));
      return resilientFetch(url, init, attempt + 1);
    }
    throw new Error(
      "Couldn't reach the server — it may be waking up after being idle. Please try again in a few seconds.",
    );
  } finally {
    clearTimeout(timer);
  }
}

async function distGet<T>(path: string): Promise<T> {
  const headers = await ragHeaders();
  const res = await resilientFetch(`${getApiBaseUrl()}${path}`, { headers });
  if (!res.ok) throw new Error(`Distributor GET ${path} failed (${res.status})`);
  return await res.json();
}

async function distJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await ragHeaders({ "Content-Type": "application/json" });
  const res = await resilientFetch(`${getApiBaseUrl()}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Distributor ${method} ${path} failed (${res.status}): ${text}`);
  }
  return await res.json();
}

async function distDelete(path: string): Promise<{ status: string }> {
  const headers = await ragHeaders();
  const res = await resilientFetch(`${getApiBaseUrl()}${path}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Distributor DELETE ${path} failed (${res.status})`);
  return await res.json();
}

/** Dashboard KPIs. */
export async function distributorDashboard(): Promise<DistributorDashboard> {
  return distGet<DistributorDashboard>("/distributor/dashboard");
}

/** Goals — list. */
export async function distributorListGoals(): Promise<Array<Record<string, unknown>>> {
  return distGet("/distributor/goals");
}

/** Goals — create. */
export async function distributorCreateGoal(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return distJson("POST", "/distributor/goals", payload);
}

/** Goals — update. */
export async function distributorUpdateGoal(goalId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return distJson("PATCH", `/distributor/goals/${goalId}`, payload);
}

/** Goals — delete. */
export async function distributorDeleteGoal(goalId: string): Promise<{ status: string }> {
  return distDelete(`/distributor/goals/${goalId}`);
}

/** Customers — list. */
export async function distributorListCustomers(params: { search?: string; status?: string; limit?: number } = {}): Promise<{ customers: CustomerProfile[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.status) qs.set("status", params.status);
  if (params.limit != null) qs.set("limit", String(params.limit));
  return distGet(`/distributor/customers?${qs.toString()}`);
}

/** Customers — create. */
export async function distributorCreateCustomer(payload: Partial<CustomerProfile>): Promise<CustomerProfile> {
  return distJson("POST", "/distributor/customers", payload);
}

/** Customers — update. */
export async function distributorUpdateCustomer(customerId: string, payload: Partial<CustomerProfile>): Promise<CustomerProfile> {
  return distJson("PATCH", `/distributor/customers/${customerId}`, payload);
}

/** Customers — delete. */
export async function distributorDeleteCustomer(customerId: string): Promise<{ status: string }> {
  return distDelete(`/distributor/customers/${customerId}`);
}

/** Follow-ups — list. */
export async function distributorListFollowUps(params: { status?: string; limit?: number } = {}): Promise<{ follow_ups: FollowUp[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.limit != null) qs.set("limit", String(params.limit));
  return distGet(`/distributor/follow-ups?${qs.toString()}`);
}

/** Follow-ups — create. */
export async function distributorCreateFollowUp(payload: Partial<FollowUp>): Promise<FollowUp> {
  return distJson("POST", "/distributor/follow-ups", payload);
}

/** Follow-ups — update. */
export async function distributorUpdateFollowUp(fuId: string, payload: Partial<FollowUp>): Promise<FollowUp> {
  return distJson("PATCH", `/distributor/follow-ups/${fuId}`, payload);
}

/** Follow-ups — delete. */
export async function distributorDeleteFollowUp(fuId: string): Promise<{ status: string }> {
  return distDelete(`/distributor/follow-ups/${fuId}`);
}

// ---------------------------------------------------------------------------
// Artifacts (Advanced Intelligence Layer capabilities 14-16: Artifact
// Generation, Task Continuation, Response Versioning) — backend/artifacts_api.py
// ---------------------------------------------------------------------------

export type ArtifactType =
  | "action_plan" | "report" | "checklist" | "training_plan"
  | "sales_plan" | "summary" | "business_document" | "guide";

export type Artifact = {
  id: string;
  user_id?: string;
  conversation_id?: string | null;
  artifact_type: ArtifactType;
  title: string;
  content: string;
  content_structured?: Record<string, unknown> | null;
  version: number;
  parent_artifact_id?: string | null;
  status?: string;
  created_at?: string;
  updated_at?: string;
};

export async function createArtifact(payload: {
  artifact_type: ArtifactType;
  title: string;
  content: string;
  content_structured?: Record<string, unknown> | null;
  conversation_id?: string | null;
}): Promise<Artifact> {
  return distJson("POST", "/artifacts", payload);
}

export async function listArtifacts(artifactType?: ArtifactType): Promise<{ artifacts: Artifact[]; total: number }> {
  const qs = artifactType ? `?artifact_type=${artifactType}` : "";
  return distGet(`/artifacts${qs}`);
}

export async function listArtifactVersions(artifactId: string): Promise<{ versions: Artifact[]; total: number }> {
  return distGet(`/artifacts/${artifactId}/versions`);
}

export async function editArtifact(
  artifactId: string,
  payload: { artifact_type: ArtifactType; title: string; content: string; content_structured?: Record<string, unknown> | null },
): Promise<Artifact> {
  return distJson("PATCH", `/artifacts/${artifactId}`, payload);
}

/** Interactive Artifacts (Capability 31) — persists checked checklist item
 * indices in place (no new version row — see backend's own docstring for
 * why ticking a checkbox isn't treated as a content revision). */
export async function updateChecklistState(artifactId: string, checkedItems: number[]): Promise<{ checked_items: number[] }> {
  return distJson("PATCH", `/artifacts/${artifactId}/checklist-state`, { checked_items: checkedItems });
}

/** Task Continuation — AI-assisted edit ("make week 2 more aggressive")
 * against an existing artifact, creating a new version. */
export async function continueArtifact(artifactId: string, instruction: string): Promise<Artifact> {
  return distJson("POST", `/artifacts/${artifactId}/continue`, { instruction });
}

// ---------------------------------------------------------------------------
// Scheduled reminders (Scheduled / Proactive Assistance, Capability 33) —
// backend/reminders_api.py. Named ScheduledReminder (not Reminder) to
// avoid colliding with the pre-existing product-usage Reminder type further
// below (WellnessJourney's customerListReminders/etc.) — a different,
// unrelated feature that happens to share the word "reminder."
// ---------------------------------------------------------------------------

export type ReminderRecurrence = "once" | "daily" | "weekly" | "monthly";

export type ScheduledReminder = {
  id: string;
  user_id?: string;
  title: string;
  body?: string | null;
  conversation_id?: string | null;
  artifact_id?: string | null;
  due_at: string;
  recurrence: ReminderRecurrence;
  is_active: boolean;
  last_delivered_at?: string | null;
  created_at?: string;
};

export async function createReminder(payload: {
  title: string;
  body?: string;
  due_at: string;
  recurrence?: ReminderRecurrence;
  conversation_id?: string | null;
  artifact_id?: string | null;
}): Promise<ScheduledReminder> {
  return distJson("POST", "/reminders", payload);
}

export async function listReminders(includeInactive = false): Promise<{ reminders: ScheduledReminder[]; total: number }> {
  return distGet(`/reminders?include_inactive=${includeInactive}`);
}

export async function cancelReminder(reminderId: string): Promise<{ cancelled: boolean }> {
  const headers = await ragHeaders();
  const res = await resilientFetch(`${getApiBaseUrl()}/reminders/${reminderId}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Cancel reminder failed (${res.status})`);
  return await res.json();
}

/** Best-effort: called on app load and periodically while active. Never
 * surfaces an error to the user — a missed check just means reminders are
 * delivered on the next successful one. */
export async function checkDueReminders(): Promise<{ delivered: Array<{ id: string; title: string }>; count: number }> {
  try {
    return await distJson("POST", "/reminders/check");
  } catch {
    return { delivered: [], count: 0 };
  }
}

/** Content — generate. */
export async function distributorGenerateContent(payload: {
  content_type: string;
  prompt: string;
  language?: string;
  tone?: string;
  customer_name?: string;
  product_name?: string;
  save?: boolean;
}): Promise<{ content: string; saved: Record<string, unknown> | null }> {
  return distJson("POST", "/distributor/content/generate", payload);
}

/** Content — list. */
export async function distributorListContent(params: { content_type?: string; limit?: number } = {}): Promise<{ content: GeneratedContent[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.content_type) qs.set("content_type", params.content_type);
  if (params.limit != null) qs.set("limit", String(params.limit));
  return distGet(`/distributor/content?${qs.toString()}`);
}

/** Content — toggle favorite. */
export async function distributorToggleContentFavorite(contentId: string): Promise<{ is_favorite: boolean }> {
  return distJson("PATCH", `/distributor/content/${contentId}/favorite`, {});
}

/** Content — delete. */
export async function distributorDeleteContent(contentId: string): Promise<{ status: string }> {
  return distDelete(`/distributor/content/${contentId}`);
}

/** Team — overview. */
export async function distributorTeamOverview(): Promise<{
  members: TeamMember[];
  active_count: number;
  total_sales: number;
  avg_training: number;
  recognition: Array<Record<string, unknown>>;
  leaderboard: TeamMember[];
}> {
  return distGet("/distributor/team");
}

/** Team — add recognition. */
export async function distributorAddRecognition(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return distJson("POST", "/distributor/team/recognition", payload);
}

/** Analytics. */
export async function distributorAnalytics(days = 30): Promise<{
  daily_metrics: Array<Record<string, unknown>>;
  aggregates: {
    total_sales: number;
    total_calls: number;
    total_follow_ups: number;
    total_ai_queries: number;
    total_new_customers: number;
    days: number;
  };
  business_health_score: number | null;
}> {
  return distGet(`/distributor/analytics?days=${days}`);
}

/** Suggestions — list. */
export async function distributorListSuggestions(limit = 20): Promise<Array<Record<string, unknown>>> {
  return distGet(`/distributor/suggestions?limit=${limit}`);
}

/** Suggestions — mark read. */
export async function distributorMarkSuggestionRead(id: string): Promise<Record<string, unknown>> {
  return distJson("PATCH", `/distributor/suggestions/${id}/read`, {});
}

/** Suggestions — dismiss. */
export async function distributorDismissSuggestion(id: string): Promise<Record<string, unknown>> {
  return distJson("PATCH", `/distributor/suggestions/${id}/dismiss`, {});
}

/** Events. */
export async function distributorListEvents(limit = 20): Promise<Array<Record<string, unknown>>> {
  return distGet(`/distributor/events?limit=${limit}`);
}

/** Role-play — start. */
export async function distributorStartRolePlay(payload: { scenario: string; custom_context?: string }): Promise<{ session: Record<string, unknown>; opening_message: string }> {
  return distJson("POST", "/distributor/role-play/start", payload);
}

/** Role-play — send message. */
export async function distributorRolePlayMessage(sessionId: string, message: string): Promise<{ customer_response: string; messages: Array<Record<string, unknown>> }> {
  return distJson("POST", `/distributor/role-play/${sessionId}/message`, { message });
}

/** Role-play — end. */
export async function distributorEndRolePlay(sessionId: string): Promise<{ feedback: string; score: number; session: Record<string, unknown> | null }> {
  return distJson("POST", `/distributor/role-play/${sessionId}/end`, {});
}

/** Role-play — history. */
export async function distributorRolePlayHistory(limit = 20): Promise<Array<Record<string, unknown>>> {
  return distGet(`/distributor/role-play/history?limit=${limit}`);
}

// ===========================================================================
// Business Intelligence — AI Business Operating System dashboard API
// ===========================================================================

export type BiOverview = {
  distributor: {
    id: string; full_name: string | null; distributor_code: string | null; state: string | null; city: string | null; kyc_status: string | null;
    sponsor_name?: string | null; profile_completion_pct?: number; joined_date?: string | null;
  };
  today: { sales_amount: number; business_volume: number; commission: number; new_customers: number; new_distributors: number; orders: number; revenue: number };
  period: { weekly_business: number; monthly_business: number; yearly_business: number };
  rank: { current: string | null; badge_icon: string | null; next: string | null; progress_pct: number; trailing_90d_bv: number; bv_needed_for_next: number };
  team: { total: number; active: number; inactive: number; retention_pct: number };
  target: { monthly_target: number; month_to_date: number; achievement_pct: number };
  incentive: { current: string | null; current_reward: string | null; potential_value: number };
  projected_income: number;
  business_health_score: number | null;
  ai_growth_score: number;
};

export async function biOverview(): Promise<BiOverview> {
  return distGet("/distributor/bi/overview");
}

export async function biInsights(): Promise<{ insights: string[]; generated_by: string; wow_change_pct?: number | null }> {
  return distGet("/distributor/bi/insights");
}

export async function biAsk(question: string, sessionId?: string): Promise<{ answer: string; session_id: string | null }> {
  return distJson("POST", "/distributor/bi/ask", { question, session_id: sessionId });
}

export async function biAskHistory(sessionId?: string, limit = 50): Promise<Array<Record<string, unknown>>> {
  const qs = new URLSearchParams();
  if (sessionId) qs.set("session_id", sessionId);
  qs.set("limit", String(limit));
  return distGet(`/distributor/bi/ask/history?${qs.toString()}`);
}

export async function biTimeline(days = 30): Promise<{ events: Array<{ type: string; title: string; timestamp: string }> }> {
  return distGet(`/distributor/bi/timeline?days=${days}`);
}

export async function biForecast(): Promise<{
  has_enough_data: boolean;
  message?: string;
  daily_history?: Array<{ date: string; bv: number }>;
  trend_direction?: "up" | "down" | "flat";
  next_30_day_projection: number | null;
  projected_daily_average?: number;
}> {
  return distGet("/distributor/bi/forecast");
}

export async function biTeamAnalytics(): Promise<{
  top_leaders: Array<Record<string, unknown>>;
  inactive_leaders: Array<Record<string, unknown>>;
  needs_support: Array<Record<string, unknown>>;
  new_joiners: Array<Record<string, unknown>>;
  top_customers: Array<{ id: string; name: string; total_spend: number }>;
  team_size: number;
  active_count: number;
}> {
  return distGet("/distributor/bi/team-analytics");
}

export async function biAlerts(): Promise<{ alerts: Array<{ type: string; severity: "low" | "medium" | "high"; message: string }>; count: number }> {
  return distGet("/distributor/bi/alerts");
}

export async function biGoalsProgress(): Promise<{
  periods: Record<string, { actual: number; target: number; progress_pct: number | null }>;
  goals: Array<Record<string, unknown>>;
}> {
  return distGet("/distributor/bi/goals-progress");
}

export async function biHealthBreakdown(): Promise<{
  overall_score: number;
  sales_score: number;
  follow_up_score: number;
  customer_score: number;
  training_score: number;
  ai_usage_score: number;
}> {
  return distGet("/distributor/bi/health-breakdown");
}

export type BiAchievements = {
  rank_milestones: Array<{ rank_name: string | null; badge_icon: string; color: string | null; achieved_at: string | null }>;
  recognitions: Array<Record<string, unknown>>;
  achieved_goals: Array<Record<string, unknown>>;
  total_achievements: number;
};

export async function biAchievements(): Promise<BiAchievements> {
  return distGet("/distributor/bi/achievements");
}

export type BiReminder = {
  type: "follow_up_overdue" | "follow_up_due" | "event" | "birthday" | "kyc";
  title: string | null;
  due: string | null;
  priority: "urgent" | "high" | "normal" | "low";
  action_url: string;
};

export async function biReminders(): Promise<{
  reminders: BiReminder[];
  overdue_count: number;
  due_soon_count: number;
  upcoming_events_count: number;
  birthdays_count: number;
}> {
  return distGet("/distributor/bi/reminders");
}

export async function biCommissions(days = 90): Promise<{
  commissions: Array<Record<string, unknown>>;
  total_pending: number;
  total_approved: number;
  total_paid: number;
  total_reversed: number;
  this_month_total: number;
  count: number;
}> {
  return distGet(`/distributor/bi/commissions?days=${days}`);
}

export async function biOrders(days = 90): Promise<{
  orders: Array<Record<string, unknown>>;
  total_amount: number;
  total_orders: number;
  avg_order_value: number;
}> {
  return distGet(`/distributor/bi/orders?days=${days}`);
}

// ===========================================================================
// Phase 4 — Customer Experience Platform API
// ===========================================================================

export type CustomerDashboard = {
  user_id: string;
  kpis: {
    favorite_products: number;
    total_favorites: number;
    recently_viewed_count: number;
    active_wellness_goals: number;
    open_tickets: number;
    collection_count: number;
    active_reminders: number;
  };
  favorites: Array<Record<string, unknown>>;
  recently_viewed: Array<Record<string, unknown>>;
  wellness_goals: Array<Record<string, unknown>>;
  reminders: Array<Record<string, unknown>>;
  tickets: Array<Record<string, unknown>>;
  announcements: Array<Record<string, unknown>>;
  recommended_products: Array<Record<string, unknown>>;
};

export type Favorite = {
  id?: string;
  user_id?: string;
  entity_type: string;
  entity_id: string;
  entity_name?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
};

export type Collection = {
  id?: string;
  user_id?: string;
  name: string;
  description?: string | null;
  color?: string;
  icon?: string;
  is_public?: boolean;
  created_at?: string;
};

export type WellnessGoal = {
  id?: string;
  user_id?: string;
  goal_type?: string;
  title: string;
  description?: string | null;
  target_value?: number | null;
  current_value?: number;
  unit?: string;
  target_date?: string | null;
  is_completed?: boolean;
  created_at?: string;
};

export type WellnessActivity = {
  id?: string;
  activity_type?: string;
  title: string;
  description?: string | null;
  value?: number | null;
  unit?: string | null;
  duration_minutes?: number | null;
  activity_date?: string;
  notes?: string | null;
  /** Goal this activity counts toward (wellness_activities.goal_id,
   * migration v28) — logging it auto-advances that goal's current_value
   * server-side (see log_wellness_activity in backend/customer_api.py). */
  goal_id?: string | null;
};

export type Reminder = {
  id?: string;
  reminder_type?: string;
  title: string;
  description?: string | null;
  product_id?: string | null;
  frequency?: string;
  time_of_day?: string | null;
  is_active?: boolean;
  start_date?: string;
};

export type CustomerFeedback = {
  id?: string;
  feedback_type?: string;
  rating?: number | null;
  category?: string | null;
  message_id?: string | null;
  conversation_id?: string | null;
  feedback_text?: string | null;
  is_reported?: boolean;
  report_reason?: string | null;
  status?: string;
  created_at?: string;
};

export type ProfilePrefs = {
  date_of_birth?: string | null;
  gender?: string | null;
  preferred_language?: string;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  health_goals?: string[];
  interests?: string[];
  allergies?: string[];
  dietary_preferences?: string[];
  email_notifications?: boolean;
  push_notifications?: boolean;
  sms_notifications?: boolean;
  whatsapp_updates?: boolean;
  marketing_emails?: boolean;
  share_data_with_distributor?: boolean;
  share_analytics?: boolean;
  public_profile?: boolean;
  ai_personalization?: boolean;
  preferred_ai_tone?: string;
  onboarding_completed?: boolean;
};

export type KnowledgeSearchResult = {
  entity_type: string;
  entity_id: string;
  title: string | null;
  snippet: string | null;
  category: string | null;
};

async function custGet<T>(path: string): Promise<T> {
  const headers = await ragHeaders();
  const res = await resilientFetch(`${getApiBaseUrl()}${path}`, { headers });
  if (!res.ok) throw new Error(`Customer GET ${path} failed (${res.status})`);
  return await res.json();
}

async function custJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await ragHeaders({ "Content-Type": "application/json" });
  const res = await resilientFetch(`${getApiBaseUrl()}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Customer ${method} ${path} failed (${res.status}): ${text}`);
  }
  return await res.json();
}

async function custDelete(path: string): Promise<{ status: string }> {
  const headers = await ragHeaders();
  const res = await resilientFetch(`${getApiBaseUrl()}${path}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Customer DELETE ${path} failed (${res.status})`);
  return await res.json();
}

/** Dashboard. */
export async function customerDashboard(): Promise<CustomerDashboard> {
  return custGet<CustomerDashboard>("/customer/dashboard");
}

/** Favorites. */
export async function customerListFavorites(entity_type?: string): Promise<Favorite[]> {
  const qs = new URLSearchParams();
  if (entity_type) qs.set("entity_type", entity_type);
  return custGet(`/customer/favorites?${qs.toString()}`);
}

export async function customerAddFavorite(payload: Omit<Favorite, "id" | "user_id" | "created_at">): Promise<Favorite> {
  return custJson("POST", "/customer/favorites", payload);
}

export async function customerRemoveFavorite(favoriteId: string): Promise<{ status: string }> {
  return custDelete(`/customer/favorites/${favoriteId}`);
}

/** Collections. */
export async function customerListCollections(): Promise<Collection[]> {
  return custGet("/customer/collections");
}

export async function customerCreateCollection(payload: Partial<Collection>): Promise<Collection> {
  return custJson("POST", "/customer/collections", payload);
}

export async function customerDeleteCollection(collectionId: string): Promise<{ status: string }> {
  return custDelete(`/customer/collections/${collectionId}`);
}

export async function customerAddCollectionItem(collectionId: string, payload: { entity_type: string; entity_id: string; entity_name?: string }): Promise<Record<string, unknown>> {
  return custJson("POST", `/customer/collections/${collectionId}/items`, payload);
}

export async function customerListCollectionItems(collectionId: string): Promise<Array<Record<string, unknown>>> {
  return custGet(`/customer/collections/${collectionId}/items`);
}

/** Recently viewed. */
export async function customerListRecentlyViewed(entity_type?: string): Promise<Array<Record<string, unknown>>> {
  const qs = new URLSearchParams();
  if (entity_type) qs.set("entity_type", entity_type);
  return custGet(`/customer/recently-viewed?${qs.toString()}`);
}

export async function customerTrackView(payload: { entity_type: string; entity_id: string; entity_name?: string }): Promise<{ status: string }> {
  return custJson("POST", "/customer/recently-viewed", payload);
}

/** Comparisons. */
export async function customerListComparisons(): Promise<Array<Record<string, unknown>>> {
  return custGet("/customer/comparisons");
}

export async function customerSaveComparison(payload: { name?: string; product_ids: string[]; product_data?: Record<string, unknown> }): Promise<Record<string, unknown>> {
  return custJson("POST", "/customer/comparisons", payload);
}

export async function customerDeleteComparison(comparisonId: string): Promise<{ status: string }> {
  return custDelete(`/customer/comparisons/${comparisonId}`);
}

/** Wellness goals. */
export async function customerListWellnessGoals(active_only = false): Promise<WellnessGoal[]> {
  return custGet(`/customer/wellness/goals?active_only=${active_only}`);
}

export async function customerCreateWellnessGoal(payload: Partial<WellnessGoal>): Promise<WellnessGoal> {
  return custJson("POST", "/customer/wellness/goals", payload);
}

export async function customerUpdateWellnessGoal(goalId: string, payload: Partial<WellnessGoal>): Promise<WellnessGoal> {
  return custJson("PATCH", `/customer/wellness/goals/${goalId}`, payload);
}

export async function customerDeleteWellnessGoal(goalId: string): Promise<{ status: string }> {
  return custDelete(`/customer/wellness/goals/${goalId}`);
}

/** Wellness activities. */
export async function customerListWellnessActivities(limit = 50): Promise<WellnessActivity[]> {
  return custGet(`/customer/wellness/activities?limit=${limit}`);
}

export async function customerLogWellnessActivity(payload: Partial<WellnessActivity>): Promise<WellnessActivity> {
  return custJson("POST", "/customer/wellness/activities", payload);
}

/** Reminders. */
export async function customerListReminders(active_only = false): Promise<Reminder[]> {
  return custGet(`/customer/wellness/reminders?active_only=${active_only}`);
}

export async function customerCreateReminder(payload: Partial<Reminder>): Promise<Reminder> {
  return custJson("POST", "/customer/wellness/reminders", payload);
}

export async function customerUpdateReminder(reminderId: string, payload: Partial<Reminder>): Promise<Reminder> {
  return custJson("PATCH", `/customer/wellness/reminders/${reminderId}`, payload);
}

export async function customerDeleteReminder(reminderId: string): Promise<{ status: string }> {
  return custDelete(`/customer/wellness/reminders/${reminderId}`);
}

/** Feedback. */
export async function customerListFeedback(): Promise<CustomerFeedback[]> {
  return custGet("/customer/feedback");
}

export async function customerSubmitFeedback(payload: Partial<CustomerFeedback>): Promise<CustomerFeedback> {
  return custJson("POST", "/customer/feedback", payload);
}

/** Profile prefs. */
export async function customerGetProfilePrefs(): Promise<ProfilePrefs> {
  return custGet<ProfilePrefs>("/customer/profile-prefs");
}

export async function customerUpdateProfilePrefs(payload: Partial<ProfilePrefs>): Promise<ProfilePrefs> {
  return custJson("PATCH", "/customer/profile-prefs", payload);
}

/** Announcements. */
export async function customerListAnnouncements(limit = 10): Promise<Array<Record<string, unknown>>> {
  return custGet(`/customer/announcements?limit=${limit}`);
}

/** Knowledge search. */
export async function customerKnowledgeSearch(payload: { query: string; entity_types?: string[]; language?: string }): Promise<{ results: KnowledgeSearchResult[]; total: number }> {
  return custJson("POST", "/customer/knowledge-search", payload);
}

/** Tickets. */
export async function customerListTickets(): Promise<Array<Record<string, unknown>>> {
  return custGet("/customer/tickets");
}

export async function customerListTicketReplies(ticketId: string): Promise<Array<Record<string, unknown>>> {
  return custGet(`/customer/tickets/${ticketId}/replies`);
}

export async function customerAddTicketReply(ticketId: string, body: string): Promise<Record<string, unknown>> {
  return custJson("POST", `/customer/tickets/${ticketId}/replies`, { body, is_internal: false });
}

export async function customerRateTicket(ticketId: string, rating: number, feedback?: string): Promise<Record<string, unknown>> {
  return custJson("POST", `/customer/tickets/${ticketId}/rating`, { rating, feedback });
}

/** AI Recommendations. */
export async function customerGetRecommendations(payload: {
  health_goals?: string[];
  age?: number;
  lifestyle?: string;
  preferences?: string[];
  budget_range?: string;
  language?: string;
}): Promise<{ recommendation: string; context_used: string }> {
  return custJson("POST", "/customer/recommendations", payload);
}

// ===========================================================================
// Phase 5 — Executive Analytics & BI API
// ===========================================================================

export type ExecutiveKPIs = {
  users: { total: number; daily_active: number; weekly_active: number; monthly_active: number };
  ai: {
    total_conversations: number; total_messages: number; total_rag_queries: number;
    failed_responses: number; verified_queries: number; avg_confidence: number;
    accuracy_pct: number | null; conversations_per_user: number;
  };
  knowledge: { total_documents: number; verified_documents: number; pending_approvals: number; total_chunks: number; coverage_pct: number | null };
  support: { total_tickets: number; open_tickets: number; resolved_tickets: number; escalated_tickets: number };
  training: { published_courses: number; completed_enrollments: number; total_enrollments: number; completion_pct: number };
  products: { total_products: number };
  satisfaction: { customer_rating: number; total_feedback: number };
};

export type AIAnalytics = {
  daily: Array<Record<string, unknown>>;
  aggregates: { total_queries: number; verified: number; unverified: number; avg_confidence: number; avg_latency_ms: number; accuracy_pct: number | null };
  top_questions: Array<{ question: string; ask_count: number; last_asked: string }>;
};

export type AnalyticsAlert = {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  message: string;
  metric_value: number | null;
  threshold: number | null;
  is_acknowledged: boolean;
  is_resolved: boolean;
  created_at: string;
};

async function anaGet<T>(path: string): Promise<T> {
  const headers = await ragHeaders();
  const res = await fetch(`${getApiBaseUrl()}${path}`, { headers });
  if (!res.ok) throw new Error(`Analytics GET ${path} failed (${res.status})`);
  return await res.json();
}

async function anaJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await ragHeaders({ "Content-Type": "application/json" });
  const res = await fetch(`${getApiBaseUrl()}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Analytics ${method} ${path} failed (${res.status})`);
  return await res.json();
}

/** Executive dashboard KPIs. */
export async function analyticsExecutive(): Promise<ExecutiveKPIs> {
  return anaGet<ExecutiveKPIs>("/analytics/executive");
}

/** AI analytics. */
export async function analyticsAI(days = 30): Promise<AIAnalytics> {
  return anaGet<AIAnalytics>(`/analytics/ai?days=${days}`);
}

/** Product analytics. */
export async function analyticsProducts(limit = 20): Promise<{
  products: Array<Record<string, unknown>>;
  category_popularity: Array<{ category: string; views: number }>;
  total_views: number;
  total_favorites: number;
}> {
  return anaGet(`/analytics/products?limit=${limit}`);
}

/** Distributor analytics. */
export async function analyticsDistributors(limit = 50): Promise<{
  distributors: Array<Record<string, unknown>>;
  aggregates: Record<string, number>;
}> {
  return anaGet(`/analytics/distributors?limit=${limit}`);
}

/** Customer analytics. */
export async function analyticsCustomers(days = 30): Promise<{
  daily: Array<Record<string, unknown>>;
  aggregates: Record<string, number | null>;
}> {
  return anaGet(`/analytics/customers?days=${days}`);
}

/** Knowledge analytics. */
export async function analyticsKnowledge(): Promise<{
  documents: Array<Record<string, unknown>>;
  aggregates: Record<string, number | null>;
}> {
  return anaGet("/analytics/knowledge");
}

/** Support analytics. */
export async function analyticsSupport(days = 30): Promise<{
  daily: Array<Record<string, unknown>>;
  aggregates: Record<string, number | null>;
}> {
  return anaGet(`/analytics/support?days=${days}`);
}

/** Training analytics. */
export async function analyticsTraining(): Promise<{
  courses: Array<Record<string, unknown>>;
  aggregates: Record<string, number>;
}> {
  return anaGet("/analytics/training");
}

/** System health. */
export async function analyticsHealth(): Promise<{
  overall_status: string;
  components: Record<string, { status: string; latency_ms?: number; configured?: boolean; available?: boolean; url_configured?: boolean }>;
  storage: Record<string, number>;
  background_jobs: number;
  timestamp: string;
}> {
  return anaGet("/analytics/health");
}

/** Alerts — list. */
export async function analyticsListAlerts(resolved = false): Promise<AnalyticsAlert[]> {
  return anaGet(`/analytics/alerts?resolved=${resolved}`);
}

/** Alerts — update. */
export async function analyticsUpdateAlert(alertId: string, payload: { is_acknowledged?: boolean; is_resolved?: boolean }): Promise<Record<string, unknown>> {
  return anaJson("PATCH", `/analytics/alerts/${alertId}`, payload);
}

/** Dashboard layout — get. */
export async function analyticsGetLayout(): Promise<{ widgets?: Array<Record<string, unknown>>; id?: string }> {
  return anaGet("/analytics/dashboard-layout");
}

/** Dashboard layout — save. */
export async function analyticsSaveLayout(payload: { layout_name: string; widgets: Array<Record<string, unknown>>; is_default: boolean }): Promise<Record<string, unknown>> {
  return anaJson("POST", "/analytics/dashboard-layout", payload);
}

/** Refresh materialized views. */
export async function analyticsRefresh(): Promise<{ status: string }> {
  return anaJson("POST", "/analytics/refresh", {});
}

/** Export CSV (returns text). */
export async function analyticsExport(metricType: string, days = 30): Promise<string> {
  const headers = await ragHeaders();
  const res = await fetch(`${getApiBaseUrl()}/analytics/export/${metricType}?days=${days}`, { headers });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  return await res.text();
}

// ===========================================================================
// Phase 6 — Omnichannel Communication API
// ===========================================================================

export type Channel = {
  id: string;
  channel_type: string;
  display_name: string;
  is_enabled: boolean;
  is_configured: boolean;
  provider: string | null;
  daily_limit: number;
  sent_today: number;
  health_status: string;
  last_health_check: string | null;
};

export type Conversation = {
  id: string;
  channel_type: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  subject: string | null;
  status: string;
  priority: string;
  assigned_to: string | null;
  ai_handled: boolean;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  created_at: string;
};

export type MessageTemplate = {
  id: string;
  template_key: string;
  name: string;
  category: string;
  channel_type: string;
  subject: string | null;
  body: string;
  placeholders: string[];
  language: string;
  is_active: boolean;
  usage_count: number;
};

export type Campaign = {
  id: string;
  name: string;
  channel_type: string;
  status: string;
  audience_count: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  open_count: number;
  click_count: number;
  delivery_rate_pct: number;
  read_rate_pct: number;
  open_rate_pct: number;
  click_rate_pct: number;
  scheduled_at: string | null;
  created_at: string;
};

export type WebhookEndpoint = {
  id: string;
  name: string;
  url: string;
  event_types: string[];
  is_active: boolean;
  last_triggered_at: string | null;
  last_response_status: number | null;
  last_error: string | null;
};

export type AutomationWorkflow = {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
  is_active: boolean;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
};

export type IntegrationConnector = {
  id: string;
  connector_type: string;
  name: string;
  provider: string | null;
  is_enabled: boolean;
  is_configured: boolean;
  sync_frequency: string;
  last_sync_at: string | null;
  last_sync_status: string;
};

async function commGet<T>(path: string): Promise<T> {
  const headers = await ragHeaders();
  const res = await fetch(`${getApiBaseUrl()}${path}`, { headers });
  if (!res.ok) throw new Error(`Comm GET ${path} failed (${res.status})`);
  return await res.json();
}

async function commJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await ragHeaders({ "Content-Type": "application/json" });
  const res = await fetch(`${getApiBaseUrl()}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Comm ${method} ${path} failed (${res.status})`);
  return await res.json();
}

async function commDelete(path: string): Promise<{ status: string }> {
  const headers = await ragHeaders();
  const res = await fetch(`${getApiBaseUrl()}${path}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Comm DELETE ${path} failed (${res.status})`);
  return await res.json();
}

/** Channels. */
export async function commListChannels(): Promise<Channel[]> {
  return commGet("/comm/channels");
}

export async function commUpdateChannel(channelId: string, payload: Partial<Channel>): Promise<Channel> {
  return commJson("PATCH", `/comm/channels/${channelId}`, payload);
}

/** Conversations. */
export async function commListConversations(params: { status?: string; channel_type?: string; search?: string; limit?: number } = {}): Promise<{ conversations: Conversation[]; total: number; unread_total: number }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.channel_type) qs.set("channel_type", params.channel_type);
  if (params.search) qs.set("search", params.search);
  if (params.limit != null) qs.set("limit", String(params.limit));
  return commGet(`/comm/conversations?${qs.toString()}`);
}

export async function commListMessages(conversationId: string): Promise<Array<Record<string, unknown>>> {
  return commGet(`/comm/conversations/${conversationId}/messages`);
}

export async function commSendMessage(conversationId: string, body: string, senderType = "agent"): Promise<Record<string, unknown>> {
  return commJson("POST", `/comm/conversations/${conversationId}/messages`, { body, sender_type: senderType });
}

export async function commAssignConversation(conversationId: string, assignedTo: string): Promise<Conversation> {
  return commJson("PATCH", `/comm/conversations/${conversationId}/assign`, { assigned_to: assignedTo });
}

export async function commUpdateConversationStatus(conversationId: string, status: string): Promise<Conversation> {
  return commJson("PATCH", `/comm/conversations/${conversationId}/status`, { status });
}

/** Templates. */
export async function commListTemplates(params: { category?: string; channel_type?: string } = {}): Promise<MessageTemplate[]> {
  const qs = new URLSearchParams();
  if (params.category) qs.set("category", params.category);
  if (params.channel_type) qs.set("channel_type", params.channel_type);
  return commGet(`/comm/templates?${qs.toString()}`);
}

export async function commCreateTemplate(payload: Partial<MessageTemplate>): Promise<MessageTemplate> {
  return commJson("POST", "/comm/templates", payload);
}

export async function commUpdateTemplate(templateId: string, payload: Partial<MessageTemplate>): Promise<MessageTemplate> {
  return commJson("PATCH", `/comm/templates/${templateId}`, payload);
}

export async function commDeleteTemplate(templateId: string): Promise<{ status: string }> {
  return commDelete(`/comm/templates/${templateId}`);
}

/** Campaigns. */
export async function commListCampaigns(status?: string): Promise<Campaign[]> {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  return commGet(`/comm/campaigns?${qs.toString()}`);
}

export async function commCreateCampaign(payload: Record<string, unknown>): Promise<Campaign> {
  return commJson("POST", "/comm/campaigns", payload);
}

export async function commUpdateCampaign(campaignId: string, payload: Record<string, unknown>): Promise<Campaign> {
  return commJson("PATCH", `/comm/campaigns/${campaignId}`, payload);
}

export async function commDeleteCampaign(campaignId: string): Promise<{ status: string }> {
  return commDelete(`/comm/campaigns/${campaignId}`);
}

/** Scheduled messages. */
export async function commListScheduled(status?: string): Promise<Array<Record<string, unknown>>> {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  return commGet(`/comm/scheduled?${qs.toString()}`);
}

export async function commCancelScheduled(messageId: string): Promise<{ status: string }> {
  return commDelete(`/comm/scheduled/${messageId}`);
}

/** Webhooks. */
export async function commListWebhooks(): Promise<WebhookEndpoint[]> {
  return commGet("/comm/webhooks");
}

export async function commCreateWebhook(payload: Partial<WebhookEndpoint>): Promise<WebhookEndpoint> {
  return commJson("POST", "/comm/webhooks", payload);
}

export async function commUpdateWebhook(webhookId: string, payload: Partial<WebhookEndpoint>): Promise<WebhookEndpoint> {
  return commJson("PATCH", `/comm/webhooks/${webhookId}`, payload);
}

export async function commDeleteWebhook(webhookId: string): Promise<{ status: string }> {
  return commDelete(`/comm/webhooks/${webhookId}`);
}

export async function commWebhookLogs(webhookId: string): Promise<Array<Record<string, unknown>>> {
  return commGet(`/comm/webhooks/${webhookId}/logs`);
}

export async function commTestWebhook(webhookId: string): Promise<Record<string, unknown>> {
  return commJson("POST", `/comm/webhooks/${webhookId}/test`, {});
}

/** Automations. */
export async function commListAutomations(): Promise<AutomationWorkflow[]> {
  return commGet("/comm/automations");
}

export async function commCreateAutomation(payload: Partial<AutomationWorkflow>): Promise<AutomationWorkflow> {
  return commJson("POST", "/comm/automations", payload);
}

export async function commUpdateAutomation(workflowId: string, payload: Partial<AutomationWorkflow>): Promise<AutomationWorkflow> {
  return commJson("PATCH", `/comm/automations/${workflowId}`, payload);
}

export async function commDeleteAutomation(workflowId: string): Promise<{ status: string }> {
  return commDelete(`/comm/automations/${workflowId}`);
}

/** Integrations. */
export async function commListIntegrations(): Promise<IntegrationConnector[]> {
  return commGet("/comm/integrations");
}

export async function commUpdateIntegration(connectorId: string, payload: Partial<IntegrationConnector>): Promise<IntegrationConnector> {
  return commJson("PATCH", `/comm/integrations/${connectorId}`, payload);
}

export async function commIntegrationLogs(connectorId: string): Promise<Array<Record<string, unknown>>> {
  return commGet(`/comm/integrations/${connectorId}/logs`);
}

/** Communication analytics. */
export async function commAnalytics(days = 30): Promise<{
  daily: Array<Record<string, unknown>>;
  aggregates: Record<string, number>;
  recent_campaigns: Campaign[];
}> {
  return commGet(`/comm/analytics?days=${days}`);
}

/** Send a message. */
export async function commSend(payload: { channel_type: string; to: string; body: string; subject?: string; conversation_id?: string }): Promise<Record<string, unknown>> {
  return commJson("POST", "/comm/send", payload);
}

// ===========================================================================
// Phase 7 — AI Workflow Automation & Multi-Agent Intelligence API
// ===========================================================================

export type AIAgent = {
  id: string;
  agent_key: string;
  name: string;
  description: string | null;
  agent_type: string;
  system_prompt: string;
  model: string;
  temperature: number;
  max_tokens: number;
  memory_enabled: boolean;
  memory_window: number;
  knowledge_sources: string[];
  allowed_tools: string[];
  is_active: boolean;
  avatar: string;
  color: string;
  created_at: string;
};

export type Workflow = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  trigger_type: string;
  status: string;
  version: number;
  execution_count: number;
  success_rate: number;
  last_executed_at: string | null;
  avg_execution_time_ms: number | null;
  running_count: number;
  completed_24h: number;
  failed_24h: number;
};

export type TaskQueueItem = {
  id: string;
  task_type: string;
  status: string;
  priority: number;
  retry_count: number;
  max_retries: number;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  created_at?: string;
};

export type ApprovalRequest = {
  id: string;
  approval_type: string;
  entity_name: string | null;
  summary: string;
  priority: string;
  status: string;
  requested_by_name: string | null;
  reviewed_by_name: string | null;
  review_comment: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export type BusinessRule = {
  id: string;
  name: string;
  description: string | null;
  rule_type: string;
  event_type: string;
  conditions: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  else_actions?: Array<Record<string, unknown>>;
  is_active: boolean;
  priority: number;
  execution_count: number;
};

async function wfGet<T>(path: string): Promise<T> {
  const headers = await ragHeaders();
  const res = await fetch(`${getApiBaseUrl()}${path}`, { headers });
  if (!res.ok) throw new Error(`Workflow GET ${path} failed (${res.status})`);
  return await res.json();
}

async function wfJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await ragHeaders({ "Content-Type": "application/json" });
  const res = await fetch(`${getApiBaseUrl()}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Workflow ${method} ${path} failed (${res.status})`);
  return await res.json();
}

async function wfDelete(path: string): Promise<{ status: string }> {
  const headers = await ragHeaders();
  const res = await fetch(`${getApiBaseUrl()}${path}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Workflow DELETE ${path} failed (${res.status})`);
  return await res.json();
}

/** Agents — list. */
export async function agentList(activeOnly = false): Promise<AIAgent[]> {
  return wfGet(`/agent/list?active_only=${activeOnly}`);
}

/** Agents — get. */
export async function agentGet(agentId: string): Promise<AIAgent & { tools: Array<Record<string, unknown>> }> {
  return wfGet(`/agent/${agentId}`);
}

/** Agents — update. */
export async function agentUpdate(agentId: string, payload: Partial<AIAgent>): Promise<AIAgent> {
  return wfJson("PATCH", `/agent/${agentId}`, payload);
}

/** Agents — chat. */
export async function agentChat(agentId: string, message: string, language = "en"): Promise<{ response: string; agent_name: string; agent_id: string }> {
  return wfJson("POST", `/agent/${agentId}/chat`, { message, language });
}

/** Agents — collaborate. */
export async function agentCollaborate(payload: { topic: string; initial_query: string; agent_chain: string[] }): Promise<{ session_id: string; messages: Array<Record<string, unknown>>; final_response: string }> {
  return wfJson("POST", "/agent/collaborate", payload);
}

/** Agent memory — list. */
export async function agentMemory(agentId: string, userId?: string): Promise<Array<Record<string, unknown>>> {
  const qs = new URLSearchParams();
  if (userId) qs.set("user_id", userId);
  return wfGet(`/agent/${agentId}/memory?${qs.toString()}`);
}

/** Agent memory — add. */
export async function agentMemoryAdd(agentId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return wfJson("POST", `/agent/${agentId}/memory`, payload);
}

/** Agent memory — delete. */
export async function agentMemoryDelete(agentId: string, memoryId: string): Promise<{ status: string }> {
  return wfDelete(`/agent/${agentId}/memory/${memoryId}`);
}

/** Workflows — list. */
export async function workflowList(params: { status?: string; category?: string } = {}): Promise<Workflow[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.category) qs.set("category", params.category);
  return wfGet(`/workflow/list?${qs.toString()}`);
}

/** Workflows — create. */
export async function workflowCreate(payload: Record<string, unknown>): Promise<Workflow> {
  return wfJson("POST", "/workflow/create", payload);
}

/** Workflows — get. */
export async function workflowGet(workflowId: string): Promise<Record<string, unknown>> {
  return wfGet(`/workflow/${workflowId}`);
}

/** Workflows — update. */
export async function workflowUpdate(workflowId: string, payload: Record<string, unknown>): Promise<Workflow> {
  return wfJson("PATCH", `/workflow/${workflowId}`, payload);
}

/** Workflows — delete. */
export async function workflowDelete(workflowId: string): Promise<{ status: string }> {
  return wfDelete(`/workflow/${workflowId}`);
}

/** Workflows — execute. */
export async function workflowExecute(workflowId: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return wfJson("POST", `/workflow/${workflowId}/execute`, payload);
}

/** Workflows — versions. */
export async function workflowVersions(workflowId: string): Promise<Array<Record<string, unknown>>> {
  return wfGet(`/workflow/${workflowId}/versions`);
}

/** Workflows — executions. */
export async function workflowExecutions(workflowId: string): Promise<Array<Record<string, unknown>>> {
  return wfGet(`/workflow/${workflowId}/executions`);
}

/** Workflows — templates. */
export async function workflowTemplates(): Promise<Workflow[]> {
  return wfGet("/workflow/templates");
}

/** Tasks — list. */
export async function workflowTasks(status?: string): Promise<{ tasks: TaskQueueItem[]; total: number; summary: Array<Record<string, unknown>> }> {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  return wfGet(`/workflow/tasks?${qs.toString()}`);
}

/** Scheduled jobs — list. */
export async function workflowScheduledJobs(): Promise<Array<Record<string, unknown>>> {
  return wfGet("/workflow/scheduled");
}

/** Scheduled jobs — create. */
export async function workflowCreateScheduledJob(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return wfJson("POST", "/workflow/scheduled", payload);
}

/** Scheduled jobs — delete. */
export async function workflowDeleteScheduledJob(jobId: string): Promise<{ status: string }> {
  return wfDelete(`/workflow/scheduled/${jobId}`);
}

/** Approvals — list. */
export async function workflowApprovals(status?: string): Promise<{ approvals: ApprovalRequest[]; total: number; summary: Array<Record<string, unknown>> }> {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  return wfGet(`/workflow/approvals?${qs.toString()}`);
}

/** Approvals — review. */
export async function workflowReviewApproval(approvalId: string, status: "approved" | "rejected", comment?: string): Promise<ApprovalRequest> {
  return wfJson("PATCH", `/workflow/approvals/${approvalId}`, { status, review_comment: comment });
}

/** Business rules — list. */
export async function workflowBusinessRules(): Promise<BusinessRule[]> {
  return wfGet("/workflow/rules");
}

/** Business rules — create. */
export async function workflowCreateBusinessRule(payload: Record<string, unknown>): Promise<BusinessRule> {
  return wfJson("POST", "/workflow/rules", payload);
}

/** Business rules — delete. */
export async function workflowDeleteBusinessRule(ruleId: string): Promise<{ status: string }> {
  return wfDelete(`/workflow/rules/${ruleId}`);
}

/** Dashboard. */
export async function workflowDashboard(): Promise<{
  task_queue: Record<string, number>;
  workflows: Record<string, number>;
  approvals: Record<string, number>;
  agents: Record<string, number>;
  scheduled_jobs: Record<string, number>;
  recent_executions: Array<Record<string, unknown>>;
}> {
  return wfGet("/workflow/dashboard");
}

// ===========================================================================
// Phase 8 — Enterprise Security, Governance, Compliance & Observability API
// ===========================================================================

export type SecurityDashboard = {
  risk_score: number | null;
  security: Record<string, number>;
  compliance: Record<string, number>;
  recent_events: Array<Record<string, unknown>>;
  open_incidents: Array<Record<string, unknown>>;
};

async function secGet<T>(path: string): Promise<T> {
  const headers = await ragHeaders();
  const res = await fetch(`${getApiBaseUrl()}${path}`, { headers });
  if (!res.ok) throw new Error(`Security GET ${path} failed (${res.status})`);
  return await res.json();
}

async function secJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await ragHeaders({ "Content-Type": "application/json" });
  const res = await fetch(`${getApiBaseUrl()}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Security ${method} ${path} failed (${res.status})`);
  return await res.json();
}

async function secDelete(path: string): Promise<{ status: string }> {
  const headers = await ragHeaders();
  const res = await fetch(`${getApiBaseUrl()}${path}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Security DELETE ${path} failed (${res.status})`);
  return await res.json();
}

/** Security dashboard. */
export async function securityDashboard(): Promise<SecurityDashboard> {
  return secGet<SecurityDashboard>("/security/dashboard");
}

/** Security events. */
export async function securityEvents(event_type?: string, severity?: string): Promise<Array<Record<string, unknown>>> {
  const qs = new URLSearchParams();
  if (event_type) qs.set("event_type", event_type);
  if (severity) qs.set("severity", severity);
  return secGet(`/security/events?${qs.toString()}`);
}

/** Sessions. */
export async function securitySessions(active_only = true): Promise<Array<Record<string, unknown>>> {
  return secGet(`/security/sessions?active_only=${active_only}`);
}

export async function securityRevokeSession(sessionId: string): Promise<{ status: string }> {
  return secDelete(`/security/sessions/${sessionId}`);
}

/** Devices. */
export async function securityDevices(trusted_only = false): Promise<Array<Record<string, unknown>>> {
  return secGet(`/security/devices?trusted_only=${trusted_only}`);
}

export async function securityToggleDeviceTrust(deviceId: string): Promise<Record<string, unknown>> {
  return secJson("PATCH", `/security/devices/${deviceId}/trust`, {});
}

/** Incidents. */
export async function securityIncidents(status?: string): Promise<Array<Record<string, unknown>>> {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  return secGet(`/security/incidents?${qs.toString()}`);
}

export async function securityCreateIncident(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return secJson("POST", "/security/incidents", payload);
}

export async function securityUpdateIncident(incidentId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return secJson("PATCH", `/security/incidents/${incidentId}`, payload);
}

export async function securityIncidentTimeline(incidentId: string): Promise<Array<Record<string, unknown>>> {
  return secGet(`/security/incidents/${incidentId}/timeline`);
}

export async function securityAddTimelineEntry(incidentId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return secJson("POST", `/security/incidents/${incidentId}/timeline`, payload);
}

/** AI Governance. */
export async function securityAIGovernance(record_type?: string): Promise<Array<Record<string, unknown>>> {
  const qs = new URLSearchParams();
  if (record_type) qs.set("record_type", record_type);
  return secGet(`/security/ai-governance?${qs.toString()}`);
}

/** Compliance. */
export async function securityComplianceRequests(status?: string): Promise<Array<Record<string, unknown>>> {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  return secGet(`/security/compliance?${qs.toString()}`);
}

export async function securityUpdateCompliance(requestId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return secJson("PATCH", `/security/compliance/${requestId}`, payload);
}

export async function securityConsentRecords(): Promise<Array<Record<string, unknown>>> {
  return secGet("/security/compliance/consent");
}

export async function securityRetentionPolicies(): Promise<Array<Record<string, unknown>>> {
  return secGet("/security/compliance/retention");
}

/** ABAC. */
export async function securityABACPolicies(): Promise<Array<Record<string, unknown>>> {
  return secGet("/security/abac");
}

export async function securityCreateABAC(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return secJson("POST", "/security/abac", payload);
}

export async function securityDeleteABAC(policyId: string): Promise<{ status: string }> {
  return secDelete(`/security/abac/${policyId}`);
}

/** Monitoring. */
export async function securityMonitoring(): Promise<Record<string, unknown>> {
  return secGet("/security/monitoring");
}

/** Backups. */
export async function securityBackups(): Promise<Array<Record<string, unknown>>> {
  return secGet("/security/backups");
}

/** Vulnerabilities. */
export async function securityVulnerabilities(): Promise<Array<Record<string, unknown>>> {
  return secGet("/security/vulnerabilities");
}

/** Audit log. */
export async function securityAuditLog(params: { action?: string; entity_type?: string; user_id?: string; limit?: number } = {}): Promise<{ logs: Array<Record<string, unknown>>; total: number }> {
  const qs = new URLSearchParams();
  if (params.action) qs.set("action", params.action);
  if (params.entity_type) qs.set("entity_type", params.entity_type);
  if (params.user_id) qs.set("user_id", params.user_id);
  if (params.limit != null) qs.set("limit", String(params.limit));
  return secGet(`/security/audit?${qs.toString()}`);
}

/** Pen test checklist. */
export async function securityPenTestChecklist(): Promise<{ checks: Array<Record<string, unknown>>; total: number; passed: number; failed: number; score: number }> {
  return secGet("/security/pen-test-checklist");
}
