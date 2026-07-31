import { useCallback, useEffect, useState } from "react";
import {
  Users, Plus, Search, Edit, Trash2, Phone, Mail, MapPin, Calendar,
  Heart, Tag, Loader2, Save, X, Sparkles, MessageCircle,
} from "lucide-react";
import { Modal, modalButtonClass } from "../common/Modal";
import { LoadingState, ErrorState, EmptyState, btnClass } from "../common/AdminUI";
import {
  distributorListCustomers, distributorCreateCustomer, distributorUpdateCustomer,
  distributorDeleteCustomer, type CustomerProfile,
} from "../../../lib/api";
import { streamChatWithBackend } from "../../../lib/api";
import { useAuth } from "../../lib/AuthContext";

const STATUSES = ["lead", "prospect", "active_customer", "inactive", "vip"];

type Form = {
  full_name: string;
  phone: string;
  email: string;
  age: string;
  gender: string;
  city: string;
  state: string;
  interests: string;
  health_goals: string;
  lifestyle: string;
  preferred_language: string;
  budget_range: string;
  notes: string;
  status: string;
  next_contact_at: string;
  birthday: string;
};

const EMPTY: Form = {
  full_name: "", phone: "", email: "", age: "", gender: "", city: "", state: "",
  interests: "", health_goals: "", lifestyle: "", preferred_language: "en",
  budget_range: "", notes: "", status: "lead", next_contact_at: "", birthday: "",
};

export function CustomerProfiles() {
  const { role } = useAuth();
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [recommendModal, setRecommendModal] = useState<CustomerProfile | null>(null);
  const [recommendation, setRecommendation] = useState("");
  const [recLoading, setRecLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await distributorListCustomers({
        search: search || undefined,
        status: statusFilter || undefined,
        limit: 100,
      });
      setCustomers(data.customers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load customers");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY);
    setModalOpen(true);
  };

  const openEdit = (c: CustomerProfile) => {
    setEditingId(c.id ?? null);
    setForm({
      full_name: c.full_name ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      age: c.age ? String(c.age) : "",
      gender: c.gender ?? "",
      city: c.city ?? "",
      state: c.state ?? "",
      interests: (c.interests ?? []).join(", "),
      health_goals: (c.health_goals ?? []).join(", "),
      lifestyle: c.lifestyle ?? "",
      preferred_language: c.preferred_language ?? "en",
      budget_range: c.budget_range ?? "",
      notes: c.notes ?? "",
      status: c.status ?? "lead",
      next_contact_at: c.next_contact_at ?? "",
      birthday: c.birthday ?? "",
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.full_name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Partial<CustomerProfile> = {
        full_name: form.full_name.trim(),
        phone: form.phone || null,
        email: form.email || null,
        age: form.age ? parseInt(form.age) : null,
        gender: form.gender || null,
        city: form.city || null,
        state: form.state || null,
        interests: form.interests.split(",").map((s) => s.trim()).filter(Boolean),
        health_goals: form.health_goals.split(",").map((s) => s.trim()).filter(Boolean),
        lifestyle: form.lifestyle || null,
        preferred_language: form.preferred_language,
        budget_range: form.budget_range || null,
        notes: form.notes || null,
        status: form.status,
        next_contact_at: form.next_contact_at || null,
        birthday: form.birthday || null,
      };
      if (editingId) {
        await distributorUpdateCustomer(editingId, payload);
      } else {
        await distributorCreateCustomer(payload);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: CustomerProfile) => {
    if (!c.id || !window.confirm(`Delete ${c.full_name}?`)) return;
    try {
      await distributorDeleteCustomer(c.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const getRecommendation = async (c: CustomerProfile) => {
    setRecommendModal(c);
    setRecommendation("");
    setRecLoading(true);
    let agg = "";
    try {
      const prompt = `Based on this customer profile, recommend suitable Dayjoy products:
Name: ${c.full_name}
Age: ${c.age ?? "unknown"}
Health Goals: ${(c.health_goals ?? []).join(", ") || "none specified"}
Interests: ${(c.interests ?? []).join(", ") || "none specified"}
Lifestyle: ${c.lifestyle ?? "unknown"}
Budget: ${c.budget_range ?? "unknown"}

Recommend 2-3 products with reasoning, usage suggestions, and precautions. Do not make medical claims.`;
      await streamChatWithBackend(
        { message: prompt, role: role ?? "distributor", language: "English" },
        (chunk) => { agg += chunk; setRecommendation(agg); },
      );
    } catch {
      setRecommendation("Unable to generate recommendations right now.");
    } finally {
      setRecLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
            <Users className="w-5 h-5" /> Customers
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage customer profiles and get AI product recommendations.</p>
        </div>
        <button type="button" className={btnClass.primary} onClick={openCreate}>
          <Plus className="w-4 h-4" /> Add Customer
        </button>
      </div>

      {error ? <ErrorState message={error} /> : null}

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-border bg-card text-sm">
          <option value="">All</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </div>

      {loading ? <LoadingState label="Loading customers…" /> : customers.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card">
          <EmptyState title="No customers yet" description="Add your first customer to get started." icon={<Users className="w-5 h-5" />} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {customers.map((c) => (
            <div key={c.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium shrink-0">
                    {c.full_name?.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{c.full_name}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${c.status === "active_customer" ? "bg-primary/10 text-primary" : c.status === "vip" ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"}`}>
                      {c.status?.replace("_", " ")}
                    </span>
                  </div>
                </div>
                <div className="flex gap-0.5 shrink-0">
                  <button type="button" className="p-1.5 rounded hover:bg-accent" onClick={() => openEdit(c)} aria-label="Edit"><Edit className="w-3.5 h-3.5" /></button>
                  <button type="button" className="p-1.5 rounded hover:bg-destructive/10 text-destructive" onClick={() => handleDelete(c)} aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                {c.phone ? <div className="flex items-center gap-1"><Phone className="w-3 h-3" /> {c.phone}</div> : null}
                {c.email ? <div className="flex items-center gap-1"><Mail className="w-3 h-3" /> {c.email}</div> : null}
                {c.city ? <div className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {c.city}{c.state ? `, ${c.state}` : ""}</div> : null}
                {c.health_goals && c.health_goals.length > 0 ? <div className="flex items-center gap-1"><Heart className="w-3 h-3" /> {c.health_goals.join(", ")}</div> : null}
                {c.next_contact_at ? <div className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Next: {new Date(c.next_contact_at).toLocaleDateString()}</div> : null}
              </div>
              <button type="button" onClick={() => getRecommendation(c)}
                className="mt-2 w-full text-xs px-2 py-1.5 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 flex items-center justify-center gap-1">
                <Sparkles className="w-3 h-3" /> Get AI Recommendations
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? "Edit Customer" : "Add Customer"} size="lg"
        footer={<>
          <button type="button" className={modalButtonClass.secondary} onClick={() => setModalOpen(false)}><X className="w-4 h-4" /> Cancel</button>
          <button type="button" className={modalButtonClass.primary} onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </button>
        </>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Full Name *</label>
            <input type="text" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Phone</label>
            <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Age</label>
            <input type="number" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Gender</label>
            <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm">
              <option value="">—</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">City</label>
            <input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Health Goals (comma-separated)</label>
            <input type="text" value={form.health_goals} onChange={(e) => setForm({ ...form, health_goals: e.target.value })}
              placeholder="weight loss, energy, immunity"
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Interests (comma-separated)</label>
            <input type="text" value={form.interests} onChange={(e) => setForm({ ...form, interests: e.target.value })}
              placeholder="fitness, wellness, organic"
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Budget Range</label>
            <input type="text" value={form.budget_range} onChange={(e) => setForm({ ...form, budget_range: e.target.value })}
              placeholder="₹500-2000"
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm">
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Birthday</label>
            <input type="date" value={form.birthday} onChange={(e) => setForm({ ...form, birthday: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Next Contact</label>
            <input type="datetime-local" value={form.next_contact_at ? form.next_contact_at.slice(0, 16) : ""} onChange={(e) => setForm({ ...form, next_contact_at: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
        </div>
      </Modal>

      {/* Recommendation modal */}
      <Modal open={!!recommendModal} onClose={() => setRecommendModal(null)}
        title={`AI Recommendations for ${recommendModal?.full_name ?? ""}`} size="lg"
        footer={<button type="button" className={modalButtonClass.secondary} onClick={() => setRecommendModal(null)}>Close</button>}>
        {recLoading && !recommendation ? <LoadingState label="Generating recommendations…" /> : (
          <div className="prose prose-sm max-w-none">
            <pre className="whitespace-pre-wrap text-sm font-sans bg-accent/30 p-3 rounded-lg">{recommendation || "No recommendations generated."}</pre>
          </div>
        )}
      </Modal>
    </div>
  );
}
