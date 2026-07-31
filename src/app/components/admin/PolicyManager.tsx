import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Plus, Search, Edit, Trash2 } from "lucide-react";
import {
  type Policy,
  createPolicy,
  deletePolicy,
  getPoliciesForManager,
  updatePolicy,
} from "../../lib/db";

type ApprovalStatus = "approved" | "pending" | "rejected";

function normalizeStatus(value: string): ApprovalStatus {
  const v = value.trim().toLowerCase();
  const allowed = new Set<ApprovalStatus>(["approved", "pending", "rejected"]);
  return allowed.has(v as ApprovalStatus) ? (v as ApprovalStatus) : "pending";
}

export function PolicyManager() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const rows = await getPoliciesForManager();
        if (!cancelled) setPolicies(rows);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load policies";
        if (!cancelled) setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredPolicies = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return policies;

    return policies.filter((p) => {
      const haystack = [p.topic, p.content, p.policy_id ?? "", p.approval_status ?? ""].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [policies, query]);

  async function refresh() {
    const rows = await getPoliciesForManager();
    setPolicies(rows);
  }

  async function handleAdd() {
    const topic = window.prompt("Policy topic", "New Policy Topic");
    if (!topic) return;

    const content = window.prompt("Policy content", "New policy content");
    if (!content) return;

    const status = normalizeStatus(
      window.prompt("Status (approved|pending|rejected)", "pending") ?? "pending"
    );

    setError(null);
    try {
      await createPolicy({ topic, content, approval_status: status });
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create policy";
      setError(message);
    }
  }

  async function handleEdit(p: Policy) {
    if (!p.id) return;

    const nextTopic = window.prompt("Policy topic", p.topic);
    if (nextTopic === null) return;

    const nextContent = window.prompt("Policy content", p.content);
    if (nextContent === null) return;

    const nextStatus = normalizeStatus(
      window.prompt("Status (approved|pending|rejected)", p.approval_status ?? "pending") ??
        (p.approval_status ?? "pending")
    );

    setError(null);
    try {
      await updatePolicy(p.id, { topic: nextTopic, content: nextContent, approval_status: nextStatus });
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update policy";
      setError(message);
    }
  }

  async function handleDelete(p: Policy) {
    if (!p.id) return;
    const ok = window.confirm("Delete this policy?");
    if (!ok) return;

    setError(null);
    try {
      await deletePolicy(p.id);
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete policy";
      setError(message);
    }
  }

  async function handleSetStatus(p: Policy, next: ApprovalStatus) {
    if (!p.id) return;
    setError(null);
    try {
      await updatePolicy(p.id, { approval_status: next });
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update policy status";
      setError(message);
    }
  }

  return (
    <div className="p-8 bg-background min-h-full">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-semibold">Policy Manager</h1>
            <p className="text-muted-foreground">Control approved rules used by Dayjoy AI Assist.</p>
          </div>
          <button
            className="bg-primary text-primary-foreground rounded-xl px-5 py-3 flex items-center gap-2"
            type="button"
            onClick={handleAdd}
          >
            <Plus className="w-4 h-4" />
            Add Policy
          </button>
        </div>

        <div className="relative max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input
            className="w-full pl-12 pr-4 py-3 bg-card border border-border rounded-xl outline-none focus:ring-2 focus:ring-ring"
            placeholder="Search policies..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {error ? (
          <div className="bg-card border border-border rounded-2xl p-4 text-red-600 text-sm">{error}</div>
        ) : null}

        {loading ? (
          <div className="text-sm text-muted-foreground py-6">Loading policies…</div>
        ) : filteredPolicies.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6">No policies found.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {filteredPolicies.map((p) => {
              const status = p.approval_status ?? "pending";
              const pill =
                status === "approved"
                  ? "bg-green-100 text-green-700"
                  : status === "pending"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-slate-100 text-slate-700";

              return (
                <div key={p.id ?? p.topic} className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-3">
                    <ShieldCheck className="w-6 h-6 text-primary" />
                    <h2 className="text-xl font-semibold">{p.topic}</h2>
                  </div>

                  <p className="text-sm text-muted-foreground mb-4 line-clamp-3">
                    {p.content}
                  </p>

                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className={`px-3 py-1 ${pill} text-xs rounded-full`}>
                      {status}
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="px-2 py-1 text-xs border border-border rounded-lg hover:border-primary"
                        onClick={() => handleSetStatus(p, "pending")}
                      >
                        Pending
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 text-xs border border-border rounded-lg hover:border-primary"
                        onClick={() => handleSetStatus(p, "approved")}
                      >
                        Approved
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 text-xs border border-border rounded-lg hover:border-primary"
                        onClick={() => handleSetStatus(p, "rejected")}
                      >
                        Rejected
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      className="p-2 hover:bg-accent rounded-lg transition-colors"
                      onClick={() => handleEdit(p)}
                      aria-label="Edit policy"
                    >
                      <Edit className="w-4 h-4 text-muted-foreground" />
                    </button>
                    <button
                      type="button"
                      className="p-2 hover:bg-accent rounded-lg transition-colors"
                      onClick={() => handleDelete(p)}
                      aria-label="Delete policy"
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
