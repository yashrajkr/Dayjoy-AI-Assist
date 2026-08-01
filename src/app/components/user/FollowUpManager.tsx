import { useCallback, useEffect, useState } from "react";
import {
  Phone, Clock, Plus, Edit, Trash2, Check, X,
  Loader2, Save, MessageSquare, Mail, MapPin, Bell,
} from "lucide-react";
import { Modal, modalButtonClass } from "../common/Modal";
import { LoadingState, ErrorState, EmptyState, btnClass } from "../common/AdminUI";
import {
  distributorListFollowUps, distributorCreateFollowUp, distributorUpdateFollowUp,
  distributorDeleteFollowUp, type FollowUp,
} from "../../../lib/api";

const TASK_TYPES = [
  { value: "call", label: "📞 Call", icon: Phone },
  { value: "meeting", label: "👥 Meeting", icon: MapPin },
  { value: "whatsapp", label: "💬 WhatsApp", icon: MessageSquare },
  { value: "email", label: "✉️ Email", icon: Mail },
  { value: "visit", label: "🏠 Visit", icon: MapPin },
  { value: "reminder", label: "⏰ Reminder", icon: Bell },
];

const STATUSES = ["pending", "in_progress", "completed", "cancelled", "snoozed"];
const PRIORITIES = ["low", "normal", "high", "urgent"];

type Form = { customer_name: string; task_type: string; title: string; description: string; due_date: string; priority: string };
const EMPTY: Form = { customer_name: "", task_type: "call", title: "", description: "", due_date: "", priority: "normal" };

export function FollowUpManager() {
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await distributorListFollowUps({ status: statusFilter || undefined, limit: 100 });
      setFollowUps(data.follow_ups);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditingId(null); setForm({ ...EMPTY, due_date: new Date(Date.now() + 86400000).toISOString().slice(0, 16) }); setModalOpen(true); };
  const openEdit = (f: FollowUp) => {
    setEditingId(f.id ?? null);
    setForm({
      customer_name: f.customer_name ?? "", task_type: f.task_type ?? "call",
      title: f.title, description: f.description ?? "",
      due_date: f.due_date ? f.due_date.slice(0, 16) : "",
      priority: f.priority ?? "normal",
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { setError("Title required."); return; }
    setSaving(true);
    try {
      const payload: Partial<FollowUp> = {
        ...form,
        due_date: new Date(form.due_date).toISOString(),
      };
      if (editingId) await distributorUpdateFollowUp(editingId, payload);
      else await distributorCreateFollowUp(payload);
      setModalOpen(false);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  };

  const handleStatus = async (f: FollowUp, status: string) => {
    if (!f.id) return;
    try {
      await distributorUpdateFollowUp(f.id, { status, completed_at: status === "completed" ? new Date().toISOString() : null });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  };

  const handleDelete = async (f: FollowUp) => {
    if (!f.id || !window.confirm("Delete this follow-up?")) return;
    try { await distributorDeleteFollowUp(f.id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  };

  const now = new Date();
  const overdue = followUps.filter((f) => f.status === "pending" && new Date(f.due_date) < now);
  const dueToday = followUps.filter((f) => f.status === "pending" && new Date(f.due_date).toDateString() === now.toDateString());

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Clock className="w-5 h-5" /> Follow-ups</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track calls, meetings, and reminders.</p>
        </div>
        <button type="button" className={btnClass.primary} onClick={openCreate}><Plus className="w-4 h-4" /> Add Task</button>
      </div>

      {error ? <ErrorState message={error} /> : null}

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className={`rounded-xl border p-3 text-center ${overdue.length > 0 ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"}`}>
          <p className="text-xl font-semibold text-destructive">{overdue.length}</p>
          <p className="text-[10px] text-muted-foreground">Overdue</p>
        </div>
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-center">
          <p className="text-xl font-semibold text-warning">{dueToday.length}</p>
          <p className="text-[10px] text-muted-foreground">Due Today</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 text-center">
          <p className="text-xl font-semibold">{followUps.filter((f) => f.status === "pending").length}</p>
          <p className="text-[10px] text-muted-foreground">Pending</p>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-border bg-card text-sm">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </div>

      {loading ? <LoadingState /> : followUps.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card"><EmptyState title="No follow-ups" icon={<Clock className="w-5 h-5" />} /></div>
      ) : (
        <div className="space-y-2">
          {followUps.map((f) => {
            const due = new Date(f.due_date);
            const isOverdue = due < now && f.status === "pending";
            const taskType = TASK_TYPES.find((t) => t.value === f.task_type) ?? TASK_TYPES[0];
            const Icon = taskType.icon;
            return (
              <div key={f.id} className={`rounded-xl border bg-card p-3 flex items-center gap-3 ${isOverdue ? "border-destructive/30" : f.status === "completed" ? "opacity-60" : "border-border"}`}>
                <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{f.title}</p>
                    {f.priority === "urgent" ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive">URGENT</span> : null}
                    {f.ai_generated ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">AI</span> : null}
                  </div>
                  {f.customer_name ? <p className="text-xs text-muted-foreground truncate">{f.customer_name}</p> : null}
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                    <span className={isOverdue ? "text-destructive font-medium" : ""}>{due.toLocaleString()}</span>
                    <span className="capitalize">· {f.status?.replace("_", " ")}</span>
                  </div>
                </div>
                <div className="flex gap-0.5 shrink-0">
                  {f.status === "pending" ? (
                    <button type="button" onClick={() => handleStatus(f, "completed")} className="p-1.5 rounded hover:bg-primary/10 text-primary" title="Complete"><Check className="w-3.5 h-3.5" /></button>
                  ) : null}
                  <button type="button" onClick={() => openEdit(f)} className="p-1.5 rounded hover:bg-accent" title="Edit"><Edit className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => handleDelete(f)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? "Edit Task" : "Add Task"} size="md"
        footer={<>
          <button type="button" className={modalButtonClass.secondary} onClick={() => setModalOpen(false)}><X className="w-4 h-4" /> Cancel</button>
          <button type="button" className={modalButtonClass.primary} onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </button>
        </>}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Title *</label>
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Customer Name</label>
            <input type="text" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Type</label>
              <select value={form.task_type} onChange={(e) => setForm({ ...form, task_type: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm">
                {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Priority</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm">
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Due Date</label>
            <input type="datetime-local" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
