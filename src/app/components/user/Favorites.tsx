import { useCallback, useEffect, useState } from "react";
import { Heart, Trash2, FolderPlus, Folder, Package, FileQuestion, MessageSquare, Sparkles, Plus, X, Loader2 } from "lucide-react";
import { Modal } from "../common/Modal";
import { LoadingState, ErrorState, EmptyState } from "../common/AdminUI";
import { AppHeader } from "../common/AppHeader";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import {
  customerListFavorites, customerRemoveFavorite,
  customerListCollections, customerCreateCollection, customerDeleteCollection,
  type Favorite, type Collection,
} from "../../../lib/api";

const ENTITY_ICONS: Record<string, typeof Package> = {
  product: Package, faq: FileQuestion, conversation: MessageSquare,
  training: Sparkles, document: FileQuestion, policy: FileQuestion,
};

const TABS = [
  { value: "product", label: "Products" },
  { value: "faq", label: "FAQs" },
  { value: "conversation", label: "Conversations" },
  { value: "training", label: "Training" },
];

export function Favorites() {
  const [tab, setTab] = useState("product");
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [newColIcon, setNewColIcon] = useState("📁");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [favs, cols] = await Promise.all([
        customerListFavorites(tab),
        customerListCollections(),
      ]);
      setFavorites(favs);
      setCollections(cols);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const handleRemove = async (fav: Favorite) => {
    if (!fav.id || !window.confirm("Remove this favorite?")) return;
    try {
      await customerRemoveFavorite(fav.id);
      setFavorites((prev) => prev.filter((f) => f.id !== fav.id));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  };

  const handleCreateCol = async () => {
    if (!newColName.trim()) return;
    setSaving(true);
    try {
      await customerCreateCollection({ name: newColName, icon: newColIcon });
      setCreateOpen(false); setNewColName(""); setNewColIcon("📁");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  };

  const handleDeleteCol = async (col: Collection) => {
    if (!col.id || !window.confirm(`Delete collection "${col.name}"?`)) return;
    try { await customerDeleteCollection(col.id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <AppHeader
        title="Favorites"
        subtitle="Your saved products, FAQs, and conversations."
        icon={Heart}
        actions={
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)} aria-label="New Collection" title="New Collection">
            <FolderPlus className="w-4 h-4" /> <span className="hidden sm:inline">New Collection</span>
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto">
      <div className="p-4 sm:p-6 max-w-5xl mx-auto w-full">
      {error ? <ErrorState message={error} /> : null}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.value} type="button" onClick={() => setTab(t.value)}
            className={`px-3 py-2 text-sm border-b-2 whitespace-nowrap ${tab === t.value ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <LoadingState /> : favorites.length === 0 ? (
        <Card className="shadow-none"><EmptyState title="No favorites yet" description="Tap the heart icon on products, FAQs, or conversations to save them here." icon={<Heart className="w-5 h-5" />} /></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {favorites.map((f) => {
            const Icon = ENTITY_ICONS[f.entity_type] || Package;
            return (
              <Card key={f.id} className="p-3 shadow-none">
                <div className="flex items-start gap-2">
                  <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{f.entity_name || "Untitled"}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{f.entity_type}</p>
                  </div>
                  <Button type="button" variant="ghost" size="icon" onClick={() => handleRemove(f)} className="h-auto w-auto p-1.5 text-destructive hover:bg-destructive/10" title="Remove" aria-label="Remove favorite"><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Collections */}
      {collections.length > 0 ? (
        <div className="mt-6">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Folder className="w-4 h-4 text-primary" /> Collections</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {collections.map((c) => (
              <Card key={c.id} className="p-3 text-center relative group shadow-none">
                <Button type="button" variant="ghost" size="icon" onClick={() => handleDeleteCol(c)} className="absolute top-1 right-1 h-auto w-auto p-1 text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100" title="Delete" aria-label="Delete collection"><Trash2 className="w-3 h-3" /></Button>
                <div className="text-2xl mb-1">{c.icon || "📁"}</div>
                <p className="text-xs font-medium truncate">{c.name}</p>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
      </div>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Collection" size="sm"
        footer={<>
          <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}><X className="w-4 h-4" /> Cancel</Button>
          <Button type="button" onClick={handleCreateCol} disabled={saving || !newColName.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create
          </Button>
        </>}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
            <input type="text" value={newColName} onChange={(e) => setNewColName(e.target.value)} placeholder="e.g. My Wellness Routine"
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Icon</label>
            <div className="flex gap-2 flex-wrap">
              {["📁","💚","🌟","💪","🌿","💊","🧘","☕"].map((emoji) => (
                <button key={emoji} type="button" onClick={() => setNewColIcon(emoji)}
                  className={`w-9 h-9 rounded-lg border text-lg ${newColIcon === emoji ? "border-primary bg-primary/5" : "border-border"}`}>{emoji}</button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
