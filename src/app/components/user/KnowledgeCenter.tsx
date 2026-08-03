import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { Search, FileQuestion, ScrollText, Package, GraduationCap, FileText, Loader2, AlertCircle, BadgeCheck, BookOpen, Sparkles, ArrowRight } from "lucide-react";
import { ErrorState, EmptyState } from "../common/AdminUI";
import { AppHeader } from "../common/AppHeader";
import { useAuth } from "../../lib/AuthContext";
import { customerKnowledgeSearch, chatWithBackend, type KnowledgeSearchResult } from "../../../lib/api";
import ReactMarkdown from "react-markdown";

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
  const { role } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [filter, setFilter] = useState("");

  // Fallback AI answer — used when the verified knowledge base has no
  // matching FAQs/policies/products/training/documents for the query, so the
  // user can still get an answer instead of a dead end.
  const [aiAnswer, setAiAnswer] = useState<{ query: string; answer: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const search = useCallback(async (q: string, filterOverride?: string) => {
    setAiAnswer(null);
    setAiError(null);
    if (q.trim().length < 2) { setResults([]); setSearched(false); return; }
    setLoading(true); setError(null); setSearched(true);
    const activeFilter = filterOverride ?? filter;
    try {
      const res = await customerKnowledgeSearch({
        query: q,
        entity_types: activeFilter ? [activeFilter] : undefined,
      });
      setResults(res.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    } finally { setLoading(false); }
  }, [filter]);

  const askAI = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await chatWithBackend({ message: q, role: role ?? "customer", language: "English" });
      setAiAnswer({ query: q, answer: res.answer });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Couldn't reach the AI assistant. Please try again.");
    } finally {
      setAiLoading(false);
    }
  }, [query, role]);

  const grouped = results.reduce<Record<string, KnowledgeSearchResult[]>>((acc, r) => {
    (acc[r.entity_type] = acc[r.entity_type] || []).push(r);
    return acc;
  }, {});

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <AppHeader
        title="Knowledge Center"
        subtitle="Search FAQs, policies, products, training, and documents — all from verified Dayjoy sources."
        icon={Search}
      />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto w-full">
      <div className="relative mb-3">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input id="dj-knowledge-search" type="search" value={query} onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
          autoFocus placeholder="Search for anything… (e.g. ashwagandha, refund policy, distributor)"
          className="w-full pl-11 pr-4 py-3 rounded-xl border border-border bg-card text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
      </div>

      <div className="flex flex-wrap gap-1.5 mb-5">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" onClick={() => { setFilter(f.value); search(query, f.value); }}
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${filter === f.value ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground hover:bg-accent/70"}`}>{f.label}</button>
        ))}
      </div>

      {error ? <ErrorState message={error} /> : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Searching verified sources…</div>
      ) : searched ? (
        results.length === 0 ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-border bg-card">
              <EmptyState title="No verified sources found" description="No exact matches in FAQs, policies, products, training, or documents. Ask Dayjoy AI directly instead." icon={<AlertCircle className="w-5 h-5" />} />
            </div>

            {aiAnswer && aiAnswer.query === query.trim() ? (
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary mb-2">
                  <Sparkles className="w-3.5 h-3.5" /> Dayjoy AI answer
                </div>
                <div className="ai-prose prose prose-sm max-w-none">
                  <ReactMarkdown>{aiAnswer.answer}</ReactMarkdown>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-2">
                {aiError ? <p className="text-xs text-destructive">{aiError}</p> : null}
                <button
                  type="button"
                  onClick={askAI}
                  disabled={aiLoading}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60 transition-opacity"
                >
                  {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {aiLoading ? "Asking Dayjoy AI…" : "Ask Dayjoy AI instead"}
                </button>
              </div>
            )}
          </div>
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
                      <div key={`${type}-${r.entity_id}-${i}`} className="rounded-xl border border-border bg-card p-4 hover:shadow-sm transition-shadow">
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-lg bg-accent text-accent-foreground flex items-center justify-center shrink-0">
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium">{r.title || "Untitled"}</p>
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-accent text-accent-foreground">
                                <BadgeCheck className="w-3 h-3" /> Verified
                              </span>
                            </div>
                            {r.snippet ? <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.snippet}</p> : null}
                            <p className="text-[11px] text-muted-foreground mt-2">
                              {ENTITY_LABELS[type] || type}
                              {r.category ? ` · ${r.category}` : ""}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Browse by category</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {FILTERS.filter((f) => f.value).map((f) => {
              const Icon = ENTITY_ICONS[f.value] || FileText;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => { setFilter(f.value); document.getElementById("dj-knowledge-search")?.focus(); }}
                  className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-3.5 text-left hover:border-primary/30 hover:bg-accent/40 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-accent text-accent-foreground flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-medium">{f.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-dashed border-border bg-accent/20 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent text-accent-foreground flex items-center justify-center shrink-0">
            <BookOpen className="w-4 h-4" />
          </div>
          <div>
            <p className="text-sm font-medium">Can't find what you need?</p>
            <p className="text-xs text-muted-foreground">Reach out to our support team.</p>
          </div>
        </div>
        <Link to="/support" className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-accent/60 transition-colors shrink-0">
          Contact support <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      </div>
    </div>
  );
}
