import { useCallback, useEffect, useState } from "react";
import { Headphones, RefreshCw, User, MessageSquare, Send, AlertTriangle, Loader2 } from "lucide-react";
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
} from "../common/AdminUI";
import { Modal } from "../common/Modal";
import { adminUpdateTicket, adminAddTicketNote, adminListTicketNotes } from "../../../lib/api";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";

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

export function SupportTickets() {
  const { currentUser } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [editing, setEditing] = useState<Ticket | null>(null);
  const [editStatus, setEditStatus] = useState("open");
  const [editPriority, setEditPriority] = useState("normal");
  const [editAssign, setEditAssign] = useState(false);
  // Ticket comments state
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [commentInternal, setCommentInternal] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  // Internal notes (Phase 2)
  const [notes, setNotes] = useState<TicketNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [postingNote, setPostingNote] = useState(false);
  const [escalating, setEscalating] = useState(false);

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
      const { data, error: err } = await q;
      if (err) throw err;
      setTickets((data ?? []) as Ticket[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openEdit = async (t: Ticket) => {
    setEditing(t);
    setEditStatus(t.status ?? "open");
    setEditPriority(t.priority ?? "normal");
    setEditAssign(false);
    setNewComment("");
    setCommentInternal(false);
    setNotes([]);
    setNewNote("");
    // Load comments for this ticket
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
    // Load internal notes via backend admin API
    loadNotes(t.id);
  };

  const handlePostComment = async () => {
    if (!editing || !supabase || !currentUser?.id || !newComment.trim()) return;
    setPostingComment(true);
    try {
      const { data, error: err } = await supabase
        .from("ticket_comments")
        .insert({
          ticket_id: editing.id,
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
    if (!editing) return;
    try {
      // Try backend admin API first
      try {
        const patch: Record<string, unknown> = {
          status: editStatus,
          priority: editPriority,
        };
        if (editAssign && currentUser?.id) {
          patch.assigned_to = currentUser.id;
        }
        await adminUpdateTicket(editing.id, patch);
      } catch {
        // Fallback to direct Supabase
        if (!supabase) return;
        const patch: Partial<Ticket> = { status: editStatus, priority: editPriority };
        if (editAssign && currentUser?.id) patch.assigned_to = currentUser.id;
        await supabase.from("support_tickets").update(patch).eq("id", editing.id);
      }
      setTickets((prev) =>
        prev.map((t) => (t.id === editing.id ? {
          ...t, status: editStatus, priority: editPriority,
          assigned_to: editAssign && currentUser?.id ? currentUser.id : t.assigned_to,
        } : t)),
      );
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update ticket");
    }
  };

  const handleEscalate = async () => {
    if (!editing) return;
    setEscalating(true);
    try {
      await adminUpdateTicket(editing.id, { escalated: true });
      setTickets((prev) => prev.map((t) => t.id === editing.id ? { ...t, escalated: true, escalated_at: new Date().toISOString() } : t));
      setEditing((prev) => prev ? { ...prev, escalated: true, escalated_at: new Date().toISOString() } : prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to escalate");
    } finally {
      setEscalating(false);
    }
  };

  const handlePostNote = async () => {
    if (!editing || !newNote.trim()) return;
    setPostingNote(true);
    try {
      const res = await adminAddTicketNote(editing.id, newNote.trim(), true);
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

  const loadNotes = async (ticketId: string) => {
    try {
      const n = await adminListTicketNotes(ticketId);
      setNotes(n as unknown as TicketNote[]);
    } catch {
      setNotes([]);
    }
  };

  const counts = tickets.reduce<Record<string, number>>((acc, t) => {
    acc[t.status ?? "unknown"] = (acc[t.status ?? "unknown"] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Support Tickets"
        description="Triage, assign, and resolve customer support requests."
        icon={<Headphones className="w-5 h-5" />}
        actions={
          <Button type="button" variant="secondary" onClick={refresh}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {STATUSES.map((s) => (
          <StatCard key={s} label={s} value={counts[s] ?? 0} />
        ))}
      </div>

      <div className="flex items-end gap-2 mb-4">
        <div>
          <label htmlFor="dj-ticket-status" className="block text-xs font-medium text-muted-foreground mb-1">
            Status
          </label>
          <select
            id="dj-ticket-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s}
              </option>
            ))}
          </select>
        </div>
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
        <div className="space-y-3">
          {tickets.map((t) => (
            <Card key={t.id}>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusPill status={t.priority ?? "normal"} />
                    <StatusPill status={t.status ?? "open"} />
                    {t.issue_category ? (
                      <span className="text-xs text-muted-foreground">{t.issue_category}</span>
                    ) : null}
                  </div>
                  <p className="text-sm font-medium line-clamp-2">{t.query || "—"}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <User className="w-3 h-3" aria-hidden="true" />
                    <span className="font-mono">{t.user_id ? t.user_id.slice(0, 8) + "…" : "anonymous"}</span>
                    <span>·</span>
                    <span>{t.created_at ? new Date(t.created_at).toLocaleString() : ""}</span>
                  </div>
                </div>
                <Button type="button" variant="secondary" onClick={() => openEdit(t)}>
                  Update
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Update support ticket"
        description={editing?.query?.slice(0, 80)}
        size="md"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveEdit}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="dj-ticket-edit-status" className="block text-xs font-medium text-muted-foreground mb-1">
              Status
            </label>
            <select
              id="dj-ticket-edit-status"
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s} className="capitalize">
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dj-ticket-edit-priority" className="block text-xs font-medium text-muted-foreground mb-1">
              Priority
            </label>
            <select
              id="dj-ticket-edit-priority"
              value={editPriority}
              onChange={(e) => setEditPriority(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p} className="capitalize">
                  {p}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editAssign}
              onChange={(e) => setEditAssign(e.target.checked)}
              className="rounded"
            />
            Assign to me
          </label>

          {/* Ticket comments / thread */}
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Comments ({comments.length})
              </h4>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-2 mb-3 scrollbar-thin">
              {comments.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">
                  No comments yet. Add the first one below.
                </p>
              ) : (
                comments.map((c) => (
                  <div
                    key={c.id}
                    className={`rounded-lg p-2 text-xs ${
                      c.internal
                        ? "bg-warning/10 border border-warning/20"
                        : "bg-accent/30"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {c.author_id ? c.author_id.slice(0, 8) + "…" : "system"}
                      </span>
                      <div className="flex items-center gap-1">
                        {c.internal ? (
                          <Badge variant="warning">INTERNAL</Badge>
                        ) : null}
                        <span className="text-[10px] text-muted-foreground">
                          {c.created_at ? new Date(c.created_at).toLocaleString() : ""}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm">{c.body}</p>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment…"
                rows={2}
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                aria-label="New comment"
              />
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={commentInternal}
                    onChange={(e) => setCommentInternal(e.target.checked)}
                    className="rounded"
                  />
                  Internal
                </label>
                <button
                  type="button"
                  onClick={handlePostComment}
                  disabled={!newComment.trim() || postingComment}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50"
                  aria-label="Post comment"
                >
                  <Send className="w-3 h-3" aria-hidden="true" />
                  Post
                </button>
              </div>
            </div>
          </div>

          {/* Internal notes (Phase 2) */}
          <div className="border-t border-border pt-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Internal Notes
            </h4>
            <div className="space-y-1.5 mb-2 max-h-32 overflow-y-auto">
              {notes.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No internal notes yet.</p>
              ) : (
                notes.map((n) => (
                  <div key={n.id} className="rounded-lg bg-warning/5 border border-warning/20 px-2 py-1.5 text-xs">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {n.author_id ? n.author_id.slice(0, 8) + "…" : "system"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {n.created_at ? new Date(n.created_at).toLocaleString() : ""}
                      </span>
                    </div>
                    <p>{n.note}</p>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Add internal note (staff only)…"
                className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-card text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label="New internal note"
              />
              <button
                type="button"
                onClick={handlePostNote}
                disabled={!newNote.trim() || postingNote}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-warning text-warning-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50"
                aria-label="Add note"
              >
                {postingNote ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                Add
              </button>
            </div>
          </div>

          {/* Escalation button */}
          {editing && !editing.escalated ? (
            <button
              type="button"
              onClick={handleEscalate}
              disabled={escalating}
              className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-warning/30 bg-warning/10 text-warning text-sm font-medium hover:bg-warning/20 disabled:opacity-50"
            >
              {escalating ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
              Escalate ticket
            </button>
          ) : editing?.escalated ? (
            <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              This ticket has been escalated{editing.escalated_at ? ` on ${new Date(editing.escalated_at).toLocaleString()}` : ""}.
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
