import { useCallback, useEffect, useMemo, useState } from "react";
import { FileQuestion, Plus, Search, Edit, Trash2, CheckCircle, Clock, Loader2, Save, X, Tag } from "lucide-react";
import {
  type FAQ,
  createFaq,
  deleteFaq,
  getFaqsForManager,
  updateFaq,
} from "../../lib/db";
import { Modal, modalButtonClass } from "../common/Modal";
import { btnClass, LoadingState, ErrorState, EmptyState } from "../common/AdminUI";
import { adminCreateFAQ, adminUpdateFAQ, adminDeleteFAQ } from "../../../lib/api";

type ApprovalStatus = "approved" | "pending" | "rejected";

type FAQFormData = {
  question: string;
  answer: string;
  category: string;
  approval_status: ApprovalStatus;
};

const EMPTY_FORM: FAQFormData = {
  question: "",
  answer: "",
  category: "General",
  approval_status: "pending",
};

export function FAQManager() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FAQFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getFaqsForManager();
      setFaqs(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load FAQs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(() => {
    const set = new Set(faqs.map((f) => f.category).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [faqs]);

  const filteredFaqs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return faqs.filter((f) => {
      const matchesQ = !q || [f.question, f.answer, f.approval_status ?? ""].join(" ").toLowerCase().includes(q);
      const matchesCat = !categoryFilter || f.category === categoryFilter;
      return matchesQ && matchesCat;
    });
  }, [faqs, query, categoryFilter]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (faq: FAQ) => {
    if (!faq.id) return;
    setEditingId(faq.id);
    setForm({
      question: faq.question,
      answer: faq.answer,
      category: faq.category ?? "General",
      approval_status: (faq.approval_status as ApprovalStatus) ?? "pending",
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.question.trim() || !form.answer.trim()) {
      setError("Question and answer are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        question: form.question.trim(),
        answer: form.answer.trim(),
        category: form.category.trim() || null,
        approval_status: form.approval_status,
      };
      if (editingId) {
        try {
          await adminUpdateFAQ(editingId, payload);
        } catch {
          await updateFaq(editingId, payload);
        }
        setSuccess("FAQ updated.");
      } else {
        try {
          await adminCreateFAQ(payload);
        } catch {
          await createFaq(payload);
        }
        setSuccess("FAQ created.");
      }
      setModalOpen(false);
      setTimeout(() => setSuccess(null), 3000);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save FAQ");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (faq: FAQ) => {
    if (!faq.id) return;
    if (!window.confirm("Delete this FAQ?")) return;
    setError(null);
    try {
      try {
        await adminDeleteFAQ(faq.id);
      } catch {
        await deleteFaq(faq.id);
      }
      setSuccess("FAQ deleted.");
      setTimeout(() => setSuccess(null), 3000);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete FAQ");
    }
  };

  const handleQuickStatus = async (faq: FAQ, next: ApprovalStatus) => {
    if (!faq.id) return;
    setError(null);
    try {
      try {
        await adminUpdateFAQ(faq.id, { approval_status: next });
      } catch {
        await updateFaq(faq.id, { approval_status: next });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
            <FileQuestion className="w-5 h-5" /> FAQ Manager
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Create, edit, categorize, and approve frequently asked questions.
          </p>
        </div>
        <button className={btnClass.primary} type="button" onClick={openCreate}>
          <Plus className="w-4 h-4" /> Add FAQ
        </button>
      </div>

      {error ? <ErrorState message={error} /> : null}
      {success ? (
        <div className="bg-primary/5 border border-primary/30 rounded-xl p-3 text-sm text-primary">{success}</div>
      ) : null}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <p className="text-xl font-semibold">{faqs.length}</p>
          <p className="text-[10px] text-muted-foreground">Total FAQs</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <p className="text-xl font-semibold text-primary">{faqs.filter((f) => f.approval_status === "approved").length}</p>
          <p className="text-[10px] text-muted-foreground">Approved</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <p className="text-xl font-semibold text-warning">{faqs.filter((f) => f.approval_status === "pending").length}</p>
          <p className="text-[10px] text-muted-foreground">Pending</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <p className="text-xl font-semibold">{categories.length}</p>
          <p className="text-[10px] text-muted-foreground">Categories</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by question or answer…"
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 text-sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* FAQ list */}
      {loading ? <LoadingState label="Loading FAQs…" /> : filteredFaqs.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl">
          <EmptyState title="No FAQs found" description="Create your first FAQ." icon={<FileQuestion className="w-5 h-5" />} />
        </div>
      ) : (
        <div className="space-y-2">
          {filteredFaqs.map((faq) => {
            const status = faq.approval_status ?? "pending";
            const pillColor = status === "approved" ? "bg-green-100 text-green-700"
              : status === "pending" ? "bg-amber-100 text-amber-700"
              : "bg-slate-100 text-slate-700";
            return (
              <div key={faq.id} className="bg-card border border-border rounded-xl p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {faq.category ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-muted-foreground">
                          <Tag className="w-2.5 h-2.5" /> {faq.category}
                        </span>
                      ) : null}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${pillColor}`}>{status}</span>
                    </div>
                    <h3 className="font-medium text-sm">{faq.question}</h3>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{faq.answer}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {status === "pending" ? (
                      <button type="button" className="text-[10px] px-2 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10"
                        onClick={() => handleQuickStatus(faq, "approved")}>Approve</button>
                    ) : null}
                    {status === "approved" ? (
                      <button type="button" className="text-[10px] px-2 py-1 rounded border border-border hover:bg-accent"
                        onClick={() => handleQuickStatus(faq, "pending")}>Unapprove</button>
                    ) : null}
                    <button type="button" className="p-1.5 hover:bg-accent rounded-lg" onClick={() => openEdit(faq)} aria-label="Edit" title="Edit">
                      <Edit className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                    <button type="button" className="p-1.5 hover:bg-destructive/10 text-destructive rounded-lg" onClick={() => handleDelete(faq)} aria-label="Delete" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Edit FAQ" : "Add FAQ"}
        size="md"
        footer={
          <>
            <button type="button" className={modalButtonClass.secondary} onClick={() => setModalOpen(false)}>
              <X className="w-4 h-4" /> Cancel
            </button>
            <button type="button" className={modalButtonClass.primary} onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingId ? "Save" : "Create"}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Question *</label>
            <input type="text" value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })}
              placeholder="e.g. How do I become a Dayjoy distributor?"
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Answer *</label>
            <textarea value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} rows={4}
              placeholder="The answer the AI should give…"
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
              <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                list="faq-categories"
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              <datalist id="faq-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Approval Status</label>
              <select value={form.approval_status} onChange={(e) => setForm({ ...form, approval_status: e.target.value as ApprovalStatus })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm">
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
