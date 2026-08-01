import { useCallback, useEffect, useState } from "react";
import {
  Shield, AlertTriangle, CheckCircle, XCircle, Clock, Activity, Lock,
  Brain, FileText, Server, Bug, RefreshCw, Loader2, Plus, Trash2,
  Smartphone, Monitor, Zap, Database,
} from "lucide-react";
import {
  PageHeader, Card, StatCard, LoadingState, ErrorState, EmptyState, btnClass, StatusPill,
} from "../common/AdminUI";
import { Modal, modalButtonClass } from "../common/Modal";
import { DonutChart, type DonutSlice } from "../common/Charts";
import {
  securityDashboard, securityEvents, securitySessions, securityRevokeSession,
  securityDevices, securityToggleDeviceTrust, securityIncidents, securityCreateIncident,
  securityUpdateIncident, securityIncidentTimeline,
  securityAIGovernance, securityComplianceRequests, securityUpdateCompliance,
  securityABACPolicies,
  securityDeleteABAC, securityMonitoring, securityBackups, securityVulnerabilities,
  securityAuditLog, securityPenTestChecklist,
  type SecurityDashboard as SecDash,
} from "../../../lib/api";

type Tab = "overview" | "events" | "incidents" | "sessions" | "devices" | "ai_governance" | "compliance" | "abac" | "monitoring" | "audit" | "backups" | "vulns" | "pentest";

const TABS: { value: Tab; label: string; icon: typeof Shield }[] = [
  { value: "overview", label: "Overview", icon: Shield },
  { value: "events", label: "Security Events", icon: AlertTriangle },
  { value: "incidents", label: "Incidents", icon: Zap },
  { value: "sessions", label: "Sessions", icon: Monitor },
  { value: "devices", label: "Devices", icon: Smartphone },
  { value: "ai_governance", label: "AI Governance", icon: Brain },
  { value: "compliance", label: "Compliance", icon: FileText },
  { value: "abac", label: "ABAC Policies", icon: Lock },
  { value: "monitoring", label: "Monitoring", icon: Activity },
  { value: "audit", label: "Audit Log", icon: Database },
  { value: "backups", label: "Backups", icon: Server },
  { value: "vulns", label: "Vulnerabilities", icon: Bug },
  { value: "pentest", label: "Pen Test", icon: CheckCircle },
];

export function SecurityCenter() {
  const [tab, setTab] = useState<Tab>("overview");
  const [dashData, setDashData] = useState<SecDash | null>(null);
  const [tabData, setTabData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dash = await securityDashboard().catch(() => null);
      setDashData(dash);

      switch (tab) {
        case "events": setTabData(await securityEvents().catch(() => [])); break;
        case "incidents": setTabData(await securityIncidents().catch(() => [])); break;
        case "sessions": setTabData(await securitySessions().catch(() => [])); break;
        case "devices": setTabData(await securityDevices().catch(() => [])); break;
        case "ai_governance": setTabData(await securityAIGovernance().catch(() => [])); break;
        case "compliance": setTabData(await securityComplianceRequests().catch(() => [])); break;
        case "abac": setTabData(await securityABACPolicies().catch(() => [])); break;
        case "monitoring": setTabData(await securityMonitoring().catch(() => null)); break;
        case "audit": setTabData(await securityAuditLog({ limit: 100 }).catch(() => ({ logs: [], total: 0 }))); break;
        case "backups": setTabData(await securityBackups().catch(() => [])); break;
        case "vulns": setTabData(await securityVulnerabilities().catch(() => [])); break;
        case "pentest": setTabData(await securityPenTestChecklist().catch(() => null)); break;
        default: setTabData(null);
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
        title="Security Center"
        description="Enterprise security, governance, compliance & observability"
        icon={<Shield className="w-5 h-5" />}
        actions={<button type="button" className={btnClass.secondary} onClick={load}><RefreshCw className="w-4 h-4" /> Refresh</button>}
      />

      {error ? <ErrorState message={error} /> : null}

      {/* Tabs */}
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
          {tab === "overview" && dashData ? <OverviewTab data={dashData} /> : null}
          {tab === "events" && tabData ? <EventsTab events={tabData} /> : null}
          {tab === "incidents" && tabData ? <IncidentsTab incidents={tabData} onChanged={load} /> : null}
          {tab === "sessions" && tabData ? <SessionsTab sessions={tabData} onChanged={load} /> : null}
          {tab === "devices" && tabData ? <DevicesTab devices={tabData} onChanged={load} /> : null}
          {tab === "ai_governance" && tabData ? <AIGovernanceTab records={tabData} /> : null}
          {tab === "compliance" && tabData ? <ComplianceTab requests={tabData} onChanged={load} /> : null}
          {tab === "abac" && tabData ? <ABACTab policies={tabData} onChanged={load} /> : null}
          {tab === "monitoring" && tabData ? <MonitoringTab data={tabData} /> : null}
          {tab === "audit" && tabData ? <AuditTab data={tabData} /> : null}
          {tab === "backups" && tabData ? <BackupsTab backups={tabData} /> : null}
          {tab === "vulns" && tabData ? <VulnsTab scans={tabData} /> : null}
          {tab === "pentest" && tabData ? <PenTestTab data={tabData} /> : null}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview Tab
// ---------------------------------------------------------------------------
function OverviewTab({ data }: { data: SecDash }) {
  const riskScore = data.risk_score ?? 0;
  const sec = data.security || {};
  const comp = data.compliance || {};

  const riskDonut: DonutSlice[] = [
    { label: "Risk", value: riskScore, color: riskScore > 50 ? "var(--destructive)" : riskScore > 25 ? "var(--warning)" : "var(--primary)" },
    { label: "Safe", value: 100 - riskScore, color: "var(--accent)" },
  ];

  return (
    <div className="space-y-4">
      {/* Risk Score */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Shield className="w-4 h-4 text-primary" /> Security Risk Score</h3>
          <div className="flex items-center justify-center py-4">
            <DonutChart data={riskDonut} centerLabel="risk" centerValue={`${Math.round(riskScore)}`} />
          </div>
          <p className="text-xs text-center text-muted-foreground">
            {riskScore < 25 ? "✅ Low risk — systems healthy" : riskScore < 50 ? "⚠️ Moderate risk — monitor closely" : riskScore < 75 ? "🟠 High risk — action needed" : "🔴 Critical — immediate action required"}
          </p>
        </Card>

        {/* Security KPIs */}
        <Card className="lg:col-span-2">
          <h3 className="text-sm font-semibold mb-3">Security Metrics (24h)</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Critical Events" value={sec.critical_events || 0} icon={<AlertTriangle className="w-5 h-5" />} trend={sec.critical_events > 0 ? "down" : "up"} />
            <StatCard label="Failed Logins" value={sec.failed_logins_24h || 0} icon={<XCircle className="w-5 h-5" />} />
            <StatCard label="Blocked Requests" value={sec.blocked_requests_24h || 0} icon={<Shield className="w-5 h-5" />} />
            <StatCard label="Rate Limited" value={sec.rate_limited_24h || 0} icon={<Zap className="w-5 h-5" />} />
            <StatCard label="Active Sessions" value={sec.active_sessions || 0} icon={<Monitor className="w-5 h-5" />} />
            <StatCard label="Trusted Devices" value={sec.trusted_devices || 0} icon={<Smartphone className="w-5 h-5" />} />
            <StatCard label="MFA Users" value={sec.mfa_enabled_users || 0} icon={<Lock className="w-5 h-5" />} />
            <StatCard label="Open Incidents" value={sec.open_incidents || 0} icon={<Zap className="w-5 h-5" />} trend={sec.open_incidents > 0 ? "down" : "up"} />
          </div>
        </Card>
      </div>

      {/* AI Governance + Compliance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Brain className="w-4 h-4 text-primary" /> AI Governance</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-3 text-center">
              <p className="text-2xl font-semibold text-destructive">{sec.hallucinations_7d || 0}</p>
              <p className="text-[10px] text-muted-foreground">Hallucinations (7d)</p>
            </div>
            <div className="rounded-lg border border-border p-3 text-center">
              <p className="text-2xl font-semibold text-warning">{sec.high_risk_ai || 0}</p>
              <p className="text-[10px] text-muted-foreground">High Risk AI Records</p>
            </div>
          </div>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><FileText className="w-4 h-4 text-primary" /> Compliance</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-3 text-center">
              <p className="text-2xl font-semibold text-warning">{comp.pending_requests || 0}</p>
              <p className="text-[10px] text-muted-foreground">Pending Requests</p>
            </div>
            <div className="rounded-lg border border-border p-3 text-center">
              <p className="text-2xl font-semibold">{comp.active_retention_policies || 0}</p>
              <p className="text-[10px] text-muted-foreground">Retention Policies</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Recent events */}
      {data.recent_events && data.recent_events.length > 0 ? (
        <Card>
          <h3 className="text-sm font-semibold mb-2">Recent Security Events</h3>
          <div className="space-y-1.5">
            {data.recent_events.slice(0, 5).map((e) => (
              <div key={String(e.id)} className="flex items-center gap-2 text-xs p-2 rounded-lg hover:bg-accent/30">
                <span className={`w-1.5 h-1.5 rounded-full ${e.severity === "critical" ? "bg-destructive" : e.severity === "warning" ? "bg-warning" : "bg-primary"}`} />
                <span className="font-medium capitalize">{String(e.event_type || "").replace(/_/g, " ")}</span>
                <span className="text-muted-foreground flex-1 truncate">{String(e.ip_address || "")} · {String(e.location || "")}</span>
                <span className="text-[10px] text-muted-foreground">{e.created_at ? new Date(String(e.created_at)).toLocaleString() : ""}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Events Tab
// ---------------------------------------------------------------------------
function EventsTab({ events }: { events: Array<Record<string, unknown>> }) {
  return (
    <Card className="p-0 overflow-hidden">
      {events.length === 0 ? <div className="p-4"><EmptyState title="No security events" icon={<CheckCircle className="w-5 h-5" />} /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-accent/50 border-b border-border"><tr>
              <th className="px-3 py-2 text-left">Event</th><th className="px-3 py-2 text-left">Severity</th>
              <th className="px-3 py-2 text-left hidden sm:table-cell">IP</th><th className="px-3 py-2 text-left hidden sm:table-cell">Location</th>
              <th className="px-3 py-2 text-left">Time</th><th className="px-3 py-2 text-left">Status</th>
            </tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={String(e.id)} className="border-b border-border last:border-0 hover:bg-accent/20">
                  <td className="px-3 py-2 font-medium capitalize">{String(e.event_type || "").replace(/_/g, " ")}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${e.severity === "critical" ? "bg-destructive/10 text-destructive" : e.severity === "warning" ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary"}`}>{String(e.severity || "info")}</span></td>
                  <td className="px-3 py-2 hidden sm:table-cell text-muted-foreground font-mono">{String(e.ip_address || "—")}</td>
                  <td className="px-3 py-2 hidden sm:table-cell text-muted-foreground">{String(e.location || "—")}</td>
                  <td className="px-3 py-2 text-muted-foreground">{e.created_at ? new Date(String(e.created_at)).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2">{e.is_resolved ? <CheckCircle className="w-3.5 h-3.5 text-primary" /> : <Clock className="w-3.5 h-3.5 text-warning" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Incidents Tab
// ---------------------------------------------------------------------------
function IncidentsTab({ incidents, onChanged }: { incidents: Array<Record<string, unknown>>; onChanged: () => void }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", incident_type: "operational", severity: "medium" });
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<Array<Record<string, unknown>>>([]);

  const handleCreate = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try { await securityCreateIncident(form); setCreateOpen(false); setForm({ title: "", description: "", incident_type: "operational", severity: "medium" }); onChanged(); }
    catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleStatus = async (inc: Record<string, unknown>, status: string) => {
    try { await securityUpdateIncident(String(inc.id), { status }); onChanged(); } catch { /* ignore */ }
  };

  const openTimeline = async (id: string) => {
    if (selected === id) { setSelected(null); return; }
    setSelected(id);
    try { setTimeline(await securityIncidentTimeline(id)); } catch { setTimeline([]); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button type="button" className={btnClass.primary} onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" /> New Incident</button></div>
      {incidents.length === 0 ? <Card><EmptyState title="No incidents" icon={<CheckCircle className="w-5 h-5" />} /></Card> : (
        <div className="space-y-2">
          {incidents.map((inc) => (
            <Card key={String(inc.id)} className={`border-l-4 ${inc.severity === "critical" ? "border-l-destructive" : inc.severity === "high" ? "border-l-warning" : "border-l-border"}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-medium">{String(inc.title || "")}</h3>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${inc.severity === "critical" ? "bg-destructive/10 text-destructive" : inc.severity === "high" ? "bg-warning/10 text-warning" : "bg-accent text-muted-foreground"}`}>{String(inc.severity || "")}</span>
                    <StatusPill status={String(inc.status || "")} />
                  </div>
                  {inc.description ? <p className="text-xs text-muted-foreground">{String(inc.description)}</p> : null}
                  <p className="text-[10px] text-muted-foreground mt-1">Type: {String(inc.incident_type || "")} · Impact: {String(inc.impact || "")} · Opened: {inc.opened_at ? new Date(String(inc.opened_at)).toLocaleString() : ""}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button type="button" onClick={() => openTimeline(String(inc.id))} className="text-xs px-2 py-1 rounded border border-border hover:bg-accent">Timeline</button>
                  {inc.status !== "resolved" && inc.status !== "closed" ? (
                    <button type="button" onClick={() => handleStatus(inc, "resolved")} className="text-xs px-2 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10">Resolve</button>
                  ) : null}
                </div>
              </div>
              {selected === String(inc.id) ? (
                <div className="mt-2 pt-2 border-t border-border">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">Timeline</p>
                  {timeline.length === 0 ? <p className="text-[10px] text-muted-foreground">No entries</p> : (
                    <div className="space-y-1">{timeline.map((t) => (
                      <div key={String(t.id)} className="text-[10px] flex items-center gap-2 p-1 rounded bg-accent/20">
                        <span className="font-medium capitalize">{String(t.event_type || "").replace(/_/g, " ")}</span>
                        <span className="text-muted-foreground flex-1">{String(t.description || "")}</span>
                        <span className="text-muted-foreground">{t.created_at ? new Date(String(t.created_at)).toLocaleString() : ""}</span>
                      </div>
                    ))}</div>
                  )}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Incident" size="sm"
        footer={<><button type="button" className={modalButtonClass.secondary} onClick={() => setCreateOpen(false)}>Cancel</button>
          <button type="button" className={modalButtonClass.primary} onClick={handleCreate} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create</button></>}>
        <div className="space-y-3">
          <div><label className="block text-xs text-muted-foreground mb-1">Title</label><input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" /></div>
          <div><label className="block text-xs text-muted-foreground mb-1">Description</label><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-muted-foreground mb-1">Type</label><select value={form.incident_type} onChange={(e) => setForm({ ...form, incident_type: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"><option value="operational">Operational</option><option value="security">Security</option><option value="system">System</option><option value="data">Data</option><option value="ai">AI</option><option value="compliance">Compliance</option></select></div>
            <div><label className="block text-xs text-muted-foreground mb-1">Severity</label><select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sessions Tab
// ---------------------------------------------------------------------------
function SessionsTab({ sessions, onChanged }: { sessions: Array<Record<string, unknown>>; onChanged: () => void }) {
  return (
    <Card className="p-0 overflow-hidden">
      {sessions.length === 0 ? <div className="p-4"><EmptyState title="No active sessions" icon={<Monitor className="w-5 h-5" />} /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-accent/50 border-b border-border"><tr><th className="px-3 py-2 text-left">User</th><th className="px-3 py-2 text-left">IP</th><th className="px-3 py-2 text-left hidden sm:table-cell">Device</th><th className="px-3 py-2 text-left">Last Active</th><th className="px-3 py-2 text-right">Action</th></tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={String(s.id)} className="border-b border-border last:border-0 hover:bg-accent/20">
                  <td className="px-3 py-2 font-mono text-[10px]">{String(s.user_id || "").slice(0, 8)}…</td>
                  <td className="px-3 py-2 font-mono text-[10px]">{String(s.ip_address || "—")}</td>
                  <td className="px-3 py-2 hidden sm:table-cell text-muted-foreground">{String(s.user_agent || "").slice(0, 30)}…</td>
                  <td className="px-3 py-2 text-muted-foreground">{s.last_activity_at ? new Date(String(s.last_activity_at)).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2 text-right"><button type="button" onClick={async () => { await securityRevokeSession(String(s.id)); onChanged(); }} className="text-[10px] px-2 py-1 rounded border border-destructive/30 text-destructive hover:bg-destructive/10">Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Devices Tab
// ---------------------------------------------------------------------------
function DevicesTab({ devices, onChanged }: { devices: Array<Record<string, unknown>>; onChanged: () => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {devices.length === 0 ? <Card><EmptyState title="No devices" icon={<Smartphone className="w-5 h-5" />} /></Card> : devices.map((d) => (
        <Card key={String(d.id)}>
          <div className="flex items-start gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center shrink-0">
              {String(d.device_type || "") === "mobile" ? <Smartphone className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{String(d.device_name || "Unknown device")}</p>
              <p className="text-[10px] text-muted-foreground">{String(d.ip_address || "")} · {String(d.location || "")}</p>
            </div>
            <span className={`w-2 h-2 rounded-full ${d.is_trusted ? "bg-primary" : "bg-muted-foreground"}`} />
          </div>
          <p className="text-[10px] text-muted-foreground mb-2">Last seen: {d.last_seen_at ? new Date(String(d.last_seen_at)).toLocaleString() : "—"}</p>
          <button type="button" onClick={async () => { await securityToggleDeviceTrust(String(d.id)); onChanged(); }} className={`w-full text-xs px-2 py-1.5 rounded border ${d.is_trusted ? "border-warning/30 text-warning hover:bg-warning/10" : "border-primary/30 text-primary hover:bg-primary/10"}`}>
            {d.is_trusted ? "Untrust" : "Trust Device"}
          </button>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Governance Tab
// ---------------------------------------------------------------------------
function AIGovernanceTab({ records }: { records: Array<Record<string, unknown>> }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Records" value={records.length} icon={<Brain className="w-5 h-5" />} />
        <StatCard label="Hallucinations" value={records.filter((r) => r.hallucination_detected).length} icon={<AlertTriangle className="w-5 h-5" />} trend="down" />
        <StatCard label="Human Overrides" value={records.filter((r) => r.human_override).length} icon={<Shield className="w-5 h-5" />} />
        <StatCard label="High Risk (>70)" value={records.filter((r) => Number(r.risk_score || 0) > 70).length} icon={<AlertTriangle className="w-5 h-5" />} trend="down" />
      </div>
      {records.length === 0 ? <Card><EmptyState title="No AI governance records" icon={<Brain className="w-5 h-5" />} /></Card> : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-accent/50 border-b border-border"><tr><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Model</th><th className="px-3 py-2 text-left">Risk</th><th className="px-3 py-2 text-left">Hallucination</th><th className="px-3 py-2 text-left">Override</th><th className="px-3 py-2 text-left">Time</th></tr></thead>
              <tbody>
                {records.slice(0, 50).map((r) => (
                  <tr key={String(r.id)} className="border-b border-border last:border-0 hover:bg-accent/20">
                    <td className="px-3 py-2 font-medium capitalize">{String(r.record_type || "").replace(/_/g, " ")}</td>
                    <td className="px-3 py-2 text-muted-foreground">{String(r.model_name || "—")}</td>
                    <td className="px-3 py-2"><span className={Number(r.risk_score || 0) > 70 ? "text-destructive font-medium" : Number(r.risk_score || 0) > 40 ? "text-warning" : ""}>{String(r.risk_score || 0)}</span></td>
                    <td className="px-3 py-2">{r.hallucination_detected ? <AlertTriangle className="w-3.5 h-3.5 text-destructive" /> : <CheckCircle className="w-3.5 h-3.5 text-primary" />}</td>
                    <td className="px-3 py-2">{r.human_override ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-warning/10 text-warning">Yes</span> : "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.created_at ? new Date(String(r.created_at)).toLocaleString() : "—"}</td>
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
// Compliance Tab
// ---------------------------------------------------------------------------
function ComplianceTab({ requests, onChanged }: { requests: Array<Record<string, unknown>>; onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-primary/5">
        <div className="flex items-start gap-2">
          <FileText className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Compliance Frameworks:</strong> GDPR (data export/deletion/consent), SOC 2 (audit logs/security monitoring), ISO 27001 (access controls/incident management), HIPAA architecture-ready (encryption/audit). Data retention policies enforce automatic archival/deletion per table.
          </p>
        </div>
      </Card>
      {requests.length === 0 ? <Card><EmptyState title="No compliance requests" icon={<FileText className="w-5 h-5" />} /></Card> : (
        <div className="space-y-2">
          {requests.map((r) => (
            <Card key={String(r.id)}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground capitalize">{String(r.request_type || "").replace(/_/g, " ")}</span>
                    <StatusPill status={String(r.status || "pending")} />
                    {r.priority === "urgent" ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive">URGENT</span> : null}
                  </div>
                  <p className="text-xs">{String(r.user_name || r.user_email || "Anonymous")}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Legal basis: {String(r.legal_basis || "—")} · Created: {r.created_at ? new Date(String(r.created_at)).toLocaleString() : ""}</p>
                </div>
                {r.status === "pending" ? (
                  <div className="flex gap-1 shrink-0">
                    <button type="button" onClick={async () => { await securityUpdateCompliance(String(r.id), { status: "completed", notes: "Processed" }); onChanged(); }} className="text-xs px-2 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10">Complete</button>
                    <button type="button" onClick={async () => { await securityUpdateCompliance(String(r.id), { status: "rejected", notes: "Rejected" }); onChanged(); }} className="text-xs px-2 py-1 rounded border border-destructive/30 text-destructive hover:bg-destructive/10">Reject</button>
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ABAC Tab
// ---------------------------------------------------------------------------
function ABACTab({ policies, onChanged }: { policies: Array<Record<string, unknown>>; onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-primary/5">
        <div className="flex items-start gap-2">
          <Lock className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">ABAC (Attribute-Based Access Control):</strong> Policies evaluate user attributes (department, region, role, device trust, time, IP) against resource conditions. Combined with RBAC for defense-in-depth.
          </p>
        </div>
      </Card>
      {policies.length === 0 ? <Card><EmptyState title="No ABAC policies" icon={<Lock className="w-5 h-5" />} /></Card> : (
        <div className="space-y-2">
          {policies.map((p) => (
            <Card key={String(p.id)}>
              <div className="flex items-start gap-3">
                <Lock className={`w-4 h-4 mt-0.5 shrink-0 ${p.is_active ? "text-primary" : "text-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium">{String(p.name || "")}</h3>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${p.effect === "allow" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>{String(p.effect || "")}</span>
                    {p.is_active ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">Active</span> : null}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Resource: {String(p.resource_type || "")}/{String(p.resource_id || "*")} · Action: {String(p.action || "")} · Priority: {String(p.priority || "")}</p>
                </div>
                <button type="button" onClick={async () => { await securityDeleteABAC(String(p.id)); onChanged(); }} className="p-1.5 rounded hover:bg-destructive/10 text-destructive shrink-0" aria-label="Delete ABAC policy" title="Delete policy"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monitoring Tab
// ---------------------------------------------------------------------------
function MonitoringTab({ data }: { data: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Blocked (24h)" value={data.blocked_requests_24h || 0} icon={<Shield className="w-5 h-5" />} />
        <StatCard label="Queued Tasks" value={data.task_queue?.queued || 0} icon={<Clock className="w-5 h-5" />} />
        <StatCard label="Processing" value={data.task_queue?.processing || 0} icon={<Activity className="w-5 h-5" />} />
        <StatCard label="Failed Tasks" value={data.task_queue?.failed || 0} icon={<XCircle className="w-5 h-5" />} trend="down" />
      </div>
      {data.recent_api_logs && data.recent_api_logs.length > 0 ? (
        <Card>
          <h3 className="text-sm font-semibold mb-2">Recent API Requests</h3>
          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {data.recent_api_logs.slice(0, 20).map((log: any) => (
              <div key={String(log.id)} className="flex items-center gap-2 text-[10px] p-1.5 rounded hover:bg-accent/30">
                {log.is_blocked ? <XCircle className="w-3 h-3 text-destructive" /> : <CheckCircle className="w-3 h-3 text-primary" />}
                <span className="font-mono w-16">{String(log.method || "")}</span>
                <span className="flex-1 truncate">{String(log.endpoint || "")}</span>
                <span className="text-muted-foreground">{String(log.status_code || "")}</span>
                <span className="text-muted-foreground">{log.response_time_ms ? `${log.response_time_ms}ms` : ""}</span>
                <span className="text-muted-foreground font-mono">{String(log.ip_address || "").slice(0, 12)}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit Tab
// ---------------------------------------------------------------------------
function AuditTab({ data }: { data: { logs: Array<Record<string, unknown>>; total: number } }) {
  return (
    <Card className="p-0 overflow-hidden">
      {data.logs.length === 0 ? <div className="p-4"><EmptyState title="No audit logs" icon={<Database className="w-5 h-5" />} /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-accent/50 border-b border-border"><tr>
              <th className="px-3 py-2 text-left">Time</th><th className="px-3 py-2 text-left">Action</th>
              <th className="px-3 py-2 text-left">Entity</th><th className="px-3 py-2 text-left hidden sm:table-cell">By</th>
              <th className="px-3 py-2 text-left hidden lg:table-cell">Metadata</th>
            </tr></thead>
            <tbody>
              {data.logs.slice(0, 50).map((l) => (
                <tr key={String(l.id)} className="border-b border-border last:border-0 hover:bg-accent/20 align-top">
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{l.created_at ? new Date(String(l.created_at)).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${String(l.action || "").includes("DELETE") ? "bg-destructive/10 text-destructive" : String(l.action || "").includes("CREATE") || String(l.action || "").includes("UPLOAD") ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{String(l.action || "").replace(/_/g, " ")}</span></td>
                  <td className="px-3 py-2"><div className="font-medium">{String(l.entity_type || "—")}</div><div className="text-[10px] text-muted-foreground font-mono">{String(l.entity_id || "").slice(0, 12)}</div></td>
                  <td className="px-3 py-2 hidden sm:table-cell text-muted-foreground font-mono text-[10px]">{String(l.created_by || "").slice(0, 8) || "system"}…</td>
                  <td className="px-3 py-2 hidden lg:table-cell"><pre className="text-[10px] text-muted-foreground max-h-16 overflow-auto">{l.metadata ? JSON.stringify(l.metadata, null, 1) : "—"}</pre></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Backups Tab
// ---------------------------------------------------------------------------
function BackupsTab({ backups }: { backups: Array<Record<string, unknown>> }) {
  return (
    <div className="space-y-2">
      {backups.length === 0 ? <Card><EmptyState title="No backup records" icon={<Server className="w-5 h-5" />} /></Card> : backups.map((b) => (
        <Card key={String(b.id)}>
          <div className="flex items-center gap-3">
            <Server className={`w-4 h-4 shrink-0 ${b.status === "completed" ? "text-primary" : b.status === "failed" ? "text-destructive" : "text-warning"}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium capitalize">{String(b.backup_type || "")}</span>
                <StatusPill status={String(b.status || "")} />
                {b.is_encrypted ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">🔒 Encrypted</span> : null}
              </div>
              <p className="text-[10px] text-muted-foreground">{b.size_bytes ? `${(Number(b.size_bytes) / 1024 / 1024).toFixed(1)} MB` : ""} · {b.completed_at ? new Date(String(b.completed_at)).toLocaleString() : "In progress"}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vulnerabilities Tab
// ---------------------------------------------------------------------------
function VulnsTab({ scans }: { scans: Array<Record<string, unknown>> }) {
  return (
    <div className="space-y-4">
      {scans.length === 0 ? <Card><EmptyState title="No vulnerability scans" description="Run security scans to identify potential vulnerabilities." icon={<Bug className="w-5 h-5" />} /></Card> : scans.map((s) => (
        <Card key={String(s.id)}>
          <div className="flex items-start gap-3 mb-2">
            <Bug className={`w-4 h-4 mt-0.5 shrink-0 ${Number(s.critical_count) > 0 ? "text-destructive" : "text-primary"}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium capitalize">{String(s.scan_type || "").replace(/_/g, " ")} Scan</h3>
                <StatusPill status={String(s.status || "")} />
              </div>
              <p className="text-[10px] text-muted-foreground">{String(s.scanner_name || "")} · {s.created_at ? new Date(String(s.created_at)).toLocaleString() : ""}</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div className="text-center rounded-lg border border-destructive/20 p-2"><p className="text-lg font-semibold text-destructive">{String(s.critical_count || 0)}</p><p className="text-[9px] text-muted-foreground">Critical</p></div>
            <div className="text-center rounded-lg border border-warning/20 p-2"><p className="text-lg font-semibold text-warning">{String(s.high_count || 0)}</p><p className="text-[9px] text-muted-foreground">High</p></div>
            <div className="text-center rounded-lg border border-border p-2"><p className="text-lg font-semibold">{String(s.medium_count || 0)}</p><p className="text-[9px] text-muted-foreground">Medium</p></div>
            <div className="text-center rounded-lg border border-border p-2"><p className="text-lg font-semibold text-muted-foreground">{String(s.low_count || 0)}</p><p className="text-[9px] text-muted-foreground">Low</p></div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pen Test Tab
// ---------------------------------------------------------------------------
function PenTestTab({ data }: { data: { checks: Array<Record<string, unknown>>; total: number; passed: number; failed: number; score: number } | null }) {
  if (!data) return <Card><EmptyState title="No pen test data" icon={<CheckCircle className="w-5 h-5" />} /></Card>;
  return (
    <div className="space-y-4">
      <Card className={`${data.score === 100 ? "border-primary/30 bg-primary/5" : "border-warning/30 bg-warning/5"}`}>
        <div className="flex items-center gap-3">
          {data.score === 100 ? <CheckCircle className="w-8 h-8 text-primary" /> : <AlertTriangle className="w-8 h-8 text-warning" />}
          <div>
            <p className="text-lg font-semibold">{data.score}% Pass Rate</p>
            <p className="text-xs text-muted-foreground">{data.passed} of {data.total} checks passed · {data.failed} failed</p>
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {data.checks.map((c) => (
          <Card key={String(c.id)} className="flex items-start gap-3">
            {c.status === "pass" ? <CheckCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" /> : <XCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />}
            <div>
              <p className="text-sm font-medium">{String(c.name || "")}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{String(c.notes || "")}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
