import { useEffect, useMemo, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Search, X, CheckCircle2, GitCompareArrows, Eye, History, QrCode, Camera, Package } from "lucide-react";
import { getProducts, logAnalytics, type AnalyticsEvent, type Product } from "../../lib/db";
import { AppHeader } from "../common/AppHeader";
import { Modal } from "../common/Modal";
import { QRScanner, type ScanResult } from "../tools/QRScanner";
import { CameraCapture, type CapturedImage } from "../tools/CameraCapture";
import { OcrScanner } from "../tools/OcrScanner";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Card } from "../ui/card";

/** Recently viewed products — persisted in localStorage (max 8). */
const RECENT_KEY = "dayjoy_recent_products";
function loadRecent(): Product[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as Product[]) : [];
  } catch {
    return [];
  }
}
function saveRecent(products: Product[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(products.slice(0, 8)));
  } catch {
    // ignore
  }
}

const categories: string[] = [
  "All Products",
  "Health Care",
  "Personal Care",
  "Skin Care",
  "Home Care",
  "Food Products",
  "Agriculture",
  "Lifestyle",
];

type SortKey = "newest" | "name_asc" | "name_desc";

export function ProductDiscovery() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>(categories[0]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [compareSet, setCompareSet] = useState<Product[]>([]);
  const [detail, setDetail] = useState<Product | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [recentProducts, setRecentProducts] = useState<Product[]>([]);
  const [qrOpen, setQrOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Load recently viewed from localStorage on mount
  useEffect(() => {
    setRecentProducts(loadRecent());
  }, []);

  // Track product views when detail modal opens
  const openDetail = useCallback((p: Product) => {
    setDetail(p);
    setRecentProducts((prev) => {
      const filtered = prev.filter(
        (x) => (x.id ?? x.product_name) !== (p.id ?? p.product_name),
      );
      const next = [p, ...filtered].slice(0, 8);
      saveRecent(next);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const rows = await getProducts();
      if (!cancelled) {
        setProducts(rows);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const event: AnalyticsEvent = {
        user_id: null,
        role: null,
        language: null,
        query: searchQuery.trim() || null,
        category: selectedCategory === "All Products" ? null : selectedCategory,
        source_used: "product_discovery",
        safety_status: "safe",
      };
      void logAnalytics(event);
    } catch {
      // ignore
    }
  }, [selectedCategory, searchQuery]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = products.filter((p) => {
      const matchesCategory =
        selectedCategory === "All Products" ? true : p.category === selectedCategory;
      if (!matchesCategory) return false;
      if (!q) return true;
      const tags = p.problem_tags ?? p.tags ?? null;
      const tagText = Array.isArray(tags)
        ? tags.join(" ").toLowerCase()
        : (tags ?? "").toString().toLowerCase();
      const haystack = [
        p.product_name,
        p.brand ?? "",
        p.category,
        p.sub_category ?? "",
        p.benefits ?? "",
        p.ingredients ?? "",
        p.safety_note ?? "",
        tagText,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
    if (sortKey === "name_asc") return [...filtered].sort((a, b) => a.product_name.localeCompare(b.product_name));
    if (sortKey === "name_desc") return [...filtered].sort((a, b) => b.product_name.localeCompare(a.product_name));
    return filtered;
  }, [products, selectedCategory, searchQuery, sortKey]);

  const toggleCompare = (p: Product) => {
    setCompareSet((prev) => {
      const exists = prev.find((x) => (x.id ?? x.product_name) === (p.id ?? p.product_name));
      if (exists) return prev.filter((x) => x !== exists);
      if (prev.length >= 3) return prev;
      return [...prev, p];
    });
  };

  const inCompare = (p: Product) =>
    compareSet.some((x) => (x.id ?? x.product_name) === (p.id ?? p.product_name));

  /**
   * Handle QR scan result. If the decoded text contains a product name or
   * URL fragment that matches an approved product, open it directly.
   * Otherwise, paste the text into the search box.
   */
  const handleQrScan = useCallback(
    (res: ScanResult) => {
      setQrOpen(false);
      setScanError(null);
      const text = res.text.trim();
      if (!text) return;
      // Try to find a product whose name appears in the QR text
      const match = products.find(
        (p) =>
          text.toLowerCase().includes(p.product_name.toLowerCase()) ||
          (p.id && text.includes(p.id)),
      );
      if (match) {
        openDetail(match);
      } else {
        // Use as search query
        setSearchQuery(text.slice(0, 80));
      }
    },
    [products, openDetail],
  );

  /**
   * Handle camera capture → no auto-action; user can preview the photo
   * and decide what to do (e.g. extract text via OCR).
   */
  const handleCameraCapture = useCallback((_img: CapturedImage) => {
    setCameraOpen(false);
    setScanError("Photo captured. Use 'Extract text' to read its contents.");
    setTimeout(() => setScanError(null), 4000);
  }, []);

  /**
   * Handle OCR-extracted text → use as search query.
   */
  const handleOcrExtracted = useCallback((text: string) => {
    setOcrOpen(false);
    setScanError(null);
    // Take first non-empty short line as the search query
    const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
    setSearchQuery(firstLine.slice(0, 80) || text.slice(0, 80));
  }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <AppHeader
        title="Product Discovery"
        subtitle="Search approved Dayjoy products by category, problem tags, benefits, and safe usage guidance."
        icon={Package}
      />
      <div className="flex-1 overflow-y-auto bg-background p-4 sm:p-6">
        <div className="max-w-6xl mx-auto space-y-6">

        <Card className="p-4 sm:p-5">
          <label htmlFor="dj-product-search" className="sr-only">
            Search products
          </label>
          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="dj-product-search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 h-auto rounded-xl focus-visible:ring-4 focus-visible:ring-primary/10"
                placeholder="Search skin care, agriculture, respiratory wellness, home care…"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setQrOpen(true)}
              className="h-auto py-3 rounded-xl shrink-0"
              aria-label="Scan QR code to find a product"
              title="Scan QR code"
            >
              <QrCode className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">Scan QR</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCameraOpen(true)}
              className="h-auto py-3 rounded-xl shrink-0"
              aria-label="Take a photo of a product label"
              title="Take a photo"
            >
              <Camera className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">Photo</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOcrOpen(true)}
              className="h-auto py-3 rounded-xl shrink-0"
              aria-label="Extract text from a product label image"
              title="Extract text from image (OCR)"
            >
              <span className="text-xs">OCR</span>
            </Button>
          </div>

          {scanError ? (
            <p className="text-xs text-primary mt-2 flex items-center gap-1" role="status">
              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
              {scanError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors ${
                    selectedCategory === cat
                      ? "bg-primary text-primary-foreground"
                      : "bg-accent text-accent-foreground hover:bg-accent/70"
                  }`}
                  aria-pressed={selectedCategory === cat}
                >
                  {cat}
                </button>
              ))}
            </div>
            <label htmlFor="dj-product-sort" className="sr-only">
              Sort
            </label>
            <select
              id="dj-product-sort"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="text-xs sm:text-sm border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="newest">Sort: Newest</option>
              <option value="name_asc">Sort: Name (A→Z)</option>
              <option value="name_desc">Sort: Name (Z→A)</option>
            </select>
          </div>
        </Card>

        {/* Recently viewed — horizontal strip */}
        {recentProducts.length > 0 ? (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground shrink-0">
              <History className="w-3.5 h-3.5" aria-hidden="true" /> Recently viewed:
            </span>
            {recentProducts.slice(0, 6).map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => openDetail(p)}
                className="shrink-0 text-xs px-3 py-1.5 rounded-full bg-accent text-accent-foreground hover:bg-accent/70 transition-colors"
              >
                {p.product_name}
              </button>
            ))}
          </div>
        ) : null}

        {loading ? (
          <div className="text-muted-foreground py-8 text-sm">Loading products…</div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm font-medium">No products found</p>
            <p className="text-xs mt-1">Try a different search or category filter.</p>
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-20"
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
          >
            {filteredProducts.map((p) => {
              const compared = inCompare(p);
              return (
                <motion.div
                  key={String(p.id ?? p.product_name)}
                  variants={{
                    hidden: { opacity: 0, y: 16 },
                    visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
                  }}
                  transition={{ duration: 0.2 }}
                  className="bg-card border border-border rounded-2xl overflow-hidden shadow-flat hover-raise flex flex-col"
                >
                  <div className="h-28 bg-gradient-to-br from-accent to-card-beige flex items-center justify-center px-4">
                    <span className="text-xl font-semibold text-primary text-center leading-tight" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
                      {p.product_name}
                    </span>
                  </div>

                  <div className="p-4 flex flex-col flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant="default">{p.category}</Badge>
                      <CheckCircle2
                        className="w-5 h-5 text-primary"
                        aria-label="Approved"
                      />
                    </div>

                    <h3 className="text-base font-semibold">{p.product_name}</h3>
                    {p.brand ? (
                      <p className="text-xs text-muted-foreground mb-2">{p.brand}</p>
                    ) : null}
                    {p.benefits ? (
                      <p className="text-sm mb-3 line-clamp-2 text-muted-foreground">{p.benefits}</p>
                    ) : null}

                    <div className="flex gap-2 mt-auto">
                      <Button type="button" onClick={() => openDetail(p)} className="flex-1 rounded-xl">
                        <Eye className="w-4 h-4" aria-hidden="true" /> Details
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => toggleCompare(p)}
                        className={`rounded-xl ${compared ? "border-primary bg-primary/10 text-primary hover:bg-primary/15" : ""}`}
                        aria-pressed={compared}
                      >
                        <GitCompareArrows className="w-4 h-4" aria-hidden="true" />
                        {compared ? "In compare" : "Compare"}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>

      {/* Floating compare bar — appears once at least one product is selected */}
      {compareSet.length > 0 ? (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 bg-card border border-border rounded-2xl shadow-overlay px-4 py-3 flex items-center gap-3">
          <div className="flex -space-x-2">
            {compareSet.map((p) => (
              <div
                key={p.id ?? p.product_name}
                title={p.product_name}
                className="w-8 h-8 rounded-full bg-accent text-accent-foreground border-2 border-card flex items-center justify-center text-xs font-semibold"
              >
                {p.product_name?.slice(0, 1)?.toUpperCase()}
              </div>
            ))}
          </div>
          <span className="text-xs text-muted-foreground hidden sm:inline">{compareSet.length} of 3 selected</span>
          <Button
            type="button"
            onClick={() => setCompareOpen(true)}
            disabled={compareSet.length < 2}
            className="rounded-xl"
          >
            Compare side-by-side
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setCompareSet([])}
            aria-label="Clear comparison selection"
            className="rounded-xl"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {/* Product detail modal */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.product_name ?? "Product"}
        description={detail?.category}
        size="lg"
      >
        {detail ? (
          <div className="space-y-3 text-sm">
            {detail.brand ? (
              <DetailRow label="Brand" value={detail.brand} />
            ) : null}
            {detail.sub_category ? (
              <DetailRow label="Sub-category" value={detail.sub_category} />
            ) : null}
            {detail.benefits ? <DetailRow label="Benefits" value={detail.benefits} /> : null}
            {detail.ingredients ? (
              <DetailRow label="Ingredients" value={detail.ingredients} />
            ) : null}
            {detail.usage ? <DetailRow label="Usage" value={detail.usage} /> : null}
            {detail.who_can_use ? (
              <DetailRow label="Who can use" value={detail.who_can_use} />
            ) : null}
            {detail.safety_note ? (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                <p className="text-xs font-semibold text-warning uppercase tracking-wide mb-1">
                  Safety note
                </p>
                <p className="text-sm">{detail.safety_note}</p>
              </div>
            ) : null}
            {detail.problem_tags?.length ? (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Tags</p>
                <div className="flex flex-wrap gap-1">
                  {detail.problem_tags.map((t) => (
                    <Badge key={t} variant="secondary" className="rounded">
                      #{t}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* Comparison modal */}
      <Modal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        title="Compare products"
        description={`${compareSet.length} products selected`}
        size="xl"
        footer={
          <Button type="button" variant="secondary" onClick={() => setCompareOpen(false)}>
            Close
          </Button>
        }
      >
        {compareSet.length < 2 ? (
          <p className="text-sm text-muted-foreground">Select at least 2 products to compare.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Attribute</th>
                  {compareSet.map((p) => (
                    <th key={p.id ?? p.product_name} className="px-3 py-2 font-medium">
                      {p.product_name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "Category", get: (p: Product) => p.category },
                  { label: "Brand", get: (p: Product) => p.brand ?? "—" },
                  { label: "Benefits", get: (p: Product) => p.benefits ?? "—" },
                  { label: "Usage", get: (p: Product) => p.usage ?? "—" },
                  { label: "Safety note", get: (p: Product) => p.safety_note ?? "—" },
                ].map((row) => (
                  <tr key={row.label} className="border-b border-border last:border-0 align-top">
                    <td className="px-3 py-2 font-medium">{row.label}</td>
                    {compareSet.map((p) => (
                      <td key={p.id ?? p.product_name} className="px-3 py-2 text-muted-foreground">
                        {row.get(p)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
      </div>

      {/* Tools: QR scanner, camera, OCR */}
      <QRScanner
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        onScan={handleQrScan}
        title="Scan product QR code"
      />
      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCameraCapture}
        title="Photograph product label"
        facingMode="environment"
      />
      <OcrScanner
        open={ocrOpen}
        onClose={() => setOcrOpen(false)}
        onExtracted={handleOcrExtracted}
        title="Extract text from product label"
      />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p>{value}</p>
    </div>
  );
}
