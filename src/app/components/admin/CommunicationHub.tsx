import { useCallback, useEffect, useState } from "react";
import {
  Send, FileText, Zap, Plug, Webhook, BarChart3, Plus, Trash2,
  Loader2, CheckCircle, XCircle, Mail, MessageSquare, Smartphone,
  Bell, RefreshCw, Play,
} from "lucide-react";
import { PageHeader, Card, StatCard, LoadingState, ErrorState, EmptyState, StatusPill } from "../common/AdminUI";
import { Modal } from "../common/Modal";
import { Button } from "../ui/button";
import { LineChart, BarChart, DonutChart, type LineChartPoint, type BarChartItem, type DonutSlice } from "../common/Charts";
import {
  commListCampaigns, commCreateCampaign, commDeleteCampaign,
  commListTemplates, commDeleteTemplate,
  commListAutomations, commCreateAutomation, commDeleteAutomation, commUpdateAutomation,
  commListIntegrations, commUpdateIntegration,
  commListWebhooks, commCreateWebhook, commDeleteWebhook, commTestWebhook, commWebhookLogs,
  commAnalytics,
  type Campaign, type MessageTemplate, type AutomationWorkflow,
  type IntegrationConnector, type WebhookEndpoint,
} from "../../../lib/api";

type Tab = "campaigns" | "templates" | "automations" | "integrations" | "webhooks" | "analytics";

const TABS: { value: Tab; label: string; icon: typeof Send }[] = [
  { value: "campaigns", label: "Campaigns", icon: Send },
  { value: "templates", label: "Templates", icon: FileText },
  { value: "automations", label: "Automations", icon: Zap },
  { value: "integrations", label: "Integrations", icon: Plug },
  { value: "webhooks", label: "Webhooks", icon: Webhook },
  { value: "analytics", label: "Analytics", icon: BarChart3 },
];

const CHANNEL_ICONS: Record<string, typeof Send> = {
  whatsapp: MessageSquare, email: Mail, sms: Smartphone, push: Bell, in_app: Bell, multi: Send, all: Send,
};

export function CommunicationHub() {
  const [tab, setTab] = useState<Tab>("campaigns");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      switch (tab) {
        case "campaigns": setData(await commListCampaigns()); break;
        case "templates": setData(await commListTemplates()); break;
        case "automations": setData(await commListAutomations()); break;
        case "integrations": setData(await commListIntegrations()); break;
        case "webhooks": setData(await commListWebhooks()); break;
        case "analytics": setData(await commAnalytics(30)); break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Communication Hub"
        description="Campaigns, templates, automations, integrations, webhooks, and analytics"
        icon={<Send className="w-5 h-5" />}
        actions={<Button type="button" variant="secondary" onClick={load}><RefreshCw className="w-4 h-4" /> Refresh</Button>}
      />

      {error ? <ErrorState message={error} /> : null}

      <div className="flex gap-1 mb-4 border-b border-border overflow-x-auto scrollbar-thin">
        {TABS.map((t) => (
          <button key={t.value} type="button" onClick={() => setTab(t.value)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 whitespace-nowrap ${tab === t.value ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {loading ? <LoadingState /> : (
        <>
          {tab === "campaigns" && data ? <CampaignsView campaigns={data} onChanged={load} /> : null}
          {tab === "templates" && data ? <TemplatesView templates={data} onChanged={load} /> : null}
          {tab === "automations" && data ? <AutomationsView workflows={data} onChanged={load} /> : null}
          {tab === "integrations" && data ? <IntegrationsView connectors={data} onChanged={load} /> : null}
          {tab === "webhooks" && data ? <WebhooksView webhooks={data} onChanged={load} /> : null}
          {tab === "analytics" && data ? <AnalyticsView data={data} /> : null}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Campaigns View
// ---------------------------------------------------------------------------
function CampaignsView({ campaigns, onChanged }: { campaigns: Campaign[]; onChanged: () => void }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", channel_type: "email", body: "", scheduled_at: "" });
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.body.trim()) return;
    setSaving(true);
    try {
      await commCreateCampaign({
        name: form.name, channel_type: form.channel_type, body: form.body,
        scheduled_at: form.scheduled_at || undefined,
      });
      setCreateOpen(false);
      setForm({ name: "", channel_type: "email", body: "", scheduled_at: "" });
      onChanged();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleDelete = async (c: Campaign) => {
    if (!window.confirm(`Delete campaign "${c.name}"?`)) return;
    try { await commDeleteCampaign(c.id); onChanged(); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" /> New Campaign</Button>
      </div>
      {campaigns.length === 0 ? <Card><EmptyState title="No campaigns" icon={<Send className="w-5 h-5" />} /></Card> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {campaigns.map((c) => {
            const Icon = CHANNEL_ICONS[c.channel_type] || Send;
            return (
              <Card key={c.id}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-medium truncate">{c.name}</h3>
                  </div>
                  <button type="button" onClick={() => handleDelete(c)} className="p-1 rounded hover:bg-destructive/10 text-destructive" aria-label={`Delete channel ${c.name}`} title="Delete channel"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <StatusPill status={c.status} />
                  <span className="text-[10px] text-muted-foreground">{c.channel_type}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  <div><span className="text-muted-foreground">Sent:</span> {c.sent_count}</div>
                  <div><span className="text-muted-foreground">Delivered:</span> {c.delivered_count}</div>
                  <div><span className="text-muted-foreground">Read:</span> {c.read_count}</div>
                  <div><span className="text-muted-foreground">Failed:</span> {c.failed_count}</div>
                </div>
                {c.delivery_rate_pct > 0 ? (
                  <div className="mt-2 pt-2 border-t border-border text-[10px] text-muted-foreground">
                    Delivery: {c.delivery_rate_pct}% · Open: {c.open_rate_pct}% · Click: {c.click_rate_pct}%
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Campaign" size="md"
        footer={<><Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button type="button" onClick={handleCreate} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create</Button></>}>
        <div className="space-y-3">
          <div><label className="block text-xs text-muted-foreground mb-1">Name</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          </div>
          <div><label className="block text-xs text-muted-foreground mb-1">Channel</label>
            <select value={form.channel_type} onChange={(e) => setForm({ ...form, channel_type: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm">
              <option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="push">Push</option><option value="in_app">In-App</option>
            </select>
          </div>
          <div><label className="block text-xs text-muted-foreground mb-1">Message Body</label>
            <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={4} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          </div>
          <div><label className="block text-xs text-muted-foreground mb-1">Schedule (optional)</label>
            <input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Templates View
// ---------------------------------------------------------------------------
function TemplatesView({ templates, onChanged }: { templates: MessageTemplate[]; onChanged: () => void }) {
  const [filter, setFilter] = useState("");
  const categories = [...new Set(templates.map((t) => t.category))].sort();
  const filtered = filter ? templates.filter((t) => t.category === filter) : templates;

  const handleDelete = async (t: MessageTemplate) => {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    try { await commDeleteTemplate(t.id); onChanged(); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setFilter("")} className={`text-xs px-2.5 py-1 rounded-full ${filter === "" ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground"}`}>All ({templates.length})</button>
        {categories.map((c) => (
          <button key={c} type="button" onClick={() => setFilter(c)} className={`text-xs px-2.5 py-1 rounded-full capitalize ${filter === c ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground"}`}>{c.replace("_", " ")} ({templates.filter((t) => t.category === c).length})</button>
        ))}
      </div>
      {filtered.length === 0 ? <Card><EmptyState title="No templates" icon={<FileText className="w-5 h-5" />} /></Card> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((t) => {
            const Icon = CHANNEL_ICONS[t.channel_type] || FileText;
            return (
              <Card key={t.id}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-primary" />
                    <div><h3 className="text-sm font-medium">{t.name}</h3><p className="text-[10px] text-muted-foreground font-mono">{t.template_key}</p></div>
                  </div>
                  <button type="button" onClick={() => handleDelete(t)} className="p-1 rounded hover:bg-destructive/10 text-destructive" aria-label={`Delete template ${t.name}`} title="Delete template"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-muted-foreground capitalize">{t.category.replace("_", " ")}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-muted-foreground capitalize">{t.channel_type}</span>
                  <span className="text-[10px] text-muted-foreground">Used {t.usage_count}×</span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{t.body}</p>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Automations View
// ---------------------------------------------------------------------------
function AutomationsView({ workflows, onChanged }: { workflows: AutomationWorkflow[]; onChanged: () => void }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", trigger_type: "user_signup", actions_json: '[{"type":"send_email","template":"welcome","delay_minutes":0}]' });
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await commCreateAutomation({
        name: form.name, trigger_type: form.trigger_type,
        actions: JSON.parse(form.actions_json),
      });
      setCreateOpen(false);
      setForm({ name: "", trigger_type: "user_signup", actions_json: '[{"type":"send_email","template":"welcome","delay_minutes":0}]' });
      onChanged();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleToggle = async (w: AutomationWorkflow) => {
    try { await commUpdateAutomation(w.id, { is_active: !w.is_active }); onChanged(); } catch { /* ignore */ }
  };

  const handleDelete = async (w: AutomationWorkflow) => {
    if (!window.confirm(`Delete workflow "${w.name}"?`)) return;
    try { await commDeleteAutomation(w.id); onChanged(); } catch { /* ignore */ }
  };

  const TRIGGERS = ["user_signup","ticket_created","ticket_resolved","product_update","knowledge_update","training_assigned","training_completed","low_confidence","scheduled","custom"];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" /> New Workflow</Button>
      </div>
      {workflows.length === 0 ? <Card><EmptyState title="No automations" description="Create workflow automations for triggers like user signup, ticket creation, and training completion." icon={<Zap className="w-5 h-5" />} /></Card> : (
        <div className="space-y-2">
          {workflows.map((w) => (
            <Card key={w.id}>
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${w.is_active ? "bg-primary/10 text-primary" : "bg-accent text-muted-foreground"}`}>
                  <Zap className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium">{w.name}</h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-muted-foreground capitalize">{w.trigger_type.replace("_", " ")}</span>
                    {w.is_active ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">Active</span> : <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">Paused</span>}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{w.actions.length} action(s) · Executed {w.execution_count}×</p>
                  <div className="flex items-center gap-1 mt-1">
                    {w.actions.map((a, i) => (
                      <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-accent/50 text-muted-foreground">{String(a.type || a.channel || "action")}</span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button type="button" variant="outline" size="sm" onClick={() => handleToggle(w)} className={w.is_active ? "text-warning border-warning/30" : "text-primary border-primary/30"}>{w.is_active ? "Pause" : "Activate"}</Button>
                  <button type="button" onClick={() => handleDelete(w)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive" aria-label={`Delete workflow ${w.name}`} title="Delete workflow"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Automation Workflow" size="md"
        footer={<><Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button type="button" onClick={handleCreate} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create</Button></>}>
        <div className="space-y-3">
          <div><label className="block text-xs text-muted-foreground mb-1">Name</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. New User Welcome Sequence" className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          </div>
          <div><label className="block text-xs text-muted-foreground mb-1">Trigger</label>
            <select value={form.trigger_type} onChange={(e) => setForm({ ...form, trigger_type: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm">
              {TRIGGERS.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
            </select>
          </div>
          <div><label className="block text-xs text-muted-foreground mb-1">Actions (JSON)</label>
            <textarea value={form.actions_json} onChange={(e) => setForm({ ...form, actions_json: e.target.value })} rows={4} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm font-mono" />
            <p className="text-[10px] text-muted-foreground mt-1">Array of actions: {"[{type, channel, template, delay_minutes}]"}</p>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Integrations View
// ---------------------------------------------------------------------------
function IntegrationsView({ connectors, onChanged }: { connectors: IntegrationConnector[]; onChanged: () => void }) {
  const handleToggle = async (c: IntegrationConnector) => {
    try { await commUpdateIntegration(c.id, { is_enabled: !c.is_enabled }); onChanged(); } catch { /* ignore */ }
  };

  const ICONS: Record<string, string> = {
    crm: "🔗", erp: "📊", inventory: "📦", accounting: "💰", hrms: "👥",
    calendar: "📅", video_meeting: "🎥", cloud_storage: "☁️", document_management: "📄",
    payment_gateway: "💳", custom: "⚙️",
  };

  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-primary/5">
        <div className="flex items-start gap-2">
          <Plug className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Adapter Pattern:</strong> All connectors use a modular adapter architecture.
            No vendor is hardcoded — swap providers (Salesforce↔HubSpot, Razorpay↔Stripe) without code changes.
            Each connector stores encrypted credentials in <code>config</code> JSONB.
          </p>
        </div>
      </Card>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {connectors.map((c) => (
          <Card key={c.id}>
            <div className="flex items-start gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center text-xl shrink-0">{ICONS[c.connector_type] || "⚙️"}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-[10px] text-muted-foreground">{c.provider || "No vendor configured"}</p>
              </div>
              <span className={`w-2 h-2 rounded-full ${c.is_enabled ? "bg-primary" : "bg-muted-foreground"}`} />
            </div>
            <div className="text-xs space-y-0.5">
              <div><span className="text-muted-foreground">Sync:</span> <span className="font-medium capitalize">{c.sync_frequency}</span></div>
              <div><span className="text-muted-foreground">Last sync:</span> <span className="font-medium">{c.last_sync_at ? new Date(c.last_sync_at).toLocaleDateString() : "Never"}</span></div>
              <div><span className="text-muted-foreground">Status:</span> <span className={`font-medium capitalize ${c.last_sync_status === "success" ? "text-primary" : c.last_sync_status === "failed" ? "text-destructive" : ""}`}>{c.last_sync_status}</span></div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => handleToggle(c)} className={`mt-2 w-full ${c.is_enabled ? "text-warning border-warning/30 hover:bg-warning/10" : "text-primary border-primary/30 hover:bg-primary/10"}`}>
              {c.is_enabled ? "Disable" : "Enable"}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Webhooks View
// ---------------------------------------------------------------------------
function WebhooksView({ webhooks, onChanged }: { webhooks: WebhookEndpoint[]; onChanged: () => void }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", event_types: "ticket_created,user_signup" });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [logsFor, setLogsFor] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.url.trim()) return;
    setSaving(true);
    try {
      await commCreateWebhook({ name: form.name, url: form.url, event_types: form.event_types.split(",").map((s) => s.trim()).filter(Boolean) });
      setCreateOpen(false);
      setForm({ name: "", url: "", event_types: "ticket_created,user_signup" });
      onChanged();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleTest = async (w: WebhookEndpoint) => {
    setTesting(w.id);
    try { await commTestWebhook(w.id); onChanged(); } catch { /* ignore */ } finally { setTesting(null); }
  };

  const handleLogs = async (w: WebhookEndpoint) => {
    if (logsFor === w.id) { setLogsFor(null); setLogs([]); return; }
    setLogsFor(w.id);
    try { setLogs(await commWebhookLogs(w.id)); } catch { setLogs([]); }
  };

  const handleDelete = async (w: WebhookEndpoint) => {
    if (!window.confirm(`Delete webhook "${w.name}"?`)) return;
    try { await commDeleteWebhook(w.id); onChanged(); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" /> New Webhook</Button>
      </div>
      {webhooks.length === 0 ? <Card><EmptyState title="No webhooks" icon={<Webhook className="w-5 h-5" />} /></Card> : (
        <div className="space-y-2">
          {webhooks.map((w) => (
            <Card key={w.id}>
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${w.is_active ? "bg-primary/10 text-primary" : "bg-accent text-muted-foreground"}`}>
                  <Webhook className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium">{w.name}</h3>
                    {w.is_active ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">Active</span> : <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">Inactive</span>}
                  </div>
                  <p className="text-[10px] text-muted-foreground font-mono truncate">{w.url}</p>
                  <div className="flex items-center gap-1 mt-1">
                    {w.event_types.slice(0, 3).map((e) => <span key={e} className="text-[9px] px-1.5 py-0.5 rounded bg-accent/50 text-muted-foreground">{e}</span>)}
                    {w.event_types.length > 3 ? <span className="text-[9px] text-muted-foreground">+{w.event_types.length - 3}</span> : null}
                  </div>
                  {w.last_response_status ? (
                    <p className="text-[10px] text-muted-foreground mt-1">Last: {w.last_response_status} · {w.last_triggered_at ? new Date(w.last_triggered_at).toLocaleString() : ""}</p>
                  ) : null}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button type="button" variant="outline" size="sm" onClick={() => handleTest(w)} disabled={testing === w.id} className="text-primary border-primary/30 hover:bg-primary/10">
                    {testing === w.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Test
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => handleLogs(w)}>Logs</Button>
                  <button type="button" onClick={() => handleDelete(w)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive" aria-label={`Delete webhook ${w.name}`} title="Delete webhook"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              {logsFor === w.id ? (
                <div className="mt-2 pt-2 border-t border-border">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">Recent Logs</p>
                  {logs.length === 0 ? <p className="text-[10px] text-muted-foreground">No logs yet</p> : (
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {logs.slice(0, 10).map((l) => (
                        <div key={String(l.id)} className="text-[10px] flex items-center gap-2 p-1 rounded bg-accent/20">
                          {l.is_success ? <CheckCircle className="w-3 h-3 text-primary" /> : <XCircle className="w-3 h-3 text-destructive" />}
                          <span>{String(l.event_type)}</span>
                          <span className="text-muted-foreground">{l.response_status ? `HTTP ${l.response_status}` : l.error_message ? "Error" : ""}</span>
                          <span className="text-muted-foreground ml-auto">{l.created_at ? new Date(String(l.created_at)).toLocaleString() : ""}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Webhook" size="md"
        footer={<><Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button type="button" onClick={handleCreate} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create</Button></>}>
        <div className="space-y-3">
          <div><label className="block text-xs text-muted-foreground mb-1">Name</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          </div>
          <div><label className="block text-xs text-muted-foreground mb-1">URL</label>
            <input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/webhook" className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          </div>
          <div><label className="block text-xs text-muted-foreground mb-1">Event Types (comma-separated)</label>
            <input type="text" value={form.event_types} onChange={(e) => setForm({ ...form, event_types: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analytics View
// ---------------------------------------------------------------------------
function AnalyticsView({ data }: { data: any }) {
  const a = data.aggregates || {};
  const trend: LineChartPoint[] = (data.daily || []).map((d: any) => ({
    label: String(d.metric_date || "").slice(5),
    value: Number(d.messages_sent || 0),
  }));
  const channelBars: BarChartItem[] = (data.daily || []).reduce((acc: BarChartItem[], d: any) => {
    const ct = d.channel_type || "unknown";
    const existing = acc.find((x) => x.label === ct);
    if (existing) existing.value += Number(d.messages_sent || 0);
    else acc.push({ label: ct, value: Number(d.messages_sent || 0) });
    return acc;
  }, []);
  const deliveryDonut: DonutSlice[] = [
    { label: "Delivered", value: a.messages_delivered || 0, color: "var(--primary)" },
    { label: "Failed", value: a.messages_failed || 0, color: "var(--destructive)" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Messages Sent" value={a.messages_sent || 0} icon={<Send className="w-5 h-5" />} />
        <StatCard label="Delivery Rate" value={`${a.delivery_rate_pct || 0}%`} icon={<CheckCircle className="w-5 h-5" />} />
        <StatCard label="Read Rate" value={`${a.read_rate_pct || 0}%`} icon={<Bell className="w-5 h-5" />} />
        <StatCard label="Open Rate" value={`${a.open_rate_pct || 0}%`} icon={<Mail className="w-5 h-5" />} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card><h3 className="text-sm font-semibold mb-3">Message Volume Trend</h3>{trend.length > 0 ? <LineChart data={trend} height={200} /> : <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground">No data</div>}</Card>
        <Card><h3 className="text-sm font-semibold mb-3">Delivery Breakdown</h3>{deliveryDonut[0].value + deliveryDonut[1].value > 0 ? <DonutChart data={deliveryDonut} centerLabel="delivered" centerValue={`${a.delivery_rate_pct || 0}%`} /> : <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground">No data</div>}</Card>
      </div>
      {channelBars.length > 0 ? (
        <Card><h3 className="text-sm font-semibold mb-3">Messages by Channel</h3><BarChart data={channelBars} height={200} horizontal /></Card>
      ) : null}
      {data.recent_campaigns?.length > 0 ? (
        <Card><h3 className="text-sm font-semibold mb-2">Recent Campaigns</h3>
          <div className="space-y-1.5">
            {data.recent_campaigns.slice(0, 5).map((c: Campaign) => (
              <div key={c.id} className="flex items-center gap-2 text-xs p-2 rounded-lg hover:bg-accent/30">
                <span className="flex-1 truncate font-medium">{c.name}</span>
                <span className="text-[10px] text-muted-foreground">{c.channel_type}</span>
                <StatusPill status={c.status} />
                <span className="text-[10px] text-muted-foreground">{c.delivery_rate_pct}% delivered</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
