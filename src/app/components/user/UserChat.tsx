import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
  Children,
  isValidElement,
  type ReactNode,
  type ReactElement,
  type ComponentPropsWithoutRef,
  type ThHTMLAttributes,
} from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence } from "framer-motion";
import {
  Paperclip,
  Users,
  TrendingUp,
  GraduationCap,
  LifeBuoy,
  Package,
  Target,
  Globe,
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
  GitBranch,
  Menu,
  MoreVertical,
  Ghost,
  Pencil,
  Volume2,
  VolumeX,
  AudioLines,
  Lightbulb,
  Filter,
  CheckCircle2,
  Wand2,
  ListChecks,
  BookmarkPlus,
  MoreHorizontal,
  Minimize2,
  Maximize,
  Languages,
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
  sortConversations,
  updateMessageContent,
  type Conversation,
  type ChatMessage,
} from "../../lib/chatStore";
import {
  streamChatWithBackend,
  generateConversationTitle,
  SessionExpiredError,
  rememberPreference,
  distributorCreateFollowUp,
  createArtifact,
  transformTextSnippet,
  KNOWLEDGE_SCOPE_OPTIONS,
  getCapabilities,
  type ArtifactType,
  type ChatSource,
  type ChatProductCard,
  type KnowledgeScope,
  type CapabilityStatus,
} from "../../../lib/api";
import { CameraCapture, type CapturedImage } from "../tools/CameraCapture";
import { QRScanner, type ScanResult } from "../tools/QRScanner";
import { OcrScanner } from "../tools/OcrScanner";
import { VoiceControls } from "../voice/VoiceControls";
import { notifyAIResponseReady } from "../../lib/pushNotifications";
import { AccountMenu } from "../common/AccountMenu";
import { DayjoyLogo } from "../brand/DayjoyLogo";
import { NotificationCenter } from "../notifications/NotificationCenter";
import { ThemeToggle } from "../common/ThemeToggle";
import { Modal } from "../common/Modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useVoice } from "../../lib/useVoice";
import { isVoiceRepliesEnabled } from "../../lib/voicePreference";
import { useIsMobile } from "../../lib/useIsMobile";
import { useChatExperience } from "../../lib/ChatExperienceContext";
import { useChatMode } from "../../lib/ChatModeContext";
import { AI_MODES, AI_MODE_ORDER, AI_MODE_ACCENT_CLASSES, type AiMode, type AiModeStatusKey } from "../../lib/aiModes";
import { ModeProcessingCard } from "./ModeProcessingCard";
import { useTransparentLogo } from "../../lib/useTransparentLogo";
import logoSrc from "../../../assets/dayjoy-logo.png";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card } from "../ui/card";
import { Switch } from "../ui/switch";

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
function generateFollowUps(answer: string, sources: unknown, answerSource?: string | null): string[] {
  const followUps: string[] = [];
  const lower = answer.toLowerCase();

  // answer_source-based follow-ups first — these reflect what the backend
  // actually determined the question WAS (structured pricing/recommendation
  // vs. a plain knowledge lookup), a stronger signal than re-guessing from
  // the answer text alone.
  if (answerSource === "dayjoy_knowledge") {
    if (sources && Array.isArray(sources) && sources.length > 0) {
      const hasProducts = (sources as Array<{ table?: string }>).some((s) => s?.table === "products");
      if (hasProducts) {
        followUps.push("Compare this with similar products");
        followUps.push("What are the safety notes?");
      }
    }
  } else if (answerSource === "web_search") {
    followUps.push("Is there an official Dayjoy source for this?");
  } else if (answerSource === "clarification") {
    // The answer IS the clarifying question — nothing more specific to
    // suggest until the user picks an option.
    return [];
  }

  // Category-based follow-ups, from the answer's own content
  if (lower.includes("price") || lower.includes("mrp") || lower.includes("dp") || lower.includes(" bv")) {
    followUps.push("What's the BV and PV for this?");
  }
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
  if (lower.includes("recommend") || lower.includes("matched for")) {
    followUps.push("What's the price of this?");
    followUps.push("Are there any alternatives?");
  }

  // Last resort — still Dayjoy-scoped, never a content-free "give me an
  // example" that has nothing to do with what was actually asked.
  if (followUps.length === 0) {
    followUps.push("Can you point me to a verified source for this?");
    followUps.push("What else does Dayjoy offer here?");
  }

  return Array.from(new Set(followUps)).slice(0, 3);
}

/**
 * Structured answer blocks — parsed from the specific bold-labeled markers
 * SYSTEM_PROMPT (backend/main.py) optionally asks the model to emit
 * ("**TL;DR:** ...", "**💡 Key Insight:** ...", etc). Each marker is still
 * valid Markdown on its own (a bold-prefixed line), so a message that never
 * uses one just renders as a single markdown block exactly as before —
 * this is additive, not a replacement rendering path.
 */
/**
 * ChartBlock — renders a small bar/line chart from a fenced ```chart code
 * block's JSON payload (see MARKDOWN_COMPONENTS' `code` override below).
 * Self-contained inline SVG — no charting library dependency. Only renders
 * for a fenced block whose language is literally "chart" and whose content
 * parses as valid JSON matching ChartSpec; anything else (including a
 * genuine ```json or code sample) falls through to normal code rendering.
 */
type ChartSpec = {
  type?: "bar" | "line" | "pie" | "donut";
  title?: string;
  data: Array<{ label: string; value: number }>;
};

function isChartSpec(v: unknown): v is ChartSpec {
  if (!v || typeof v !== "object") return false;
  const data = (v as { data?: unknown }).data;
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    data.every((d) => d && typeof d === "object" && "label" in d && "value" in d && typeof (d as { value: unknown }).value === "number")
  );
}

/** Categorical palette for pie/donut segments — the first slot reuses the
 * app's own primary brand color, the rest are fixed hex values (inline SVG
 * needs real color values, not Tailwind utility classes) chosen to stay
 * visually distinct from each other and from the primary accent. */
const DONUT_COLORS = [
  "rgb(var(--primary-rgb))",
  "#6366f1",
  "#a855f7",
  "#10b981",
  "#f59e0b",
  "#14b8a6",
  "#f43f5e",
];

function DonutChart({ spec }: { spec: ChartSpec }) {
  const size = 140;
  const cx = size / 2;
  const cy = size / 2;
  const r = 50;
  const strokeWidth = 22;
  const circumference = 2 * Math.PI * r;
  const total = spec.data.reduce((s, d) => s + Math.max(d.value, 0), 0) || 1;
  let offsetAcc = 0;

  return (
    <div className="not-prose rounded-xl border border-border bg-card px-3 py-3 my-2">
      {spec.title ? <div className="text-xs font-semibold text-foreground mb-2">{spec.title}</div> : null}
      <div className="flex items-center gap-4">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label={spec.title || "Chart"}>
          <g transform={`rotate(-90 ${cx} ${cy})`}>
            {spec.data.map((d, i) => {
              const value = Math.max(d.value, 0);
              const fraction = value / total;
              const dash = fraction * circumference;
              const dashoffset = -offsetAcc;
              offsetAcc += dash;
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={dashoffset}
                />
              );
            })}
          </g>
        </svg>
        <div className="flex flex-col gap-1 text-[11px] min-w-0">
          {spec.data.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
                aria-hidden="true"
              />
              <span className="truncate text-muted-foreground">{d.label}</span>
              <span className="text-foreground font-medium ml-auto shrink-0">
                {Math.round((Math.max(d.value, 0) / total) * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChartBlock({ spec }: { spec: ChartSpec }) {
  if (spec.type === "pie" || spec.type === "donut") {
    return <DonutChart spec={spec} />;
  }

  const width = 320;
  const height = 140;
  const padding = 24;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;
  const values = spec.data.map((d) => d.value);
  const max = Math.max(...values, 1);
  const isLine = spec.type === "line";

  return (
    <div className="not-prose rounded-xl border border-border bg-card px-3 py-3 my-2">
      {spec.title ? <div className="text-xs font-semibold text-foreground mb-2">{spec.title}</div> : null}
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label={spec.title || "Chart"}>
        {isLine ? (
          <polyline
            fill="none"
            stroke="rgb(var(--primary-rgb))"
            strokeWidth={2}
            points={spec.data
              .map((d, i) => {
                const x = padding + (i / Math.max(spec.data.length - 1, 1)) * chartW;
                const y = padding + chartH - (d.value / max) * chartH;
                return `${x},${y}`;
              })
              .join(" ")}
          />
        ) : (
          spec.data.map((d, i) => {
            const slot = chartW / spec.data.length;
            const barW = Math.max(slot - 8, 4);
            const x = padding + i * slot + 4;
            const barH = (d.value / max) * chartH;
            const y = padding + chartH - barH;
            return <rect key={i} x={x} y={y} width={barW} height={barH} rx={3} fill="rgb(var(--primary-rgb))" opacity={0.85} />;
          })
        )}
      </svg>
      <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
        {spec.data.map((d, i) => (
          <span key={i} className="truncate px-0.5" style={{ maxWidth: `${100 / spec.data.length}%` }} title={d.label}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Wraps every markdown table in a horizontally-scrollable container — a wide
 * comparison table (common in Compare mode's answers) would otherwise force
 * the whole chat column wider than the viewport on mobile instead of
 * scrolling within its own box.
 */
/** Recursively flattens a React node tree to its rendered text — used to
 * read a table cell's content for sorting without touching the DOM. */
function extractNodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractNodeText).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return extractNodeText(props.children);
  }
  return "";
}

/** Interactive Tables (Feature 20) — a markdown table's header cells become
 * clickable to sort the rows, purely client-side. Falls back to a plain
 * (still horizontally-scrollable) table whenever the children don't match
 * the exact thead/tr + tbody/tr shape remark-gfm always produces for a
 * table — never throws, worst case is "not sortable", not a crash. */
function SortableTable(props: ComponentPropsWithoutRef<"table">) {
  const { children, ...rest } = props;
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const childArray = Children.toArray(children);
  const thead = childArray.find(
    (c): c is ReactElement<{ children?: ReactNode }> => isValidElement(c) && c.type === "thead",
  );
  const tbody = childArray.find(
    (c): c is ReactElement<{ children?: ReactNode }> => isValidElement(c) && c.type === "tbody",
  );
  const headerRow = thead
    ? (Children.toArray(thead.props.children).find(
        (c): c is ReactElement<{ children?: ReactNode }> => isValidElement(c),
      ) ?? null)
    : null;
  const headerCells = headerRow ? Children.toArray(headerRow.props.children) : [];
  const bodyRows = tbody
    ? Children.toArray(tbody.props.children).filter(
        (c): c is ReactElement<{ children?: ReactNode }> => isValidElement(c),
      )
    : [];

  // Anything other than the standard shape (unexpected nesting, a table
  // with no header, etc.) — render exactly as before, just not sortable.
  if (!thead || !tbody || headerCells.length === 0) {
    return (
      <div className="overflow-x-auto">
        <table {...rest}>{children}</table>
      </div>
    );
  }

  const sortedRows = (() => {
    if (sortCol === null) return bodyRows;
    const withText = bodyRows.map((row) => {
      const cells = Children.toArray(row.props.children);
      const cell = cells[sortCol];
      const text = isValidElement(cell) ? extractNodeText((cell.props as { children?: ReactNode }).children) : "";
      return { row, text: text.trim() };
    });
    // `Number("")` is 0, not NaN — stripping a purely-alphabetic cell like
    // "Turmeric" down to non-digit characters leaves "", which this naive
    // check would have called "numeric" and compared as 0 === 0 for every
    // row (a silent no-op sort instead of the expected alphabetic one).
    // Require at least one actual digit in the original text first.
    const numeric = withText.every(
      (w) => w.text === "" || (/\d/.test(w.text) && !Number.isNaN(Number(w.text.replace(/[^0-9.-]/g, "")))),
    );
    const sorted = [...withText].sort((a, b) => {
      const cmp = numeric
        ? Number(a.text.replace(/[^0-9.-]/g, "") || 0) - Number(b.text.replace(/[^0-9.-]/g, "") || 0)
        : a.text.localeCompare(b.text);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted.map((w) => w.row);
  })();

  return (
    <div className="overflow-x-auto">
      <table {...rest}>
        <thead>
          <tr>
            {headerCells.map((cell, i) => {
              if (!isValidElement(cell)) return null;
              const cellProps = cell.props as ThHTMLAttributes<HTMLTableCellElement>;
              return (
                <th
                  {...cellProps}
                  key={i}
                  className={`${cellProps.className ?? ""} cursor-pointer select-none hover:opacity-70 transition-opacity`}
                  onClick={() => {
                    if (sortCol === i) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                    else {
                      setSortCol(i);
                      setSortDir("asc");
                    }
                  }}
                  role="columnheader"
                  aria-sort={sortCol === i ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <span className="inline-flex items-center gap-1">
                    {cellProps.children}
                    {sortCol === i ? (
                      <span aria-hidden="true" className="text-[10px]">
                        {sortDir === "asc" ? "▲" : "▼"}
                      </span>
                    ) : null}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{sortedRows}</tbody>
      </table>
    </div>
  );
}

const MARKDOWN_COMPONENTS: Components = {
  table: (props) => <SortableTable {...props} />,
  code: ({ className, children, ...props }) => {
    if (/language-chart/.test(className || "")) {
      const raw = String(children).replace(/\n$/, "");
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isChartSpec(parsed)) return <ChartBlock spec={parsed} />;
      } catch {
        // Invalid JSON in a ```chart block — fall through to plain code
        // rendering below rather than silently dropping the content.
      }
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

type AnswerBlock =
  | { type: "markdown"; text: string }
  | { type: "tldr"; text: string }
  | { type: "callout"; variant: "insight" | "warning" | "tip" | "recommended"; text: string };

const CALLOUT_DEFS: ReadonlyArray<{
  variant: "insight" | "warning" | "tip" | "recommended";
  re: RegExp;
}> = [
  { variant: "insight", re: /^\*\*💡\s*Key Insight:\*\*\s*(.+)$/i },
  { variant: "warning", re: /^\*\*⚠️\s*Warning:\*\*\s*(.+)$/i },
  { variant: "tip", re: /^\*\*✅\s*Tip:\*\*\s*(.+)$/i },
  { variant: "recommended", re: /^\*\*🎯\s*Recommended:\*\*\s*(.+)$/i },
];

const TLDR_RE = /^\*\*TL;DR:\*\*\s*(.+)$/i;

function parseAnswerBlocks(content: string): AnswerBlock[] {
  const lines = content.split("\n");
  const blocks: AnswerBlock[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) blocks.push({ type: "markdown", text });
    buffer = [];
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    // Only the very first non-blank line can be the TL;DR — a mid-answer
    // line that happens to start "**TL;DR:**" (unlikely, but possible in
    // quoted/copied text) is left as plain markdown instead.
    if (blocks.length === 0 && buffer.length === 0 && idx === lines.findIndex((l) => l.trim())) {
      const tldrMatch = trimmed.match(TLDR_RE);
      if (tldrMatch) {
        blocks.push({ type: "tldr", text: tldrMatch[1].trim() });
        return;
      }
    }

    const calloutDef = CALLOUT_DEFS.find((d) => d.re.test(trimmed));
    if (calloutDef) {
      flush();
      const match = trimmed.match(calloutDef.re);
      blocks.push({ type: "callout", variant: calloutDef.variant, text: (match?.[1] ?? "").trim() });
      return;
    }

    buffer.push(line);
  });
  flush();

  return blocks;
}

const CALLOUT_STYLES: Record<
  "insight" | "warning" | "tip" | "recommended",
  { icon: typeof Lightbulb; label: string; cls: string }
> = {
  insight: { icon: Lightbulb, label: "Key Insight", cls: "border-primary/25 bg-primary/[0.06] text-primary" },
  warning: {
    icon: AlertTriangle,
    label: "Warning",
    cls: "border-destructive/25 bg-destructive/[0.06] text-destructive",
  },
  tip: { icon: CheckCircle2, label: "Tip", cls: "border-secondary/25 bg-secondary/[0.06] text-secondary" },
  recommended: {
    icon: Target,
    label: "Recommended",
    cls: "border-gold-accent/40 bg-gold-accent/[0.08] text-warning",
  },
};

function AnswerCallout({ variant, text }: { variant: "insight" | "warning" | "tip" | "recommended"; text: string }) {
  const { icon: Icon, label, cls } = CALLOUT_STYLES[variant];
  return (
    <div className={`flex gap-2 items-start rounded-xl border px-3 py-2 my-2 text-sm not-prose ${cls}`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{label}</div>
        <div className="text-foreground/90 break-words">{text}</div>
      </div>
    </div>
  );
}

function AnswerTLDR({ text }: { text: string }) {
  return (
    <div className="flex gap-2 items-start rounded-xl border border-primary/20 bg-primary/[0.05] px-3 py-2 mb-2 text-sm not-prose">
      <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-primary/80">TL;DR</div>
        <div className="text-foreground/90 break-words">{text}</div>
      </div>
    </div>
  );
}

/** Progressive Disclosure: long answers stay short by default — the reader
 * sees the TL;DR/callouts plus a preview of the detail, with a "Show more"
 * toggle for the rest, instead of a long scroll they have to work through
 * to find out whether the extra detail is worth reading. Only kicks in past
 * PROGRESSIVE_DISCLOSURE_THRESHOLD chars so short answers render exactly as
 * before (no collapse chrome for a two-sentence answer). */
const PROGRESSIVE_DISCLOSURE_THRESHOLD = 900;
const PROGRESSIVE_DISCLOSURE_PREVIEW = 420;

/** Inline Follow-up (Capability 35) — a small, hover-revealed action row
 * attached to ONE answer section rather than the whole message, reusing
 * the existing Transform Controls machinery scoped to just that
 * section's text. Only rendered for sections with enough content to be
 * worth a targeted action (a one-line section doesn't need this). */
function InlineFollowUp({ text, onTransform }: { text: string; onTransform?: (kind: TransformKind, text: string) => void }) {
  if (!onTransform || text.trim().length < 80) return null;
  return (
    <div className="not-prose flex items-center gap-2 mt-1 mb-2 opacity-0 group-hover/section:opacity-100 transition-opacity">
      <button
        type="button"
        onClick={() => onTransform("detail", text)}
        className="text-[10px] font-medium text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded hover:bg-accent/50"
      >
        Explain
      </button>
      <button
        type="button"
        onClick={() => onTransform("example", text)}
        className="text-[10px] font-medium text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded hover:bg-accent/50"
      >
        Give example
      </button>
      <button
        type="button"
        onClick={() => onTransform("actionable", text)}
        className="text-[10px] font-medium text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded hover:bg-accent/50"
      >
        Make actionable
      </button>
    </div>
  );
}

function DetailMarkdown({ text, onTransform }: { text: string; onTransform?: (kind: TransformKind, text: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > PROGRESSIVE_DISCLOSURE_THRESHOLD;
  if (!isLong || expanded) {
    return (
      <div className="group/section">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
          {text}
        </ReactMarkdown>
        {isLong ? (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="not-prose flex items-center gap-1 text-xs font-medium text-primary hover:underline mt-1"
          >
            <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
            Show less
          </button>
        ) : null}
        <InlineFollowUp text={text} onTransform={onTransform} />
      </div>
    );
  }
  // Cut on a paragraph/sentence boundary near the preview length so the
  // truncated text doesn't end mid-word.
  const cutAt = text.indexOf("\n\n", PROGRESSIVE_DISCLOSURE_PREVIEW);
  const previewEnd = cutAt > 0 && cutAt < PROGRESSIVE_DISCLOSURE_PREVIEW + 200 ? cutAt : PROGRESSIVE_DISCLOSURE_PREVIEW;
  const preview = text.slice(0, previewEnd);
  return (
    <div className="group/section">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {preview}
      </ReactMarkdown>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="not-prose flex items-center gap-1 text-xs font-medium text-primary hover:underline mt-1"
      >
        <ChevronUp className="w-3.5 h-3.5 rotate-180" aria-hidden="true" />
        Show more
      </button>
    </div>
  );
}

/** Renders `content` as structured blocks (TL;DR / callouts / markdown) instead
 * of one flat ReactMarkdown call — see `parseAnswerBlocks`. */
function AnswerContent({ content, onTransform }: { content: string; onTransform?: (kind: TransformKind, text: string) => void }) {
  const blocks = useMemo(() => parseAnswerBlocks(content), [content]);
  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === "tldr") return <AnswerTLDR key={i} text={block.text} />;
        if (block.type === "callout") return <AnswerCallout key={i} variant={block.variant} text={block.text} />;
        return <DetailMarkdown key={i} text={block.text} onTransform={onTransform} />;
      })}
    </>
  );
}

/**
 * ProductCard — renders structured product data (ChatResponse.products).
 * Only ever populated from a verified DB row (pricing_lookup /
 * product_recommendation tool result — see backend/main.py's RouteResult.
 * product_cards), never from RAG/LLM text, so every field here is safe to
 * show as fact rather than AI-generated content.
 */
/**
 * Product photo slot for a chat ProductCard — the approved image resolved
 * server-side (product.image_url, from product_images via
 * backend/orchestrator/tools/product_media.py), falling back to the generic
 * package icon when there's no image or it fails to load. Never shows a
 * broken-image icon, and never substitutes a non-approved image.
 */
function ProductCardPhoto({ src, alt }: { src?: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex items-center justify-center w-11 h-11 rounded-lg bg-primary/10 text-primary shrink-0">
        <Package className="w-4 h-4" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className="w-11 h-11 rounded-lg overflow-hidden border border-border shrink-0 bg-accent/40">
      <img
        src={src}
        alt={alt}
        className="w-full h-full object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function ProductCard({ product, hideImage = false }: { product: ChatProductCard; hideImage?: boolean }) {
  const price = product.price;
  const [showWhy, setShowWhy] = useState(false);
  return (
    <div className="not-prose rounded-xl border border-border bg-accent/30 px-3 py-2.5 my-2 text-sm">
      <div className="flex items-start gap-2">
        <ProductCardPhoto
          src={hideImage ? null : product.image_url}
          alt={product.image_alt || product.product_name || "Dayjoy product"}
        />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-foreground truncate">{product.product_name ?? "Dayjoy product"}</div>
          {product.matched_condition ? (
            <div className="text-[11px] text-muted-foreground">Matched for: {product.matched_condition}</div>
          ) : null}
          {product.recommendation_strength ? (
            <span
              className={`inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                product.recommendation_strength === "Strong recommendation"
                  ? "text-primary bg-primary/10"
                  : product.recommendation_strength === "Good option"
                    ? "text-secondary bg-secondary/10"
                    : "text-muted-foreground bg-accent"
              }`}
            >
              {product.recommendation_strength}
            </span>
          ) : null}
        </div>
        {price ? (
          <div className="text-right shrink-0">
            <div className="font-semibold text-foreground">
              {price.currency ?? "INR"} {price.dp ?? price.mrp}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {price.dp != null ? "DP" : "MRP"}
              {price.bv != null ? ` · BV ${price.bv}` : ""}
            </div>
          </div>
        ) : null}
      </div>
      {product.benefits ? (
        <p className="mt-1.5 text-foreground/80 line-clamp-2">{product.benefits}</p>
      ) : null}
      {product.safety_note ? (
        <p className="mt-1 text-[11px] text-warning">⚠ {product.safety_note}</p>
      ) : null}
      {/* Reasoning Summary (Capability 36) — safe, concise "why this
          recommendation?" bullets, never hidden chain-of-thought. */}
      {product.reasoning_summary && product.reasoning_summary.length > 0 ? (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => setShowWhy((v) => !v)}
            className="text-[11px] text-primary hover:underline"
          >
            {showWhy ? "Hide" : "Why this?"}
          </button>
          {showWhy ? (
            <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground list-disc list-inside">
              {product.reasoning_summary.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Roles that own rows in the `follow_ups` table (backend/distributor_api.py
 * scopes every /distributor/* route to `distributor_id = auth.uid()`) —
 * gates the "Save as follow-up task" chat action so a customer never gets
 * offered an action meant for a distributor's own business workflow. */
const CAN_SAVE_FOLLOW_UPS = new Set(["distributor", "management", "admin", "super_admin"]);

/** Only offer "Save as follow-up task" on answers that are actually
 * plan/step-shaped — never on a plain factual lookup, matching the "no
 * irrelevant buttons" guidance for follow-up intelligence generally. */
function looksActionable(content: string, aiMode?: string | null): boolean {
  if (aiMode === "create") return true;
  return /(^|\n)\s*\d+\.\s/.test(content);
}

/**
 * Answer Transformation Controls — reuses the normal send pipeline (same as
 * a follow-up chip) rather than a dedicated backend endpoint: each transform
 * is just a differently-phrased follow-up question about the prior answer,
 * and the existing orchestrator/RAG/grounding pipeline already handles
 * "explain X simply" style requests correctly.
 */
export type TransformKind =
  | "simplify"
  | "actionable"
  | "shorter"
  | "detail"
  | "checklist"
  | "compare"
  | "hinglish"
  | "example"
  | "translate"
  | "rewrite"
  | "expand";

/**
 * Advanced Regeneration Controls — variants beyond a plain "try again",
 * each appending a directive to the ORIGINAL question (not the previous
 * answer, unlike TransformKind above) so the model regenerates from
 * scratch with that constraint in mind, rather than editing prior output.
 */
export type RegenerateVariant =
  | "accurate"
  | "shorter"
  | "detailed"
  | "simpler"
  | "professional"
  | "actionable"
  | "different";

const REGENERATE_VARIANT_LABELS: Record<RegenerateVariant, string> = {
  accurate: "More accurate",
  shorter: "Shorter",
  detailed: "More detailed",
  simpler: "Simpler",
  professional: "More professional",
  actionable: "More actionable",
  different: "Different approach",
};

const REGENERATE_VARIANT_DIRECTIVES: Record<RegenerateVariant, string> = {
  accurate: "Please double-check accuracy and be more precise and factually careful than a typical answer.",
  shorter: "Please answer more concisely than usual — keep only the essential point(s).",
  detailed: "Please answer in more depth than usual, with the full reasoning and relevant specifics.",
  simpler: "Please explain more simply, in plain everyday language.",
  professional: "Please answer in a more polished, professional tone.",
  actionable: "Please make the answer more actionable — concrete steps the user can act on.",
  different: "Please answer from a different angle or approach than a typical first answer would.",
};

function buildRegeneratePrompt(variant: RegenerateVariant, originalQuestion: string): string {
  return `${originalQuestion}\n\n(${REGENERATE_VARIANT_DIRECTIVES[variant]})`;
}

const TRANSFORM_PROMPTS: Record<TransformKind, (text: string) => string> = {
  simplify: (t) => `Explain this more simply, in plain everyday language:\n\n"""${t}"""`,
  actionable: (t) => `Turn this into a clear, practical action plan — what to do, in what order:\n\n"""${t}"""`,
  shorter: (t) => `Make this significantly shorter — keep only the essential point(s), nothing else:\n\n"""${t}"""`,
  detail: (t) => `Explain this in more detail — the full reasoning and relevant specifics:\n\n"""${t}"""`,
  checklist: (t) => `Turn this into a short, practical checklist:\n\n"""${t}"""`,
  compare: (t) => `Compare the options mentioned here side by side, with a clear verdict:\n\n"""${t}"""`,
  hinglish: (t) => `Rewrite this in Hinglish (Hindi in Latin script, mixed with English the way it's commonly spoken):\n\n"""${t}"""`,
  example: (t) => `Give a concrete, realistic example that illustrates this:\n\n"""${t}"""`,
  translate: (t) => `Translate this into Hindi:\n\n"""${t}"""`,
  rewrite: (t) => `Rewrite this to be clearer and better-worded, keeping the same meaning:\n\n"""${t}"""`,
  expand: (t) => `Expand on this with more context and supporting detail:\n\n"""${t}"""`,
};

function buildTransformPrompt(kind: TransformKind, text: string): string {
  return TRANSFORM_PROMPTS[kind](text);
}

/**
 * Feature: User Preference Learning. After a user repeatedly requests the
 * same transform, save it as a standing preference via the EXISTING memory
 * system (POST /memory) so future answers can already be tuned to it rather
 * than the user needing to ask every time. A lightweight client-side
 * counter (localStorage, per browser) — not a new backend table, and only
 * ever saves once per preference (never re-writes it on every later use).
 */
const TRANSFORM_PREFERENCE_MAP: Partial<Record<TransformKind, { key: string; value: string }>> = {
  simplify: { key: "preferred_explanation_level", value: "simple" },
  actionable: { key: "preferred_response_style", value: "actionable" },
  detail: { key: "preferred_detail", value: "detailed" },
  shorter: { key: "preferred_detail", value: "short" },
};
const TRANSFORM_USAGE_THRESHOLD = 3;

function trackTransformUsage(kind: TransformKind) {
  const mapping = TRANSFORM_PREFERENCE_MAP[kind];
  if (!mapping) return;
  try {
    const countKey = `dayjoy_transform_count_${kind}`;
    const savedKey = `dayjoy_transform_saved_${mapping.key}`;
    if (localStorage.getItem(savedKey) === "1") return; // already learned this preference
    const count = Number(localStorage.getItem(countKey) || "0") + 1;
    localStorage.setItem(countKey, String(count));
    if (count >= TRANSFORM_USAGE_THRESHOLD) {
      localStorage.setItem(savedKey, "1");
      void rememberPreference(mapping.key, mapping.value);
    }
  } catch {
    // localStorage unavailable (private browsing, etc.) — skip silently;
    // this is a quality-of-life save, never a critical action.
  }
}

type Lang = "English" | "Hindi" | "Hinglish";

/**
 * Suggested prompts — each tied to a Dayjoy-themed category with its own
 * accent color + lucide icon. This makes the welcome screen feel curated
 * rather than generic, and visually connects each card to the brand palette.
 */
type PromptStyle = { icon: typeof Leaf; tint: string; ring: string };

/** Cycled by card position rather than by topic — keeps the 4-card grid's
 * color variety even though each role now gets its own set of topics. */
const PROMPT_STYLES: ReadonlyArray<PromptStyle> = [
  { icon: Leaf, tint: "bg-primary/10 text-primary", ring: "group-hover:border-primary/40" },
  { icon: Rocket, tint: "bg-gold-accent/20 text-warning", ring: "group-hover:border-gold-accent/50" },
  { icon: ShieldCheck, tint: "bg-secondary/10 text-secondary", ring: "group-hover:border-secondary/40" },
  { icon: ScrollText, tint: "bg-accent text-accent-foreground", ring: "group-hover:border-primary/30" },
];

/**
 * A <textarea> placeholder renders on a single line — it cannot wrap, so a
 * long string is clipped mid-word on narrow screens rather than reflowed.
 * Keep this short; the full description lives on the textarea's aria-label.
 * (BRAND.shortName is already "Dayjoy AI", so naming Dayjoy again here would
 * read as "Ask Dayjoy AI ... about Dayjoy products".)
 */
const composerPlaceholder = `Ask ${BRAND.shortName} anything…`;

/**
 * Voice-orb hero — disabled per product request (2026-08-17): the always-
 * visible animated sphere read as visually dominant/decorative on the
 * empty-state screen without adding value in text-chat mode, and looked
 * broken once the on-screen keyboard opened on mobile. Flip this back to
 * `true` to restore it as the tappable hands-free-voice centerpiece — the
 * orb's JSX, `toggleVoiceMode`, and all voice-mode state below are kept
 * intact, just gated behind this flag, so nothing needs to be rewritten.
 */
const SHOW_VOICE_ORB = false;

/** Attachments are inlined as data URLs, so keep them small. */
const MAX_ATTACHMENT_BYTES = 10_000_000;
const MAX_ATTACHMENTS = 5;
// Advanced File Intelligence (Capabilities 3/21/22/5) — mirrors
// backend/main.py's MAX_ATTACHED_DOCUMENTS.
const MAX_ATTACHED_DOCUMENTS_PER_MESSAGE = 3;

type SuggestedPrompt = { title: string; text: string; icon: typeof Leaf };

/**
 * Suggested prompts personalized by role. Each role sees the topics that
 * actually matter to their job: customers get discovery/wellness/orders/
 * support, distributors get customers/follow-ups/recommendations/sales/
 * training, leaders get team performance/coaching/targets/analytics.
 */
const ROLE_PROMPTS: Record<string, ReadonlyArray<SuggestedPrompt>> = {
  customer: [
    { title: "Find a product", text: "Help me find a Dayjoy product for daily wellness.", icon: Package },
    { title: "Wellness questions", text: "Which Dayjoy products support immunity and energy?", icon: Leaf },
    { title: "Track my order", text: "What's the status of my most recent Dayjoy order?", icon: Clock },
    { title: "Get support", text: "I need help with a product issue — what should I do?", icon: LifeBuoy },
  ],
  distributor: [
    { title: "Customer follow-ups", text: "Which of my customers are due for a follow-up today?", icon: Users },
    { title: "Product recommendations", text: "Recommend Dayjoy products for a customer interested in wellness.", icon: Package },
    { title: "Sales guidance", text: "Give me objection handling for a hesitant prospect.", icon: TrendingUp },
    { title: "Training & growth", text: "What training should I complete next to grow my business?", icon: GraduationCap },
  ],
  leader: [
    { title: "Team performance", text: "How is my team performing against this month's target?", icon: Users },
    { title: "Coach my team", text: "Help me coach a distributor who's falling behind.", icon: GraduationCap },
    { title: "Targets & progress", text: "Show me progress toward this month's team target.", icon: Target },
    { title: "Analytics summary", text: "Summarize my team's key analytics this week.", icon: TrendingUp },
  ],
  trainer: [
    { title: "Build a quiz", text: "Help me build a quiz for new distributor onboarding.", icon: GraduationCap },
    { title: "Training modules", text: "What training modules cover Dayjoy product knowledge?", icon: Package },
    { title: "Certification status", text: "Which trainees are close to certification?", icon: Target },
    { title: "Company policies", text: "What is the Dayjoy return and refund policy?", icon: ScrollText },
  ],
  default: [
    { title: "Wellness products", text: "Which Dayjoy products support daily wellness and immunity?", icon: Leaf },
    { title: "Distributor onboarding", text: "What are the first 3 steps to start as a Dayjoy distributor?", icon: Rocket },
    { title: "Safety & usage", text: "Are there any products not recommended during pregnancy?", icon: ShieldCheck },
    { title: "Company policies", text: "What is the Dayjoy return and refund policy?", icon: ScrollText },
  ],
};

function getSuggestedPrompts(role: string | null | undefined): ReadonlyArray<SuggestedPrompt> {
  if (role && ROLE_PROMPTS[role]) return ROLE_PROMPTS[role];
  if (role === "employee" || role === "support") return ROLE_PROMPTS.trainer;
  if (role === "admin" || role === "management" || role === "super_admin") return ROLE_PROMPTS.leader;
  return ROLE_PROMPTS.default;
}

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

/** Knowledge Conflict Resolution (Capability 9) — reads the
 * knowledge_conflict block out of the message's (untyped) rag_metadata,
 * if present. */
function messageKnowledgeConflict(message: ChatMessage): {
  category: string;
  authoritative_document: string;
  authoritative_updated_at: string | null;
  other_documents: string[];
} | null {
  const meta = message.rag_metadata as { knowledge_conflict?: unknown } | null | undefined;
  const conflict = meta?.knowledge_conflict;
  if (!conflict || typeof conflict !== "object") return null;
  return conflict as {
    category: string;
    authoritative_document: string;
    authoritative_updated_at: string | null;
    other_documents: string[];
  };
}

/**
 * Truthful, contextual per-message trust badge — replaces a literal
 * "Verified" label that previously rendered unconditionally on every
 * assistant bubble regardless of what the backend actually reported.
 * Returns `null` for messages with no verification data (e.g. an
 * optimistic local bubble not yet reconciled with the backend response),
 * so no badge renders rather than a misleading one.
 */
function messageTrustBadge(
  message: ChatMessage,
): { label: string; icon: typeof BadgeCheck; tone: "primary" | "muted" | "warning" } | null {
  if (message.answer_source === "casual") return null;
  if (message.answer_source === "live_data") {
    return { label: "Live data", icon: Globe, tone: "primary" };
  }
  if (message.answer_source === "web_search") {
    return { label: "Web source", icon: Globe, tone: "muted" };
  }
  if (message.answer_source === "general_llm") {
    return { label: "General AI knowledge", icon: Sparkles, tone: "muted" };
  }
  if (message.verification_status === "verified") {
    return { label: "Dayjoy Knowledge Base", icon: BadgeCheck, tone: "primary" };
  }
  if (message.verification_status === "partial") {
    return { label: "Partial match — verify", icon: BadgeCheck, tone: "warning" };
  }
  if (message.verification_status === "unverified") {
    return { label: "Unverified", icon: BadgeCheck, tone: "muted" };
  }
  return null;
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
  const { mode: aiMode, setMode: setAiMode } = useChatMode();
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
  // "Save as follow-up task" — id of the message currently showing a
  // saved/saving/error confirmation on its action button.
  const [followUpSaveState, setFollowUpSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  // "Save as artifact" — same transient per-message save-state pattern.
  const [artifactSaveState, setArtifactSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [lastAssistantId, setLastAssistantId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");

  // Edit-and-resend a previously sent user message (ChatGPT-style). Keyed
  // the same way message list `key`s are (`m.id ?? "role-created_at"`) so a
  // not-yet-persisted message can still be edited.
  const [editingMessageKey, setEditingMessageKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  // Temporary Chat (Claude/ChatGPT-style): messages aren't written to
  // Supabase and no conversation row is created, so nothing appears in the
  // sidebar's history and nothing survives a refresh/navigation. Only
  // togglable before the first message of a chat — like those products,
  // switching modes mid-conversation would be confusing (the messages
  // already sent don't retroactively become saved/unsaved).
  const [isTemporary, setIsTemporary] = useState(false);

  // Voice AI (Web Speech API — gracefully degrades if unsupported)
  const voice = useVoice(language === "Hindi" ? "hi" : "en");

  // ---- Tap-the-orb hands-free voice mode ----
  // Distinct from the composer's dictate-to-input mic (VoiceControls): this
  // is a continuous loop — tap the orb once to start, speak your question,
  // it's sent and answered in this same chat, and the mic re-opens
  // automatically once the answer finishes speaking. Tap again to end.
  // (Effects that drive this loop are defined after handleSend, below.)
  const [voiceMode, setVoiceMode] = useState(false);

  // Runtime capability status — vision (image understanding) is only
  // reliably available when the backend's AI provider actually has
  // credit right now, so this is polled live rather than assumed from
  // env config. Polling (not one-shot) means the feature turns back on
  // by itself in the UI within a few minutes of billing being restored,
  // with no page reload required.
  const [visionCapability, setVisionCapability] = useState<CapabilityStatus | null>(null);
  const [webSearchCapability, setWebSearchCapability] = useState<CapabilityStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const caps = await getCapabilities();
      if (!cancelled && caps) {
        setVisionCapability(caps.vision);
        setWebSearchCapability(caps.web_search);
      }
    };
    check();
    const interval = setInterval(check, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Tools state: camera / QR / OCR modals + attach menu
  const [cameraOpen, setCameraOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<
    Array<{ name: string; dataUrl: string; kind: "image" | "document"; mime: string }>
  >([]);
  // Knowledge Scope Selector (Capability 16) — narrows retrieval to one
  // category instead of all of DayJoy's knowledge base. Persists only for
  // this browser session (not saved to a preference) since it's a
  // per-conversation intent, not a standing style preference.
  const [knowledgeScope, setKnowledgeScope] = useState<KnowledgeScope>("all");
  // Context Scope Control (Capability 15) — whether this conversation may
  // fall back to a live web search. Session-scoped, same as knowledgeScope.
  // Off by default, matching ChatGPT/Gemini — the user opts in to web
  // search per session via the "+" plugins menu rather than it running
  // silently on every message.
  const [allowWebSearch, setAllowWebSearch] = useState(false);
  // Smart Text Selection (Capability 34) — a floating toolbar appears when
  // the user selects text WITHIN an assistant answer (scoped via the
  // ".ai-prose" class on that bubble's content wrapper, so selecting a
  // user message or page chrome never triggers it). Reuses the existing
  // TransformKind machinery (handleTransform already accepts arbitrary
  // text, not just the whole message) — just applied to the selection.
  const [selectionToolbar, setSelectionToolbar] = useState<{ text: string; x: number; y: number; messageId: string | null } | null>(null);
  const [editingInPlace, setEditingInPlace] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement | null>(null);

  // AI Mode System — mode picker panel (search + list) opened from the
  // attach ("+") menu, and the real backend SSE status events received for
  // the in-flight request (drives ModeProcessingCard; never a fixed timer).
  const [modePanelOpen, setModePanelOpen] = useState(false);
  const [modeSearch, setModeSearch] = useState("");
  const [receivedStatuses, setReceivedStatuses] = useState<AiModeStatusKey[]>([]);
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
    // Opening a saved conversation (it has a real chatId) is never temporary.
    setIsTemporary(false);
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
      // Ref, not state: `sending` (state) isn't in this callback's own
      // dependency array, so its closure can go stale — once created while
      // `sending` was true, it stays permanently stuck reading `true` until
      // some OTHER listed dep happens to change, blocking every later call
      // even long after the send actually finished. Caught via the edit-
      // and-resend flow: editing a message and saving silently no-opped
      // because handleSend's captured `sending` never updated back to
      // false. `sendingRef.current` doesn't have this problem — a ref's
      // `.current` is always read live, never captured by a closure — so
      // it alone is the correct guard here.
      if (!text || sendingRef.current) return;
      if (text.length > 4000) {
        setError("Message is too long (max 4000 characters).");
        return;
      }

      sendingRef.current = true;
      setError(null);
      setInput("");
      setStreamingText("");
      setSending(true);
      setReceivedStatuses([]);
      const sentAiMode = aiMode;

      let convId = chatId ?? activeConv?.id;
      let conv: Conversation | null = activeConv;

      if (!convId && !isTemporary) {
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
        setConversations((prev) => sortConversations([createdConv, ...prev]));
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
        ai_mode?: string;
        follow_ups?: string[] | null;
        products?: ChatProductCard[] | null;
        clarification_options?: string[] | null;
        evidence_strength?: string | null;
        claim_verification?: ChatMessage["claim_verification"];
      } = {};

      // Multimodal Understanding (Capabilities 1/2/19/20) — the most
      // recently attached image, if any, rides along with THIS message
      // only (attachments themselves stay in the persistent per-conversation
      // gallery below, unaffected by sending).
      const documentAttachments = attachments.filter((a) => a.kind === "document");
      const imageAttachments = attachments.filter((a) => a.kind === "image");
      // Advanced File Intelligence (Capabilities 3/21/22/5) — documents
      // take priority over an image if somehow both are attached (matches
      // the backend's own precedence in main.py's /chat handler).
      const documentsForThisSend =
        documentAttachments.length > 0
          ? documentAttachments
              .slice(-MAX_ATTACHED_DOCUMENTS_PER_MESSAGE)
              .map((a) => ({ name: a.name, mime: a.mime, data_url: a.dataUrl }))
          : undefined;
      const imageForThisSend =
        documentAttachments.length === 0 && imageAttachments.length > 0
          ? imageAttachments[imageAttachments.length - 1].dataUrl
          : undefined;

      try {
        const res = await streamChatWithBackend(
          {
            message: text,
            role: role ?? "customer",
            language,
            conversation_id: convId,
            is_temporary: isTemporary,
            ai_mode: sentAiMode,
            image_data_url: imageForThisSend,
            attached_documents: documentsForThisSend,
            knowledge_scope: knowledgeScope === "all" ? undefined : knowledgeScope,
            allow_web_search: allowWebSearch,
          },
          (chunk) => {
            aggregated += chunk;
            setStreamingText(aggregated);
          },
          controller.signal,
          (status) => {
            setReceivedStatuses((prev) =>
              prev.includes(status as AiModeStatusKey) ? prev : [...prev, status as AiModeStatusKey],
            );
          },
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
          ai_mode: res.ai_mode ?? sentAiMode,
          follow_ups: res.follow_ups,
          products: res.products,
          clarification_options: res.clarification_options,
          evidence_strength: res.evidence_strength,
          claim_verification: res.claim_verification,
        };

        // Temporary Chat: never write to Supabase — build the same message
        // shapes purely in local state so the transcript still renders
        // normally, but nothing persists past this browser session.
        if (!isTemporary) {
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
        }

        const assistantMsg = isTemporary
          ? null
          : await appendMessage(convId!, {
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
              ai_mode: meta.ai_mode ?? sentAiMode,
            });

        // The answer must always render, even if the Supabase write above
        // failed (network blip, RLS, etc.) — fall back to a locally-built
        // message so the reply never silently vanishes after streaming.
        assistantId = assistantMsg?.id ?? null;
        const displayedAssistantMsg: ChatMessage = {
          ...((assistantMsg as ChatMessage | null) ?? {
            // Local-only fallback id (Supabase write failed or this is a
            // temporary conversation) — without a stable id, per-message
            // actions like feedback/copy/speak that key off message.id
            // silently no-op, so this must always be set.
            id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
            ai_mode: meta.ai_mode ?? sentAiMode,
            created_at: new Date().toISOString(),
            _unsaved: !assistantMsg && !isTemporary,
          }),
          // Not a DB column — attached client-side only, after the Supabase
          // write (which spreads its input object verbatim into `.insert()`
          // and would otherwise error on an unknown `follow_ups` column).
          follow_ups: meta.follow_ups ?? null,
          products: meta.products ?? null,
          clarification_options: meta.clarification_options ?? null,
          evidence_strength: meta.evidence_strength ?? null,
          claim_verification: meta.claim_verification ?? null,
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

        if (!isTemporary) await refreshConversations();
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          // User pressed stop — keep what we have, even if persistence fails.
          if (aggregated && (convId || isTemporary)) {
            const stoppedContent = aggregated + "\n\n_⃠ Generation stopped by user._";
            const m = isTemporary
              ? null
              : await appendMessage(convId!, {
                  role: "assistant",
                  content: stoppedContent,
                  safety_status: "safe",
                  handoff_required: false,
                });
            // Show the partial answer even if it failed to persist.
            setMessages((prev) => [
              ...prev,
              (m as ChatMessage | null) ?? {
                id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                conversation_id: convId ?? undefined,
                role: "assistant",
                content: stoppedContent,
                safety_status: "safe",
                handoff_required: false,
                created_at: new Date().toISOString(),
                _unsaved: !isTemporary,
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
    [activeConv, aiMode, allowWebSearch, attachments, currentUser, input, isTemporary, knowledgeScope, language, messages, navigate, refreshConversations, role, voiceMode],
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
      { name: img.file.name, dataUrl: img.dataUrl, kind: "image" as const, mime: img.file.type || "image/jpeg" },
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
        // Advanced File Intelligence (Capabilities 3/21/22/5) — a
        // non-image attachment (PDF/Word/Excel/etc.) is sent to the
        // backend's document-extraction path instead of the vision path.
        const kind: "image" | "document" = file.type.startsWith("image/") ? "image" : "document";
        setAttachments((prev) =>
          prev.length >= MAX_ATTACHMENTS
            ? prev
            : [...prev, { name: file.name, dataUrl, kind, mime: file.type || "application/octet-stream" }],
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

  // ---- Advanced Regeneration Controls: same drop-trailing-then-resend
  // shape as plain regenerate above, but resends a directive-augmented
  // version of the ORIGINAL question rather than the verbatim text. ----
  const handleRegenerateVariant = useCallback(
    async (variant: RegenerateVariant) => {
      if (!activeConv || messages.length === 0) return;
      let lastUserIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx === -1) return;
      const lastUserText = messages[lastUserIdx].content;
      setMessages((prev) => prev.slice(0, lastUserIdx + 1));
      setInput("");
      await handleSend(buildRegeneratePrompt(variant, lastUserText));
    },
    [activeConv, messages, handleSend],
  );

  // ---- Feedback ----
  const handleFeedback = useCallback(
    async (messageId: string | undefined, rating: "up" | "down") => {
      if (!messageId) return;
      const wasSameRating = messages.find((m) => m.id === messageId)?.feedback === rating;
      const nextFeedback = wasSameRating ? null : rating;
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, feedback: nextFeedback } : m)),
      );
      // Local-only fallback ids (message never made it to Supabase) aren't a
      // real row to update — the UI toggle above is all that can happen.
      if (messageId.startsWith("local-")) return;
      await setMessageFeedback(messageId, nextFeedback);
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

  // ---- Read a single assistant reply aloud (independent of hands-free Voice mode) ----
  const handleSpeakMessage = useCallback(
    (text: string, id: string) => {
      if (speakingId === id) {
        voice.stopSpeaking();
        setSpeakingId(null);
        return;
      }
      voice.stopSpeaking();
      setSpeakingId(id);
      voice.speak(text);
    },
    [speakingId, voice],
  );

  // Clear speakingId only on a real speaking→idle transition (TTS finished
  // naturally). Keying this off the bare `!voice.speaking` value instead
  // raced with the async SpeechSynthesis start: setSpeakingId(id) landed in
  // the same render as the still-stale voice.speaking === false from before
  // the utterance's onstart fired, so this effect immediately cleared it
  // back to null — the icon reverted to "Read aloud" while audio kept
  // playing, and the next tap restarted playback instead of stopping it.
  const wasSpeakingRef = useRef(false);
  useEffect(() => {
    if (wasSpeakingRef.current && !voice.speaking) setSpeakingId(null);
    wasSpeakingRef.current = voice.speaking;
  }, [voice.speaking]);

  // ---- Share a single assistant reply (native share sheet, falling back to clipboard) ----
  const handleShareMessage = useCallback(async (text: string, id: string) => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text, title: `${BRAND.shortName} answer` });
        return;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // ignore
    }
  }, []);

  // ---- Transform a previous answer (Explain simpler / Make it actionable) ----
  // Reuses the normal send pipeline (same as a follow-up chip) rather than a
  // dedicated backend endpoint — the transform is just a differently-phrased
  // question about the prior answer, and the existing orchestrator/RAG/
  // grounding pipeline already handles "explain X simply" style requests.
  const handleTransform = useCallback(
    (kind: TransformKind, text: string) => {
      if (sendingRef.current) return;
      const truncated = text.length > 3000 ? `${text.slice(0, 3000)}…` : text;
      const prompt = buildTransformPrompt(kind, truncated);
      trackTransformUsage(kind);
      void handleSend(prompt);
    },
    [handleSend],
  );

  // ---- Smart Text Selection (Capability 34) ----
  const handleMessagesMouseUp = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (!selection || selection.rangeCount === 0 || text.length < 3) {
      setSelectionToolbar(null);
      return;
    }
    const anchorEl =
      selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
    const bubbleEl = anchorEl?.closest(".ai-prose");
    if (!bubbleEl) {
      setSelectionToolbar(null);
      return;
    }
    const messageId = bubbleEl.getAttribute("data-message-id") || null;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setSelectionToolbar({ text: text.slice(0, 3000), x: rect.left + rect.width / 2, y: rect.top, messageId });
  }, []);

  const handleSelectionTransform = useCallback(
    (kind: TransformKind) => {
      if (!selectionToolbar) return;
      handleTransform(kind, selectionToolbar.text);
      setSelectionToolbar(null);
      window.getSelection()?.removeAllRanges();
    },
    [selectionToolbar, handleTransform],
  );

  // ---- Answer Editing, selection-scoped (Capability 12) ----
  // Rewrites JUST the selected snippet and splices the result back into
  // the SAME message in place, unlike every other transform above (which
  // sends the transformation as a brand-new chat turn).
  const handleEditInPlace = useCallback(async () => {
    if (!selectionToolbar?.messageId) return;
    const { text: selectedText, messageId } = selectionToolbar;
    setEditingInPlace(true);
    try {
      const replacement = await transformTextSnippet(
        selectedText,
        "Improve the wording — keep the same meaning and any facts/numbers exactly.",
      );
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !m.content.includes(selectedText)) return m;
          const newContent = m.content.replace(selectedText, replacement);
          void updateMessageContent(messageId, newContent);
          return { ...m, content: newContent };
        }),
      );
    } catch {
      setError("Couldn't edit that text right now. Please try again.");
    } finally {
      setEditingInPlace(false);
      setSelectionToolbar(null);
      window.getSelection()?.removeAllRanges();
    }
  }, [selectionToolbar]);

  // ---- Save an assistant answer as a distributor follow-up task ----
  // Feature: Agentic Workflows, scoped safely — this calls the EXISTING,
  // already-authorized POST /distributor/follow-ups (RLS-scoped to the
  // caller's own distributor_id, see backend/distributor_api.py), not a
  // staff-only endpoint. The user's own button click IS the required
  // explicit approval (see the safety rule against autonomous consequential
  // actions) — nothing here executes anything on its own.
  const handleSaveFollowUp = useCallback(
    async (message: ChatMessage) => {
      const key = message.id ?? `${message.role}-${message.created_at}`;
      setFollowUpSaveState((prev) => ({ ...prev, [key]: "saving" }));
      try {
        const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await distributorCreateFollowUp({
          title: deriveTitle(message.content, 60),
          description: message.content,
          due_date: dueDate,
          task_type: "follow_up",
          priority: "normal",
          ai_generated: true,
          ai_suggestion: message.content,
        });
        setFollowUpSaveState((prev) => ({ ...prev, [key]: "saved" }));
      } catch {
        setFollowUpSaveState((prev) => ({ ...prev, [key]: "error" }));
        setTimeout(() => {
          setFollowUpSaveState((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        }, 2500);
      }
    },
    [],
  );

  // ---- Save an assistant answer as a reusable Artifact ----
  // Feature: Artifact Generation. Available to every role (unlike the
  // distributor-only follow-up task) since an artifact is a personal saved
  // document, not a business-workflow record.
  const handleSaveArtifact = useCallback(
    async (message: ChatMessage) => {
      const key = message.id ?? `${message.role}-${message.created_at}`;
      setArtifactSaveState((prev) => ({ ...prev, [key]: "saving" }));
      try {
        const artifactType: ArtifactType = /(^|\n)\s*\d+\.\s/.test(message.content) ? "action_plan" : "summary";
        await createArtifact({
          artifact_type: artifactType,
          title: deriveTitle(message.content, 60),
          content: message.content,
          conversation_id: activeConv?.id ?? null,
        });
        setArtifactSaveState((prev) => ({ ...prev, [key]: "saved" }));
      } catch {
        setArtifactSaveState((prev) => ({ ...prev, [key]: "error" }));
        setTimeout(() => {
          setArtifactSaveState((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        }, 2500);
      }
    },
    [activeConv],
  );

  // ---- Conversation Branching (Capability 11) ----
  // Duplicates the transcript UP TO AND INCLUDING the given message into a
  // brand-new conversation, then navigates there — the ORIGINAL
  // conversation is never modified, matching the brief's explicit "do not
  // destroy the original conversation state." Lets a user try "Improve" /
  // "Try another approach" / "Explore alternative" from any earlier point
  // without losing the path they already have.
  const [branching, setBranching] = useState(false);
  const handleBranchConversation = useCallback(
    async (uptoMessage: ChatMessage) => {
      if (!currentUser || branching) return;
      setBranching(true);
      try {
        const cutIdx = messages.findIndex((m) => m === uptoMessage);
        const toCopy = cutIdx >= 0 ? messages.slice(0, cutIdx + 1) : messages;
        const sourceTitle = activeConv?.title || "Conversation";
        const branched = await createConversation(currentUser.id, `${sourceTitle} (branch)`, language);
        if (!branched) {
          setError("Could not create a branched conversation. Please try again.");
          return;
        }
        for (const m of toCopy) {
          await appendMessage(branched.id, {
            role: m.role,
            content: m.content,
            sources: m.sources,
            safety_status: m.safety_status ?? "safe",
            handoff_required: m.handoff_required ?? false,
            confidence: m.confidence ?? null,
            verification_status: m.verification_status ?? null,
            handoff_message: m.handoff_message ?? null,
            rag_metadata: m.rag_metadata ?? null,
            answer_source: m.answer_source ?? null,
            ai_mode: m.ai_mode ?? "normal",
          });
        }
        setConversations((prev) => [branched, ...prev]);
        navigate(`/chat/${branched.id}`);
      } finally {
        setBranching(false);
      }
    },
    [activeConv, branching, currentUser, language, messages, navigate],
  );

  // ---- Edit-and-resend a sent user message ----
  const handleStartEdit = useCallback((m: ChatMessage) => {
    setEditingMessageKey(m.id ?? `${m.role}-${m.created_at}`);
    setEditingValue(m.content);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageKey(null);
    setEditingValue("");
  }, []);

  const handleSaveEdit = useCallback(
    async (m: ChatMessage) => {
      const trimmed = editingValue.trim();
      if (!trimmed || sendingRef.current) return;
      const key = m.id ?? `${m.role}-${m.created_at}`;
      const idx = messages.findIndex((x) => (x.id ?? `${x.role}-${x.created_at}`) === key);
      // Drop the edited message and everything after it — same "keep local
      // state, resend fresh" convention handleRegenerate already uses above;
      // any already-persisted rows for the dropped tail stay in Supabase
      // (a reload will show the fuller history) rather than adding a new
      // bulk-delete path for this.
      if (idx !== -1) setMessages((prev) => prev.slice(0, idx));
      setEditingMessageKey(null);
      setEditingValue("");
      await handleSend(trimmed);
    },
    [editingValue, messages, handleSend],
  );

  // ---- Conversation actions ----
  const handleNewChat = useCallback(() => {
    setActiveConv(null);
    setMessages([]);
    setStreamingText("");
    setError(null);
    setIsTemporary(false);
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
      sortConversations(prev.map((c) => (c.id === id ? { ...c, pinned } : c))),
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

  // ---- Share conversation ----
  // Tries the native Web Share API first — the actual OS/browser share
  // sheet (WhatsApp, Mail, etc.), supported on essentially all mobile
  // browsers and increasingly on desktop (Chrome/Edge on Windows, Safari on
  // macOS). Only falls back to a plain clipboard copy where `navigator.share`
  // isn't available at all. Previously this only ever copied a link, which
  // read as "no real share, just copy" on every platform.
  const handleShareConversation = useCallback(async () => {
    if (!activeConv?.id) return false;
    const shareUrl = `${window.location.origin}/chat/${activeConv.id}`;
    const shareTitle = activeConv.title || `${BRAND.shortName} conversation`;

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: shareTitle, url: shareUrl });
        return true;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return true; // user cancelled the share sheet — not a failure
        // Any other failure (e.g. permission denied) falls through to the clipboard copy below.
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setError(null);
      setCopiedId("share-" + activeConv.id);
      setTimeout(() => setCopiedId(null), 2000);
      return true;
    } catch {
      setError("Could not copy link to clipboard.");
      return false;
    }
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
        {filteredConversations.length > 0 ? (
          <div className="px-4 pt-3 pb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/50">
              Recent
            </span>
          </div>
        ) : null}
        <nav className="flex-1 overflow-y-auto p-2 pt-1 space-y-1 scrollbar-thin" aria-label="Conversations">
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
                      <span className="block text-sm font-medium text-foreground truncate">{c.title}</span>
                      {c.updated_at ? (
                        <span className="block text-[11px] text-foreground/55">
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
          <header className="lg:hidden relative flex items-center justify-between gap-2 px-3 h-14 border-b border-border bg-card/80 backdrop-blur-sm shrink-0">
            <button
              type="button"
              onClick={() => outletCtx?.openDrawer()}
              className="flex items-center justify-center w-9 h-9 rounded-full bg-accent/60 text-foreground hover:bg-accent active:scale-90 transition-all"
              aria-label="Open navigation"
            >
              <Menu className="w-4.5 h-4.5" aria-hidden="true" />
            </button>
            {/* Logo + "Dayjoy AI Assist" wordmark. Absolutely centered on the
                bar itself (not flex `justify-center` in a `flex-1` slot) —
                the left side is a single fixed-width button but the right
                side's button count varies (1-3 depending on chat state), so
                a flex-based center slot drifted the wordmark off-true-center
                whenever the right side wasn't exactly as wide as the left.
                Same fix already applied to UserLayout's mobile top bar.

                No profile avatar here: this is the one page in the app
                that's deliberately chat-first with no account chrome in its
                header; profile is still reachable from the hamburger drawer,
                and from every other page's header/mobile top bar as before.

                Swapped for a "Temporary Chat" pill when active — this is
                the ONLY header shown on mobile in Professional mode (the
                default), and it previously showed the fixed logo
                regardless of temporary-chat state, so there was no visible
                confirmation anywhere on screen that the toggle had actually
                done anything besides the small icon's subtle color change. */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
              {isTemporary ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 text-primary ring-1 ring-primary/40 px-3 py-1 text-xs font-semibold">
                  <Ghost className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  Temporary Chat
                </span>
              ) : (
                <DayjoyLogo variant="full" size={22} />
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {!activeConv ? (
                <button
                  type="button"
                  onClick={() => setIsTemporary((v) => !v)}
                  // Always clickable in both directions — a disabled button
                  // gives zero feedback on tap, which is exactly what reads
                  // as "this button doesn't work." This only renders while
                  // `!activeConv` (no saved conversation yet), so toggling
                  // never affects an already-persisted message either way —
                  // it only changes what happens to messages sent AFTER
                  // this tap.
                  className={`flex items-center justify-center w-9 h-9 rounded-full transition-all active:scale-90 ${
                    isTemporary
                      ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                      : "bg-accent/60 text-foreground hover:bg-accent"
                  }`}
                  aria-label={isTemporary ? "Turn off Temporary Chat" : "Turn on Temporary Chat"}
                  aria-pressed={isTemporary}
                  title={isTemporary ? "Temporary Chat is on — tap to turn off" : "Temporary Chat"}
                >
                  <Ghost className="w-4.5 h-4.5" aria-hidden="true" />
                </button>
              ) : null}
              {/* "New chat" only makes sense once there's an actual
                  conversation to leave — on a blank, brand-new chat screen
                  it was rendered (just disabled), which is a dead control
                  with no purpose: there's nothing to start "new" from yet. */}
              {activeConv || messages.length > 0 ? (
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="flex items-center justify-center w-9 h-9 rounded-full bg-accent/60 text-foreground hover:bg-accent active:scale-90 transition-all"
                  aria-label="Start new chat"
                  title="New chat"
                >
                  <MessageSquarePlus className="w-4.5 h-4.5" aria-hidden="true" />
                </button>
              ) : null}
              <DropdownMenu open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center justify-center w-9 h-9 rounded-full bg-accent/60 text-foreground hover:bg-accent active:scale-90 transition-all"
                    aria-label="Chat actions"
                  >
                    <MoreVertical className="w-4.5 h-4.5" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <MoreMenuContent
                  activeConv={activeConv}
                  lastSources={lastSources}
                  attachments={attachments}
                  onSearchChats={() => setSidebarOpen(true)}
                  onShare={handleShareConversation}
                  onRename={() => activeConv && openRename(activeConv.id, activeConv.title)}
                  onExport={handleExportConversation}
                  onViewSources={() => setSourcesPanelOpen(true)}
                  onFindInChat={() => setFindInChatOpen(true)}
                  onPin={() => activeConv && handlePin(activeConv.id, !activeConv.pinned)}
                  onArchive={() => activeConv && handleArchive(activeConv.id, true)}
                  onDelete={() => activeConv && void handleDelete(activeConv.id)}
                />
              </DropdownMenu>
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
                {activeConv?.title ?? (isTemporary ? "Temporary Chat" : "New conversation")}
              </h2>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground min-w-0">
                {activeConv ? (
                  <span className="inline-flex items-center gap-1 truncate">
                    <Clock className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{formatTimestamp(activeConv.updated_at ?? activeConv.created_at)}</span>
                  </span>
                ) : isTemporary ? (
                  <span className="inline-flex items-center gap-1 font-medium truncate">
                    <Ghost className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">Not saved to history</span>
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
            {!activeConv ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setIsTemporary((v) => !v)}
                className={`h-auto w-auto p-2 ${
                  isTemporary
                    ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                    : "text-muted-foreground"
                }`}
                aria-label={isTemporary ? "Turn off Temporary Chat" : "Turn on Temporary Chat"}
                aria-pressed={isTemporary}
                title={isTemporary ? "Temporary Chat is on — tap to turn off" : "Start a Temporary Chat"}
              >
                <Ghost className="w-4 h-4" aria-hidden="true" />
              </Button>
            ) : null}
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
          onMouseUp={handleMessagesMouseUp}
          aria-live="polite"
          aria-relevant="additions text"
        >
          <div className="max-w-3xl mx-auto space-y-5">
            {messages.length === 0 && !streamingText ? (
              <div className="py-3 sm:py-12 text-center">
                {/* Welcome text — the greeting heading + subtitle below stand
                    in for the voice-orb hero while it's disabled. No stand-in
                    icon here on purpose: a generic sparkle/star mark above
                    the greeting read as an AI-cliché placeholder rather than
                    part of the brand. If the orb is restored
                    (SHOW_VOICE_ORB = true) this comment can go too, since the
                    orb's own "Tap the orb to talk" caption covers the hero. */}
                {/* ============================================================
                    VOICE ORB HERO — DISABLED, NOT DELETED.
                    Set SHOW_VOICE_ORB (top of file) back to `true` to restore
                    the tappable animated orb centerpiece (hands-free voice
                    mode: tap to start, speak, hear the answer, mic re-opens
                    automatically). Everything below is untouched so it can be
                    flipped back on at any time.
                    ============================================================ */}
                {SHOW_VOICE_ORB ? (
                  <>
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
                  </>
                ) : null}

                {isTemporary ? (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-accent/50 px-3.5 py-1.5 text-xs font-medium text-muted-foreground"
                  >
                    <Ghost className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    Temporary Chat — this conversation won't be saved or appear in your history
                  </motion.div>
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

                {/* Curated prompt cards — personalized per role (see
                    ROLE_PROMPTS / getSuggestedPrompts above). Hidden on
                    mobile in Professional mode: a chat-first empty state
                    shouldn't front-load a grid of suggestions before the
                    user has typed anything. Still available in Explorer
                    mode and on desktop. */}
                <div
                  className={`${professionalMobile ? "hidden lg:grid" : "grid"} grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto text-left`}
                >
                  {getSuggestedPrompts(role).map((p, idx) => {
                    const style = PROMPT_STYLES[idx % PROMPT_STYLES.length];
                    const Icon = p.icon;
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
                        className={`group relative text-left p-4 rounded-2xl border border-border bg-card hover:bg-accent/40 transition-all overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none ${style.ring}`}
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
                            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${style.tint}`}
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
                {messages.map((m, idx) => {
                  const key = m.id ?? `${m.role}-${m.created_at}`;
                  // De-dup: if the immediately preceding assistant message
                  // already showed a product's image, an immediate follow-up
                  // about the same product ("what are its benefits?") skips
                  // re-showing that image — text-only is enough on a direct
                  // follow-up, avoiding an image-per-message wall for a
                  // multi-turn conversation about one product.
                  let prevProductIds: Set<string> | undefined;
                  if (m.role === "assistant") {
                    for (let j = idx - 1; j >= 0; j--) {
                      const prev = messages[j];
                      if (prev.role !== "assistant") continue;
                      if (prev.products && prev.products.length > 0) {
                        prevProductIds = new Set(
                          prev.products.map((p) => p.product_id).filter((id): id is string => !!id),
                        );
                      }
                      break;
                    }
                  }
                  return (
                    <MessageBubble
                      key={key}
                      message={m}
                      dedupeProductIds={prevProductIds}
                      onFeedback={handleFeedback}
                      onCopy={handleCopy}
                      copiedId={copiedId}
                      onRegenerate={
                        m.role === "assistant" && m.id === lastAssistantId
                          ? handleRegenerate
                          : undefined
                      }
                      onRegenerateVariant={
                        m.role === "assistant" && m.id === lastAssistantId
                          ? handleRegenerateVariant
                          : undefined
                      }
                      onBranch={m.role === "assistant" ? () => handleBranchConversation(m) : undefined}
                      onSpeak={voice.ttsSupported ? handleSpeakMessage : undefined}
                      speakingId={speakingId}
                      onShare={handleShareMessage}
                      onTransform={m.role === "assistant" ? handleTransform : undefined}
                      onSaveFollowUp={
                        m.role === "assistant" && CAN_SAVE_FOLLOW_UPS.has(role ?? "")
                          ? handleSaveFollowUp
                          : undefined
                      }
                      followUpSaveState={followUpSaveState[key]}
                      onSaveArtifact={m.role === "assistant" ? handleSaveArtifact : undefined}
                      artifactSaveState={artifactSaveState[key]}
                      isEditing={editingMessageKey === key}
                      editingValue={editingValue}
                      onEditingValueChange={setEditingValue}
                      onStartEdit={handleStartEdit}
                      onSaveEdit={handleSaveEdit}
                      onCancelEdit={handleCancelEdit}
                    />
                  );
                })}

                {/* Follow-up suggestions — only after the last assistant message, when not
                    sending, and only when generateFollowUps actually has something
                    question-specific to suggest (it returns [] for a clarification
                    reply, where nothing more specific applies until the user answers). */}
                {(() => {
                  if (!lastAssistant || sending || streamingText) return null;
                  // Feature: Clarification Intelligence — when the last
                  // reply IS a clarifying question, selectable options take
                  // priority over generic follow-ups (there's nothing more
                  // specific to suggest until the user answers).
                  if (lastAssistant.answer_source === "clarification") {
                    const options = lastAssistant.clarification_options ?? [];
                    if (options.length === 0) return null;
                    return <FollowUpChips suggestions={options} onSelect={handleSend} disabled={sending} />;
                  }
                  // Prefer the backend's context-aware suggestions
                  // (orchestrator/followups.py — sees answer_source AND
                  // category) over the local heuristic; fall back to the
                  // heuristic only when the backend didn't return any
                  // (older cached messages, or a route it doesn't cover yet).
                  const suggestions =
                    lastAssistant.follow_ups && lastAssistant.follow_ups.length > 0
                      ? lastAssistant.follow_ups
                      : generateFollowUps(
                          lastAssistant.content, lastAssistant.sources, lastAssistant.answer_source,
                        );
                  if (suggestions.length === 0) return null;
                  return <FollowUpChips suggestions={suggestions} onSelect={handleSend} disabled={sending} />;
                })()}
              </>
            )}

            {/* Mode-aware processing card — shown while sending, before tokens arrive.
                Driven by real backend SSE status events (receivedStatuses), never a
                fixed timer — see ModeProcessingCard/aiModes.ts. */}
            <ModeProcessingCard active={sending && !streamingText} mode={aiMode} receivedStatuses={receivedStatuses} />

            {streamingText ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex group"
              >
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
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
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
                className="relative w-full resize-none bg-transparent px-4 pt-3 pb-2 text-base placeholder:text-muted-foreground/80 placeholder:font-normal focus:outline-none disabled:opacity-60"
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
                      accept="image/*,.pdf,.txt,.csv,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.md,.json"
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
                        <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Plugins
                        </p>
                        <button
                          type="button"
                          onClick={() => setAllowWebSearch((v) => !v)}
                          className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-accent/60"
                          role="menuitemcheckbox"
                          aria-checked={allowWebSearch}
                        >
                          <Globe className={`w-4 h-4 mt-0.5 shrink-0 ${allowWebSearch ? "text-primary" : "text-muted-foreground"}`} aria-hidden="true" />
                          <div className="flex-1">
                            <p className="text-sm font-medium">Web search</p>
                            <p className="text-[11px] text-muted-foreground">
                              {webSearchCapability && !webSearchCapability.available
                                ? webSearchCapability.message ?? "Temporarily unavailable"
                                : "Let Dayjoy AI look things up on the web for this chat"}
                            </p>
                          </div>
                          {/* Purely visual — the enclosing button is the single
                              source of truth for the toggle, so this doesn't
                              own its own click/onCheckedChange handler (that
                              double-fired against the button's onClick and
                              flipped the value straight back). */}
                          <Switch
                            checked={allowWebSearch}
                            tabIndex={-1}
                            aria-hidden="true"
                            className="mt-0.5 shrink-0 pointer-events-none"
                          />
                        </button>
                        <div className="my-1 h-px bg-border" aria-hidden="true" />
                        <button
                          type="button"
                          onClick={() => {
                            setAttachMenuOpen(false);
                            setModePanelOpen(true);
                          }}
                          className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-accent/60"
                          role="menuitem"
                        >
                          {(() => {
                            const ModeIcon = AI_MODES[aiMode].icon;
                            return <ModeIcon className={`w-4 h-4 mt-0.5 shrink-0 ${AI_MODE_ACCENT_CLASSES[AI_MODES[aiMode].accent].text}`} aria-hidden="true" />;
                          })()}
                          <div className="flex-1">
                            <p className="text-sm font-medium">Mode: {AI_MODES[aiMode].label}</p>
                            <p className="text-[11px] text-muted-foreground">Choose how Dayjoy AI answers</p>
                          </div>
                        </button>
                        <div className="my-1 h-px bg-border" aria-hidden="true" />
                        <button
                          type="button"
                          onClick={() => {
                            if (visionCapability && !visionCapability.available) return;
                            setAttachMenuOpen(false);
                            setCameraOpen(true);
                          }}
                          disabled={!!visionCapability && !visionCapability.available}
                          title={visionCapability && !visionCapability.available ? visionCapability.message ?? undefined : undefined}
                          className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-accent/60 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                          role="menuitem"
                        >
                          <Camera className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden="true" />
                          <div>
                            <p className="text-sm font-medium">Take photo</p>
                            <p className="text-[11px] text-muted-foreground">
                              {visionCapability && !visionCapability.available
                                ? "Temporarily unavailable"
                                : "Capture a product label or document"}
                            </p>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (visionCapability && !visionCapability.available) return;
                            setAttachMenuOpen(false);
                            photoInputRef.current?.click();
                          }}
                          disabled={!!visionCapability && !visionCapability.available}
                          title={visionCapability && !visionCapability.available ? visionCapability.message ?? undefined : undefined}
                          className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-accent/60 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                          role="menuitem"
                        >
                          <ImageIcon className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden="true" />
                          <div>
                            <p className="text-sm font-medium">Photo library</p>
                            <p className="text-[11px] text-muted-foreground">
                              {visionCapability && !visionCapability.available
                                ? "Temporarily unavailable"
                                : "Attach an image already on your device"}
                            </p>
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
                  {aiMode !== "normal" ? (
                    <button
                      type="button"
                      onClick={() => setModePanelOpen(true)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium shrink-0 ${AI_MODE_ACCENT_CLASSES[AI_MODES[aiMode].accent].bg} ${AI_MODE_ACCENT_CLASSES[AI_MODES[aiMode].accent].text}`}
                      aria-haspopup="dialog"
                      title="Change AI mode"
                    >
                      {(() => {
                        const ModeIcon = AI_MODES[aiMode].icon;
                        return <ModeIcon className="w-3 h-3" aria-hidden="true" />;
                      })()}
                      {AI_MODES[aiMode].label}
                      <ChevronUp className="w-2.5 h-2.5 rotate-180" aria-hidden="true" />
                    </button>
                  ) : null}
                  {/* Knowledge Scope Selector (Capability 16) */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium shrink-0 transition-colors ${
                          knowledgeScope === "all"
                            ? "text-muted-foreground hover:bg-accent/50"
                            : "text-primary bg-primary/10"
                        }`}
                        title="Choose what DayJoy AI can search"
                        aria-haspopup="menu"
                      >
                        <Filter className="w-3 h-3" aria-hidden="true" />
                        {KNOWLEDGE_SCOPE_OPTIONS.find((o) => o.value === knowledgeScope)?.label ?? "All DayJoy knowledge"}
                        <ChevronUp className="w-2.5 h-2.5 rotate-180" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      {KNOWLEDGE_SCOPE_OPTIONS.map((opt) => (
                        <DropdownMenuItem key={opt.value} onClick={() => setKnowledgeScope(opt.value)}>
                          {opt.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {/* Context Scope Control (Capability 15) — web research on/off.
                      Toggled from the "+" plugins menu now (ChatGPT/Gemini-style
                      opt-in); this pill only appears once the user has actually
                      turned it on, instead of permanently occupying composer
                      space in either state. Shows a degraded indicator when the
                      live capability check (webSearchCapability) knows the
                      provider is currently failing (e.g. quota exceeded) — the
                      toggle stays functional either way since the backend
                      already falls back to the model's own knowledge on
                      failure; this is a status signal, not a hard block. */}
                  {allowWebSearch ? (
                    <button
                      type="button"
                      onClick={() => setAllowWebSearch(false)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium shrink-0 transition-colors ${
                        webSearchCapability && !webSearchCapability.available
                          ? "text-warning bg-gold-accent/15 hover:bg-gold-accent/25"
                          : "text-primary bg-primary/10 hover:bg-primary/15"
                      }`}
                      title={
                        webSearchCapability && !webSearchCapability.available
                          ? webSearchCapability.message ?? "Web research is temporarily unavailable"
                          : "Web search is on for this chat — click to turn off"
                      }
                      aria-pressed="true"
                    >
                      <Globe className="w-3 h-3" aria-hidden="true" />
                      {webSearchCapability && !webSearchCapability.available ? "Web search (degraded)" : "Web search"}
                    </button>
                  ) : null}
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
                  {/* Mic (dictation) always sits beside the primary button —
                      tap it to speak and the transcript lands in the
                      composer, no typing needed. Deliberately NOT wired to
                      voiceMode/toggleVoiceMode (the tap-the-orb hands-free
                      loop, see its declaration above) — this mic is a
                      one-shot dictate-into-input control, matching
                      ChatGPT's composer mic. Hidden entirely when voice is
                      turned off in Settings (isVoiceRepliesEnabled). Speak/
                      mute toggles are omitted since normal text chat no
                      longer auto-speaks answers. */}
                  {isVoiceRepliesEnabled() ? (
                    <VoiceControls
                      voice={voice}
                      onTranscript={setInput}
                      showSpeakToggle={false}
                    />
                  ) : null}
                  {/* Primary circular button is dual-purpose, ChatGPT-style:
                      empty composer -> jump into the full hands-free Voice
                      Assistant page (autoStart tells it to open the mic on
                      arrival, since this click IS the user gesture); once
                      there's text to send, it becomes the Send button. */}
                  {isVoiceRepliesEnabled() && voice.sttSupported && !input.trim() ? (
                    <motion.button
                      type="button"
                      onClick={() =>
                        navigate("/voice", { state: { autoStart: true, conversationId: activeConv?.id ?? chatId ?? null } })
                      }
                      whileTap={{ scale: 0.95 }}
                      whileHover={{ scale: 1.05 }}
                      className="group/send relative inline-flex items-center justify-center w-9 h-9 rounded-full bg-primary text-primary-foreground hover:opacity-90 transition-all shadow-sm hover:shadow-md shrink-0"
                      aria-label="Start voice assistant"
                      title="Voice assistant"
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 rounded-full opacity-0 group-hover/send:opacity-100 transition-opacity pointer-events-none"
                        style={{
                          background:
                            "linear-gradient(135deg, rgba(255,255,255,0.18) 0%, transparent 60%)",
                        }}
                      />
                      <AudioLines className="w-4 h-4 relative" aria-hidden="true" />
                    </motion.button>
                  ) : (
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
                  )}
                </div>
              </div>
              {/* Attachments preview row — scroll-snap so it settles on a
                  whole thumbnail instead of stopping mid-crop, plus a bit
                  more breathing room than the previous raw overflow strip. */}
              {attachments.length > 0 ? (
                <div
                  className="flex gap-2.5 px-3 pb-2.5 overflow-x-auto scrollbar-thin"
                  style={{ scrollSnapType: "x proximity" }}
                >
                  {attachments.map((att, idx) => (
                    <div
                      key={`${att.name}-${idx}`}
                      className="relative w-16 h-16 rounded-xl overflow-hidden border border-border shrink-0 group shadow-sm"
                      style={{ scrollSnapAlign: "start" }}
                    >
                      {att.kind === "image" ? (
                        <img src={att.dataUrl} alt={att.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-0.5 bg-accent/40 px-1" title={att.name}>
                          <FileText className="w-4 h-4 text-primary" aria-hidden="true" />
                          <span className="text-[8px] text-muted-foreground truncate w-full text-center leading-tight">
                            {att.name}
                          </span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(idx)}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 max-lg:opacity-100 transition-opacity"
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

      {/* Smart Text Selection (Capability 34) — floating toolbar over a
          text selection inside an assistant answer. */}
      {selectionToolbar ? (
        <div
          className="fixed z-50 flex items-center gap-0.5 rounded-xl border border-border bg-card shadow-xl px-1 py-1"
          style={{ left: selectionToolbar.x, top: Math.max(8, selectionToolbar.y - 44), transform: "translateX(-50%)" }}
        >
          <button
            type="button"
            onClick={() => handleSelectionTransform("detail")}
            className="px-2 py-1 rounded-lg text-xs font-medium hover:bg-accent/60"
          >
            Explain
          </button>
          <button
            type="button"
            onClick={() => handleSelectionTransform("simplify")}
            className="px-2 py-1 rounded-lg text-xs font-medium hover:bg-accent/60"
          >
            Simplify
          </button>
          <button
            type="button"
            onClick={() => handleSelectionTransform("rewrite")}
            className="px-2 py-1 rounded-lg text-xs font-medium hover:bg-accent/60"
          >
            Rewrite
          </button>
          <button
            type="button"
            onClick={() => handleSelectionTransform("expand")}
            className="px-2 py-1 rounded-lg text-xs font-medium hover:bg-accent/60"
          >
            Expand
          </button>
          <button
            type="button"
            onClick={() => handleSelectionTransform("translate")}
            className="px-2 py-1 rounded-lg text-xs font-medium hover:bg-accent/60"
          >
            Translate
          </button>
          {/* Answer Editing, selection-scoped (Capability 12) — the ONLY
              button here that edits the message IN PLACE instead of
              sending a new chat turn. Only offered when the message has
              a real, persisted id to update. */}
          {selectionToolbar.messageId ? (
            <button
              type="button"
              onClick={handleEditInPlace}
              disabled={editingInPlace}
              className="px-2 py-1 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
              title="Rewrite just this selection, in place"
            >
              {editingInPlace ? "Editing…" : "Edit"}
            </button>
          ) : null}
        </div>
      ) : null}

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
                              {/* Source Preview System (Capability 6) — document name/
                                  page/section/date, when the retrieval layer supplied them
                                  (knowledge_chunks sources from document ingestion). These
                                  fields already existed on ChatSource but were never
                                  rendered anywhere in the UI. */}
                              {isObj && s.document_name ? (
                                <div>
                                  <span className="text-muted-foreground">Document:</span>{" "}
                                  <span className="font-medium">
                                    {s.document_name}
                                    {s.document_version ? ` (v${s.document_version})` : ""}
                                  </span>
                                </div>
                              ) : null}
                              {isObj && (s.section || s.page_number != null) ? (
                                <div>
                                  <span className="text-muted-foreground">Section:</span>{" "}
                                  <span className="font-medium">
                                    {s.section ?? "—"}
                                    {s.page_number != null ? ` · Page ${s.page_number}` : ""}
                                  </span>
                                </div>
                              ) : null}
                              {isObj && s.document_updated_at ? (
                                <div>
                                  <span className="text-muted-foreground">Last updated:</span>{" "}
                                  <span className="font-medium">
                                    {new Date(s.document_updated_at).toLocaleDateString()}
                                  </span>
                                </div>
                              ) : null}
                              {isObj && s.score != null ? (
                                <div>
                                  <span className="text-muted-foreground">Relevance:</span>{" "}
                                  <span className="font-medium">{Math.round(s.score * 100)}%</span>
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
                      ) : lastAssistant.answer_source === "live_data" ? (
                        <><Globe className="w-3.5 h-3.5" aria-hidden="true" /> Live data</>
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
                        {att.kind === "image" ? (
                          <img
                            src={att.dataUrl}
                            alt={att.name}
                            className="w-full h-24 object-cover"
                          />
                        ) : (
                          <div className="w-full h-24 flex flex-col items-center justify-center gap-1 px-2">
                            <FileText className="w-6 h-6 text-primary" aria-hidden="true" />
                            <span className="text-[10px] text-muted-foreground truncate w-full text-center">{att.name}</span>
                          </div>
                        )}
                        {/* Overlay actions on hover */}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
                          {att.kind === "image" ? (
                            <button
                              type="button"
                              onClick={() => setPreviewAttachment(att)}
                              className="p-1.5 rounded-lg bg-white/90 text-foreground hover:bg-white transition-colors"
                              aria-label={`Preview ${att.name}`}
                              title="Preview"
                            >
                              <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          ) : null}
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

      {/* AI Mode System — mode picker (Normal / Thinking / Deep Research / Compare
          Products), reached from the "+" composer menu's "Mode:" row above. */}
      <Modal
        open={modePanelOpen}
        onClose={() => {
          setModePanelOpen(false);
          setModeSearch("");
        }}
        title="Choose a mode"
        description="Each mode is optimized for different tasks"
        size="sm"
      >
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
            <input
              type="text"
              value={modeSearch}
              onChange={(e) => setModeSearch(e.target.value)}
              placeholder="Search modes..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              // Autofocus opens the on-screen keyboard on mobile, shrinking
              // the visible area before the user has even seen the mode
              // list — desktop keeps it since there's no keyboard to fight.
              autoFocus={!isMobile}
            />
          </div>
          <div className="space-y-1" role="listbox" aria-label="AI modes">
            {AI_MODE_ORDER.filter((id) => {
              const q = modeSearch.trim().toLowerCase();
              if (!q) return true;
              const cfg = AI_MODES[id];
              return cfg.label.toLowerCase().includes(q) || cfg.description.toLowerCase().includes(q);
            }).map((id) => {
              const cfg = AI_MODES[id];
              const accent = AI_MODE_ACCENT_CLASSES[cfg.accent];
              const selected = aiMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setAiMode(id);
                    setModePanelOpen(false);
                    setModeSearch("");
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors hover:bg-accent/60 ${
                    selected ? `${accent.bg} ring-1 ${accent.ring}` : ""
                  }`}
                >
                  <span className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${accent.bg} ${accent.text}`}>
                    <cfg.icon className="w-4 h-4" aria-hidden="true" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-foreground">{cfg.label}</span>
                    <span className="block text-xs text-muted-foreground">{cfg.description}</span>
                  </span>
                  {selected ? <Check className={`w-4 h-4 shrink-0 ${accent.text}`} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </Modal>

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

/**
 * "Chat actions" menu — the "•••" trigger's dropdown content. A compact,
 * anchored popover (Radix DropdownMenu, same primitive as AccountMenu) that
 * sizes to its content instead of a near-full-height centered Modal — the
 * previous version covered most of the viewport for a 9-item list, which
 * read as a full-screen takeover rather than the small ChatGPT/Claude-style
 * context menu it should be. Only lists actions actually backed by existing
 * functionality (share, rename, export, sources, attachments in this chat,
 * pin, archive, delete, find in chat) — no placeholder buttons.
 */
function MoreMenuContent({
  activeConv,
  lastSources,
  attachments,
  onSearchChats,
  onShare,
  onRename,
  onExport,
  onViewSources,
  onFindInChat,
  onPin,
  onArchive,
  onDelete,
}: {
  activeConv: Conversation | null;
  lastSources: unknown[];
  attachments: unknown[];
  onSearchChats: () => void;
  onShare: () => void;
  onRename: () => void;
  onExport: () => void;
  onViewSources: () => void;
  onFindInChat: () => void;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenuContent align="end" className="w-64">
      <DropdownMenuItem onClick={onSearchChats}>
        <Search className="w-4 h-4 shrink-0" aria-hidden="true" />
        Search chats
      </DropdownMenuItem>
      {activeConv ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onShare}>
            <Share2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            Share
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onRename}>
            <RefreshCw className="w-4 h-4 shrink-0" aria-hidden="true" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExport}>
            <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
            Export as PDF
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onViewSources}>
            <PanelRightOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
            View verified sources{lastSources.length > 0 ? ` (${lastSources.length})` : ""}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onViewSources}>
            <Paperclip className="w-4 h-4 shrink-0" aria-hidden="true" />
            Attachments in this chat{attachments.length > 0 ? ` (${attachments.length})` : ""}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onFindInChat}>
            <Search className="w-4 h-4 shrink-0" aria-hidden="true" />
            Find in chat
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onPin}>
            {activeConv.pinned ? (
              <PinOff className="w-4 h-4 shrink-0" aria-hidden="true" />
            ) : (
              <Pin className="w-4 h-4 shrink-0" aria-hidden="true" />
            )}
            {activeConv.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onArchive}>
            <Archive className="w-4 h-4 shrink-0" aria-hidden="true" />
            Archive
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
            <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </>
      ) : (
        <p className="text-sm text-muted-foreground px-2 py-1.5">
          Start a conversation to see sharing, export, and organization options here.
        </p>
      )}
    </DropdownMenuContent>
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
  onRegenerateVariant,
  onBranch,
  onSpeak,
  speakingId,
  onShare,
  onTransform,
  onSaveFollowUp,
  followUpSaveState,
  onSaveArtifact,
  artifactSaveState,
  isEditing = false,
  editingValue = "",
  onEditingValueChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  dedupeProductIds,
}: {
  message: ChatMessage;
  onFeedback: (id: string | undefined, rating: "up" | "down") => void;
  onCopy: (text: string, id: string) => void;
  copiedId: string | null;
  onRegenerate?: () => void;
  onRegenerateVariant?: (variant: RegenerateVariant) => void;
  onBranch?: () => void;
  onSpeak?: (text: string, id: string) => void;
  speakingId?: string | null;
  onShare?: (text: string, id: string) => void;
  onTransform?: (kind: TransformKind, text: string) => void;
  onSaveFollowUp?: (message: ChatMessage) => void;
  followUpSaveState?: "saving" | "saved" | "error";
  onSaveArtifact?: (message: ChatMessage) => void;
  artifactSaveState?: "saving" | "saved" | "error";
  isEditing?: boolean;
  editingValue?: string;
  onEditingValueChange?: (value: string) => void;
  onStartEdit?: (message: ChatMessage) => void;
  onSaveEdit?: (message: ChatMessage) => void;
  onCancelEdit?: () => void;
  /** product_ids already shown with an image in the immediately preceding
   * assistant message — see the de-dup comment at the messages.map call
   * site. */
  dedupeProductIds?: Set<string>;
}) {
  const isUser = message.role === "user";
  const bubbleId = message.id ?? `temp-${message.created_at}`;
  const isBlocked = message.safety_status === "blocked";

  if (isUser) {
    if (isEditing) {
      return (
        <motion.div
          id={`msg-${bubbleId}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex gap-3 justify-end"
        >
          <div className="flex flex-col items-end max-w-[80%] w-full">
            <textarea
              autoFocus
              value={editingValue}
              onChange={(e) => onEditingValueChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSaveEdit?.(message);
                } else if (e.key === "Escape") {
                  onCancelEdit?.();
                }
              }}
              rows={Math.min(6, Math.max(2, editingValue.split("\n").length))}
              className="w-full rounded-2xl rounded-tr-md bg-primary text-primary-foreground px-4 py-2.5 shadow-sm text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-primary-foreground/60"
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                onClick={onCancelEdit}
                className="px-3 py-1.5 rounded-full text-xs font-medium text-muted-foreground hover:bg-accent/60 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onSaveEdit?.(message)}
                disabled={!editingValue.trim()}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                Send
              </button>
            </div>
          </div>
        </motion.div>
      );
    }
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
          <div className="flex items-center gap-2 mt-1 pr-1">
            {/* Edit + Copy — hidden until hover, matching ChatGPT's own
                pattern for a sent message. Edit truncates everything after
                this message and resends the edited text (see
                handleSaveEdit); Copy just copies the raw text. */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 max-lg:opacity-100 transition-opacity">
              {onStartEdit ? (
                <button
                  type="button"
                  onClick={() => onStartEdit(message)}
                  className="p-1 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Edit message"
                  title="Edit"
                >
                  <Pencil className="w-3 h-3" aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onCopy(message.content, bubbleId)}
                className="p-1 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={copiedId === bubbleId ? "Copied" : "Copy message"}
                title={copiedId === bubbleId ? "Copied!" : "Copy"}
              >
                {copiedId === bubbleId ? (
                  <Check className="w-3 h-3 text-primary" aria-hidden="true" />
                ) : (
                  <Copy className="w-3 h-3" aria-hidden="true" />
                )}
              </button>
            </div>
            {message.created_at ? (
              <div className="text-[10px] text-muted-foreground opacity-70 group-hover:opacity-100 transition-opacity">
                {formatTimestamp(message.created_at)}
              </div>
            ) : null}
          </div>
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
      className="flex group"
    >
      <div className="flex-1 min-w-0">
        <div className="text-xs mb-1 flex items-center gap-2">
          {(() => {
            const badge = messageTrustBadge(message);
            if (!badge) return null;
            const toneClass =
              badge.tone === "primary"
                ? "text-primary bg-primary/8"
                : badge.tone === "warning"
                  ? "text-warning bg-gold-accent/15"
                  : "text-muted-foreground bg-accent";
            const Icon = badge.icon;
            return (
              <span
                className={`inline-flex items-center justify-center w-4 h-4 rounded-full ${toneClass}`}
                title={badge.label}
                aria-label={badge.label}
              >
                <Icon className="w-2.5 h-2.5" aria-hidden="true" />
              </span>
            );
          })()}
          {message.evidence_strength ? (
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                message.evidence_strength === "Strongly supported" || message.evidence_strength === "Supported"
                  ? "text-primary bg-primary/8"
                  : message.evidence_strength === "Not verified"
                    ? "text-muted-foreground bg-accent"
                    : "text-warning bg-gold-accent/15"
              }`}
              title="Evidence Strength — how well this answer is backed by verified DayJoy sources"
            >
              {message.evidence_strength}
            </span>
          ) : null}
          {message.claim_verification?.checked && message.claim_verification.claims.some((c) => c.state === "unverified") ? (
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-warning bg-gold-accent/15"
              title={`Some specific claims in this answer weren't found in the evidence: ${message.claim_verification.claims
                .filter((c) => c.state === "unverified")
                .map((c) => c.claim)
                .join("; ")}`}
            >
              {message.claim_verification.claims.filter((c) => c.state === "unverified").length} claim
              {message.claim_verification.claims.filter((c) => c.state === "unverified").length === 1 ? "" : "s"} unverified
            </span>
          ) : null}
          {(() => {
            const conflict = messageKnowledgeConflict(message);
            if (!conflict) return null;
            return (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full text-warning bg-gold-accent/15"
                title={`Multiple ${conflict.category} documents matched — using the more recently updated one ("${conflict.authoritative_document}")`}
              >
                <HistoryIcon className="w-2.5 h-2.5" aria-hidden="true" />
                Updated info used
              </span>
            );
          })()}
          {message.ai_mode && message.ai_mode !== "normal" && AI_MODES[message.ai_mode as AiMode] ? (
            (() => {
              const modeConfig = AI_MODES[message.ai_mode as AiMode];
              const modeAccent = AI_MODE_ACCENT_CLASSES[modeConfig.accent];
              const ModeIcon = modeConfig.icon;
              return (
                <span
                  className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${modeAccent.text} ${modeAccent.bg}`}
                >
                  <ModeIcon className="w-2.5 h-2.5" aria-hidden="true" />
                  {modeConfig.label}
                </span>
              );
            })()
          ) : null}
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
          data-message-id={message.id ?? ""}
          className={`ai-prose prose prose-sm max-w-none rounded-2xl rounded-tl-md border px-4 py-3 transition-colors ${
            isBlocked
              ? "border-destructive/30 bg-destructive/5"
              : "border-border bg-card group-hover:border-primary/20"
          }`}
        >
          {message.products && message.products.length > 0 ? (
            <div className="not-prose mb-2 flex flex-col gap-2">
              {message.products.map((p, i) => (
                <ProductCard
                  key={p.product_id ?? i}
                  product={p}
                  hideImage={!!p.product_id && !!dedupeProductIds?.has(p.product_id)}
                />
              ))}
            </div>
          ) : null}
          <AnswerContent content={message.content} onTransform={onTransform} />
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
            <>
              <ActionButton onClick={onRegenerate} label="Regenerate">
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              </ActionButton>
              {onRegenerateVariant ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="group/action relative inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-accent/60 text-muted-foreground transition-colors"
                      aria-label="Regeneration options"
                      title="Regenerate with a variant"
                    >
                      <ChevronUp className="w-3 h-3 rotate-180" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    {(Object.keys(REGENERATE_VARIANT_LABELS) as RegenerateVariant[]).map((variant) => (
                      <DropdownMenuItem key={variant} onClick={() => onRegenerateVariant(variant)}>
                        {REGENERATE_VARIANT_LABELS[variant]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </>
          ) : null}
          {onBranch ? (
            <ActionButton onClick={onBranch} label="Branch from here — continue in a new conversation">
              <GitBranch className="w-3.5 h-3.5" aria-hidden="true" />
            </ActionButton>
          ) : null}
          {onSpeak ? (
            <ActionButton
              onClick={() => onSpeak(message.content, bubbleId)}
              label={speakingId === bubbleId ? "Stop" : "Read aloud"}
              active={speakingId === bubbleId}
              activeColor="primary"
            >
              {speakingId === bubbleId ? (
                <VolumeX className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </ActionButton>
          ) : null}
          {onShare ? (
            <ActionButton onClick={() => onShare(message.content, bubbleId)} label="Share">
              <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
            </ActionButton>
          ) : null}
          {onTransform ? (
            <>
              <ActionButton
                onClick={() => onTransform("simplify", message.content)}
                label="Explain simpler"
              >
                <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
              </ActionButton>
              <ActionButton
                onClick={() => onTransform("actionable", message.content)}
                label="Make it actionable"
              >
                <ScrollText className="w-3.5 h-3.5" aria-hidden="true" />
              </ActionButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="group/action relative inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-accent/60 text-muted-foreground transition-colors"
                    aria-label="More ways to transform this answer"
                    title="More"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <DropdownMenuItem onClick={() => onTransform("shorter", message.content)}>
                    <Minimize2 className="w-3.5 h-3.5 mr-2" aria-hidden="true" /> Shorter
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onTransform("detail", message.content)}>
                    <Maximize className="w-3.5 h-3.5 mr-2" aria-hidden="true" /> More detail
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onTransform("checklist", message.content)}>
                    <ListChecks className="w-3.5 h-3.5 mr-2" aria-hidden="true" /> Create checklist
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onTransform("compare", message.content)}>
                    <GitCompare className="w-3.5 h-3.5 mr-2" aria-hidden="true" /> Compare
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onTransform("example", message.content)}>
                    <Lightbulb className="w-3.5 h-3.5 mr-2" aria-hidden="true" /> Give example
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onTransform("translate", message.content)}>
                    <Globe className="w-3.5 h-3.5 mr-2" aria-hidden="true" /> Translate to Hindi
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onTransform("hinglish", message.content)}>
                    <Languages className="w-3.5 h-3.5 mr-2" aria-hidden="true" /> Hinglish
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
          {onSaveFollowUp && looksActionable(message.content, message.ai_mode) ? (
            <ActionButton
              onClick={() => onSaveFollowUp(message)}
              label={
                followUpSaveState === "saved"
                  ? "Saved to Follow-Ups"
                  : followUpSaveState === "error"
                    ? "Couldn't save — try again"
                    : "Save as follow-up task"
              }
              active={followUpSaveState === "saved"}
              activeColor="primary"
            >
              {followUpSaveState === "saved" ? (
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <ListChecks className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </ActionButton>
          ) : null}
          {onSaveArtifact && looksActionable(message.content, message.ai_mode) ? (
            <ActionButton
              onClick={() => onSaveArtifact(message)}
              label={
                artifactSaveState === "saved"
                  ? "Saved as artifact"
                  : artifactSaveState === "error"
                    ? "Couldn't save — try again"
                    : "Save as artifact"
              }
              active={artifactSaveState === "saved"}
              activeColor="primary"
            >
              {artifactSaveState === "saved" ? (
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <BookmarkPlus className="w-3.5 h-3.5" aria-hidden="true" />
              )}
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
