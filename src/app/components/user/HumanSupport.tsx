import { useCallback, useEffect, useRef, useState } from "react";
import {
  LifeBuoy,
  Send,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Sparkles,
  Loader2,
  Phone,
  Mail,
  History,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/AuthContext";
import { BRAND } from "../../lib/brand";
import { Button } from "../ui/button";
import { Textarea } from "../ui/input";
import { Card, StatusPill, EmptyState } from "../common/AdminUI";
import { AppHeader } from "../common/AppHeader";
import { customerKnowledgeSearch, type KnowledgeSearchResult } from "../../../lib/api";

const CATEGORIES = [
  "Product question",
  "Order / delivery",
  "Refund / return",
  "Distributor onboarding",
  "Account / login",
  "Other",
];

const PRIORITIES = ["low", "normal", "high", "urgent"];

type Ticket = {
  id: string;
  query: string | null;
  issue_category: string | null;
  priority: string | null;
  status: string | null;
  created_at: string | null;
  resolved_at?: string | null;
};

type TicketComment = {
  id: string;
  ticket_id: string;
  author_id: string | null;
  body: string;
  internal: boolean;
  created_at: string | null;
};

function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Expandable card for one of the current user's own tickets, with its reply thread. */
function TicketRow({ ticket, currentUserId }: { ticket: Ticket; currentUserId: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<TicketComment[] | null>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const loadComments = useCallback(async () => {
    if (!supabase) return;
    setLoadingComments(true);
    try {
      const { data } = await supabase
        .from("ticket_comments")
        .select("*")
        .eq("ticket_id", ticket.id)
        .eq("internal", false)
        .order("created_at", { ascending: true });
      setComments((data as TicketComment[]) ?? []);
    } finally {
      setLoadingComments(false);
    }
  }, [ticket.id]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && comments === null) void loadComments();
  };

  const sendReply = async () => {
    if (!supabase || !reply.trim() || sending) return;
    setSending(true);
    try {
      const { data, error } = await supabase
        .from("ticket_comments")
        .insert({ ticket_id: ticket.id, author_id: currentUserId ?? null, body: reply.trim(), internal: false })
        .select()
        .single();
      if (!error && data) {
        setComments((prev) => [...(prev ?? []), data as TicketComment]);
        setReply("");
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-start gap-3 p-3.5 text-left hover:bg-accent/30 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[11px] font-mono text-muted-foreground">#{shortId(ticket.id)}</span>
            <StatusPill status={ticket.status ?? "open"} />
            <StatusPill status={ticket.priority ?? "normal"} />
          </div>
          <p className="text-sm line-clamp-2">{ticket.query}</p>
          <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
            <Clock className="w-3 h-3" aria-hidden="true" />
            {ticket.issue_category} · {formatDate(ticket.created_at)}
          </p>
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
        )}
      </button>

      {open ? (
        <div className="border-t border-border p-3.5 space-y-3 bg-accent/10">
          {loadingComments ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading conversation…
            </div>
          ) : comments && comments.length > 0 ? (
            <div className="space-y-2">
              {comments.map((c) => {
                const isMine = c.author_id === currentUserId;
                return (
                  <div key={c.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2 text-xs ${
                        isMine ? "bg-primary text-primary-foreground" : "bg-card border border-border"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{c.body}</p>
                      <p className={`mt-1 text-[10px] ${isMine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {formatDate(c.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-1">No replies yet — the Dayjoy team will respond here.</p>
          )}

          {ticket.status !== "closed" ? (
            <div className="flex items-center gap-2">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendReply();
                  }
                }}
                placeholder="Add a reply…"
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-border bg-card text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <Button type="button" size="sm" onClick={sendReply} disabled={!reply.trim() || sending} className="rounded-lg shrink-0">
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function HumanSupport() {
  const { currentUser } = useAuth();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [priority, setPriority] = useState("normal");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successTicketId, setSuccessTicketId] = useState<string | null>(null);

  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState(true);

  const [suggestions, setSuggestions] = useState<KnowledgeSearchResult[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const firstName = currentUser?.user_metadata?.full_name
    ? String(currentUser.user_metadata.full_name).split(" ")[0]
    : null;

  const loadTickets = useCallback(async () => {
    if (!supabase || !currentUser?.id) {
      setTicketsLoading(false);
      return;
    }
    setTicketsLoading(true);
    try {
      const { data } = await supabase
        .from("support_tickets")
        .select("id, query, issue_category, priority, status, created_at, resolved_at")
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false })
        .limit(20);
      setTickets((data as Ticket[]) ?? []);
    } finally {
      setTicketsLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  // Suggest relevant FAQs/policies as the user describes their issue, so many
  // questions can be answered instantly instead of waiting on a ticket.
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (query.trim().length < 8) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setSuggestLoading(true);
      try {
        const res = await customerKnowledgeSearch({ query: query.trim() });
        setSuggestions(res.results.slice(0, 3));
      } catch {
        setSuggestions([]);
      } finally {
        setSuggestLoading(false);
      }
    }, 500);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !query.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      if (!supabase) {
        setError("Support tickets require Supabase. Contact Dayjoy support directly.");
        return;
      }
      const { data, error: err } = await supabase
        .from("support_tickets")
        .insert({
          user_id: currentUser?.id ?? null,
          query: query.trim(),
          issue_category: category,
          priority,
          status: "open",
        })
        .select()
        .single();
      if (err) throw err;
      setSuccessTicketId((data as Ticket).id);
      setTickets((prev) => (prev ? [data as Ticket, ...prev] : [data as Ticket]));
      setQuery("");
      setSuggestions([]);
      window.setTimeout(() => setSuccessTicketId(null), 8000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit ticket");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <AppHeader
        title="Support Centre"
        subtitle={
          firstName
            ? `Hi ${firstName} — can't find what you need from ${BRAND.name}? Raise a ticket and a Dayjoy team member will respond directly.`
            : `Can't find what you need from ${BRAND.name}? Raise a ticket and a Dayjoy team member will respond directly.`
        }
        icon={LifeBuoy}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          {/* Left: new ticket form */}
          <div>
            {successTicketId ? (
              <Card className="border-primary/30 surface-gradient p-5 mb-4 shadow-none">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-6 h-6 text-primary shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold">
                      Ticket #{shortId(successTicketId)} submitted
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      A Dayjoy team member will follow up shortly. Track progress and reply anytime in
                      "Your tickets" — it's already listed there.
                    </p>
                  </div>
                </div>
              </Card>
            ) : null}

            {error ? (
              <div
                role="alert"
                className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              >
                {error}
              </div>
            ) : null}

            <Card className="p-4 sm:p-5">
              <h2 className="text-sm font-semibold mb-3">Raise a new ticket</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="dj-support-query" className="block text-xs font-medium text-muted-foreground mb-1">
                    What do you need help with?
                  </label>
                  <Textarea
                    id="dj-support-query"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    rows={5}
                    maxLength={2000}
                    required
                    placeholder="Describe your question or issue in as much detail as you can…"
                    className="w-full rounded-xl bg-card resize-y focus-visible:ring-4 focus-visible:ring-primary/10"
                  />
                </div>

                {/* Personalized: suggest existing answers before a ticket is even raised */}
                {suggestLoading || suggestions.length > 0 ? (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                    <p className="text-[11px] font-semibold text-primary flex items-center gap-1.5 mb-2">
                      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                      {suggestLoading ? "Checking for an instant answer…" : "You might not need to wait — try these first"}
                    </p>
                    {!suggestLoading ? (
                      <ul className="space-y-1.5">
                        {suggestions.map((s, i) => (
                          <li key={`${s.entity_type}-${s.entity_id}-${i}`} className="text-xs">
                            <span className="font-medium">{s.title || "Untitled"}</span>
                            {s.snippet ? <span className="text-muted-foreground"> — {s.snippet.slice(0, 90)}…</span> : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="dj-support-category" className="block text-xs font-medium text-muted-foreground mb-1">
                      Category
                    </label>
                    <select
                      id="dj-support-category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="dj-support-priority" className="block text-xs font-medium text-muted-foreground mb-1">
                      Priority
                    </label>
                    <select
                      id="dj-support-priority"
                      value={priority}
                      onChange={(e) => setPriority(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p} className="capitalize">
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <Button type="submit" disabled={submitting || !query.trim()} className="rounded-xl">
                  <Send className="w-4 h-4" aria-hidden="true" />
                  {submitting ? "Submitting…" : "Raise support ticket"}
                </Button>
              </form>
            </Card>

            <Card className="mt-4 p-4">
              <p className="text-xs font-semibold mb-2">Prefer to talk to someone?</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                <a href="tel:+918000000000" className="inline-flex items-center gap-1.5 text-primary hover:underline">
                  <Phone className="w-3.5 h-3.5" aria-hidden="true" /> +91 80000 00000
                </a>
                <a href="mailto:support@dayjoy.com" className="inline-flex items-center gap-1.5 text-primary hover:underline">
                  <Mail className="w-3.5 h-3.5" aria-hidden="true" /> support@dayjoy.com
                </a>
              </div>
            </Card>
          </div>

          {/* Right: personalized ticket history */}
          <div>
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <History className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              Your tickets
            </h2>
            {ticketsLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading your tickets…
              </div>
            ) : !tickets || tickets.length === 0 ? (
              <div className="rounded-xl border border-border bg-card">
                <EmptyState
                  title="No tickets yet"
                  description="Tickets you raise will show up here so you can track their status and reply to the team."
                  icon={<MessageSquare className="w-5 h-5" />}
                />
              </div>
            ) : (
              <div className="space-y-2">
                {tickets.map((t) => (
                  <TicketRow key={t.id} ticket={t} currentUserId={currentUser?.id} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
