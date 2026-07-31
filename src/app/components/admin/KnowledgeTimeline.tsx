import { useCallback, useEffect, useState } from "react";
import { GitBranch, RefreshCw, FileText, Package, FileQuestion, Shield, GraduationCap } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import {
  PageHeader,
  Card,
  EmptyState,
  LoadingState,
  ErrorState,
  StatusPill,
  btnClass,
} from "../common/AdminUI";

type TimelineEvent = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string | null;
};

const ENTITY_ICONS: Record<string, typeof FileText> = {
  products: Package,
  faqs: FileQuestion,
  policies: Shield,
  distributor_training: GraduationCap,
  knowledge_documents: FileText,
};

/**
 * KnowledgeTimeline — chronological feed of every knowledge change.
 *
 * Reads from `audit_logs` (which is populated by the `log_audit()` trigger
 * on every INSERT/UPDATE/DELETE). Each event is rendered as a timeline
 * row with icon, entity type, action, author, and timestamp.
 *
 * This is the "knowledge timeline" feature — gives admins a single
 * view of "what changed in the knowledge base, when, and by whom."
 */
export function KnowledgeTimeline() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }
    try {
      // Only show knowledge-related entities (filter out chat/lead noise)
      const knowledgeEntities = [
        "products",
        "faqs",
        "policies",
        "distributor_training",
        "knowledge_documents",
        "objection_handling",
        "social_templates",
      ];
      let q = supabase
        .from("audit_logs")
        .select("*")
        .in("entity_type", knowledgeEntities)
        .order("created_at", { ascending: false })
        .limit(100);
      if (entityFilter) q = q.eq("entity_type", entityFilter);
      const { data, error: err } = await q;
      if (err) throw err;
      setEvents((data ?? []) as TimelineEvent[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load timeline");
    } finally {
      setLoading(false);
    }
  }, [entityFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Knowledge Timeline"
        description="Chronological feed of every change to products, FAQs, policies, training, and documents."
        icon={<GitBranch className="w-5 h-5" />}
        actions={
          <button type="button" className={btnClass.secondary} onClick={refresh}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Refresh
          </button>
        }
      />

      <div className="flex items-end gap-2 mb-4">
        <div>
          <label htmlFor="dj-timeline-filter" className="block text-xs font-medium text-muted-foreground mb-1">
            Filter by type
          </label>
          <select
            id="dj-timeline-filter"
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">All knowledge</option>
            <option value="products">Products</option>
            <option value="faqs">FAQs</option>
            <option value="policies">Policies</option>
            <option value="distributor_training">Training</option>
            <option value="knowledge_documents">Documents</option>
          </select>
        </div>
      </div>

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {loading ? (
        <LoadingState label="Loading timeline…" />
      ) : events.length === 0 ? (
        <Card>
          <EmptyState
            title="No knowledge changes yet"
            description="When admins create or edit products, FAQs, policies, training, or documents, those changes will appear here in chronological order."
            icon={<GitBranch className="w-5 h-5" />}
          />
        </Card>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-4 top-2 bottom-2 w-px bg-border" aria-hidden="true" />

          <ul className="space-y-3">
            {events.map((e) => {
              const Icon = ENTITY_ICONS[e.entity_type] ?? FileText;
              return (
                <li key={e.id} className="relative pl-12">
                  <div className="absolute left-0 top-0 w-8 h-8 rounded-full bg-accent flex items-center justify-center ring-4 ring-background">
                    <Icon className="w-4 h-4 text-primary" aria-hidden="true" />
                  </div>
                  <Card>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {e.entity_type.replace(/_/g, " ")}
                          </span>
                          <StatusPill status={e.action} />
                          {e.entity_id ? (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              #{e.entity_id.slice(0, 8)}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {e.created_at ? new Date(e.created_at).toLocaleString() : ""}
                          {" · by "}
                          <span className="font-mono">
                            {e.created_by ? e.created_by.slice(0, 8) + "…" : "system"}
                          </span>
                        </p>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
