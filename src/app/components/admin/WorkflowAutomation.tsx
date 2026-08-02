import { useCallback, useEffect, useState } from "react";
import {
  Workflow, Zap, Clock, CheckCircle, XCircle, Loader2, Plus, Trash2,
  Play, GitBranch, Brain, Bell, RefreshCw,
  ChevronDown, Save, X,
} from "lucide-react";
import { PageHeader, Card, StatCard, LoadingState, ErrorState, EmptyState, StatusPill } from "../common/AdminUI";
import { Modal } from "../common/Modal";
import {
  workflowList, workflowCreate, workflowDelete, workflowExecute, workflowGet, workflowUpdate,
  workflowTasks, workflowScheduledJobs, workflowDeleteScheduledJob,
  workflowApprovals, workflowReviewApproval, workflowBusinessRules, workflowDeleteBusinessRule,
  workflowDashboard,
  type Workflow as WorkflowType, type TaskQueueItem, type ApprovalRequest, type BusinessRule,
} from "../../../lib/api";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";

type Tab = "workflows" | "tasks" | "approvals" | "rules" | "scheduler";

const NODE_TYPES = [
  { type: "trigger", label: "Trigger", icon: Zap, color: "#0ea5e9" },
  { type: "condition", label: "Condition", icon: GitBranch, color: "#f59e0b" },
  { type: "action", label: "Action", icon: Play, color: "#10b981" },
  { type: "delay", label: "Delay", icon: Clock, color: "#8b5cf6" },
  { type: "decision", label: "Decision", icon: ChevronDown, color: "#ec4899" },
  { type: "approval", label: "Approval", icon: CheckCircle, color: "#ef4444" },
  { type: "notification", label: "Notification", icon: Bell, color: "#06b6d4" },
  { type: "ai_step", label: "AI Step", icon: Brain, color: "#6366f1" },
  { type: "webhook", label: "Webhook", icon: GitBranch, color: "#14b8a6" },
];

const TRIGGER_TYPES = [
  "user_created", "user_login", "product_updated", "knowledge_uploaded",
  "ticket_created", "ticket_resolved", "training_completed", "conversation_ended",
  "webhook_received", "api_called", "scheduled", "manual", "low_confidence",
  "approval_needed", "document_uploaded",
];

const CATEGORIES = ["custom", "support", "onboarding", "knowledge", "training", "marketing", "follow_up", "compliance", "analytics", "operations"];

export function WorkflowAutomation() {
  const [tab, setTab] = useState<Tab>("workflows");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dashboard stats
  const [dashStats, setDashStats] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dash, tabData] = await Promise.all([
        workflowDashboard().catch(() => null),
        loadTabData(tab),
      ]);
      setDashStats(dash);
      setData(tabData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const loadTabData = async (t: Tab) => {
    switch (t) {
      case "workflows": return await workflowList();
      case "tasks": return await workflowTasks();
      case "approvals": return await workflowApprovals();
      case "rules": return await workflowBusinessRules();
      case "scheduler": return await workflowScheduledJobs();
      default: return null;
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Workflow Automation"
        description="AI-powered business process automation with multi-agent intelligence"
        icon={<Workflow className="w-5 h-5" />}
        actions={<Button type="button" variant="secondary" onClick={load}><RefreshCw className="w-4 h-4" /> Refresh</Button>}
      />

      {error ? <ErrorState message={error} /> : null}

      {/* Dashboard KPIs */}
      {dashStats ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
          <StatCard label="Queued Tasks" value={dashStats.task_queue?.queued || 0} icon={<Clock className="w-5 h-5" />} />
          <StatCard label="Processing" value={dashStats.task_queue?.processing || 0} icon={<Loader2 className="w-5 h-5" />} />
          <StatCard label="Failed" value={dashStats.task_queue?.failed || 0} icon={<XCircle className="w-5 h-5" />} trend={dashStats.task_queue?.failed > 0 ? "down" : "up"} />
          <StatCard label="Active Workflows" value={dashStats.workflows?.active || 0} icon={<Workflow className="w-5 h-5" />} />
          <StatCard label="Pending Approvals" value={dashStats.approvals?.pending || 0} icon={<CheckCircle className="w-5 h-5" />} hint={`${dashStats.approvals?.urgent || 0} urgent`} />
          <StatCard label="Active Agents" value={dashStats.agents?.active || 0} icon={<Brain className="w-5 h-5" />} />
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border overflow-x-auto scrollbar-thin">
        {([
          { value: "workflows", label: "Workflows", icon: Workflow },
          { value: "tasks", label: "Task Queue", icon: Clock },
          { value: "approvals", label: "Approvals", icon: CheckCircle },
          { value: "rules", label: "Business Rules", icon: GitBranch },
          { value: "scheduler", label: "Scheduler", icon: Clock },
        ] as const).map((t) => (
          <button key={t.value} type="button" onClick={() => setTab(t.value)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 whitespace-nowrap ${tab === t.value ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {loading ? <LoadingState /> : (
        <>
          {tab === "workflows" && data ? <WorkflowsView workflows={data} onChanged={load} /> : null}
          {tab === "tasks" && data ? <TasksView data={data} /> : null}
          {tab === "approvals" && data ? <ApprovalsView data={data} onChanged={load} /> : null}
          {tab === "rules" && data ? <RulesView rules={data} onChanged={load} /> : null}
          {tab === "scheduler" && data ? <SchedulerView jobs={data} onChanged={load} /> : null}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workflows View
// ---------------------------------------------------------------------------
function WorkflowsView({ workflows, onChanged }: { workflows: WorkflowType[]; onChanged: () => void }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingWf, setEditingWf] = useState<WorkflowType | null>(null);
  const [form, setForm] = useState({ name: "", description: "", category: "custom", trigger_type: "manual" });
  const [saving, setSaving] = useState(false);

  // Builder state
  const [nodes, setNodes] = useState<Array<Record<string, unknown>>>([]);
  const [edges, setEdges] = useState<Array<Record<string, unknown>>>([]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await workflowCreate({ ...form, nodes: [], edges: [] });
      setCreateOpen(false);
      setForm({ name: "", description: "", category: "custom", trigger_type: "manual" });
      onChanged();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const openBuilder = async (wf: WorkflowType) => {
    setEditingWf(wf);
    try {
      const full = await workflowGet(wf.id);
      setNodes((full.nodes as Array<Record<string, unknown>>) || []);
      setEdges((full.edges as Array<Record<string, unknown>>) || []);
    } catch { setNodes([]); setEdges([]); }
    setBuilderOpen(true);
  };

  const saveBuilder = async () => {
    if (!editingWf) return;
    setSaving(true);
    try {
      await workflowUpdate(editingWf.id, { nodes, edges, status: "draft" });
      setBuilderOpen(false);
      onChanged();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const addNode = (nodeType: string) => {
    const nodeDef = NODE_TYPES.find((n) => n.type === nodeType);
    const id = `node_${Date.now()}`;
    setNodes((prev) => [...prev, { id, type: nodeType, label: nodeDef?.label || nodeType, config: {} }]);
  };

  const removeNode = (nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
  };

  const handleExecute = async (wf: WorkflowType) => {
    try { await workflowExecute(wf.id, {}); onChanged(); } catch { /* ignore */ }
  };

  const handleDelete = async (wf: WorkflowType) => {
    if (!window.confirm(`Delete workflow "${wf.name}"?`)) return;
    try { await workflowDelete(wf.id); onChanged(); } catch { /* ignore */ }
  };

  const handleToggleStatus = async (wf: WorkflowType) => {
    try {
      await workflowUpdate(wf.id, { status: wf.status === "active" ? "paused" : "active" });
      onChanged();
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" /> New Workflow</Button>
      </div>
      {workflows.length === 0 ? <Card><EmptyState title="No workflows" description="Create your first workflow to automate business processes." icon={<Workflow className="w-5 h-5" />} /></Card> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {workflows.map((wf) => (
            <Card key={wf.id}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium truncate">{wf.name}</h3>
                  <p className="text-[10px] text-muted-foreground capitalize">{wf.category} · v{wf.version}</p>
                </div>
                <StatusPill status={wf.status} />
              </div>
              {wf.description ? <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{wf.description}</p> : null}
              <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground mb-2">
                <div>Trigger: <span className="font-medium text-foreground">{wf.trigger_type.replace(/_/g, " ")}</span></div>
                <div>Executions: <span className="font-medium text-foreground">{wf.execution_count}</span></div>
                <div>Success: <span className="font-medium text-foreground">{wf.success_rate}%</span></div>
                <div>24h: <span className="font-medium text-primary">{wf.completed_24h}</span> ok / <span className="font-medium text-destructive">{wf.failed_24h}</span> fail</div>
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => openBuilder(wf)} className="flex-1 text-xs px-2 py-1.5 rounded border border-border hover:bg-accent">Builder</button>
                <button type="button" onClick={() => handleExecute(wf)} className="text-xs px-2 py-1.5 rounded border border-primary/30 text-primary hover:bg-primary/10" title="Execute" aria-label={`Execute workflow ${wf.name}`}><Play className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => handleToggleStatus(wf)} className={`text-xs px-2 py-1.5 rounded border ${wf.status === "active" ? "border-warning/30 text-warning" : "border-primary/30 text-primary"}`}>{wf.status === "active" ? "Pause" : "Activate"}</button>
                <button type="button" onClick={() => handleDelete(wf)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive" aria-label={`Delete workflow ${wf.name}`} title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Workflow" size="sm"
        footer={<><Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button type="button" onClick={handleCreate} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create</Button></>}>
        <div className="space-y-3">
          <div><label className="block text-xs text-muted-foreground mb-1">Name</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          </div>
          <div><label className="block text-xs text-muted-foreground mb-1">Description</label>
            <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-muted-foreground mb-1">Category</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div><label className="block text-xs text-muted-foreground mb-1">Trigger</label>
              <select value={form.trigger_type} onChange={(e) => setForm({ ...form, trigger_type: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm">
                {TRIGGER_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
              </select>
            </div>
          </div>
        </div>
      </Modal>

      {/* Workflow Builder Modal */}
      <Modal open={builderOpen} onClose={() => setBuilderOpen(false)} title={`Builder: ${editingWf?.name ?? ""}`} size="lg"
        footer={<><Button type="button" variant="secondary" onClick={() => setBuilderOpen(false)}>Close</Button>
          <Button type="button" onClick={saveBuilder} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save</Button></>}>
        <div className="space-y-3">
          {/* Node palette */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Add Node:</label>
            <div className="flex flex-wrap gap-1.5">
              {NODE_TYPES.map((nt) => (
                <button key={nt.type} type="button" onClick={() => addNode(nt.type)}
                  className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border border-border hover:bg-accent">
                  <nt.icon className="w-3 h-3" style={{ color: nt.color }} /> {nt.label}
                </button>
              ))}
            </div>
          </div>
          {/* Canvas */}
          <div className="rounded-lg border border-border bg-accent/20 p-3 min-h-[300px]">
            {nodes.length === 0 ? <p className="text-xs text-muted-foreground text-center py-12">Add nodes from the palette above to build your workflow.</p> : (
              <div className="space-y-2">
                {nodes.map((node, i) => {
                  const nt = NODE_TYPES.find((n) => n.type === node.type);
                  return (
                    <div key={String(node.id)} className="flex items-center gap-2 bg-card rounded-lg border border-border p-2.5">
                      <span className="text-[10px] font-mono text-muted-foreground w-6">{i + 1}</span>
                      <div className="w-7 h-7 rounded flex items-center justify-center shrink-0" style={{ backgroundColor: `${nt?.color || "#6b7280"}20` }}>
                        {nt ? <nt.icon className="w-3.5 h-3.5" style={{ color: nt.color }} /> : null}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{String(node.label || node.type)}</p>
                        <p className="text-[9px] text-muted-foreground capitalize">{String(node.type)}</p>
                      </div>
                      <button type="button" onClick={() => removeNode(String(node.id))} className="p-1 rounded hover:bg-destructive/10 text-destructive" aria-label={`Remove node ${String(node.label || node.type)}`} title="Remove node"><X className="w-3.5 h-3.5" /></button>
                      {i < nodes.length - 1 ? <ChevronDown className="w-3 h-3 text-muted-foreground absolute" /> : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            <GitBranch className="w-3 h-3 inline mr-1" />
            {nodes.length} nodes · {edges.length} connections · Auto-saves version on save
          </p>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tasks View
// ---------------------------------------------------------------------------
function TasksView({ data }: { data: { tasks: TaskQueueItem[]; total: number; summary: Array<Record<string, unknown>> } }) {
  return (
    <div className="space-y-4">
      {data.summary?.length > 0 ? (
        <Card><h3 className="text-sm font-semibold mb-2">Queue Summary by Type</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {data.summary.map((s, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-xs">
                <p className="font-medium capitalize">{String(s.task_type || "").replace(/_/g, " ")}</p>
                <div className="flex gap-2 mt-1 text-[10px]">
                  <span className="text-warning">Q:{String(s.queued || 0)}</span>
                  <span className="text-primary">C:{String(s.completed || 0)}</span>
                  <span className="text-destructive">F:{String(s.failed || 0)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      {data.tasks?.length === 0 ? <Card><EmptyState title="No tasks" icon={<Clock className="w-5 h-5" />} /></Card> : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-accent/50 border-b border-border"><tr>
                <th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Priority</th><th className="px-3 py-2 text-left hidden sm:table-cell">Created</th>
                <th className="px-3 py-2 text-left hidden sm:table-cell">Duration</th><th className="px-3 py-2 text-left">Retries</th>
              </tr></thead>
              <tbody>
                {data.tasks?.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0 hover:bg-accent/20">
                    <td className="px-3 py-2 capitalize">{t.task_type.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2"><StatusPill status={t.status} /></td>
                    <td className="px-3 py-2">{t.priority <= 3 ? <span className="text-destructive font-medium">{t.priority}</span> : t.priority}</td>
                    <td className="px-3 py-2 hidden sm:table-cell text-muted-foreground">{t.created_at ? new Date(t.created_at).toLocaleString() : ""}</td>
                    <td className="px-3 py-2 hidden sm:table-cell text-muted-foreground">{t.duration_ms ? `${t.duration_ms}ms` : "—"}</td>
                    <td className="px-3 py-2">{t.retry_count > 0 ? <span className="text-warning">{t.retry_count}/{t.max_retries}</span> : "0"}</td>
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

// ---------------------------------------------------------------------------
// Approvals View
// ---------------------------------------------------------------------------
function ApprovalsView({ data, onChanged }: { data: { approvals: ApprovalRequest[]; total: number }; onChanged: () => void }) {
  const handleReview = async (a: ApprovalRequest, status: "approved" | "rejected") => {
    try { await workflowReviewApproval(a.id, status); onChanged(); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      {data.approvals?.length === 0 ? <Card><EmptyState title="No pending approvals" description="All caught up!" icon={<CheckCircle className="w-5 h-5" />} /></Card> : (
        <div className="space-y-2">
          {data.approvals?.map((a) => (
            <Card key={a.id} className={`border-l-4 ${a.priority === "urgent" ? "border-l-destructive" : "border-l-warning"}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="secondary" className="capitalize">{a.approval_type.replace(/_/g, " ")}</Badge>
                    {a.priority === "urgent" ? <Badge variant="destructive">URGENT</Badge> : null}
                    <span className="text-xs font-medium">{a.entity_name || a.summary.slice(0, 40)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{a.summary}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Requested by {a.requested_by_name || "system"} · {a.created_at ? new Date(a.created_at).toLocaleString() : ""}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button type="button" onClick={() => handleReview(a, "approved")} className="text-xs px-3 py-1.5 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Approve</button>
                  <button type="button" onClick={() => handleReview(a, "rejected")} className="text-xs px-3 py-1.5 rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> Reject</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rules View
// ---------------------------------------------------------------------------
function RulesView({ rules, onChanged }: { rules: BusinessRule[]; onChanged: () => void }) {
  const handleDelete = async (r: BusinessRule) => {
    if (!window.confirm(`Delete rule "${r.name}"?`)) return;
    try { await workflowDeleteBusinessRule(r.id); onChanged(); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      {rules.length === 0 ? <Card><EmptyState title="No business rules" description="Create IF/THEN/ELSE rules to automate decisions." icon={<GitBranch className="w-5 h-5" />} /></Card> : (
        <div className="space-y-2">
          {rules.map((r) => (
            <Card key={r.id}>
              <div className="flex items-start gap-3">
                <GitBranch className={`w-4 h-4 mt-0.5 shrink-0 ${r.is_active ? "text-primary" : "text-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium">{r.name}</h3>
                    <Badge variant="secondary" className="capitalize">{r.rule_type}</Badge>
                    {r.is_active ? <Badge>Active</Badge> : null}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Event: {r.event_type} · Priority: {r.priority} · Executed {r.execution_count}×</p>
                  <div className="flex items-center gap-1 mt-1 text-[10px]">
                    <span className="text-muted-foreground">IF</span>
                    <span className="px-1.5 py-0.5 rounded bg-accent/50">{r.conditions.length} condition(s)</span>
                    <span className="text-muted-foreground">THEN</span>
                    <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary">{r.actions.length} action(s)</span>
                    {r.else_actions && r.else_actions.length > 0 ? <><span className="text-muted-foreground">ELSE</span><span className="px-1.5 py-0.5 rounded bg-accent/50">{r.else_actions.length}</span></> : null}
                  </div>
                </div>
                <button type="button" onClick={() => handleDelete(r)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive shrink-0" aria-label={`Delete rule ${r.name}`} title="Delete rule"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scheduler View
// ---------------------------------------------------------------------------
function SchedulerView({ jobs, onChanged }: { jobs: Array<Record<string, unknown>>; onChanged: () => void }) {
  const handleDelete = async (jobId: string) => {
    if (!window.confirm("Delete this scheduled job?")) return;
    try { await workflowDeleteScheduledJob(jobId); onChanged(); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      {jobs.length === 0 ? <Card><EmptyState title="No scheduled jobs" description="Schedule recurring or one-time automation jobs." icon={<Clock className="w-5 h-5" />} /></Card> : (
        <div className="space-y-2">
          {jobs.map((j) => (
            <Card key={String(j.id)}>
              <div className="flex items-start gap-3">
                <Clock className={`w-4 h-4 mt-0.5 shrink-0 ${j.is_active ? "text-primary" : "text-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium">{String(j.name || "Job")}</h3>
                    <Badge variant="secondary" className="capitalize">{String(j.job_type || "")}</Badge>
                    {j.is_active ? <Badge>Active</Badge> : null}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {j.cron_expression ? `Cron: ${j.cron_expression}` : j.interval_seconds ? `Every ${j.interval_seconds}s` : j.scheduled_for ? `At: ${j.scheduled_for}` : ""}
                    {" · "}Type: {String(j.task_type || "")}
                    {" · "}Runs: {String(j.run_count || 0)}
                  </p>
                  {j.next_run_at ? <p className="text-[10px] text-primary mt-0.5">Next: {new Date(String(j.next_run_at)).toLocaleString()}</p> : null}
                </div>
                <button type="button" onClick={() => handleDelete(String(j.id))} className="p-1.5 rounded hover:bg-destructive/10 text-destructive shrink-0" aria-label={`Delete job ${String(j.name || "Job")}`} title="Delete job"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
