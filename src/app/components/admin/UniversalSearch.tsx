import { useCallback, useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, X, Users, Package, FileText, FileQuestion, GraduationCap,
  Headphones, ScrollText, BookOpen, Loader2, ArrowRight,
} from "lucide-react";
import { adminSearch, type AdminSearchResult } from "../../../lib/api";
import { Card } from "../common/AdminUI";

const ENTITY_ICONS: Record<string, typeof Users> = {
  user: Users,
  product: Package,
  document: FileText,
  faq: FileQuestion,
  training: GraduationCap,
  course: GraduationCap,
  policy: ScrollText,
  ticket: Headphones,
};

const ENTITY_ROUTES: Record<string, (id: string) => string> = {
  user: () => "/admin/users",
  product: () => "/admin/products",
  document: () => "/admin/knowledge",
  faq: () => "/admin/faqs",
  training: () => "/admin/training",
  course: () => "/admin/training",
  policy: () => "/admin/policies",
  ticket: () => "/admin/support",
};

const ENTITY_COLORS: Record<string, string> = {
  user: "text-blue-500",
  product: "text-emerald-500",
  document: "text-orange-500",
  faq: "text-purple-500",
  training: "text-cyan-500",
  course: "text-cyan-500",
  policy: "text-rose-500",
  ticket: "text-amber-500",
};

const ENTITY_FILTERS = [
  { value: "", label: "All" },
  { value: "user", label: "Users" },
  { value: "product", label: "Products" },
  { value: "document", label: "Documents" },
  { value: "faq", label: "FAQs" },
  { value: "training", label: "Training" },
  { value: "policy", label: "Policies" },
  { value: "ticket", label: "Tickets" },
];

export function UniversalSearch({ embedded = false }: { embedded?: boolean }) {
  const [query, setQuery] = useState("");
  const [entityType, setEntityType] = useState("");
  const [results, setResults] = useState<AdminSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const navigate = useNavigate();

  const doSearch = useCallback(async (q: string, type: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const res = await adminSearch(q, type || undefined, 30);
      setResults(res.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => doSearch(query, entityType), 250);
    return () => clearTimeout(t);
  }, [query, entityType, doSearch]);

  // Group results by entity type
  const grouped = useMemo(() => {
    const map: Record<string, AdminSearchResult[]> = {};
    for (const r of results) {
      (map[r.entity_type] = map[r.entity_type] || []).push(r);
    }
    return map;
  }, [results]);

  const totalCount = results.length;

  return (
    <div className={embedded ? "" : "p-4 sm:p-6 max-w-5xl mx-auto"}>
      {!embedded ? (
        <div className="mb-4">
          <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
            <Search className="w-5 h-5" /> Universal Search
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Search across users, products, documents, FAQs, training, policies, and tickets.
          </p>
        </div>
      ) : null}

      {/* Search bar */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          autoFocus={!embedded}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search anything… (users, products, docs, FAQs)"
          className="w-full pl-9 pr-9 py-2.5 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-accent"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      {/* Entity type filter chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {ENTITY_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setEntityType(f.value)}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
              entityType === f.value
                ? "bg-primary text-primary-foreground"
                : "bg-accent text-muted-foreground hover:bg-accent/80"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/5 text-destructive text-sm">
          {error}
        </Card>
      ) : null}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Searching…
        </div>
      ) : null}

      {/* Results */}
      {!loading && hasSearched ? (
        totalCount === 0 ? (
          <Card>
            <div className="text-center py-8">
              <p className="text-sm font-medium">No results found</p>
              <p className="text-xs text-muted-foreground mt-1">
                Try a different search term or remove the filter.
              </p>
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {totalCount} result{totalCount === 1 ? "" : "s"} for "{query}"
            </p>
            {Object.entries(grouped).map(([type, items]) => {
              const Icon = ENTITY_ICONS[type] || FileText;
              const color = ENTITY_COLORS[type] || "text-muted-foreground";
              return (
                <div key={type}>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    <Icon className={`w-3 h-3 ${color}`} />
                    {type} ({items.length})
                  </h2>
                  <Card className="p-0 overflow-hidden">
                    <ul className="divide-y divide-border">
                      {items.map((r) => {
                        const route = ENTITY_ROUTES[type]?.(r.entity_id) || "/admin/dashboard";
                        return (
                          <li key={`${type}-${r.entity_id}`}>
                            <button
                              type="button"
                              onClick={() => navigate(route)}
                              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-accent/40 text-left transition-colors"
                            >
                              <Icon className={`w-4 h-4 shrink-0 ${color}`} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{r.title || "Untitled"}</p>
                                <p className="text-[10px] text-muted-foreground truncate">
                                  {r.subtitle || "—"}
                                  {r.created_at ? ` · ${new Date(r.created_at).toLocaleDateString()}` : ""}
                                </p>
                              </div>
                              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </Card>
                </div>
              );
            })}
          </div>
        )
      ) : null}

      {/* Empty state */}
      {!hasSearched && !loading ? (
        <Card>
          <div className="text-center py-8">
            <Search className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
            <p className="text-sm font-medium">Start typing to search</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              The search unifies users, products, documents, FAQs, training courses,
              policies, and support tickets into one index.
            </p>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
