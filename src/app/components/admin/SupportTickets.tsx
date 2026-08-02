import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Headphones,
  RefreshCw,
  User,
  MessageSquare,
  Send,
  AlertTriangle,
  Loader2,
  Search,
  Clock,
  CheckCircle2,
  BookOpen,
  Package,
  History,
  ArrowUpRight,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/AuthContext";
import {
  PageHeader,
  Card,
  StatusPill,
  EmptyState,
  LoadingState,
  ErrorState,
  StatCard,
  btnClass,
} from "../common/AdminUI";
import { adminUpdateTicket, adminAddTicketNote, adminListTicketNotes, customerKnowledgeSearch, type KnowledgeSearchResult } from "../../../lib/api";
import { getProducts, type Product } from "../../lib/db";

type Ticket = {
  id: string;
  user_id: string | null;
  query: string | null;
  issue_category: string | null;
  priority: string | null;
  status: string | null;
  assigned_to: string | null;
  escalated?: boolean | null;
  escalated_at?: string | null;
  escalated_by?: string | null;
  resolution_notes?: string | null;
  first_response_at?: string | null;
  resolved_at?: string | null;
  created_at: string | null;
};

type TicketComment = {
  id: string;
  ticket_id: string;
  author_id: string | null;
  body: string;
  internal: boolean;
  created_at: string | null;
};

type TicketNote = {
  id: string;
  note: string;
  is_internal: boolean;
  author_id: string | null;
  created_at: string;
};

const PRIORITIES = ["low", "normal", "high", "urgent"];
const STATUSES = ["open", "in_progress", "resolved", "closed"];

function shortId(id: string | null, len = 8) {
  return id ? `${id.slice(0, len)}…` : "anonymous";
}

function timeAgo(iso: string | null) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function SupportTickets() {
  const { currentUser } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [queueSearch, setQueueSearch] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState("open");
  const [editPriority, setEditPriority] = useState("normal");
  const [editAssign, setEditAssign] = useState(false);
  const [saving, setSaving] = useState(false);

  // Ticket comments (conversation thread)
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [commentInternal, setCommentInternal] = useState(false);
  const [postingComment, setPostingComment] = useState(false);

  // Internal notes
  const [notes, setNotes] = useState<TicketNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [postingNote, setPostingNote] = useState(false);
  const [escalating, setEscalating] = useState(false);

  // Related knowledge (real search against the knowledge base + product catalog)
  const [relatedFaqs, setRelatedFaqs] = useState<KnowledgeSearchResult[]>([]);
  const [relatedPolicies, setRelatedPolicies] = useState<KnowledgeSearchResult[]>([]);
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }
    try {
      let q = supabase.from("support_tickets").select("*").order("created_at", { ascending: false }).limit(100);
      if (statusFilter) q = q.eq("status", statusFilter);
      if (priorityFilter) q = q.eq("priority", priorityFilter);
      if (categoryFilter) q = q.eq("issue_category", categoryFilter);
      const { data, error: err } = await q;
      if (err) throw err;
      setTickets((data ?? []) as Ticket[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter, categoryFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const categories = useMemo(
    () => Array.from(new Set(tickets.map((t) => t.issue_category).filter((c): c is string => !!c))).sort(),
    [tickets],
  );

  const filteredTickets = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter((t) =>
      [t.query ?? "", t.issue_category ?? "", t.id].join(" ").toLowerCase().includes(q),
    );
  }, [tickets, queueSearch]);

  const selected = useMemo(() => tickets.find((t) => t.id === selectedId) ?? null, [tickets, selectedId]);

  const relatedTickets = useMemo(() => {
    if (!selected?.user_id) return [];
    return tickets.filter((t) => t.id !== selected.id && t.user_id === selected.user_id).slice(0, 5);
  }, [tickets, selected]);

  const loadNotes = async (ticketId: string) => {
    try {
      const n = await adminListTicketNotes(ticketId);
      setNotes(n as unknown as TicketNote[]);
    } catch {
      setNotes([]);
    }
  };

  const selectTicket = useCallback(async (t: Ticket) => {
    setSelectedId(t.id);
    setEditStatus(t.status ?? "open");
    setEditPriority(t.priority ?? "normal");
    setEditAssign(false);
    setNewComment("");
    setCommentInternal(false);
    setNotes([]);
    setNewNote("");
    setRelatedFaqs([]);
    setRelatedPolicies([]);
    setRelatedProducts([]);

    if (supabase) {
      try {
        const { data } = await supabase
          .from("ticket_comments")
          .select("*")
          .eq("ticket_id", t.id)
          .order("created_at", { ascending: true });
        setComments((data ?? []) as TicketComment[]);
      } catch {
        setComments([]);
      }
    }
    loadNotes(t.id);

    // Load related FAQs/policies/products from the real knowledge base + catalog.
    if (t.query && t.query.trim().length >= 2) {
      setRelatedLoading(true);
      try {
        const [kb, products] = await Promise.all([
          customerKnowledgeSearch({ query: t.query }),
          getProducts(),
        ]);
        setRelatedFaqs(kb.results.filter((r) => r.entity_type === "faq").slice(0, 3));
        setRelatedPolicies(kb.results.filter((r) => r.entity_type === "policy").slice(0, 3));
        const q = t.query.toLowerCase();
        const matchedProducts = products
          .filter((p) => {
            if (t.issue_category && p.category?.toLowerCase() === t.issue_category.toLowerCase()) return true;
            const haystack = [p.product_name, p.benefits ?? "", p.category].join(" ").toLowerCase();
            return q.split(/\s+/).some((word) => word.length > 3 && haystack.includes(word));
          })
          .slice(0, 3);
        setRelatedProducts(matchedProducts);
      } catch {
        // Non-critical — the context panel simply shows nothing if the lookup fails.
      } finally {
        setRelatedLoading(false);
      }
    }
  }, []);

  const handlePostComment = async () => {
    if (!selected || !supabase || !currentUser?.id || !newComment.trim()) return;
    setPostingComment(true);
    try {
      const { data, error: err } = await supabase
        .from("ticket_comments")
        .insert({
          ticket_id: selected.id,
          author_id: currentUser.id,
          body: newComment.trim(),
          internal: commentInternal,
        })
        .select("*")
        .single();
      if (err) throw err;
      if (data) {
        setComments((prev) => [...prev, data as TicketComment]);
        setNewComment("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post comment");
    } finally {
      setPostingComment(false);
    }
  };

  const saveEdit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      try {
        const patch: Record<string, unknown> = { status: editStatus, priority: editPriority };
        if (editAssign && currentUser?.id) patch.assigned_to = currentUser.id;
        await adminUpdateTicket(selected.id, patch);
      } catch {
        if (!supabase) return;
        const patch: Partial<Ticket> = { status: editStatus, priority: editPriority };
        if (editAssign && currentUser?.id) patch.assigned_to = currentUser.id;
        await supabase.from("support_tickets").update(patch).eq("id", selected.id);
      }
      setTickets((prev) =>
        prev.map((t) => (t.id === selected.id ? {
          ...t, status: editStatus, priority: editPriority,
          assigned_to: editAssign && currentUser?.id ? currentUser.id : t.assigned_to,
        } : t)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update ticket");
    } finally {
      setSaving(false);
    }
  };

  const handleEscalate = async () => {
    if (!selected) return;
    setEscalating(true);
    try {
      await adminUpdateTicket(selected.id, { escalated: true });
      setTickets((prev) => prev.map((t) => t.id === selected.id ? { ...t, escalated: true, escalated_at: new Date().toISOString() } : t));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to escalate");
    } finally {
      setEscalating(false);
    }
  };

  const handlePostNote = async () => {
    if (!selected || !newNote.trim()) return;
    setPostingNote(true);
    try {
      const res = await adminAddTicketNote(selected.id, newNote.trim(), true);
      if (res.note) {
        setNotes((prev) => [...prev, res.note as unknown as TicketNote]);
        setNewNote("");
      }
    } catch {
      // ignore
    } finally {
      setPostingNote(false);
    }
  };

  const counts = tickets.reduce<Record<string, number>>((acc, t) => {
    acc[t.status ?? "unknown"] = (acc[t.status ?? "unknown"] ?? 0) + 1;
    return acc;
  }, {});
  const escalatedCount = tickets.filter((t) => t.escalated).length;
  const respondedTickets = tickets.filter((t) => t.first_response_at && t.created_at);
  const avgResponseMins = respondedTickets.length
    ? Math.round(
        respondedTickets.reduce((sum, t) => {
          const diff = new Date(t.first_response_at as string).getTime() - new Date(t.created_at as string).getTime();
          return sum + diff / 60000;
        }, 0) / respondedTickets.length,
      )
    : null;

  // Simple, transparent next-step suggestions derived from real ticket state
  // (not an AI/ML output — just business rules on the fields we actually have).
  const nextSteps = useMemo(() => {
    if (!selected) return [];
    const steps: string[] = [];
    if (!selected.first_response_at) steps.push("Send a first response — SLA clock is running.");
    if ((selected.priority === "high" || selected.priority === "urgent") && !selected.escalated) {
      steps.push("High priority and not yet escalated — consider escalating.");
    }
    if (selected.status === "resolved" && !selected.resolved_at) {
      steps.push("Marked resolved but missing a resolved timestamp — save to confirm.");
    }
    if (steps.length === 0) steps.push("No outstanding actions detected for this ticket.");
    return steps;
  }, [selected]);

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Support Tickets"
        description="Triage, assign, and resolve customer support requests."
        icon={<Headphones className="w-5 h-5" />}
        actions={
          <button type="button" className={btnClass.secondary} onClick={refresh}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Refresh
          </button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {STATUSES.map((s) => (
          <StatCard key={s} label={s} value={counts[s] ?? 0} />
        ))}
        <StatCard label="escalated" value={escalatedCount} icon={<AlertTriangle className="w-4 h-4" />} />
        <StatCard
          label="avg first response"
          value={avgResponseMins !== null ? `${avgResponseMins}m` : "—"}
          icon={<Clock className="w-4 h-4" />}
        />
      </div>

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {loading ? (
        <LoadingState label="Loading tickets…" />
      ) : tickets.length === 0 ? (
        <Card>
          <EmptyState
            title="No support tickets"
            description="When customers raise tickets via the Human Support page, they will appear here."
            icon={<Headphones className="w-5 h-5" />}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] gap-4 items-start">
          {/* Queue panel */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Search queue…"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label="Search ticket queue"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-border bg-card text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label="Filter by status"
              >
                <option value="">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-border bg-card text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label="Filter by priority"
              >
                <option value="">All priorities</option>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {categories.length > 0 ? (
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-border bg-card text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                  aria-label="Filter by category"
                >
                  <option value="">All categories</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : null}
            </div>

            <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1 scrollbar-thin">
              {filteredTickets.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No tickets match these filters.</p>
              ) : (
                filteredTickets.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => selectTicket(t)}
                    className={`w-full text-left rounded-xl border p-3 transition-colors ${
                      selectedId === t.id
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:bg-accent/40"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <StatusPill status={t.priority ?? "normal"} />
                      <StatusPill status={t.status ?? "open"} />
                      {t.escalated ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">
                          <AlertTriangle className="w-2.5 h-2.5" /> Escalated
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm font-medium line-clamp-2">{t.query || "—"}</p>
                    <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                      <User className="w-3 h-3" aria-hidden="true" />
                      <span className="font-mono">{shortId(t.user_id)}</span>
                      {t.issue_category ? <><span>·</span><span>{t.issue_category}</span></> : null}
                      <span>·</span>
                      <span>{timeAgo(t.created_at)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Conversation panel */}
          {!selected ? (
            <Card className="h-[70vh] flex items-center justify-center">
              <EmptyState
                title="Select a ticket"
                description="Choose a ticket from the queue on the left to view the conversation."
                icon={<MessageSquare className="w-5 h-5" />}
              />
            </Card>
          ) : (
            <div className="rounded-2xl border border-border bg-card flex flex-col h-[70vh] overflow-hidden">
              <div className="p-4 border-b border-border shrink-0">
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  <span className="font-mono text-xs text-muted-foreground">#{selected.id.slice(0, 8)}</span>
                  <StatusPill status={selected.priority ?? "normal"} />
                  <StatusPill status={selected.status ?? "open"} />
                  {selected.issue_category ? (
                    <span className="text-xs text-muted-foreground">{selected.issue_category}</span>
                  ) : null}
                </div>
                <p className="text-sm font-medium">{selected.query || "—"}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Opened {timeAgo(selected.created_at)} by <span className="font-mono">{shortId(selected.user_id)}</span>
                </p>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
                {/* Original ticket message, styled as the customer's opening message */}
                <div className="max-w-[85%] rounded-xl rounded-tl-sm bg-accent/40 border border-border p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold">Customer</span>
                    <span className="text-[10px] text-muted-foreground">{selected.created_at ? new Date(selected.created_at).toLocaleString() : ""}</span>
                  </div>
                  <p className="text-sm">{selected.query || "—"}</p>
                </div>

                {comments.map((c) => (
                  <div
                    key={c.id}
                    className={`max-w-[85%] rounded-xl p-3 border ${
                      c.internal
                        ? "ml-auto rounded-tr-sm bg-warning/10 border-warning/30"
                        : "ml-auto rounded-tr-sm bg-primary/10 border-primary/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold flex items-center gap-1">
                        {c.internal ? <><AlertTriangle className="w-3 h-3 text-warning" /> Internal note</> : "Team reply"}
                        <span className="font-mono text-[10px] text-muted-foreground font-normal">{shortId(c.author_id, 6)}</span>
                      </span>
                      <span className="text-[10px] text-muted-foreground">{c.created_at ? new Date(c.created_at).toLocaleString() : ""}</span>
                    </div>
                    <p className="text-sm">{c.body}</p>
                  </div>
                ))}
              </div>

              {/* Sticky composer */}
              <div className="border-t border-border p-3 shrink-0 space-y-2">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Write a reply…"
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                  aria-label="New reply"
                />
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={commentInternal}
                      onChange={(e) => setCommentInternal(e.target.checked)}
                      className="rounded"
                    />
                    Internal only
                  </label>
                  <button
                    type="button"
                    onClick={handlePostComment}
                    disabled={!newComment.trim() || postingComment}
                    className={btnClass.primary}
                  >
                    {postingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Send reply
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Context panel */}
          {!selected ? (
            <div className="hidden lg:block" />
          ) : (
            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1 scrollbar-thin">
              <Card className="!p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Ticket details</h3>
                <div className="space-y-2">
                  <div>
                    <label htmlFor="dj-ticket-status" className="block text-[11px] text-muted-foreground mb-1">Status</label>
                    <select
                      id="dj-ticket-status"
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="dj-ticket-priority" className="block text-[11px] text-muted-foreground mb-1">Priority</label>
                    <select
                      id="dj-ticket-priority"
                      value={editPriority}
                      onChange={(e) => setEditPriority(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={editAssign} onChange={(e) => setEditAssign(e.target.checked)} className="rounded" />
                    Assign to me
                  </label>
                  <button type="button" onClick={saveEdit} disabled={saving} className={`${btnClass.primary} w-full justify-center`}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Save changes
                  </button>
                </div>
              </Card>

              <Card className="!p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                  <ArrowUpRight className="w-3.5 h-3.5" /> Next steps
                </h3>
                <ul className="space-y-1.5">
                  {nextSteps.map((s, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <span className="mt-1 w-1 h-1 rounded-full bg-primary shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
                {!selected.escalated ? (
                  <button
                    type="button"
                    onClick={handleEscalate}
                    disabled={escalating}
                    className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-warning/30 bg-warning/10 text-warning text-xs font-medium hover:bg-warning/20 disabled:opacity-50"
                  >
                    {escalating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                    Escalate to human lead
                  </button>
                ) : (
                  <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Escalated{selected.escalated_at ? ` ${new Date(selected.escalated_at).toLocaleString()}` : ""}
                  </div>
                )}
              </Card>

              {relatedTickets.length > 0 ? (
                <Card className="!p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" /> Previous tickets — same customer
                  </h3>
                  <ul className="space-y-1.5">
                    {relatedTickets.map((rt) => (
                      <li key={rt.id}>
                        <button
                          type="button"
                          onClick={() => selectTicket(rt)}
                          className="w-full text-left text-xs px-2 py-1.5 rounded-lg hover:bg-accent/50 transition-colors"
                        >
                          <p className="line-clamp-1">{rt.query || "—"}</p>
                          <p className="text-[10px] text-muted-foreground">{rt.status} · {timeAgo(rt.created_at)}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              <Card className="!p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5" /> Related FAQs &amp; policies
                </h3>
                {relatedLoading ? (
                  <p className="text-xs text-muted-foreground">Searching knowledge base…</p>
                ) : relatedFaqs.length === 0 && relatedPolicies.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No close matches found in the knowledge base.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {[...relatedFaqs, ...relatedPolicies].map((r, i) => (
                      <li key={`${r.entity_type}-${r.entity_id}-${i}`} className="text-xs">
                        <p className="font-medium line-clamp-1">{r.title || "Untitled"}</p>
                        {r.snippet ? <p className="text-muted-foreground line-clamp-2">{r.snippet}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card className="!p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" /> Related products
                </h3>
                {relatedLoading ? (
                  <p className="text-xs text-muted-foreground">Searching catalog…</p>
                ) : relatedProducts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No matching products found.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {relatedProducts.map((p) => (
                      <li key={p.id ?? p.product_name} className="text-xs">
                        <p className="font-medium">{p.product_name}</p>
                        <p className="text-muted-foreground">{p.category}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card className="!p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Internal notes
                </h3>
                <div className="space-y-1.5 mb-2 max-h-32 overflow-y-auto scrollbar-thin">
                  {notes.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No internal notes yet.</p>
                  ) : (
                    notes.map((n) => (
                      <div key={n.id} className="rounded-lg bg-warning/5 border border-warning/20 px-2 py-1.5 text-xs">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-mono text-[10px] text-muted-foreground">{shortId(n.author_id, 6)}</span>
                          <span className="text-[10px] text-muted-foreground">{n.created_at ? new Date(n.created_at).toLocaleString() : ""}</span>
                        </div>
                        <p>{n.note}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Add internal note…"
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                    aria-label="New internal note"
                  />
                  <button
                    type="button"
                    onClick={handlePostNote}
                    disabled={!newNote.trim() || postingNote}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-warning text-warning-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50 shrink-0"
                    aria-label="Add note"
                  >
                    {postingNote ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    Add
                  </button>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
