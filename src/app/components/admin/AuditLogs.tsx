import { useCallback, useEffect, useState } from "react";
import { History, Download, Filter } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import {
  PageHeader,
  Card,
  EmptyState,
  LoadingState,
  ErrorState,
  btnClass,
} from "../common/AdminUI";

type AuditLog = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string | null;
};

const AUDIT_ACTIONS = [
  "INSERT", "UPDATE", "DELETE",
  "USER_LOGIN", "USER_LOGOUT", "USER_REGISTER", "USER_ROLE_CHANGE", "USER_SUSPEND", "USER_RESET_PASSWORD",
  "DOCUMENT_UPLOAD", "DOCUMENT_APPROVE", "DOCUMENT_REJECT", "DOCUMENT_DELETE", "DOCUMENT_REPLACE",
  "PRODUCT_CREATE", "PRODUCT_UPDATE", "PRODUCT_DELETE", "PRODUCT_ARCHIVE",
  "FAQ_CREATE", "FAQ_UPDATE", "FAQ_DELETE", "FAQ_APPROVE",
  "POLICY_CREATE", "POLICY_UPDATE", "POLICY_DELETE",
  "TRAINING_CREATE", "TRAINING_UPDATE", "TRAINING_DELETE", "TRAINING_ENROLL", "TRAINING_COMPLETE",
  "PROMPT_CHANGE", "AI_CONFIG_CHANGE", "SAFETY_RULE_CHANGE",
  "PERMISSION_CHANGE", "ROLE_PERMISSION_CHANGE",
  "SUPPORT_TICKET_CREATE", "SUPPORT_TICKET_UPDATE", "SUPPORT_TICKET_ASSIGN", "SUPPORT_TICKET_ESCALATE", "SUPPORT_TICKET_RESOLVE",
  "INTEGRATION_UPDATE", "SETTINGS_UPDATE", "API_KEY_ROTATE",
];

const AUDIT_ENTITIES = [
  "profiles", "products", "faqs", "policies", "distributor_training",
  "knowledge_documents", "knowledge_chunks", "knowledge_embeddings",
  "leads", "support_tickets", "support_ticket_notes",
  "chat_conversations", "chat_messages",
  "ai_configuration", "safety_rules", "role_permissions",
  "organization_settings", "admin_api_keys", "training_courses",
  "notifications", "audit_logs",
];

export function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState("");
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
      let q = supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (actionFilter) q = q.eq("action", actionFilter);
      if (entityFilter) q = q.eq("entity_type", entityFilter);
      const { data, error: err } = await q;
      if (err) throw err;
      setLogs((data ?? []) as AuditLog[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [actionFilter, entityFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const exportCsv = () => {
    const headers = ["created_at", "action", "entity_type", "entity_id", "created_by"];
    const rows = logs.map((l) =>
      [l.created_at, l.action, l.entity_type, l.entity_id, l.created_by]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dayjoy-audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Audit Logs"
        description="Every create, update, and delete on business data is recorded here."
        icon={<History className="w-5 h-5" />}
        actions={
          <button
            type="button"
            className={btnClass.secondary}
            onClick={exportCsv}
            disabled={logs.length === 0}
          >
            <Download className="w-4 h-4" aria-hidden="true" /> Export CSV
          </button>
        }
      />

      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div>
          <label htmlFor="dj-audit-action" className="block text-xs font-medium text-muted-foreground mb-1">
            Action
          </label>
          <select
            id="dj-audit-action"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 max-h-12"
          >
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>{a.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="dj-audit-entity" className="block text-xs font-medium text-muted-foreground mb-1">
            Entity type
          </label>
          <select
            id="dj-audit-entity"
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 max-h-12"
          >
            <option value="">All entities</option>
            {AUDIT_ENTITIES.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </div>
        <button type="button" className={btnClass.secondary} onClick={refresh}>
          <Filter className="w-4 h-4" aria-hidden="true" /> Refresh
        </button>
      </div>

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {loading ? (
        <LoadingState label="Loading audit logs…" />
      ) : logs.length === 0 ? (
        <Card>
          <EmptyState
            title="No audit logs yet"
            description="Once admins start creating or editing records, those actions will appear here."
            icon={<History className="w-5 h-5" />}
          />
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Timestamp</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">By</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-0 hover:bg-accent/30 align-top">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {l.created_at ? new Date(l.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          l.action === "DELETE" || l.action.includes("DELETE") || l.action.includes("REVOKE")
                            ? "bg-destructive/10 text-destructive"
                            : l.action === "INSERT" || l.action.includes("CREATE") || l.action.includes("UPLOAD") || l.action.includes("REGISTER")
                              ? "bg-primary/10 text-primary"
                              : l.action.includes("ESCALATE") || l.action.includes("SUSPEND") || l.action.includes("REJECT")
                                ? "bg-warning/15 text-warning"
                                : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {l.action.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{l.entity_type}</div>
                      <div className="text-xs text-muted-foreground font-mono">{l.entity_id ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground font-mono">
                      {l.created_by ? l.created_by.slice(0, 8) + "…" : "system"}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <pre className="text-xs text-muted-foreground max-h-24 overflow-auto">
                        {l.metadata ? JSON.stringify(l.metadata, null, 2) : "—"}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
