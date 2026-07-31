import { useCallback, useEffect, useState } from "react";
import { CheckSquare, RefreshCw, Check, X, AlertCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import {
  PageHeader,
  Card,
  EmptyState,
  LoadingState,
  ErrorState,
  StatCard,
  btnClass,
} from "../common/AdminUI";

type PendingItem = {
  id: string;
  table: "products" | "faqs" | "policies" | "distributor_training" | "knowledge_documents";
  title: string;
  preview: string;
  status: string;
  created_at: string | null;
};

const TABLES: { key: PendingItem["table"]; label: string; titleField: string; previewFields: string[] }[] = [
  { key: "products", label: "Product", titleField: "product_name", previewFields: ["category", "benefits"] },
  { key: "faqs", label: "FAQ", titleField: "question", previewFields: ["answer"] },
  { key: "policies", label: "Policy", titleField: "topic", previewFields: ["content"] },
  { key: "distributor_training", label: "Training", titleField: "title", previewFields: ["content"] },
  { key: "knowledge_documents", label: "Document", titleField: "file_name", previewFields: ["file_type"] },
];

export function ApprovalQueue() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }
    try {
      const all: PendingItem[] = [];
      const newCounts: Record<string, number> = {};
      for (const t of TABLES) {
        const { data, error: err } = await supabase
          .from(t.key)
          .select("*")
          .eq("approval_status", "pending")
          .order("created_at", { ascending: false })
          .limit(20);
        if (err) continue;
        newCounts[t.key] = data?.length ?? 0;
        for (const row of data ?? []) {
          const title = String(row[t.titleField] ?? "Untitled");
          const preview = t.previewFields
            .map((f) => row[f])
            .filter(Boolean)
            .join(" · ")
            .slice(0, 200);
          all.push({
            id: row.id,
            table: t.key,
            title,
            preview,
            status: row.approval_status,
            created_at: row.created_at,
          });
        }
      }
      all.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      setItems(all);
      setCounts(newCounts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load approval queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setApproval = async (item: PendingItem, status: "approved" | "rejected") => {
    if (!supabase) return;
    try {
      const { error: err } = await supabase
        .from(item.table)
        .update({ approval_status: status })
        .eq("id", item.id);
      if (err) throw err;
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setCounts((prev) => ({
        ...prev,
        [item.table]: Math.max(0, (prev[item.table] ?? 0) - 1),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update approval");
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Approval Queue"
        description="Review and approve pending knowledge before it goes live to users."
        icon={<CheckSquare className="w-5 h-5" />}
        actions={
          <button type="button" className={btnClass.secondary} onClick={refresh}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Refresh
          </button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {TABLES.map((t) => (
          <StatCard key={t.key} label={t.label} value={counts[t.key] ?? 0} />
        ))}
      </div>

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {loading ? (
        <LoadingState label="Loading approval queue…" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title="Queue is empty"
            description="When admins add new products, FAQs, policies, training, or documents, pending items appear here."
            icon={<CheckSquare className="w-5 h-5" />}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={`${item.table}-${item.id}`}>
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent text-accent-foreground uppercase tracking-wide">
                      {item.table.replace(/_/g, " ")}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-warning/15 text-warning">
                      {item.status}
                    </span>
                    {item.created_at ? (
                      <span className="text-xs text-muted-foreground">
                        {new Date(item.created_at).toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                  <p className="font-medium text-sm">{item.title}</p>
                  {item.preview ? (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.preview}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setApproval(item, "approved")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
                  >
                    <Check className="w-4 h-4" aria-hidden="true" /> Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => setApproval(item, "rejected")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-destructive text-destructive text-sm font-medium hover:bg-destructive/10"
                  >
                    <X className="w-4 h-4" aria-hidden="true" /> Reject
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">
            Approving an item immediately makes it visible to authenticated users via the RLS policy
            <code className="mx-1">approval_status = 'approved'</code>.
            All approvals are recorded in the audit log.
          </p>
        </div>
      </Card>
    </div>
  );
}
