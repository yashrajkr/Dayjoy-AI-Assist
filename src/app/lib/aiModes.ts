import type { LucideIcon } from "lucide-react";
import { MessageCircle, Lightbulb, Microscope, GitCompare, PenTool, BarChart3 } from "lucide-react";

/**
 * AI Mode System — single source of truth for the frontend.
 *
 * Mirrors `backend/ai_modes.py`. Each mode is sent to the backend as
 * `ai_mode` on the chat request and genuinely changes backend behavior
 * (retrieval breadth + system-prompt addendum) — this file only owns the
 * presentation layer (labels, icons, accent, processing-step copy).
 *
 * `processingSteps` keys are restricted to status strings the backend
 * ACTUALLY emits over SSE (`_route_events`/`chat_stream` in backend/main.py:
 * connected, searching_knowledge, searching_web, checking_weather,
 * checking_pricing, checking_recommendations, verifying, generating, done).
 * A mode's step list may skip steps it doesn't care to show, but must never
 * invent a step name the backend can't produce — that would be fake progress.
 */

export type AiMode = "normal" | "thinking" | "deep_research" | "compare_products" | "create" | "analyze";

export type AiModeStatusKey =
  | "connected"
  | "searching_knowledge"
  | "searching_web"
  | "checking_weather"
  | "checking_pricing"
  | "checking_recommendations"
  | "verifying"
  | "generating"
  | "done";

export type AiModeAccent = "orange" | "indigo" | "purple" | "green" | "amber" | "teal";

export type AiModeProcessingStep = {
  key: AiModeStatusKey;
  label: string;
  detail: string;
};

export type AiModeConfig = {
  id: AiMode;
  label: string;
  description: string;
  icon: LucideIcon;
  accent: AiModeAccent;
  headline: string;
  /** Only the steps this mode chooses to surface; order matters for the UI. */
  processingSteps: AiModeProcessingStep[];
};

export const AI_MODE_ORDER: AiMode[] = [
  "normal",
  "thinking",
  "deep_research",
  "compare_products",
  "create",
  "analyze",
];

export const AI_MODES: Record<AiMode, AiModeConfig> = {
  normal: {
    id: "normal",
    label: "Normal Chat",
    description: "Quick answers for everyday questions",
    icon: MessageCircle,
    accent: "orange",
    headline: "Working on your answer...",
    processingSteps: [
      { key: "connected", label: "Understanding your request", detail: "Analyzing what you need" },
      { key: "searching_knowledge", label: "Checking Dayjoy knowledge", detail: "Searching verified information" },
      { key: "generating", label: "Preparing your answer", detail: "Writing the response" },
    ],
  },
  thinking: {
    id: "thinking",
    label: "Thinking Mode",
    description: "Best for complex reasoning & analysis",
    icon: Lightbulb,
    accent: "indigo",
    headline: "Thinking through your question...",
    processingSteps: [
      { key: "connected", label: "Understanding the question", detail: "Analyzing intent and context" },
      { key: "searching_knowledge", label: "Exploring relevant information", detail: "Gathering supporting context" },
      { key: "searching_web", label: "Checking additional sources", detail: "Broadening the search" },
      { key: "generating", label: "Preparing a thoughtful answer", detail: "Synthesizing the response" },
    ],
  },
  deep_research: {
    id: "deep_research",
    label: "Deep Research",
    description: "In-depth research and analysis",
    icon: Microscope,
    accent: "purple",
    headline: "Researching in depth...",
    processingSteps: [
      { key: "connected", label: "Understanding research goal", detail: "Defining scope and keywords" },
      { key: "searching_knowledge", label: "Searching Dayjoy knowledge", detail: "Scanning verified documents" },
      { key: "searching_web", label: "Gathering additional sources", detail: "Broadening the evidence base" },
      { key: "verifying", label: "Cross-checking findings", detail: "Ensuring accuracy and relevance" },
      { key: "generating", label: "Preparing research report", detail: "Structuring the findings" },
    ],
  },
  compare_products: {
    id: "compare_products",
    label: "Compare Products",
    description: "Compare products, features & value",
    icon: GitCompare,
    accent: "green",
    headline: "Comparing products...",
    processingSteps: [
      { key: "connected", label: "Understanding the comparison", detail: "Identifying products & criteria" },
      { key: "searching_knowledge", label: "Gathering product information", detail: "Collecting verified details" },
      { key: "generating", label: "Preparing the comparison", detail: "Building the comparison table" },
    ],
  },
  create: {
    id: "create",
    label: "Create",
    description: "Draft messages, plans & content",
    icon: PenTool,
    accent: "amber",
    headline: "Creating your content...",
    processingSteps: [
      { key: "connected", label: "Understanding what to create", detail: "Reading the request" },
      { key: "searching_knowledge", label: "Checking Dayjoy details", detail: "Pulling facts to ground it in" },
      { key: "generating", label: "Drafting it", detail: "Writing the finished version" },
    ],
  },
  analyze: {
    id: "analyze",
    label: "Analyze",
    description: "Findings & recommendations from your data",
    icon: BarChart3,
    accent: "teal",
    headline: "Analyzing...",
    processingSteps: [
      { key: "connected", label: "Understanding what to analyze", detail: "Reading the request" },
      { key: "searching_knowledge", label: "Gathering relevant data", detail: "Pulling supporting information" },
      { key: "verifying", label: "Checking the evidence", detail: "Making sure findings are grounded" },
      { key: "generating", label: "Preparing findings", detail: "Structuring the analysis" },
    ],
  },
};

export const AI_MODE_ACCENT_CLASSES: Record<AiModeAccent, { text: string; bg: string; ring: string; dot: string }> = {
  orange: { text: "text-primary", bg: "bg-primary/8", ring: "ring-primary/20", dot: "bg-primary" },
  indigo: { text: "text-indigo-500", bg: "bg-indigo-500/8", ring: "ring-indigo-500/20", dot: "bg-indigo-500" },
  purple: { text: "text-purple-500", bg: "bg-purple-500/8", ring: "ring-purple-500/20", dot: "bg-purple-500" },
  green: { text: "text-emerald-600", bg: "bg-emerald-500/8", ring: "ring-emerald-500/20", dot: "bg-emerald-500" },
  amber: { text: "text-amber-600", bg: "bg-amber-500/8", ring: "ring-amber-500/20", dot: "bg-amber-500" },
  teal: { text: "text-teal-600", bg: "bg-teal-500/8", ring: "ring-teal-500/20", dot: "bg-teal-500" },
};

export function isAiMode(value: unknown): value is AiMode {
  return typeof value === "string" && (AI_MODE_ORDER as string[]).includes(value);
}
