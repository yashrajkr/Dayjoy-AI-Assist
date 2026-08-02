import { useCallback, useState } from "react";
import { Search, FileQuestion, ScrollText, Package, GraduationCap, FileText, Loader2, AlertCircle } from "lucide-react";
import { ErrorState, EmptyState } from "../common/AdminUI";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { customerKnowledgeSearch, type KnowledgeSearchResult } from "../../../lib/api";

const ENTITY_ICONS: Record<string, typeof Package> = {
  faq: FileQuestion, policy: ScrollText, product: Package,
  training: GraduationCap, document: FileText,
};

const ENTITY_LABELS: Record<string, string> = {
  faq: "FAQ", policy: "Policy", product: "Product",
  training: "Training", document: "Document",
};

const FILTERS = [
  { value: "", label: "All" },
  { value: "faq", label: "FAQs" },
  { value: "policy", label: "Policies" },
  { value: "product", label: "Products" },
  { value: "training", label: "Training" },
  { value: "document", label: "Documents" },
];

export function KnowledgeCenter() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [filter, setFilter] = useState("");

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); setSearched(false); return; }
    setLoading(true); setError(null); setSearched(true);
    try {
      const res = await customerKnowledgeSearch({
        query: q,
        entity_types: filter ? [filter] : undefined,
      });
      setResults(res.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    } finally { setLoading(false); }
  }, [filter]);

  const grouped = results.reduce<Record<string, KnowledgeSearchResult[]>>((acc, r) => {
    (acc[r.entity_type] = acc[r.entity_type] || []).push(r);
    return acc;
  }, {});

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Search className="w-5 h-5 text-primary" /> Knowledge Center</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Search FAQs, policies, products, training, and documents — all from verified Dayjoy sources.</p>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
          autoFocus placeholder="Search for anything… (e.g. ashwagandha, refund policy, distributor)"
          className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" onClick={() => { setFilter(f.value); search(query); }}
            className={`text-xs px-2.5 py-1 rounded-full ${filter === f.value ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:bg-accent/80"}`}>{f.label}</button>
        ))}
      </div>

      {error ? <ErrorState message={error} /> : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Searching verified sources…</div>
      ) : searched ? (
        results.length === 0 ? (
          <Card className="shadow-none"><EmptyState title="No results found" description="Try a different search term or broaden your filter." icon={<AlertCircle className="w-5 h-5" />} /></Card>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">{results.length} result{results.length === 1 ? "" : "s"} for "{query}"</p>
            {Object.entries(grouped).map(([type, items]) => {
              const Icon = ENTITY_ICONS[type] || FileText;
              return (
                <div key={type}>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    <Icon className="w-3 h-3" /> {ENTITY_LABELS[type] || type} ({items.length})
                  </h2>
                  <div className="space-y-2">
                    {items.map((r, i) => (
                      <Card key={`${type}-${r.entity_id}-${i}`} className="p-3 shadow-none">
                        <p className="text-sm font-medium">{r.title || "Untitled"}</p>
                        {r.snippet ? <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.snippet}</p> : null}
                        {r.category ? <Badge variant="secondary" className="mt-1.5">{r.category}</Badge> : null}
                      </Card>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <Card className="shadow-none">
          <EmptyState title="Start searching" description="The Knowledge Center searches across FAQs, policies, products, training, and approved documents — all verified Dayjoy sources." icon={<Search className="w-5 h-5" />} />
        </Card>
      )}
    </div>
  );
}
