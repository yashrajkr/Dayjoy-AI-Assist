import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Package, Plus, Search, Edit, Trash2, CheckCircle, Clock, Upload,
  Archive, RotateCcw, Loader2, X, Save, Image as ImageIcon, Star,
} from "lucide-react";
import {
  type Product,
  createProduct,
  deleteProduct,
  getAllProductsForAdmin,
  setProductApprovalStatus,
  updateProduct,
  getProductImages,
  addProductImage,
  deleteProductImage,
  setProductImagePrimary,
} from "../../lib/db";
import { Modal } from "../common/Modal";
import { Input, Textarea } from "../ui/input";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card } from "../ui/card";
import {
  adminCreateProduct,
  adminUpdateProduct,
  adminDeleteProduct,
  adminCreateProductImage,
  adminDeleteProductImage,
  adminUpdateProductImage,
} from "../../../lib/api";
import { PRODUCT_CATEGORIES } from "../user/ProductDiscovery";

function StatsCard({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  return (
    <Card className="p-6 shadow-none">
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center">
          <Package className="w-6 h-6 text-primary" />
        </div>
      </div>
      <h3 className="text-2xl font-semibold mb-1">{value}</h3>
      <p className="text-sm text-foreground mb-1">{label}</p>
      <p className="text-xs text-muted-foreground">{sublabel}</p>
    </Card>
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

  // Product images — the approved-media source for both Product Discovery
  // and the chat Product Visual Intelligence cards. Only manageable once a
  // product exists (product_images.product_id is a real FK to products.id).
  const [images, setImages] = useState<
    { id: string; image_url: string; alt_text: string | null; is_primary: boolean | null; display_order: number | null }[]
  >([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [newImageUrl, setNewImageUrl] = useState("");
  const [newImageAlt, setNewImageAlt] = useState("");
  const [imageSaving, setImageSaving] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const loadImages = useCallback(async (productId: string) => {
    setImagesLoading(true);
    try {
      setImages(await getProductImages(productId));
    } finally {
      setImagesLoading(false);
    }
  }, []);

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
    setImages([]);
    setNewImageUrl("");
    setNewImageAlt("");
    setImageError(null);
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
    setNewImageUrl("");
    setNewImageAlt("");
    setImageError(null);
    if (p.id) {
      void loadImages(p.id);
    } else {
      setImages([]);
    }
    setModalOpen(true);
  };

  const handleAddImage = async () => {
    if (!editingId || !newImageUrl.trim()) return;
    setImageSaving(true);
    setImageError(null);
    try {
      const payload = {
        image_url: newImageUrl.trim(),
        alt_text: newImageAlt.trim() || undefined,
        is_primary: images.length === 0, // first image on a product defaults to primary
      };
      try {
        await adminCreateProductImage(editingId, payload);
      } catch {
        await addProductImage(editingId, payload);
      }
      setNewImageUrl("");
      setNewImageAlt("");
      await loadImages(editingId);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Failed to add image");
    } finally {
      setImageSaving(false);
    }
  };

  const handleRemoveImage = async (imageId: string) => {
    if (!editingId) return;
    setImageError(null);
    try {
      try {
        await adminDeleteProductImage(editingId, imageId);
      } catch {
        await deleteProductImage(imageId);
      }
      await loadImages(editingId);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Failed to remove image");
    }
  };

  const handleSetPrimaryImage = async (imageId: string) => {
    if (!editingId) return;
    setImageError(null);
    try {
      try {
        await adminUpdateProductImage(editingId, imageId, { is_primary: true });
      } catch {
        await setProductImagePrimary(editingId, imageId);
      }
      await loadImages(editingId);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Failed to set primary image");
    }
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
          <Button
            variant="secondary"
            type="button"
            title="Import CSV (coming soon)"
            disabled
          >
            <Upload className="w-4 h-4" /> Import CSV
          </Button>
          <Button
            type="button"
            onClick={openCreate}
          >
            <Plus className="w-4 h-4" /> Add Product
          </Button>
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
      <Card className="p-0 overflow-hidden shadow-none">
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
      </Card>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Edit Product" : "Add Product"}
        description={editingId ? "Update product details." : "Create a new product entry."}
        size="lg"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              <X className="w-4 h-4" /> Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingId ? "Save changes" : "Create product"}
            </Button>
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
              {/* A fixed select, not free text — Product Discovery's category
                  chips filter by exact category value, so a free-typed
                  category (different casing/spacing, a synonym) silently
                  fell out of every chip except "All Products". */}
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Select a category…</option>
                {PRODUCT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
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

          {/* Product photos — the approved-media source for Product
              Discovery cards and the chat Product Visual Intelligence
              feature (product_images table). Only available once the
              product itself has been created (save it first, then reopen
              Edit to add photos). */}
          <div className="pt-2 border-t border-border">
            <label className="block text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5" aria-hidden="true" /> Product Photos
            </label>
            {!editingId ? (
              <p className="text-xs text-muted-foreground">Save this product first, then reopen Edit to add photos.</p>
            ) : (
              <>
                {imageError ? <p className="text-xs text-destructive mb-2">{imageError}</p> : null}
                {imagesLoading ? (
                  <p className="text-xs text-muted-foreground">Loading photos…</p>
                ) : images.length > 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">
                    {images.map((img) => (
                      <div key={img.id} className="relative group rounded-lg overflow-hidden border border-border aspect-square bg-accent/30">
                        <img src={img.image_url} alt={img.alt_text ?? ""} className="w-full h-full object-cover" loading="lazy" />
                        {img.is_primary ? (
                          <span className="absolute top-1 left-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-medium">
                            <Star className="w-2.5 h-2.5" aria-hidden="true" /> Primary
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleSetPrimaryImage(img.id)}
                            className="absolute top-1 left-1 px-1.5 py-0.5 rounded-full bg-card/90 text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            Set primary
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleRemoveImage(img.id)}
                          aria-label="Remove photo"
                          className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mb-2">No photos yet — customers see a placeholder until one is added.</p>
                )}
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    type="url"
                    value={newImageUrl}
                    onChange={(e) => setNewImageUrl(e.target.value)}
                    placeholder="https://... image URL"
                    className="flex-1 px-3 py-2 h-auto rounded-lg"
                  />
                  <Input
                    type="text"
                    value={newImageAlt}
                    onChange={(e) => setNewImageAlt(e.target.value)}
                    placeholder="Alt text (optional)"
                    className="flex-1 px-3 py-2 h-auto rounded-lg"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!newImageUrl.trim() || imageSaving}
                    onClick={() => void handleAddImage()}
                    className="shrink-0"
                  >
                    {imageSaving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
                    Add
                  </Button>
                </div>
              </>
            )}
          </div>
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
        <Badge>{product.category}</Badge>
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
            <Button type="button" variant="outline" size="sm" className="text-primary border-primary/30 hover:bg-primary/10"
              onClick={() => onApprove("approved")}>Approve</Button>
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
