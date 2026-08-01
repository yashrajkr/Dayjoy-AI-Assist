import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Package, Plus, Search, Edit, Trash2, CheckCircle, Clock, Upload,
  Archive, RotateCcw, Loader2, X, Save,
} from "lucide-react";
import {
  type Product,
  createProduct,
  deleteProduct,
  getAllProductsForAdmin,
  setProductApprovalStatus,
  updateProduct,
} from "../../lib/db";
import { Modal, modalButtonClass } from "../common/Modal";
import { Input, Textarea } from "../ui/input";
import { btnClass } from "../common/AdminUI";
import { adminCreateProduct, adminUpdateProduct, adminDeleteProduct } from "../../../lib/api";

function StatsCard({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center">
          <Package className="w-6 h-6 text-primary" />
        </div>
      </div>
      <h3 className="text-2xl font-semibold mb-1">{value}</h3>
      <p className="text-sm text-foreground mb-1">{label}</p>
      <p className="text-xs text-muted-foreground">{sublabel}</p>
    </div>
  );
}

type ProductFormData = {
  product_name: string;
  sku: string;
  brand: string;
  category: string;
  sub_category: string;
  benefits: string;
  ingredients: string;
  usage: string;
  warnings: string;
  safety_note: string;
  approval_status: "pending" | "approved" | "rejected";
  is_archived: boolean;
};

const EMPTY_FORM: ProductFormData = {
  product_name: "",
  sku: "",
  brand: "",
  category: "Health Care",
  sub_category: "",
  benefits: "",
  ingredients: "",
  usage: "",
  warnings: "",
  safety_note: "",
  approval_status: "pending",
  is_archived: false,
};

export function ProductDatabase() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All Categories");
  const [status, setStatus] = useState<string>("All Status");
  const [showArchived, setShowArchived] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getAllProductsForAdmin();
      setProducts(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category).filter(Boolean) as string[]);
    return ["All Categories", ...Array.from(set)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      const pStatus = (p.approval_status ?? "pending").toLowerCase();
      const matchesCat = category === "All Categories" ? true : p.category === category;
      const matchesStatus = status === "All Status" ? true : pStatus === status.toLowerCase();
      const matchesArchived = showArchived ? true : !p.is_archived;
      if (!matchesCat || !matchesStatus || !matchesArchived) return false;
      if (!q) return true;
      const haystack = [p.product_name, p.brand ?? "", p.category, p.sub_category ?? "", p.sku ?? "", p.problem_tags?.join(" ") ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [products, query, category, status, showArchived]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditingId(p.id ?? null);
    setForm({
      product_name: p.product_name ?? "",
      sku: (p.sku as string) ?? "",
      brand: p.brand ?? "",
      category: p.category ?? "",
      sub_category: p.sub_category ?? "",
      benefits: p.benefits ?? "",
      ingredients: p.ingredients ?? "",
      usage: p.usage ?? "",
      warnings: (p.warnings as string) ?? "",
      safety_note: p.safety_note ?? "",
      approval_status: (p.approval_status as "pending" | "approved" | "rejected") ?? "pending",
      is_archived: Boolean(p.is_archived),
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.product_name.trim()) {
      setError("Product name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        product_name: form.product_name.trim(),
        sku: form.sku.trim() || null,
        brand: form.brand.trim() || null,
        category: form.category.trim(),
        sub_category: form.sub_category.trim() || null,
        benefits: form.benefits.trim() || null,
        ingredients: form.ingredients.trim() || null,
        usage: form.usage.trim() || null,
        warnings: form.warnings.trim() || null,
        safety_note: form.safety_note.trim() || null,
        approval_status: form.approval_status,
        is_archived: form.is_archived,
      };

      if (editingId) {
        // Try backend admin API first, fall back to direct Supabase
        try {
          await adminUpdateProduct(editingId, payload);
        } catch {
          await updateProduct(editingId, payload);
        }
        setSuccess("Product updated.");
      } else {
        try {
          await adminCreateProduct({
            ...payload,
            problem_tags: null,
            who_can_use: null,
            source: null,
          });
        } catch {
          await createProduct({
            ...payload,
            problem_tags: null,
            who_can_use: null,
            source: null,
          } as Parameters<typeof createProduct>[0]);
        }
        setSuccess("Product created.");
      }
      setModalOpen(false);
      setSuccess(editingId ? "Product updated." : "Product created.");
      setTimeout(() => setSuccess(null), 3000);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save product");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (productId?: string) => {
    if (!productId) return;
    if (!window.confirm("Delete this product? This cannot be undone.")) return;
    setError(null);
    try {
      try {
        await adminDeleteProduct(productId);
      } catch {
        await deleteProduct(productId);
      }
      setSuccess("Product deleted.");
      setTimeout(() => setSuccess(null), 3000);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete product");
    }
  };

  const handleArchive = async (p: Product) => {
    if (!p.id) return;
    const next = !p.is_archived;
    setError(null);
    try {
      try {
        await adminUpdateProduct(p.id, { is_archived: next });
      } catch {
        await updateProduct(p.id, { is_archived: next } as Partial<Product>);
      }
      setSuccess(next ? "Product archived." : "Product restored.");
      setTimeout(() => setSuccess(null), 3000);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle archive");
    }
  };

  const handleQuickApprove = async (product: Product, next: "approved" | "pending" | "rejected") => {
    if (!product.id) return;
    setError(null);
    try {
      await setProductApprovalStatus(product.id, next);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update approval status");
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold mb-1">Product Database</h1>
          <p className="text-sm text-muted-foreground">
            Manage all Dayjoy products — SKU, category, benefits, ingredients, warnings, and approval status.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className={`${btnClass.secondary}`}
            type="button"
            title="Import CSV (coming soon)"
            disabled
          >
            <Upload className="w-4 h-4" /> Import CSV
          </button>
          <button
            className={`${btnClass.primary}`}
            type="button"
            onClick={openCreate}
          >
            <Plus className="w-4 h-4" /> Add Product
          </button>
        </div>
      </div>

      {error ? (
        <div className="bg-destructive/5 border border-destructive/30 rounded-xl p-3 text-sm text-destructive">{error}</div>
      ) : null}
      {success ? (
        <div className="bg-primary/5 border border-primary/30 rounded-xl p-3 text-sm text-primary">{success}</div>
      ) : null}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
        <StatsCard label="Total Products" value={String(products.length)} sublabel="In database" />
        <StatsCard
          label="Approved"
          value={String(products.filter((p) => (p.approval_status ?? "pending") === "approved").length)}
          sublabel="Ready for AI use"
        />
        <StatsCard
          label="Pending Review"
          value={String(products.filter((p) => (p.approval_status ?? "pending") === "pending").length)}
          sublabel="Awaiting approval"
        />
        <StatsCard label="Categories" value={String(categories.length - 1)} sublabel="Product types" />
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by name, SKU, category…"
            className="w-full pl-9 pr-4 py-2 h-auto rounded-lg"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          className="px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {["All Status", "approved", "pending", "rejected"].map((s) => (
            <option key={s} value={s}>{s === "All Status" ? "All Status" : s[0].toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 px-3 py-2 bg-card border border-border rounded-lg text-sm cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="rounded" />
          Show archived
        </label>
      </div>

      {/* Products Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-accent/50 border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden sm:table-cell">SKU</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Category</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden lg:table-cell">Updated</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-sm text-muted-foreground">Loading…</td></tr>
              ) : filteredProducts.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-sm text-muted-foreground">No products found.</td></tr>
              ) : (
                filteredProducts.map((p) => (
                  <ProductRow
                    key={p.id ?? p.product_name}
                    product={p}
                    onEdit={() => openEdit(p)}
                    onDelete={() => handleDelete(p.id)}
                    onArchive={() => handleArchive(p)}
                    onApprove={(next) => handleQuickApprove(p, next)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border px-4 py-3 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {filteredProducts.length} of {products.length} products
          </p>
        </div>
      </div>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Edit Product" : "Add Product"}
        description={editingId ? "Update product details." : "Create a new product entry."}
        size="lg"
        footer={
          <>
            <button type="button" className={modalButtonClass.secondary} onClick={() => setModalOpen(false)}>
              <X className="w-4 h-4" /> Cancel
            </button>
            <button type="button" className={modalButtonClass.primary} onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingId ? "Save changes" : "Create product"}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Product Name *</label>
              <Input type="text" value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })}
                className="w-full px-3 py-2 h-auto rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">SKU</label>
              <Input type="text" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })}
                placeholder="DJ-001"
                className="w-full px-3 py-2 h-auto rounded-lg font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Brand</label>
              <Input type="text" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })}
                className="w-full px-3 py-2 h-auto rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
              <Input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 h-auto rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Sub-Category</label>
              <Input type="text" value={form.sub_category} onChange={(e) => setForm({ ...form, sub_category: e.target.value })}
                className="w-full px-3 py-2 h-auto rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Approval Status</label>
              <select value={form.approval_status} onChange={(e) => setForm({ ...form, approval_status: e.target.value as "pending" | "approved" | "rejected" })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Benefits</label>
            <Textarea value={form.benefits} onChange={(e) => setForm({ ...form, benefits: e.target.value })} rows={2}
              className="w-full px-3 py-2 rounded-lg" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Ingredients</label>
            <Textarea value={form.ingredients} onChange={(e) => setForm({ ...form, ingredients: e.target.value })} rows={2}
              className="w-full px-3 py-2 rounded-lg" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Usage</label>
            <Textarea value={form.usage} onChange={(e) => setForm({ ...form, usage: e.target.value })} rows={2}
              className="w-full px-3 py-2 rounded-lg" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Warnings</label>
            <Textarea value={form.warnings} onChange={(e) => setForm({ ...form, warnings: e.target.value })} rows={2}
              placeholder="e.g. Not for pregnant women. Keep out of reach of children."
              className="w-full px-3 py-2 rounded-lg" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Safety Note</label>
            <Textarea value={form.safety_note} onChange={(e) => setForm({ ...form, safety_note: e.target.value })} rows={2}
              className="w-full px-3 py-2 rounded-lg" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_archived} onChange={(e) => setForm({ ...form, is_archived: e.target.checked })} className="rounded" />
            Archive this product (excluded from AI recommendations)
          </label>
        </div>
      </Modal>
    </div>
  );
}

function ProductRow({
  product,
  onEdit,
  onDelete,
  onArchive,
  onApprove,
}: {
  product: Product;
  onEdit: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onApprove: (next: "approved" | "pending" | "rejected") => void;
}) {
  const status = product.approval_status ?? "pending";
  const statusConfig: Record<string, { bg: string; text: string; Icon: typeof CheckCircle }> = {
    approved: { bg: "bg-green-100", text: "text-green-700", Icon: CheckCircle },
    pending: { bg: "bg-amber-100", text: "text-amber-700", Icon: Clock },
    rejected: { bg: "bg-slate-100", text: "text-slate-700", Icon: Clock },
  };
  const config = statusConfig[status] ?? statusConfig.pending;
  const Icon = config.Icon;
  const isArchived = Boolean(product.is_archived);
  const sku = product.sku as string | undefined;

  return (
    <tr className={`hover:bg-accent/30 transition-colors ${isArchived ? "opacity-50" : ""}`}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center text-lg shrink-0">🌿</div>
          <div className="min-w-0">
            <div className="font-medium text-sm truncate flex items-center gap-1.5">
              {product.product_name}
              {isArchived ? <Archive className="w-3 h-3 text-muted-foreground" /> : null}
            </div>
            {product.brand ? <div className="text-[10px] text-muted-foreground">{product.brand}</div> : null}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 hidden sm:table-cell">
        {sku ? <code className="text-xs font-mono text-muted-foreground">{sku}</code> : <span className="text-xs text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-3">
        <span className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-[11px] font-medium">
          {product.category}
        </span>
        {product.sub_category ? <div className="text-[10px] text-muted-foreground mt-0.5">{product.sub_category}</div> : null}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Icon className={`w-3.5 h-3.5 ${config.text}`} />
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${config.bg} ${config.text}`}>{status}</span>
        </div>
      </td>
      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
        {product.created_at ? String(product.created_at).slice(0, 10) : "—"}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {status === "pending" ? (
            <button type="button" className="text-[10px] px-2 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10"
              onClick={() => onApprove("approved")}>Approve</button>
          ) : null}
          <button type="button" className="p-1.5 hover:bg-accent rounded-lg" onClick={onEdit} aria-label="Edit" title="Edit">
            <Edit className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button type="button" className="p-1.5 hover:bg-accent rounded-lg" onClick={onArchive} aria-label="Archive" title={isArchived ? "Restore" : "Archive"}>
            {isArchived ? <RotateCcw className="w-3.5 h-3.5 text-muted-foreground" /> : <Archive className="w-3.5 h-3.5 text-muted-foreground" />}
          </button>
          <button type="button" className="p-1.5 hover:bg-destructive/10 text-destructive rounded-lg" onClick={onDelete} aria-label="Delete" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
